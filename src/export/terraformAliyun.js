import { buildGraph, slug } from './utils.js'
import { translate } from '../i18n/index.js'

const tt = (key) => translate(`export.${key}`)

// 生成阿里云 Terraform 资源定义
export function exportAliyunTerraform(nodes, edges) {
  const { byId, sourceNodes, targetNodes } = buildGraph(nodes, edges)
  const blocks = []

  // 每个节点生成唯一资源名
  const resourceNames = new Map() // nodeId -> terraform 资源名
  function assignUniqueNames(type) {
    const seen = new Map()
    for (const n of nodes.filter((x) => x.type === type)) {
      const base = slug(n.data.name) || 'unnamed'
      const count = (seen.get(base) || 0) + 1
      seen.set(base, count)
      resourceNames.set(n.id, count === 1 ? base : `${base}_${count}`)
    }
  }
  ;['VPC', 'Subnet', 'Instance', 'SecurityGroup', 'Gateway', 'RouteTable'].forEach(assignUniqueNames)

  const ref = (node) => {
    const type = node.type
    const name = resourceNames.get(node.id)
    if (type === 'Subnet') return `alicloud_vswitch.${name}`
    if (type === 'VPC') return `alicloud_vpc.${name}`
    if (type === 'Instance') return `alicloud_instance.${name}`
    if (type === 'SecurityGroup') return `alicloud_security_group.${name}`
    if (type === 'Gateway') return node.data.kind === 'eip' ? `alicloud_eip.${name}` : `alicloud_nat_gateway.${name}`
    if (type === 'RouteTable') return `alicloud_route_table.${name}`
    return null
  }

  // 解析节点所属 VPC
  function findVpc(node, depth = 0) {
    if (depth > 6 || !node) return null
    if (node.type === 'VPC') return node
    const candidates = sourceNodes(node.id)
    const directVpc = candidates.find((n) => n.type === 'VPC')
    if (directVpc) return directVpc
    const subnet = candidates.find((n) => n.type === 'Subnet')
    if (subnet) return findVpc(subnet, depth + 1)
    const inst = candidates.find((n) => n.type === 'Instance')
    if (inst) return findVpc(inst, depth + 1)
    return null
  }

  function findSubnet(node) {
    if (!node) return null
    if (node.type === 'Subnet') return node
    return sourceNodes(node.id).find((n) => n.type === 'Subnet') || null
  }

  // 头部
  blocks.push(`terraform {
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
  default = "cn-hangzhou"
}
`)

  // VPC
  const vpcs = nodes.filter((n) => n.type === 'VPC')
  for (const vpc of vpcs) {
    blocks.push(`resource "alicloud_vpc" "${resourceNames.get(vpc.id)}" {
  vpc_name   = "${vpc.data.name}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  // Subnet (VSwitch)
  const subnets = nodes.filter((n) => n.type === 'Subnet')
  for (const sub of subnets) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_vswitch" "${resourceNames.get(sub.id)}" {
  vpc_id       = ${vpcRef}
  vswitch_name = "${sub.data.name}"
  cidr_block   = "${sub.data.cidr}"
  zone_id      = "${sub.data.zone}"
}`)
  }

  // Security Group
  const sgs = nodes.filter((n) => n.type === 'SecurityGroup')
  for (const sg of sgs) {
    const vpc = findVpc(sg)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_security_group" "${resourceNames.get(sg.id)}" {
  name   = "${sg.data.name}"
  vpc_id = ${vpcRef}
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const ipProtocol =
        rule.protocol === 'icmp' ? 'icmp' : rule.protocol === 'all' ? 'all' : rule.protocol
      const portRange = rule.protocol === 'icmp' || rule.protocol === 'all' ? '-1/-1' : rule.port
      blocks.push(`resource "alicloud_security_group_rule" "${resourceNames.get(sg.id)}_${rule.direction}_${i}" {
  type              = "${rule.direction}"
  ip_protocol       = "${ipProtocol}"
  port_range        = "${portRange}"
  security_group_id = ${ref(sg)}.id
  cidr_ip           = "${rule.cidr}"
  description       = "${rule.description || ''}"
}`)
    })
  }

  // Gateway
  const gateways = nodes.filter((n) => n.type === 'Gateway')
  for (const gw of gateways) {
    if (gw.data.kind === 'eip') {
      blocks.push(`resource "alicloud_eip" "${resourceNames.get(gw.id)}" {
  bandwidth            = "100"
  internet_charge_type = "PayByTraffic"
}`)
    } else {
      const sub = findSubnet(gw)
      const vpc = findVpc(gw)
      const vpcRef = vpc ? ref(vpc) + '.id' : '""'
      const vswRef = sub ? ref(sub) + '.id' : '""'
      blocks.push(`resource "alicloud_nat_gateway" "${resourceNames.get(gw.id)}" {
  vpc_id           = ${vpcRef}
  vswitch_id       = ${vswRef}
  nat_gateway_name = "${gw.data.name}"
  nat_type         = "Enhanced"
}`)
    }
  }

  // Instance (ECS)
  const instances = nodes.filter((n) => n.type === 'Instance')
  for (const inst of instances) {
    const sub = findSubnet(inst)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const sgLine = sgRefs.length
      ? `\n  security_groups            = [${sgRefs.join(', ')}]`
      : ''
    blocks.push(`resource "alicloud_instance" "${resourceNames.get(inst.id)}" {
  instance_name              = "${inst.data.name}"
  instance_type              = "${inst.data.instanceType}"
  image_id                   = "${inst.data.imageId}"
  vswitch_id                 = ${vswRef}${sgLine}
  private_ip                 = "${inst.data.privateIp}"
  internet_max_bandwidth_out = 0
}`)
  }

  // Route Table
  const rts = nodes.filter((n) => n.type === 'RouteTable')
  for (const rt of rts) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "alicloud_route_table" "${resourceNames.get(rt.id)}" {
  vpc_id           = ${vpcRef}
  route_table_name = "${rt.data.name}"
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      let nexthopId = route.nextHop
      if (!nexthopId) {
        // 自动解析下一跳
        if (route.nextHopType === 'NatGateway') {
          const gws = nodes.filter((n) => n.type === 'Gateway' && n.data.kind !== 'eip')
          const targetGw = gws.find((g) => findVpc(g)?.id === vpc?.id) || gws[0]
          if (targetGw) nexthopId = ref(targetGw) + '.id'
        }
      }
      if (!nexthopId) nexthopId = `"" # ${tt('fillNextHop')}`
      blocks.push(`resource "alicloud_route_entry" "${resourceNames.get(rt.id)}_${i}" {
  route_table_id        = ${ref(rt)}.id
  destination_cidrblock = "${route.destination}"
  nexthop_type          = "${route.nextHopType}"
  nexthop_id            = ${nexthopId}
}`)
    })
  }

  return blocks.join('\n\n') + '\n'
}
