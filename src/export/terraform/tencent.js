import { createCloudContext, resolveNextHopNode } from './common.js'
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

const header = `terraform {
  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
      version = "~> 1.81"
    }
  }
}

provider "tencentcloud" {
  region = var.region
}

variable "region" {
  type    = string
  default = "ap-guangzhou"
}
`

function tcProtocol(protocol) {
  if (protocol === 'all') return 'ALL'
  if (protocol === 'icmp') return 'ICMP'
  return protocol.toUpperCase()
}

export function exportTencentTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const blocks = [header]

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

  const eips = nodes.filter((n) => n.type === 'Gateway' && n.data.kind === 'eip')
  for (const eip of eips) {
    blocks.push(`resource "tencentcloud_eip" "${ctx.name(eip)}" {
  name = "${eip.data.name}"
}`)
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway' && n.data.kind !== 'eip')) {
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
    const sgLine = sgRefs.length ? `\n  security_groups = [${sgRefs.join(', ')}]` : ''
    blocks.push(`resource "tencentcloud_instance" "${ctx.name(inst)}" {
  instance_name = "${inst.data.name}"
  image_id      = "${inst.data.imageId}"
  instance_type = "${inst.data.instanceType}"
  vpc_id        = ${vpcRef}
  subnet_id     = ${subRef}
  private_ip    = "${inst.data.privateIp}"${sgLine}
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

  return blocks.join('\n\n') + '\n'
}
