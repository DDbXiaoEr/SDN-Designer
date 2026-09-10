import { createCloudContext, resolveNextHopNode, parsePortRange } from './common.js'
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

const header = `terraform {
  required_providers {
    huaweicloud = {
      source  = "huaweicloud/huaweicloud"
      version = "~> 1.60"
    }
  }
}

provider "huaweicloud" {
  region = var.region
}

variable "region" {
  type    = string
  default = "cn-north-4"
}
`

function hwProtocol(protocol) {
  if (protocol === 'all') return ''
  return protocol
}

export function exportHuaweiTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const blocks = [header]

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

  const eips = nodes.filter((n) => n.type === 'Gateway' && n.data.kind === 'eip')
  for (const eip of eips) {
    blocks.push(`resource "huaweicloud_vpc_eip" "${ctx.name(eip)}" {
  bandwidth {
    share_type = "PER"
    size       = 100
  }
}`)
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway' && n.data.kind !== 'eip')) {
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
    const sgLine = sgNames.length ? `\n  security_groups = [${sgNames.join(', ')}]` : ''
    blocks.push(`resource "huaweicloud_compute_instance" "${ctx.name(inst)}" {
  name      = "${inst.data.name}"
  image_id  = "${inst.data.imageId}"
  flavor_id = "${inst.data.instanceType}"

  network {
    uuid        = ${subRef}
    fixed_ip_v4 = "${inst.data.privateIp}"
  }${sgLine}
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

  return blocks.join('\n\n') + '\n'
}
