import { createCloudContext, resolveNextHopNode, parsePortRange, resolveVpcRegion, resolveZone, gatewayEips, lbSubnets, lbVpc, lbHealthCheck, instanceLoginAuth, resolveInstanceKeyPair, collectKeyPairs, resolveInterconnects, routeTablesOfVpc, tlsKeyBlocks, hclLines, systemDiskConfig, dataDiskConfigs, clean, instanceRef, instanceCount, isCountedInstance, instancePrivateIp, instanceNameExpr, eipCount, eipRef, eipNameExpr, eipInstanceCandidates, eipBindings } from './common.js'
import { translate } from '../../i18n/index.js'
import { buildOutputs } from './outputs.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'aws_vpc',
  subnet: 'aws_subnet',
  instance: 'aws_instance',
  securityGroup: 'aws_security_group',
  securityGroupRule: 'aws_security_group_rule',
  eip: 'aws_eip',
  natGateway: 'aws_nat_gateway',
  loadBalancer: 'aws_lb',
  routeTable: 'aws_route_table',
  routeEntry: 'aws_route',
  interconnect: 'aws_vpc_peering_connection',
}

const providerBlock = (providerVersion) => `terraform {
  required_providers {
    aws = {
      source  = "hashicorp/aws"
      version = "${providerVersion}"
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
  default     = ""
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('awsSecretKey')}"
  default     = ""
  sensitive   = true
}
`

function awsProtocol(protocol) {
  if (protocol === 'all') return '-1'
  if (protocol === 'icmp') return 'icmp'
  return protocol
}

export function exportAwsTerraform(nodes, edges, providerVersion) {
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
    const eipCountLine = isCountedInstance(eip) ? `\n  count = ${eipCount(eip)}` : ''
    blocks.push(`resource "aws_eip" "${ctx.name(eip)}" {${eipCountLine}
  tags = {
    Name = ${eipNameExpr(eip)}
  }
}`)
    // 按编辑器选择的绑定生成关联（每个 EIP 绑定到选定的实例内网 IP）
    const eipTargets = eipInstanceCandidates(ctx, eip)
    eipBindings(eip, eipTargets).forEach((b, i) => {
      if (!b) return
      blocks.push(`resource "aws_eip_association" "${ctx.name(eip)}_${i}" {
  allocation_id = ${eipRef(ctx, eip, i)}.id
  instance_id   = ${instanceRef(ctx, b.node, b.index)}.id
}`)
    })
  }

  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const sub = findSubnet(gw)
    const vpc = findVpc(gw)
    const vswRef = sub ? ref(sub) + '.id' : `"" # ${tt('unassociatedVswitch')}`
    // 优先使用 Eip -> Gateway 连线绑定的 EIP，未连线时回退到未绑定实例的 EIP
    const eipNode = gatewayEips(ctx, gw)[0]
    const allocRef = eipNode ? eipRef(ctx, eipNode, 0) + '.id' : `"" # TODO: ${tt('fillNextHop')}`
    blocks.push(`resource "aws_nat_gateway" "${ctx.name(gw)}" {
  allocation_id = ${allocRef}
  subnet_id     = ${vswRef}

  tags = {
    Name = "${clean(gw.data.name)}"
  }
}`)
  }

  // 负载均衡：ALB/NLB 实例 + 每个监听规则一个目标组/监听器 + 目标绑定
  for (const lb of nodes.filter((n) => n.type === 'LoadBalancer')) {
    const vpc = lbVpc(ctx, lb)
    const subs = lbSubnets(ctx, lb)
    const rules = lb.data.rules || []
    // HTTP/HTTPS 用应用型 ALB，TCP/UDP 用网络型 NLB
    const isL7 = rules.some((r) => ['http', 'https'].includes(String(r.protocol || '').toLowerCase()))
    const rows = [
      ['name', `"${clean(lb.data.name)}"`],
      ['load_balancer_type', isL7 ? '"application"' : '"network"'],
      ['internal', lb.data.internal ? 'true' : 'false'],
    ]
    if (subs.length) rows.push(['subnets', `[${subs.map((s) => `${ref(s)}.id`).join(', ')}]`])
    blocks.push(`resource "aws_lb" "${ctx.name(lb)}" {
${hclLines(rows)}
}`)
    rules.forEach((rule, ri) => {
      const ruleName = `${ctx.name(lb)}_${ri}`
      const port = Number(rule.port) || 80
      const proto = String(rule.protocol || 'tcp').toUpperCase()
      const tgName = `${ruleName}_tg`
      // 健康检查：AWS 目标组强制启用，故仅能配置参数；协议 http(s) 带路径与状态码匹配
      const hc = lbHealthCheck(rule)
      const hcProto = hc.protocol === 'tcp' ? 'TCP' : hc.protocol.toUpperCase()
      const hcRows = [
        ['healthy_threshold', String(hc.healthyThreshold)],
        ['unhealthy_threshold', String(hc.unhealthyThreshold)],
        ['timeout', String(hc.timeout)],
        ['interval', String(hc.interval)],
        ['protocol', `"${hcProto}"`],
      ]
      if (hc.port) hcRows.push(['port', `"${hc.port}"`])
      if (hc.protocol !== 'tcp') {
        hcRows.push(['path', `"${hc.path}"`])
        hcRows.push(['matcher', '"200"'])
      }
      const hcBlock = hc.enabled
        ? `\n\n  health_check {\n${hclLines(hcRows)
            .split('\n')
            .map((l) => `  ${l}`)
            .join('\n')}\n  }`
        : `\n\n  # ${tt('lbHealthCheckForced')}`
      blocks.push(`resource "aws_lb_target_group" "${tgName}" {
  name        = "${clean(lb.data.name)}-${ri}"
  port        = ${port}
  protocol    = "${proto}"
  target_type = "instance"
  vpc_id      = ${vpc ? `${ref(vpc)}.id` : `"" # ${tt('unassociatedVpc')}`}${hcBlock}
}`)
      ;(rule.backends || []).forEach((bid, bi) => {
        // 解析 bid 格式：可能是 "instId" 或 "instId#index"（多实例展开后）
        const [instId, indexStr] = bid.split('#')
        const inst = ctx.byId.get(instId)
        if (!inst || inst.type !== 'Instance') return
        // 多实例节点且指定了具体实例：只生成一条目标组绑定
        // 多实例节点未指定：为每一台实例各生成一条目标组绑定
        const count = instanceCount(inst)
        const index = indexStr != null ? Number(indexStr) : -1
        const loops = index >= 0 ? 1 : count
        const startIdx = index >= 0 ? index : 0
        for (let k = 0; k < loops; k++) {
          const instIdx = startIdx + k
          const resId = loops > 1 ? `${tgName}_${bi}_${k}` : `${tgName}_${bi}`
          blocks.push(`resource "aws_lb_target_group_attachment" "${resId}" {
  target_group_arn = aws_lb_target_group.${tgName}.arn
  target_id        = ${instanceRef(ctx, inst, instIdx)}.id
  port             = ${port}
}`)
        }
      })
      blocks.push(`resource "aws_lb_listener" "${ruleName}" {
  load_balancer_arn = ${ref(lb)}.arn
  port              = ${port}
  protocol          = "${proto}"

  default_action {
    type             = "forward"
    target_group_arn = aws_lb_target_group.${tgName}.arn
  }
}`)
    })
  }

  const keyPairs = collectKeyPairs(ctx, nodes)
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
    const kp = resolveInstanceKeyPair(ctx, inst)
    let authLine = ''
    if (kp) {
      // 新建密钥对引用生成的资源；关联现有密钥对直接按名称引用
      if (kp.mode === 'create') {
        authLine = `\n  key_name      = aws_key_pair.${keyPairs.get(kp.name)}.key_name`
      } else {
        authLine = `\n  key_name      = "${kp.name}"`
      }
    } else if (auth.type === 'password' && auth.value) {
      authLine = `\n  # ${tt('passwordUnsupported')}`
    }
    const marketLine =
      inst.data.chargeType === 'spot'
        ? `\n\n  instance_market_options {\n    market_type = "spot"\n  }`
        : ''
    const counted = isCountedInstance(inst)
    // 多实例按子网 CIDR 顺序分配私网 IP；单实例保持固定值
    const priv = counted
      ? instancePrivateIp(inst.data, sub && sub.data.cidr, 'count.index')
      : `"${inst.data.privateIp}"`
    const countLine = counted ? `\n  count         = ${instanceCount(inst)}` : ''
    const privLine = priv ? `\n  private_ip    = ${priv}` : ''
    const sysDisk = systemDiskConfig(inst.data, 'gp3')
    const dataDisks = dataDiskConfigs(inst.data, 'gp3')
    const dataDiskBlock = dataDisks.length
      ? '\n' +
        dataDisks
          .map(
            (d, i) => `\n  ebs_block_device {
    device_name = "/dev/sd${String.fromCharCode(98 + i)}"
    volume_type = "${d.type}"
    volume_size = ${d.size}
  }`
          )
          .join('')
      : ''
    blocks.push(`resource "aws_instance" "${ctx.name(inst)}" {${countLine}
  ami           = "${inst.data.imageId}"
  instance_type = "${inst.data.instanceType}"
  subnet_id     = ${vswRef}${sgLine}${privLine}${authLine}${marketLine}

  root_block_device {
    volume_type = "${sysDisk.type}"
    volume_size = ${sysDisk.size}
  }${dataDiskBlock}

  tags = {
    Name = ${instanceNameExpr(inst)}
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
        hopLine = `  instance_id            = ${instanceRef(ctx, hop, 0)}.id`
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

  let peerSeq = 0
  for (const { ic, pairs } of resolveInterconnects(ctx)) {
    for (const pair of pairs) {
      blocks.push(`resource "aws_vpc_peering_connection" "${ctx.name(ic)}_${pair.key}" {
  vpc_id      = ${ref(pair.a)}.id
  peer_vpc_id = ${ref(pair.b)}.id
  auto_accept = true
}`)
    }
    for (const pair of pairs) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        for (const rt of routeTablesOfVpc(ctx, from)) {
          blocks.push(`resource "aws_route" "${ctx.name(rt)}_peer_${peerSeq++}" {
  route_table_id            = ${ref(rt)}.id
  destination_cidr_block    = "${to.data.cidr}"
  vpc_peering_connection_id = ${ref(ic)}_${pair.key}.id
}`)
        }
      }
    }
  }

  return {
    provider: providerBlock(providerVersion),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
    outputs: buildOutputs(ctx, nodes, 'aws'),
  }
}
