import { createCloudContext, resolveNextHopNode, resolveVpcRegion, instanceLoginAuth, hclLines } from './common.js'
import { translate } from '../../i18n/index.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'tencentcloud_vpc',
  subnet: 'tencentcloud_subnet',
  instance: 'tencentcloud_instance',
  securityGroup: 'tencentcloud_security_group',
  securityGroupRule: 'tencentcloud_security_group_rule',
  eip: 'tencentcloud_eip',
  natGateway: 'tencentcloud_nat_gateway',
  routeTable: 'tencentcloud_route_table',
  routeEntry: 'tencentcloud_route_entry',
}

const providerBlock = () => `terraform {
  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
      version = "~> 1.81"
    }
  }
}

provider "tencentcloud" {
  region     = var.region
  secret_id  = var.secret_id
  secret_key = var.secret_key
}
`

const variablesBlock = (region) => `variable "region" {
  type    = string
  default = "${region}"
}

variable "secret_id" {
  type        = string
  description = "${tt('tencentSecretId')}"
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('tencentSecretKey')}"
  sensitive   = true
}
`

function tcProtocol(protocol) {
  if (protocol === 'all') return 'ALL'
  if (protocol === 'icmp') return 'ICMP'
  return protocol.toUpperCase()
}

function tencentChargeRows(chargeType) {
  if (chargeType === 'subscription') {
    return [
      ['instance_charge_type', '"PREPAID"'],
      ['instance_charge_type_prepaid_period', '1'],
    ]
  }
  if (chargeType === 'spot') {
    return [
      ['instance_charge_type', '"SPOTPAID"'],
      ['spot_instance_type', '"ONE-TIME"'],
      ['spot_max_price', '"0.50"'],
    ]
  }
  return [['instance_charge_type', '"POSTPAID_BY_HOUR"']]
}

export function exportTencentTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'ap-guangzhou')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "tencentcloud_vpc" "${ctx.name(vpc)}" {
  name       = "${vpc.data.name}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_subnet" "${ctx.name(sub)}" {
  vpc_id            = ${vpcRef}
  name              = "${sub.data.name}"
  cidr_block        = "${sub.data.cidr}"
  availability_zone = "${sub.data.zone}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    blocks.push(`resource "tencentcloud_security_group" "${ctx.name(sg)}" {
  name = "${sg.data.name}"
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const portRange = rule.protocol === 'icmp' || rule.protocol === 'all' ? 'ALL' : rule.port
      blocks.push(`resource "tencentcloud_security_group_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  security_group_id = ${ref(sg)}.id
  type              = "${rule.direction}"
  cidr_ip           = "${rule.cidr}"
  ip_protocol       = "${tcProtocol(rule.protocol)}"
  port_range        = "${portRange}"
  policy            = "ACCEPT"
  description       = "${rule.description || ''}"
}`)
    })
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const internetChargeType =
      eip.data.internetChargeType === 'payByBandwidth'
        ? 'BANDWIDTH_POSTPAID_BY_HOUR'
        : 'TRAFFIC_POSTPAID_BY_HOUR'
    blocks.push(`resource "tencentcloud_eip" "${ctx.name(eip)}" {
  name                       = "${eip.data.name}"
  internet_charge_type       = "${internetChargeType}"
  internet_max_bandwidth_out = ${Number(eip.data.bandwidth) || 5}
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "tencentcloud_eip_association" "${ctx.name(eip)}_${i}" {
  eip_id      = ${ref(eip)}.id
  instance_id = ${ref(inst)}.id
}`)
      })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_nat_gateway" "${ctx.name(gw)}" {
  name           = "${gw.data.name}"
  vpc_id         = ${vpcRef}
  bandwidth      = 100
  max_concurrent = 1000000
}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vpc = findVpc(inst)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    const subRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const auth = instanceLoginAuth(inst.data)
    const rows = [
      ['instance_name', `"${inst.data.name}"`],
      ['image_id', `"${inst.data.imageId}"`],
      ['instance_type', `"${inst.data.instanceType}"`],
      ...tencentChargeRows(inst.data.chargeType),
      ['vpc_id', vpcRef],
      ['subnet_id', subRef],
      ['private_ip', `"${inst.data.privateIp}"`],
    ]
    if (sgRefs.length) rows.push(['security_groups', `[${sgRefs.join(', ')}]`])
    if (auth.value) {
      rows.push(
        auth.type === 'password'
          ? ['password', `"${auth.value}"`]
          : ['key_ids', `["${auth.value}"]`]
      )
    }
    blocks.push(`resource "tencentcloud_instance" "${ctx.name(inst)}" {
${hclLines(rows)}
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_route_table" "${ctx.name(rt)}" {
  name   = "${rt.data.name}"
  vpc_id = ${vpcRef}
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      const hop = resolveNextHopNode(ctx, route, vpc)
      let nextType
      let nextHub
      if (route.nextHop) {
        nextType = route.nextHopType === 'Instance' ? 'CVM' : route.nextHopType === 'NatGateway' ? 'NAT' : 'VPN'
        nextHub = route.nextHop
      } else if (hop && route.nextHopType === 'NatGateway') {
        nextType = 'NAT'
        nextHub = ref(hop) + '.id'
      } else if (hop && route.nextHopType === 'Instance') {
        nextType = 'CVM'
        nextHub = ref(hop) + '.id'
      } else {
        nextType = 'NAT'
        nextHub = `"" # ${tt('fillNextHop')}`
      }
      blocks.push(`resource "tencentcloud_route_entry" "${ctx.name(rt)}_${i}" {
  route_table_id         = ${ref(rt)}.id
  destination_cidr_block = "${route.destination}"
  next_type              = "${nextType}"
  next_hub               = ${nextHub}
}`)
    })
  }

  return {
    provider: providerBlock(),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
  }
}
