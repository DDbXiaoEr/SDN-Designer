import { createCloudContext, resolveNextHopNode, parsePortRange, resolveVpcRegion, instanceLoginAuth, hclLines } from './common.js'
import { translate } from '../../i18n/index.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'huaweicloud_vpc',
  subnet: 'huaweicloud_vpc_subnet',
  instance: 'huaweicloud_compute_instance',
  securityGroup: 'huaweicloud_networking_secgroup',
  securityGroupRule: 'huaweicloud_networking_secgroup_rule',
  eip: 'huaweicloud_vpc_eip',
  natGateway: 'huaweicloud_nat_gateway',
  routeTable: 'huaweicloud_vpc_route_table',
  routeEntry: 'huaweicloud_vpc_route',
}

const providerBlock = () => `terraform {
  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = "~> 1.60"
    }
  }
}

provider "huaweicloud" {
  region     = var.region
  access_key = var.access_key
  secret_key = var.secret_key
}
`

const variablesBlock = (region) => `variable "region" {
  type    = string
  default = "${region}"
}

variable "access_key" {
  type        = string
  description = "${tt('huaweiAccessKey')}"
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('huaweiSecretKey')}"
  sensitive   = true
}
`

function hwProtocol(protocol) {
  if (protocol === 'all') return ''
  return protocol
}

function huaweiChargeRows(chargeType) {
  if (chargeType === 'subscription') {
    return [
      ['charging_mode', '"prePaid"'],
      ['period_unit', '"month"'],
      ['period', '1'],
    ]
  }
  if (chargeType === 'spot') {
    return [
      ['charging_mode', '"spot"'],
      ['spot_maximum_price', '"0.5"'],
    ]
  }
  return [['charging_mode', '"postPaid"']]
}

export function exportHuaweiTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'cn-north-4')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "huaweicloud_vpc" "${ctx.name(vpc)}" {
  name = "${vpc.data.name}"
  cidr = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "huaweicloud_vpc_subnet" "${ctx.name(sub)}" {
  name              = "${sub.data.name}"
  cidr              = "${sub.data.cidr}"
  vpc_id            = ${vpcRef}
  availability_zone = "${sub.data.zone}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    blocks.push(`resource "huaweicloud_networking_secgroup" "${ctx.name(sg)}" {
  name = "${sg.data.name}"
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const port = parsePortRange(rule.port, rule.protocol)
      const min = port ? port.from : 'null'
      const max = port ? port.to : 'null'
      blocks.push(`resource "huaweicloud_networking_secgroup_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  direction         = "${rule.direction}"
  protocol          = "${hwProtocol(rule.protocol)}"
  port_range_min    = ${min}
  port_range_max    = ${max}
  remote_ip_prefix  = "${rule.cidr}"
  security_group_id = ${ref(sg)}.id
  description       = "${rule.description || ''}"
}`)
    })
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const chargeMode = eip.data.internetChargeType === 'payByBandwidth' ? 'bandwidth' : 'traffic'
    blocks.push(`resource "huaweicloud_vpc_eip" "${ctx.name(eip)}" {
  publicip {
    type = "5_bgp"
  }
  bandwidth {
    name        = "${eip.data.name}"
    share_type  = "PER"
    size        = ${Number(eip.data.bandwidth) || 5}
    charge_mode = "${chargeMode}"
  }
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "huaweicloud_compute_eip_associate" "${ctx.name(eip)}_${i}" {
  public_ip   = ${ref(eip)}.address
  instance_id = ${ref(inst)}.id
}`)
      })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    const subRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    blocks.push(`resource "huaweicloud_nat_gateway" "${ctx.name(gw)}" {
  name      = "${gw.data.name}"
  vpc_id    = ${vpcRef}
  subnet_id = ${subRef}
  spec      = "1"
}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const subRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgNames = sgs.map((s) => `"${s.data.name}"`)
    const auth = instanceLoginAuth(inst.data)
    const rows = [
      ['name', `"${inst.data.name}"`],
      ['image_id', `"${inst.data.imageId}"`],
      ['flavor_id', `"${inst.data.instanceType}"`],
      ...huaweiChargeRows(inst.data.chargeType),
    ]
    if (auth.value) {
      rows.push(
        auth.type === 'password'
          ? ['admin_pass', `"${auth.value}"`]
          : ['key_pair', `"${auth.value}"`]
      )
    }
    if (sgNames.length) rows.push(['security_groups', `[${sgNames.join(', ')}]`])
    blocks.push(`resource "huaweicloud_compute_instance" "${ctx.name(inst)}" {
${hclLines(rows)}

  network {
    uuid        = ${subRef}
    fixed_ip_v4 = "${inst.data.privateIp}"
  }
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "huaweicloud_vpc_route_table" "${ctx.name(rt)}" {
  name   = "${rt.data.name}"
  vpc_id = ${vpcRef}
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      const hop = resolveNextHopNode(ctx, route, vpc)
      let type
      let nexthop
      if (route.nextHop) {
        type = route.nextHopType === 'Instance' ? 'ecs' : route.nextHopType === 'NatGateway' ? 'nat' : 'vpn'
        nexthop = route.nextHop
      } else if (hop && route.nextHopType === 'NatGateway') {
        type = 'nat'
        nexthop = ref(hop) + '.id'
      } else if (hop && route.nextHopType === 'Instance') {
        type = 'ecs'
        nexthop = ref(hop) + '.id'
      } else {
        type = 'nat'
        nexthop = `"" # ${tt('fillNextHop')}`
      }
      blocks.push(`resource "huaweicloud_vpc_route" "${ctx.name(rt)}_${i}" {
  vpc_id      = ${vpcRef}
  destination = "${route.destination}"
  type        = "${type}"
  nexthop     = ${nexthop}
}`)
    })
  }

  return {
    provider: providerBlock(),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
  }
}
