import { createCloudContext, resolveNextHopNode, resolveVpcRegion, resolveZone, instanceLoginAuth, collectKeyPairs, hclLines, clean } from './common.js'
import { translate } from '../../i18n/index.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'alicloud_vpc',
  subnet: 'alicloud_vswitch',
  instance: 'alicloud_instance',
  securityGroup: 'alicloud_security_group',
  securityGroupRule: 'alicloud_security_group_rule',
  eip: 'alicloud_eip',
  natGateway: 'alicloud_nat_gateway',
  routeTable: 'alicloud_route_table',
  routeEntry: 'alicloud_route_entry',
}

const providerBlock = () => `terraform {
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = ">= 1.200.0"
    }
  }
}

provider "alicloud" {
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
  description = "${tt('aliyunAccessKey')}"
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('aliyunSecretKey')}"
  sensitive   = true
}
`

function aliyunChargeRows(chargeType) {
  if (chargeType === 'subscription') {
    return [
      ['instance_charge_type', '"PrePaid"'],
      ['period_unit', '"Month"'],
      ['period', '1'],
    ]
  }
  if (chargeType === 'spot') {
    return [
      ['instance_charge_type', '"PostPaid"'],
      ['spot_strategy', '"SpotAsPriceGo"'],
    ]
  }
  return [['instance_charge_type', '"PostPaid"']]
}

export function exportAliyunTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'cn-hangzhou')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "alicloud_vpc" "${ctx.name(vpc)}" {
  vpc_name   = "${clean(vpc.data.name)}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_vswitch" "${ctx.name(sub)}" {
  vpc_id       = ${vpcRef}
  vswitch_name = "${clean(sub.data.name)}"
  cidr_block   = "${sub.data.cidr}"
  zone_id      = "${resolveZone(sub.data.zone, vpc?.data.region || region, 'aliyun')}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    const vpc = findVpc(sg)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_security_group" "${ctx.name(sg)}" {
  security_group_name = "${clean(sg.data.name)}"
  vpc_id              = ${vpcRef}
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const ipProtocol = rule.protocol === 'icmp' ? 'icmp' : rule.protocol === 'all' ? 'all' : rule.protocol
      const portRange = rule.protocol === 'icmp' || rule.protocol === 'all' ? '-1/-1' : rule.port
      blocks.push(`resource "alicloud_security_group_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  type              = "${rule.direction}"
  ip_protocol       = "${ipProtocol}"
  port_range        = "${portRange}"
  security_group_id = ${ref(sg)}.id
  cidr_ip           = "${rule.cidr}"
  description       = "${rule.description || ''}"
}`)
    })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : '""'
    const vswRef = sub ? ref(sub) + '.id' : '""'
    blocks.push(`resource "alicloud_nat_gateway" "${ctx.name(gw)}" {
  vpc_id           = ${vpcRef}
  vswitch_id       = ${vswRef}
  nat_gateway_name = "${clean(gw.data.name)}"
  nat_type         = "Enhanced"
}`)
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const internetChargeType =
      eip.data.internetChargeType === 'payByBandwidth' ? 'PayByBandwidth' : 'PayByTraffic'
    blocks.push(`resource "alicloud_eip" "${ctx.name(eip)}" {
  bandwidth            = "${eip.data.bandwidth}"
  internet_charge_type = "${internetChargeType}"
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "alicloud_eip_association" "${ctx.name(eip)}_${i}" {
  allocation_id = ${ref(eip)}.id
  instance_id   = ${ref(inst)}.id
}`)
      })
  }

  const keyPairs = collectKeyPairs(nodes)
  for (const [keyName, resName] of keyPairs) {
    blocks.push(`resource "alicloud_key_pair" "${resName}" {
  key_name = "${keyName}"
  key_file = "${keyName}.pem"
}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const auth = instanceLoginAuth(inst.data)
    const rows = [
      ['instance_name', `"${clean(inst.data.name)}"`],
      ['instance_type', `"${inst.data.instanceType}"`],
      ['image_id', `"${inst.data.imageId}"`],
      ...aliyunChargeRows(inst.data.chargeType),
      ['vswitch_id', vswRef],
      ['private_ip', `"${inst.data.privateIp}"`],
      ['internet_max_bandwidth_out', '0'],
      ['system_disk_size', '40'],
    ]
    if (sgRefs.length) rows.push(['security_groups', `[${sgRefs.join(', ')}]`])
    if (auth.value) {
      if (auth.type === 'password') {
        rows.push(['password', `"${auth.value}"`])
      } else {
        const keyName = clean(auth.value)
        const resName = keyPairs.get(keyName)
        rows.push(['key_name', `alicloud_key_pair.${resName}.key_name`])
      }
    }
    blocks.push(`resource "alicloud_instance" "${ctx.name(inst)}" {
${hclLines(rows)}
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_route_table" "${ctx.name(rt)}" {
  vpc_id           = ${vpcRef}
  route_table_name = "${clean(rt.data.name)}"
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      let nexthopId = route.nextHop
      if (!nexthopId) {
        const hop = resolveNextHopNode(ctx, route, vpc)
        if (hop) nexthopId = ref(hop) + '.id'
      }
      if (!nexthopId) nexthopId = `"" # ${tt('fillNextHop')}`
      blocks.push(`resource "alicloud_route_entry" "${ctx.name(rt)}_${i}" {
  route_table_id        = ${ref(rt)}.id
  destination_cidrblock = "${route.destination}"
  nexthop_type          = "${route.nextHopType}"
  nexthop_id            = ${nexthopId}
}`)
    })
  }

  return {
    provider: providerBlock(),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
  }
}
