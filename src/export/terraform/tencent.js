import { createCloudContext, resolveNextHopNode, parsePortRange, resolveVpcRegion, resolveZone, gatewayEips, gatewaySnatSources, vpcSubnets, lbSubnets, lbVpc, lbHealthCheck, lbBackendInstances, instanceLoginAuth, resolveInstanceKeyPair, collectKeyPairs, collectExistingKeyPairs, escapeRegex, resolveInterconnects, routeTablesOfVpc, tlsKeyBlocks, hclLines, systemDiskConfig, dataDiskConfigs, clean, instanceRef, instanceCount, isCountedInstance, instancePrivateIp, instancePrivateIpAt, instanceNameExpr, eipCount, eipRef, eipNameExpr, eipInstanceCandidates, eipBindings } from './common.js'
import { translate } from '../../i18n/index.js'
import { buildOutputs } from './outputs.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'tencentcloud_vpc',
  subnet: 'tencentcloud_subnet',
  instance: 'tencentcloud_instance',
  securityGroup: 'tencentcloud_security_group',
  securityGroupRule: 'tencentcloud_security_group_rule',
  eip: 'tencentcloud_eip',
  natGateway: 'tencentcloud_nat_gateway',
  loadBalancer: 'tencentcloud_clb_instance',
  routeTable: 'tencentcloud_route_table',
  routeEntry: 'tencentcloud_route_entry',
  interconnect: 'tencentcloud_vpc_peering_connection',
}

const providerBlock = (providerVersion) => `terraform {
  required_providers {
    tencentcloud = {
      source  = "tencentcloudstack/tencentcloud"
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
  default     = ""
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('tencentSecretKey')}"
  default     = ""
  sensitive   = true
}
`

function tcProtocol(protocol) {
  if (protocol === 'all') return 'ALL'
  if (protocol === 'icmp') return 'ICMP'
  return protocol.toUpperCase()
}

// 腾讯云 port_range 语义：单端口 "22"、多端口 "80,443"、范围 "80-90"；
// 内部统一存 "起始/结束"，故起止相同输出单值，否则输出 "起-止"。
function tcPortRange(rule) {
  if (rule.protocol === 'icmp' || rule.protocol === 'all') return 'ALL'
  const raw = String(rule.port || '').trim()
  if (raw.includes(',')) return raw
  const port = parsePortRange(rule.port, rule.protocol)
  if (!port) return 'ALL'
  return port.from === port.to ? String(port.from) : `${port.from}-${port.to}`
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

// 腾讯云负载均衡类型（ALB 暂无 Terraform 资源，仅提供选择并告警）
const TENCENT_LB_TYPES = ['clb', 'gwlb', 'alb']

export function tencentLbType(lb) {
  const t = String((lb.data && lb.data.lbConfig && lb.data.lbConfig.type) || '').toLowerCase()
  return TENCENT_LB_TYPES.includes(t) ? t : 'clb'
}

// 腾讯云 GWLB 配置归一化
function tencentLbConfig(lb) {
  const c = (lb.data && lb.data.lbConfig) || {}
  return { geneveProtocol: c.geneveProtocol === 'AWS_GENEVE' ? 'AWS_GENEVE' : 'TENCENT_GENEVE' }
}

// 传统型 CLB：实例 + 每个监听规则一个监听器/后端绑定
function exportTencentClb(ctx, lb, blocks) {
  const { ref } = ctx
  const vpc = lbVpc(ctx, lb)
  const sub = lbSubnets(ctx, lb)[0]
  const rows = [
    ['clb_name', `"${clean(lb.data.name)}"`],
    ['network_type', lb.data.internal ? '"INTERNAL"' : '"OPEN"'],
    ['vpc_id', vpc ? `${ref(vpc)}.id` : `"" # ${tt('unassociatedVpc')}`],
  ]
  // 内网 CLB 必须指定子网
  if (lb.data.internal && sub) rows.push(['subnet_id', `${ref(sub)}.id`])
  blocks.push(`resource "tencentcloud_clb_instance" "${ctx.name(lb)}" {
${hclLines(rows)}
}`)
  ;(lb.data.rules || []).forEach((rule, ri) => {
    const ruleName = `${ctx.name(lb)}_${ri}`
    const port = Number(rule.port) || 80
    const proto = String(rule.protocol || 'tcp').toUpperCase()
    // 健康检查：协议 http(s) 用 HTTP(S) 检查并带路径
    const hc = lbHealthCheck(rule)
    const hcProto = hc.protocol === 'tcp' ? 'TCP' : hc.protocol.toUpperCase()
    const lrows = [
      ['clb_id', `${ref(lb)}.id`],
      ['listener_name', `"${clean(lb.data.name)}-${ri}"`],
      ['port', String(port)],
      ['protocol', `"${proto}"`],
      ['health_check_switch', hc.enabled ? 'true' : 'false'],
    ]
    if (hc.enabled) {
      lrows.push(['health_check_proto', `"${hcProto}"`])
      if (hc.protocol !== 'tcp') lrows.push(['health_check_path', `"${hc.path}"`])
      // 腾讯云 CLB 的 HTTP 健康检查请求方法仅支持 HEAD/GET
      if (hc.protocol !== 'tcp' && ['GET', 'HEAD'].includes(hc.method)) {
        lrows.push(['health_check_http_method', `"${hc.method}"`])
      }
      lrows.push(['health_check_interval_time', String(hc.interval)])
      lrows.push(['health_check_time_out', String(hc.timeout)])
      lrows.push(['health_check_healthy_threshold', String(hc.healthyThreshold)])
      lrows.push(['health_check_unhealthy_threshold', String(hc.unhealthyThreshold)])
    }
    blocks.push(`resource "tencentcloud_clb_listener" "${ruleName}" {
${hclLines(lrows)}
}`)
    const targets = (rule.backends || [])
      .map((bid) => {
        // 解析 bid 格式：可能是 "instId" 或 "instId#index"（多实例展开后）
        const [instId, indexStr] = bid.split('#')
        const inst = ctx.byId.get(instId)
        if (!inst || inst.type !== 'Instance') return null
        const index = indexStr != null ? Number(indexStr) : -1
        return { inst, index }
      })
      .filter(Boolean)
    if (targets.length) {
      // 多实例节点且指定了具体实例：只生成一个 targets 块
      // 多实例节点未指定：每台实例各生成一个 targets 块
      const targetBlocks = targets
        .flatMap(({ inst, index }) => {
          const count = instanceCount(inst)
          const loops = index >= 0 ? 1 : count
          const startIdx = index >= 0 ? index : 0
          return Array.from({ length: loops }, (_, k) => {
            const instIdx = startIdx + k
            return `  targets {
    instance_id = ${instanceRef(ctx, inst, instIdx)}.id
    port        = ${port}
    weight      = 10
  }`
          })
        })
        .join('\n')
      blocks.push(`resource "tencentcloud_clb_attachment" "${ruleName}" {
  clb_id      = ${ref(lb)}.id
  listener_id = tencentcloud_clb_listener.${ruleName}.id
${targetBlocks}
}`)
    }
  })
}

// 网关型 GWLB：实例 + 每个监听规则一个目标组（注册后端并关联）
function exportTencentGwlb(ctx, lb, cfg, blocks) {
  const { ref } = ctx
  const name = ctx.name(lb)
  const vpc = lbVpc(ctx, lb)
  const sub = lbSubnets(ctx, lb)[0]
  const vpcRef = vpc ? `${ref(vpc)}.id` : `"" # ${tt('unassociatedVpc')}`
  const rows = [
    ['load_balancer_name', `"${clean(lb.data.name)}"`],
    ['lb_charge_type', '"POSTPAID_BY_HOUR"'],
    ['vpc_id', vpcRef],
  ]
  if (sub) rows.push(['subnet_id', `${ref(sub)}.id`])
  blocks.push(`resource "tencentcloud_gwlb_instance" "${name}" {
${hclLines(rows)}
}`)
  const lbRef = `tencentcloud_gwlb_instance.${name}.id`
  ;(lb.data.rules || []).forEach((rule, ri) => {
    const tg = `${name}_${ri}_tg`
    const hc = lbHealthCheck(rule)
    // 腾讯云 GWLB 健康检查仅支持 PING/TCP，且探测端口固定 6081
    const hcRows = [
      ['health_switch', hc.enabled ? 'true' : 'false'],
      ['protocol', '"TCP"'],
      ['port', '6081'],
      ['timeout', String(hc.timeout)],
      ['interval_time', String(hc.interval)],
      ['health_num', String(hc.healthyThreshold)],
      ['un_health_num', String(hc.unhealthyThreshold)],
    ]
    const hcBlock = `  health_check {\n${hclLines(hcRows).split('\n').map((l) => '  ' + l).join('\n')}\n  }`
    blocks.push(`resource "tencentcloud_gwlb_target_group" "${tg}" {
  target_group_name  = "${clean(lb.data.name)}-${ri}"
  vpc_id             = ${vpcRef}
  port               = 6081
  protocol           = "${cfg.geneveProtocol}"
  schedule_algorithm = "IP_HASH_3_ELASTIC"
${hcBlock}
}`)
    blocks.push(`resource "tencentcloud_gwlb_instance_associate_target_group" "${name}_${ri}_assoc" {
  load_balancer_id = ${lbRef}
  target_group_id  = tencentcloud_gwlb_target_group.${tg}.id
}`)
    const instances = lbBackendInstances(ctx, rule)
    if (instances.length) {
      const targetBlocks = instances
        .map(({ node, index }) => {
          const s = ctx.findSubnet(node)
          const ip = instancePrivateIpAt(node, s && s.data.cidr, index)
          // 无静态私网 IP 时回退引用实例的 private_ip 属性
          const bindIp = ip ? `"${ip}"` : `${instanceRef(ctx, node, index)}.private_ip`
          return `  target_group_instances {
    bind_ip = ${bindIp}
    port    = 6081
    weight  = 16
  }`
        })
        .join('\n')
      blocks.push(`resource "tencentcloud_gwlb_target_group_register_instances" "${name}_${ri}_reg" {
  target_group_id = tencentcloud_gwlb_target_group.${tg}.id
${targetBlocks}
}`)
    }
  })
}

// 按 lbConfig.type 分发腾讯云负载均衡导出
function exportTencentLoadBalancer(ctx, lb, blocks) {
  const type = tencentLbType(lb)
  if (type === 'alb') return // 腾讯云 ALB 缺少 Terraform 资源，校验阶段已告警
  if (type === 'gwlb') return exportTencentGwlb(ctx, lb, tencentLbConfig(lb), blocks)
  return exportTencentClb(ctx, lb, blocks)
}

export function exportTencentTerraform(nodes, edges, providerVersion) {
  const ctx = createCloudContext(nodes, edges, resourceTypes)
  const { ref, findVpc, findSubnet } = ctx
  const region = resolveVpcRegion(nodes, 'ap-guangzhou')
  const blocks = []

  for (const vpc of nodes.filter((n) => n.type === 'VPC')) {
    blocks.push(`resource "tencentcloud_vpc" "${ctx.name(vpc)}" {
  name       = "${clean(vpc.data.name)}"
  cidr_block = "${vpc.data.cidr}"
}`)
  }

  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = findVpc(sub)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_subnet" "${ctx.name(sub)}" {
  vpc_id            = ${vpcRef}
  name              = "${clean(sub.data.name)}"
  cidr_block        = "${sub.data.cidr}"
  availability_zone = "${resolveZone(sub.data.zone, vpc?.data.region || region, 'tencent')}"
}`)
  }

  for (const sg of nodes.filter((n) => n.type === 'SecurityGroup')) {
    blocks.push(`resource "tencentcloud_security_group" "${ctx.name(sg)}" {
  name = "${clean(sg.data.name)}"
}`)
    ;(sg.data.rules || []).forEach((rule, i) => {
      const portRange = tcPortRange(rule)
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
    const eipRows = [
      ...(isCountedInstance(eip) ? [['count', String(eipCount(eip))]] : []),
      ['name', eipNameExpr(eip)],
      ['internet_charge_type', `"${internetChargeType}"`],
      ['internet_max_bandwidth_out', String(Number(eip.data.bandwidth) || 5)],
    ]
    blocks.push(`resource "tencentcloud_eip" "${ctx.name(eip)}" {
${hclLines(eipRows)}
}`)
    // 按编辑器选择的绑定生成关联（每个 EIP 绑定到选定的实例内网 IP）
    const eipTargets = eipInstanceCandidates(ctx, eip)
    eipBindings(eip, eipTargets).forEach((b, i) => {
      if (!b) return
      blocks.push(`resource "tencentcloud_eip_association" "${ctx.name(eip)}_${i}" {
  eip_id      = ${eipRef(ctx, eip, i)}.id
  instance_id = ${instanceRef(ctx, b.node, b.index)}.id
}`)
    })
  }

  let snatSeq = 0 // SNAT 规则资源名后缀，保证多个网关/子网组合唯一
  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const vpc = findVpc(gw)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    const eips = gatewayEips(ctx, gw)
    // 展开 EIP 数量，得到全部公网 IP 引用（多出口）
    const eipIpRefs = eips.flatMap((e) =>
      Array.from({ length: eipCount(e) }, (_, ei) => `${eipRef(ctx, e, ei)}.public_ip`)
    )
    // assigned_eip_set 为必填项，未连接 EIP 时给出 TODO 提示
    const eipSet = eipIpRefs.length
      ? `\n  assigned_eip_set = [\n${eipIpRefs.map((r) => `    ${r},`).join('\n')}\n  ]`
      : `\n  # TODO: ${tt('bindEipToGateway')}`
    blocks.push(`resource "tencentcloud_nat_gateway" "${ctx.name(gw)}" {
  name           = "${clean(gw.data.name)}"
  vpc_id         = ${vpcRef}
  bandwidth      = 100
  max_concurrent = 1000000${eipSet}
}`)
    // SNAT 来源：子网直连；VPC 降级为 VPC 内各子网；实例用 NETWORKINTERFACE（腾讯云原生支持）
    if (eipIpRefs.length) {
      const { vpcs, subnets, instances } = gatewaySnatSources(ctx, gw)
      const snatSubnets = new Map(subnets.map((s) => [s.id, s]))
      for (const vpcSrc of vpcs) {
        for (const s of vpcSubnets(ctx, vpcSrc)) snatSubnets.set(s.id, s)
      }
      const ipList = eipIpRefs.join(', ')
      for (const snatSub of snatSubnets.values()) {
        blocks.push(`resource "tencentcloud_nat_gateway_snat" "${ctx.name(gw)}_snat_${snatSeq++}" {
  nat_gateway_id    = ${ref(gw)}.id
  resource_type     = "SUBNET"
  subnet_id         = ${ref(snatSub)}.id
  subnet_cidr_block = ${ref(snatSub)}.cidr_block
  description       = "${clean(gw.data.name)} snat"
  public_ip_addr    = [${ipList}]
}`)
      }
      for (const inst of instances) {
        // 多实例节点：为每一台实例各生成一条按实例的 SNAT
        for (let k = 0; k < instanceCount(inst); k++) {
          blocks.push(`resource "tencentcloud_nat_gateway_snat" "${ctx.name(gw)}_snat_${snatSeq++}" {
  nat_gateway_id           = ${ref(gw)}.id
  resource_type            = "NETWORKINTERFACE"
  instance_id              = ${instanceRef(ctx, inst, k)}.id
  instance_private_ip_addr = ${instanceRef(ctx, inst, k)}.private_ip
  description              = "${clean(gw.data.name)} snat"
  public_ip_addr           = [${ipList}]
}`)
        }
      }
    }
  }

  // 负载均衡：按 lbConfig.type 生成 CLB/GWLB 对应资源（ALB 暂不支持 Terraform）
  for (const lb of nodes.filter((n) => n.type === 'LoadBalancer')) {
    exportTencentLoadBalancer(ctx, lb, blocks)
  }

  const keyPairs = collectKeyPairs(ctx, nodes)
  for (const [keyName, resName] of keyPairs) {
    blocks.push(`resource "tencentcloud_key_pair" "${resName}" {
  key_name   = "${keyName}"
  public_key = tls_private_key.${resName}.public_key_openssh
}

${tlsKeyBlocks(keyName, resName)}`)
  }

  // 关联现有密钥对：实例的 key_ids 需要密钥 ID，按名称查询 data source
  const existingKeyPairs = collectExistingKeyPairs(ctx, nodes)
  for (const [keyName, resName] of existingKeyPairs) {
    blocks.push(`data "tencentcloud_key_pairs" "${resName}" {
  key_name = "^${escapeRegex(keyName)}$"
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
    const kp = resolveInstanceKeyPair(ctx, inst)
    const sysDisk = systemDiskConfig(inst.data, 'CLOUD_PREMIUM')
    const dataDisks = dataDiskConfigs(inst.data, 'CLOUD_PREMIUM')
    // 腾讯云实例必须指定可用区，优先从关联子网的可用区推导（与子网保持一致）
    const az = resolveZone(sub?.data.zone, vpc?.data.region || region, 'tencent')
    const counted = isCountedInstance(inst)
    // 多实例按子网 CIDR 顺序分配私网 IP；单实例保持固定值
    const priv = counted
      ? instancePrivateIp(inst.data, sub && sub.data.cidr, 'count.index')
      : `"${inst.data.privateIp}"`
    const rows = [
      ...(counted ? [['count', String(instanceCount(inst))]] : []),
      ['instance_name', instanceNameExpr(inst)],
      ['image_id', `"${inst.data.imageId}"`],
      ['instance_type', `"${inst.data.instanceType}"`],
      ...tencentChargeRows(inst.data.chargeType),
      ['vpc_id', vpcRef],
      ['subnet_id', subRef],
      ['availability_zone', `"${az}"`],
      ...(priv ? [['private_ip', priv]] : []),
      ['system_disk_type', `"${sysDisk.type}"`],
      ['system_disk_size', String(sysDisk.size)],
    ]
    if (sgRefs.length) rows.push(['orderly_security_groups', `[${sgRefs.join(', ')}]`])
    if (kp) {
      // 新建密钥对引用生成的资源；关联现有密钥对通过 data source 查询 ID
      if (kp.mode === 'create') {
        rows.push(['key_ids', `[tencentcloud_key_pair.${keyPairs.get(kp.name)}.id]`])
      } else {
        rows.push([
          'key_ids',
          `[data.tencentcloud_key_pairs.${existingKeyPairs.get(kp.name)}.key_pair_list[0].key_id]`,
        ])
      }
    } else if (auth.type === 'password' && auth.value) {
      rows.push(['password', `"${auth.value}"`])
    }
    const dataDiskBlock = dataDisks.length
      ? '\n\n' +
        dataDisks
          .map(
            (d) => `  data_disks {
    data_disk_type = "${d.type}"
    data_disk_size = ${d.size}
  }`
          )
          .join('\n')
      : ''
    blocks.push(`resource "tencentcloud_instance" "${ctx.name(inst)}" {
${hclLines(rows)}${dataDiskBlock}
}`)
  }

  for (const rt of nodes.filter((n) => n.type === 'RouteTable')) {
    const vpc = findVpc(rt)
    const vpcRef = vpc ? ref(vpc) + '.id' : `"" # ${tt('unassociatedVpc')}`
    blocks.push(`resource "tencentcloud_route_table" "${ctx.name(rt)}" {
  name   = "${clean(rt.data.name)}"
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
        nextHub = instanceRef(ctx, hop, 0) + '.id'
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

  let peerSeq = 0
  for (const { ic, pairs } of resolveInterconnects(ctx)) {
    for (const pair of pairs) {
      const peerRegion = clean(pair.a.data.region) || region
      blocks.push(`resource "tencentcloud_vpc_peering_connection" "${ctx.name(ic)}_${pair.key}" {
  vpc_id                  = ${ref(pair.a)}.id
  peer_vpc_id             = ${ref(pair.b)}.id
  peering_connection_name = "${clean(ic.data.name)}-${pair.key}"
  peer_region             = "${peerRegion}"
}`)
    }
    for (const pair of pairs) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        for (const rt of routeTablesOfVpc(ctx, from)) {
          blocks.push(`resource "tencentcloud_route_entry" "${ctx.name(rt)}_peer_${peerSeq++}" {
  route_table_id         = ${ref(rt)}.id
  destination_cidr_block = "${to.data.cidr}"
  next_type              = "PEER_CONNECTION"
  next_hub               = ${ref(ic)}_${pair.key}.id
}`)
        }
      }
    }
  }

  return {
    provider: providerBlock(providerVersion),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
    outputs: buildOutputs(ctx, nodes, 'tencent'),
  }
}
