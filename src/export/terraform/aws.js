import { createCloudContext, resolveNextHopNode, parsePortRange, resolveVpcRegion, resolveZone, instanceLoginAuth, collectKeyPairs, tlsKeyBlocks, clean } from './common.js'
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

const providerBlock = () => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "~> 5.0"
    }
    tls = {
      source  = "hashicorp/tls"
      version = "~> 4.0"
    }
    local = {
      source  = "hashicorp/local"
      version = "~> 2.0"
    }
  }
}

provider "aws" {
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
  description = "${tt('awsAccessKey')}"
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('awsSecretKey')}"
  sensitive   = true
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
  const region = resolveVpcRegion(nodes, 'us-east-1')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "aws_vpc" "${ctx.name(vpc)}" {
  cidr_block = "${vpc.data.cidr}"

  tags = {
    Name = "${clean(vpc.data.name)}"
  }
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "aws_subnet" "${ctx.name(sub)}" {
  vpc_id            = ${vpcRef}
  cidr_block        = "${sub.data.cidr}"
  availability_zone = "${resolveZone(sub.data.zone, vpc?.data.region || region, 'aws')}"

  tags = {
    Name = "${clean(sub.data.name)}"
  }
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    const vpc = findVpc(sg)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "aws_security_group" "${ctx.name(sg)}" {
  name   = "${clean(sg.data.name)}"
  vpc_id = ${vpcRef}

  tags = {
    Name = "${clean(sg.data.name)}"
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

  const eips = nodes.filter((n) => n.type === 'Eip')
  for (const eip of eips) {
    blocks.push(`resource "aws_eip" "${ctx.name(eip)}" {
  tags = {
    Name = "${clean(eip.data.name)}"
  }
}`)
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Instance')
      .forEach((inst, i) => {
        blocks.push(`resource "aws_eip_association" "${ctx.name(eip)}_${i}" {
  allocation_id = ${ref(eip)}.id
  instance_id   = ${ref(inst)}.id
}`)
      })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const freeEips = eips.filter((e) => !ctx.targetNodes(e.id).some((n) => n.type === 'Instance'))
    const eipNode = freeEips[0] || eips[0]
    const allocRef = eipNode ? ref(eipNode) + '.id' : `"" # TODO: ${tt('fillNextHop')}`
    blocks.push(`resource "aws_nat_gateway" "${ctx.name(gw)}" {
  allocation_id = ${allocRef}
  subnet_id     = ${vswRef}

  tags = {
    Name = "${clean(gw.data.name)}"
  }
}`)
  }

  const keyPairs = collectKeyPairs(nodes)
  for (const [keyName, resName] of keyPairs) {
    blocks.push(`resource "aws_key_pair" "${resName}" {
  key_name   = "${keyName}"
  public_key = tls_private_key.${resName}.public_key_openssh
}

${tlsKeyBlocks(keyName, resName)}`)
  }

  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const sub = findSubnet(inst)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    const sgs = ctx.targetNodes(inst.id).filter((n) => n.type === 'SecurityGroup')
    const sgRefs = sgs.map((s) => ref(s) + '.id')
    const sgLine = sgRefs.length ? `\n  vpc_security_group_ids   = [${sgRefs.join(', ')}]` : ''
    const auth = instanceLoginAuth(inst.data)
    let authLine = ''
    if (auth.value) {
      if (auth.type === 'password') {
        authLine = `\n  # ${tt('passwordUnsupported')}`
      } else {
        const resName = keyPairs.get(clean(auth.value))
        authLine = `\n  key_name      = aws_key_pair.${resName}.key_name`
      }
    }
    const marketLine =
      inst.data.chargeType === 'spot'
        ? `\n\n  instance_market_options {\n    market_type = "spot"\n  }`
        : ''
    blocks.push(`resource "aws_instance" "${ctx.name(inst)}" {
  ami           = "${inst.data.imageId}"
  instance_type = "${inst.data.instanceType}"
  subnet_id     = ${vswRef}${sgLine}
  private_ip    = "${inst.data.privateIp}"${authLine}${marketLine}

  root_block_device {
    volume_size = 40
  }

  tags = {
    Name = "${clean(inst.data.name)}"
  }
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "aws_route_table" "${ctx.name(rt)}" {
  vpc_id = ${vpcRef}

  tags = {
    Name = "${clean(rt.data.name)}"
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

  return {
    provider: providerBlock(),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
  }
}
