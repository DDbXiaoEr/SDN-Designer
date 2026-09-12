import { createCloudContext, resolveNextHopNode, resolveVpcRegion } from './common.js'
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

const header = (region) => `terraform {
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = ">= 1.200.0"
    }
  }
}

provider "alicloud" {
  region = var.region
}

variable "region" {
  type    = string
  default = "${region}"
}
`

export function exportAliyunTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const blocks = [header(resolveVpcRegion(nodes, 'cn-hangzhou'))]

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "alicloud_vpc" "${ctx.name(vpc)}" {
  vpc_name   = "${vpc.data.name}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_vswitch" "${ctx.name(sub)}" {
  vpc_id       = ${vpcRef}
  vswitch_name = "${sub.data.name}"
  cidr_block   = "${sub.data.cidr}"
  zone_id      = "${sub.data.zone}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    const vpc = findVpc(sg)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_security_group" "${ctx.name(sg)}" {
  name   = "${sg.data.name}"
  vpc_id = ${vpcRef}
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
    if (gw.data.kind === 'eip') {
      blocks.push(`resource "alicloud_eip" "${ctx.name(gw)}" {
  bandwidth            = "100"
  internet_charge_type = "PayByTraffic"
}`)
    } else {
      const sub = findSubnet(gw)
      const vpc = findVpc(gw)
      const vpcRef = vpc ? ref(vpc) + '.id' : '""'
      const vswRef = sub ? ref(sub) + '.id' : '""'
      blocks.push(`resource "alicloud_nat_gateway" "${ctx.name(gw)}" {
  vpc_id           = ${vpcRef}
  vswitch_id       = ${vswRef}
  nat_gateway_name = "${gw.data.name}"
  nat_type         = "Enhanced"
}`)
    }
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const sgLine = sgRefs.length ? `\n  security_groups            = [${sgRefs.join(', ')}]` : ''
    blocks.push(`resource "alicloud_instance" "${ctx.name(inst)}" {
  instance_name              = "${inst.data.name}"
  instance_type              = "${inst.data.instanceType}"
  image_id                   = "${inst.data.imageId}"
  vswitch_id                 = ${vswRef}${sgLine}
  private_ip                 = "${inst.data.privateIp}"
  internet_max_bandwidth_out = 0
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_route_table" "${ctx.name(rt)}" {
  vpc_id           = ${vpcRef}
  route_table_name = "${rt.data.name}"
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

  return blocks.join('\n\n') + '\n'
}
