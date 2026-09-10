import { createCloudContext, resolveNextHopNode, parsePortRange } from './common.js'
import { translate } from '../../i18n/index.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'aws_vpc',
  subnet: 'aws_subnet',
  instance: 'aws_instance',
  securityGroup: 'aws_security_group',
  securityGroupRule: 'aws_security_group_rule',
  eip: 'aws_eip',
  natGateway: 'aws_nat_gateway',
  routeTable: 'aws_route_table',
  routeEntry: 'aws_route',
}

const header = `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
  }
}

provider "aws" {
  region = var.region
}

variable "region" {
  type    = string
  default = "us-east-1"
}
`

function awsProtocol(protocol) {
  if (protocol === 'all') return '-1'
  if (protocol === 'icmp') return 'icmp'
  return protocol
}

export function exportAwsTerraform(nodes, edges) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const blocks = [header]

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "aws_vpc" "${ctx.name(vpc)}" {
  cidr_block = "${vpc.data.cidr}"

  tags = {
    Name = "${vpc.data.name}"
  }
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "aws_subnet" "${ctx.name(sub)}" {
  vpc_id            = ${vpcRef}
  cidr_block        = "${sub.data.cidr}"
  availability_zone = "${sub.data.zone}"

  tags = {
    Name = "${sub.data.name}"
  }
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    const vpc = findVpc(sg)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "aws_security_group" "${ctx.name(sg)}" {
  name   = "${sg.data.name}"
  vpc_id = ${vpcRef}

  tags = {
    Name = "${sg.data.name}"
  }
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const port = parsePortRange(rule.port, rule.protocol)
      const fromPort = port ? port.from : -1
      const toPort = port ? port.to : -1
      blocks.push(`resource "aws_security_group_rule" "${ctx.name(sg)}_${rule.direction}_${i}" {
  type              = "${rule.direction}"
  from_port         = ${fromPort}
  to_port           = ${toPort}
  protocol          = "${awsProtocol(rule.protocol)}"
  cidr_blocks       = ["${rule.cidr}"]
  security_group_id = ${ref(sg)}.id
  description       = "${rule.description || ''}"
}`)
    })
  }

  const eips = nodes.filter((n) => n.type === 'Gateway' && n.data.kind === 'eip')
  for (const eip of eips) {
    blocks.push(`resource "aws_eip" "${ctx.name(eip)}" {
  tags = {
    Name = "${eip.data.name}"
  }
}`)
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway' && n.data.kind !== 'eip')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const eipNode =
      eips.find((e) => findVpc(e)?.id === vpc?.id) || eips[0]
    const allocRef = eipNode ? ref(eipNode) + '.id' : `"" # TODO: ${tt('fillNextHop')}`
    blocks.push(`resource "aws_nat_gateway" "${ctx.name(gw)}" {
  allocation_id = ${allocRef}
  subnet_id     = ${vswRef}

  tags = {
    Name = "${gw.data.name}"
  }
}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const sgLine = sgRefs.length ? `\n  vpc_security_group_ids   = [${sgRefs.join(', ')}]` : ''
    blocks.push(`resource "aws_instance" "${ctx.name(inst)}" {
  ami           = "${inst.data.imageId}"
  instance_type = "${inst.data.instanceType}"
  subnet_id     = ${vswRef}${sgLine}
  private_ip    = "${inst.data.privateIp}"

  tags = {
    Name = "${inst.data.name}"
  }
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "aws_route_table" "${ctx.name(rt)}" {
  vpc_id = ${vpcRef}

  tags = {
    Name = "${rt.data.name}"
  }
}`)
    ;(rt.data.routes || []).forEach((route, i) => {
      const hop = resolveNextHopNode(ctx, route, vpc)
      let hopLine
      if (route.nextHop) {
        hopLine = `  # ${tt('fillNextHop')}: ${route.nextHop}`
      } else if (hop && route.nextHopType === 'NatGateway') {
        hopLine = `  nat_gateway_id         = ${ref(hop)}.id`
      } else if (hop && route.nextHopType === 'Instance') {
        hopLine = `  instance_id            = ${ref(hop)}.id`
      } else {
        hopLine = `  # ${tt('fillNextHop')}`
      }
      blocks.push(`resource "aws_route" "${ctx.name(rt)}_${i}" {
  route_table_id         = ${ref(rt)}.id
  destination_cidr_block = "${route.destination}"
${hopLine}
}`)
    })
  }

  return blocks.join('\n\n') + '\n'
}
