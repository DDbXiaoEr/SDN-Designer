import { createCloudContext, resolveNextHopNode, resolveVpcRegion, resolveZone, gatewayEips, gatewaySnatSources, lbSubnets, lbVpc, lbHealthCheck, lbBackendInstances, instanceLoginAuth, resolveInstanceKeyPair, collectKeyPairs, resolveInterconnects, routeTablesOfVpc, hclLines, systemDiskConfig, dataDiskConfigs, gpuUserDataExpr, clean, instanceRef, instanceCount, isCountedInstance, instancePrivateIp, instancePrivateIpAt, instanceNameExpr, eipCount, eipRef, eipNameExpr, eipInstanceCandidates, eipBindings } from './common.js'
import { translate } from '../../i18n/index.js'
import { buildOutputs } from './outputs.js'

const tt = (key) => translate(`export.${key}`)

const resourceTypes = {
  vpc: 'alicloud_vpc',
  subnet: 'alicloud_vswitch',
  instance: 'alicloud_instance',
  securityGroup: 'alicloud_security_group',
  securityGroupRule: 'alicloud_security_group_rule',
  eip: 'alicloud_eip',
  natGateway: 'alicloud_nat_gateway',
  loadBalancer: 'alicloud_slb_load_balancer',
  routeTable: 'alicloud_route_table',
  routeEntry: 'alicloud_route_entry',
  interconnect: 'alicloud_vpc_peer_connection',
}

const providerBlock = (providerVersion) => `terraform {
  required_providers {
    alicloud = {
      source  = "aliyun/alicloud"
      version = "${providerVersion}"
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
  default     = ""
  sensitive   = true
}

variable "secret_key" {
  type        = string
  description = "${tt('aliyunSecretKey')}"
  default     = ""
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

// 阿里云四类负载均衡支持的监听协议：clb 传统型 / alb 应用型 / nlb 网络型 / gwlb 网关型
export const ALIYUN_LB_PROTOCOLS = {
  clb: ['tcp', 'udp', 'http', 'https'],
  alb: ['http', 'https', 'quic'],
  nlb: ['tcp', 'udp', 'tcpssl'],
  gwlb: ['geneve'],
}

// NLB 服务器组协议：TCPSSL 监听器后端仍按 TCP 转发
const NLB_SERVER_PROTOCOL = { tcp: 'TCP', udp: 'UDP', tcpssl: 'TCP' }

// 归一化阿里云负载均衡配置（兼容旧设计：缺少 lbConfig 时按传统型 CLB 处理）
export function aliyunLbConfig(lb) {
  const c = (lb.data && lb.data.lbConfig) || {}
  const type = ALIYUN_LB_PROTOCOLS[String(c.type || '').toLowerCase()]
    ? String(c.type).toLowerCase()
    : 'clb'
  const defaults = {
    clb: { scheduler: 'wrr', ipVersion: '' },
    alb: { scheduler: 'Wrr', ipVersion: 'IPv4' },
    nlb: { scheduler: 'Wrr', ipVersion: 'ipv4' },
    gwlb: { scheduler: '5TCH', ipVersion: 'Ipv4' },
  }[type]
  return {
    type,
    spec: clean(c.spec) || 'slb.s2.small',
    internetChargeType: c.internetChargeType === 'paybybandwidth' ? 'PayByBandwidth' : 'PayByTraffic',
    bandwidth: Number(c.bandwidth) > 0 ? Math.floor(Number(c.bandwidth)) : 10,
    edition: c.edition === 'Standard' ? 'Standard' : 'Basic',
    addressAllocatedMode: c.addressAllocatedMode === 'Fixed' ? 'Fixed' : 'Dynamic',
    ipVersion: clean(c.ipVersion) || defaults.ipVersion,
    scheduler: clean(c.scheduler) || defaults.scheduler,
    stickySession: !!c.stickySession,
    connectionDrain: !!c.connectionDrain,
    crossZone: c.crossZone !== false,
    preserveClientIp: !!c.preserveClientIp,
    proxyProtocol: !!c.proxyProtocol,
    serverFailoverMode: c.serverFailoverMode === 'Rebalance' ? 'Rebalance' : 'NoRebalance',
  }
}

// 由接入的子网推导负载均衡的可用区映射（vswitch_id + zone_id）；zone 去重
function aliyunLbZoneMappings(ctx, lb, region) {
  const out = []
  const seen = new Set()
  for (const sub of lbSubnets(ctx, lb)) {
    const vpc = ctx.findVpc(sub)
    const zone = resolveZone(sub.data.zone, (vpc && vpc.data.region) || region, 'aliyun')
    if (!zone || seen.has(zone)) continue
    seen.add(zone)
    out.push({ vswId: `${ctx.ref(sub)}.id`, zone })
  }
  return out
}

// HCL 内联子块（如 zone_mappings / health_check_config / servers）格式化
function nestedBlock(keyword, rows, indent) {
  const pad = ' '.repeat(indent)
  const inner = ' '.repeat(indent + 2)
  const width = rows.reduce((m, [k]) => Math.max(m, k.length), 0)
  const body = rows.map(([k, v]) => `${inner}${k.padEnd(width)} = ${v}`).join('\n')
  return `${pad}${keyword} {\n${body}\n${pad}}`
}

function resourceBlock(type, name, body) {
  return `resource "${type}" "${name}" {\n${body}\n}`
}

// 后端服务器属性（ALB/NLB/GWLB 共用）；GWLB 无 weight 字段
function serverRows(ctx, inst, index, port, withWeight) {
  const sub = ctx.findSubnet(inst)
  const ip = instancePrivateIpAt(inst, sub && sub.data.cidr, index)
  const rows = [['server_id', `${instanceRef(ctx, inst, index)}.id`]]
  if (ip) rows.push(['server_ip', `"${ip}"`])
  rows.push(['server_type', '"Ecs"'], ['port', String(port)])
  if (withWeight) rows.push(['weight', '100'])
  return rows
}

function albHealthRows(hc) {
  const proto = hc.protocol === 'https' ? 'HTTPS' : hc.protocol === 'tcp' ? 'TCP' : 'HTTP'
  const rows = [
    ['health_check_enabled', hc.enabled ? 'true' : 'false'],
    ['health_check_protocol', `"${proto}"`],
    ['health_check_interval', String(hc.interval)],
    ['health_check_timeout', String(hc.timeout)],
    ['healthy_threshold', String(hc.healthyThreshold)],
    ['unhealthy_threshold', String(hc.unhealthyThreshold)],
  ]
  if (/^\d+$/.test(hc.port)) rows.push(['health_check_connect_port', hc.port])
  if (hc.enabled && hc.protocol !== 'tcp') {
    rows.push(['health_check_path', `"${hc.path}"`], ['health_check_method', `"${hc.method}"`])
  }
  return rows
}

function nlbHealthRows(hc) {
  const http = hc.protocol !== 'tcp'
  const rows = [
    ['health_check_enabled', hc.enabled ? 'true' : 'false'],
    ['health_check_type', `"${http ? 'HTTP' : 'TCP'}"`],
    ['health_check_interval', String(hc.interval)],
    ['health_check_connect_timeout', String(hc.timeout)],
    ['healthy_threshold', String(hc.healthyThreshold)],
    ['unhealthy_threshold', String(hc.unhealthyThreshold)],
  ]
  if (/^\d+$/.test(hc.port)) rows.push(['health_check_connect_port', hc.port])
  if (http) {
    rows.push(['health_check_url', `"${hc.path}"`])
    rows.push(['http_check_method', `"${['GET', 'HEAD'].includes(hc.method) ? hc.method : 'GET'}"`])
  }
  return rows
}

function gwlbHealthRows(hc) {
  const http = hc.protocol !== 'tcp'
  const rows = [
    ['health_check_enabled', hc.enabled ? 'true' : 'false'],
    ['health_check_protocol', `"${http ? 'HTTP' : 'TCP'}"`],
    ['health_check_interval', String(hc.interval)],
    ['health_check_connect_timeout', String(hc.timeout)],
    ['healthy_threshold', String(hc.healthyThreshold)],
    ['unhealthy_threshold', String(hc.unhealthyThreshold)],
  ]
  if (/^\d+$/.test(hc.port)) rows.push(['health_check_connect_port', hc.port])
  if (http) rows.push(['health_check_path', `"${hc.path}"`])
  return rows
}

// 传统型 CLB：SLB 实例 + 服务器组 + 监听器 + 后端附件
function exportAliyunClb(ctx, lb, cfg, blocks) {
  const { ref } = ctx
  const name = ctx.name(lb)
  const sub = lbSubnets(ctx, lb)[0]
  const rows = [
    ['load_balancer_name', `"${clean(lb.data.name)}"`],
    ['address_type', lb.data.internal ? '"intranet"' : '"internet"'],
    ['load_balancer_spec', `"${cfg.spec}"`],
    ['internet_charge_type', `"${cfg.internetChargeType}"`],
  ]
  if (cfg.internetChargeType === 'PayByBandwidth') rows.push(['bandwidth', String(cfg.bandwidth)])
  if (sub) rows.push(['vswitch_id', `${ref(sub)}.id`])
  blocks.push(resourceBlock('alicloud_slb_load_balancer', name, hclLines(rows)))
  ;(lb.data.rules || []).forEach((rule, ri) => {
    const ruleName = `${name}_${ri}`
    const sgName = `${ruleName}_sg`
    const port = Number(rule.port) || 80
    const proto = String(rule.protocol || 'tcp').toLowerCase()
    blocks.push(`resource "alicloud_slb_server_group" "${sgName}" {
  load_balancer_id = ${ref(lb)}.id
  name             = "${clean(lb.data.name)}-${ri}"
}`)
    const lrows = [
      ['load_balancer_id', `${ref(lb)}.id`],
      ['frontend_port', String(port)],
      ['backend_port', String(port)],
      ['protocol', `"${proto}"`],
      ['server_group_id', `alicloud_slb_server_group.${sgName}.id`],
    ]
    if (['wrr', 'rr', 'wlc', 'sch'].includes(cfg.scheduler)) lrows.push(['scheduler', `"${cfg.scheduler}"`])
    // HTTPS 监听器的 bandwidth 为必填
    if (proto === 'https') lrows.push(['bandwidth', '10'])
    // 健康检查：协议 http(s) 用 http 检查并带路径，tcp 用 tcp 检查
    const hc = lbHealthCheck(rule)
    if (hc.enabled) {
      const hcHttp = hc.protocol !== 'tcp'
      lrows.push(['health_check', '"on"'])
      lrows.push(['health_check_type', hcHttp ? '"http"' : '"tcp"'])
      if (hcHttp) lrows.push(['health_check_uri', `"${hc.path}"`])
      // 阿里云 SLB 的 HTTP 健康检查请求方法仅支持 head/get
      if (hcHttp && ['GET', 'HEAD'].includes(hc.method)) {
        lrows.push(['health_check_method', `"${hc.method.toLowerCase()}"`])
      }
      if (/^\d+$/.test(hc.port)) lrows.push(['health_check_connect_port', hc.port])
      lrows.push(['healthy_threshold', String(hc.healthyThreshold)])
      lrows.push(['unhealthy_threshold', String(hc.unhealthyThreshold)])
      lrows.push(['health_check_timeout', String(hc.timeout)])
      lrows.push(['health_check_interval', String(hc.interval)])
    } else {
      lrows.push(['health_check', '"off"'])
    }
    blocks.push(resourceBlock('alicloud_slb_listener', ruleName, hclLines(lrows)))
    ;(rule.backends || []).forEach((bid, bi) => {
      // 解析 bid 格式：可能是 "instId" 或 "instId#index"（多实例展开后）
      const [instId, indexStr] = bid.split('#')
      const inst = ctx.byId.get(instId)
      if (!inst || inst.type !== 'Instance') return
      // 多实例节点且指定了具体实例：只生成一条后端附件
      // 多实例节点未指定：为每一台实例各生成一条后端附件
      const count = instanceCount(inst)
      const index = indexStr != null ? Number(indexStr) : -1
      const loops = index >= 0 ? 1 : count
      const startIdx = index >= 0 ? index : 0
      for (let k = 0; k < loops; k++) {
        const instIdx = startIdx + k
        const resId = loops > 1 ? `${ruleName}_${bi}_${k}` : `${ruleName}_${bi}`
        blocks.push(`resource "alicloud_slb_server_group_server_attachment" "${resId}" {
  server_group_id = alicloud_slb_server_group.${sgName}.id
  server_id       = ${instanceRef(ctx, inst, instIdx)}.id
  port            = ${port}
  type            = "ecs"
}`)
      }
    })
  })
}

// 应用型 ALB：LB 实例 + 服务器组（内联后端）+ 监听器（默认动作转发到服务器组）
function exportAliyunAlb(ctx, lb, cfg, region, blocks) {
  const { ref } = ctx
  const name = ctx.name(lb)
  const lbRef = `alicloud_alb_load_balancer.${name}.id`
  const vpc = lbVpc(ctx, lb)
  const rows = [
    ['load_balancer_name', `"${clean(lb.data.name)}"`],
    ['address_type', lb.data.internal ? '"Intranet"' : '"Internet"'],
    ['address_allocated_mode', `"${cfg.addressAllocatedMode}"`],
    ['address_ip_version', `"${cfg.ipVersion}"`],
    ['load_balancer_edition', `"${cfg.edition}"`],
  ]
  if (vpc) rows.push(['vpc_id', `${ref(vpc)}.id`])
  const zones = aliyunLbZoneMappings(ctx, lb, region)
    .map((m) => nestedBlock('zone_mappings', [['vswitch_id', m.vswId], ['zone_id', `"${m.zone}"`]], 2))
    .join('\n')
  const billing = nestedBlock('load_balancer_billing_config', [['pay_type', '"PayAsYouGo"']], 2)
  blocks.push(resourceBlock('alicloud_alb_load_balancer', name, [hclLines(rows), billing, zones].filter(Boolean).join('\n')))

  ;(lb.data.rules || []).forEach((rule, ri) => {
    const proto = String(rule.protocol || 'http').toLowerCase()
    if (!ALIYUN_LB_PROTOCOLS.alb.includes(proto)) return
    const ruleName = `${name}_${ri}`
    const sgName = `${ruleName}_sg`
    const port = Number(rule.port) || (proto === 'https' ? 443 : 80)
    const hc = lbHealthCheck(rule)
    const sgBody = [
      hclLines([
        ['vpc_id', vpc ? `${ref(vpc)}.id` : '""'],
        ['server_group_name', `"${clean(lb.data.name)}-${ri}"`],
        ['protocol', '"HTTP"'],
        ['scheduler', `"${cfg.scheduler}"`],
      ]),
      nestedBlock('health_check_config', albHealthRows(hc), 2),
    ]
    if (cfg.stickySession) {
      sgBody.push(nestedBlock('sticky_session_config', [['sticky_session_enabled', 'true'], ['sticky_session_type', '"Insert"']], 2))
    }
    if (cfg.connectionDrain) {
      sgBody.push(nestedBlock('connection_drain_config', [['connection_drain_enabled', 'true']], 2))
    }
    for (const { node, index } of lbBackendInstances(ctx, rule)) {
      sgBody.push(nestedBlock('servers', serverRows(ctx, node, index, port, true), 2))
    }
    blocks.push(resourceBlock('alicloud_alb_server_group', sgName, sgBody.join('\n')))
    const listenerBody = [
      `  load_balancer_id  = ${lbRef}`,
      `  listener_protocol = "${proto.toUpperCase()}"`,
      `  listener_port     = ${port}`,
      '  default_actions {',
      '    type = "ForwardGroup"',
      '    forward_group_config {',
      '      server_group_tuples {',
      `        server_group_id = alicloud_alb_server_group.${sgName}.id`,
      '      }',
      '    }',
      '  }',
    ].join('\n')
    blocks.push(resourceBlock('alicloud_alb_listener', ruleName, listenerBody))
  })
}

// 网络型 NLB：LB 实例 + 服务器组 + 监听器 + 后端附件
function exportAliyunNlb(ctx, lb, cfg, region, blocks) {
  const { ref } = ctx
  const name = ctx.name(lb)
  const lbRef = `alicloud_nlb_load_balancer.${name}.id`
  const vpc = lbVpc(ctx, lb)
  const vpcRef = vpc ? `${ref(vpc)}.id` : '""'
  const rows = [
    ['load_balancer_name', `"${clean(lb.data.name)}"`],
    ['load_balancer_type', '"Network"'],
    ['address_type', lb.data.internal ? '"Intranet"' : '"Internet"'],
    ['address_ip_version', `"${cfg.ipVersion}"`],
    ['cross_zone_enabled', cfg.crossZone ? 'true' : 'false'],
  ]
  if (vpc) rows.push(['vpc_id', vpcRef])
  const zones = aliyunLbZoneMappings(ctx, lb, region)
    .map((m) => nestedBlock('zone_mappings', [['vswitch_id', m.vswId], ['zone_id', `"${m.zone}"`]], 2))
    .join('\n')
  blocks.push(resourceBlock('alicloud_nlb_load_balancer', name, [hclLines(rows), zones].filter(Boolean).join('\n')))

  ;(lb.data.rules || []).forEach((rule, ri) => {
    const proto = String(rule.protocol || 'tcp').toLowerCase()
    if (!ALIYUN_LB_PROTOCOLS.nlb.includes(proto)) return
    const protoUp = proto.toUpperCase()
    const port = Number(rule.port) || 80
    const ruleName = `${name}_${ri}`
    const sgName = `${ruleName}_sg`
    const sgRows = [
      ['vpc_id', vpcRef],
      ['server_group_name', `"${clean(lb.data.name)}-${ri}"`],
      ['protocol', `"${NLB_SERVER_PROTOCOL[proto] || 'TCP'}"`],
      ['scheduler', `"${cfg.scheduler}"`],
    ]
    if (cfg.connectionDrain) sgRows.push(['connection_drain_enabled', 'true'])
    if (cfg.preserveClientIp) sgRows.push(['preserve_client_ip_enabled', 'true'])
    const sgBody = [hclLines(sgRows), nestedBlock('health_check', nlbHealthRows(lbHealthCheck(rule)), 2)]
    blocks.push(resourceBlock('alicloud_nlb_server_group', sgName, sgBody.join('\n')))

    const lrows = [
      ['load_balancer_id', lbRef],
      ['listener_protocol', `"${protoUp}"`],
      ['listener_port', String(port)],
      ['server_group_id', `alicloud_nlb_server_group.${sgName}.id`],
    ]
    if (cfg.proxyProtocol) lrows.push(['proxy_protocol_enabled', 'true'])
    blocks.push(resourceBlock('alicloud_nlb_listener', ruleName, hclLines(lrows)))

    lbBackendInstances(ctx, rule).forEach(({ node, index }, bi) => {
      const attRows = [
        ['server_group_id', `alicloud_nlb_server_group.${sgName}.id`],
        ...serverRows(ctx, node, index, port, true),
      ]
      blocks.push(resourceBlock('alicloud_nlb_server_group_server_attachment', `${ruleName}_${bi}`, hclLines(attRows)))
    })
  })
}

// 网关型 GWLB：LB 实例 + 服务器组（GENEVE，内联后端）+ 监听器（无端口/协议）
function exportAliyunGwlb(ctx, lb, cfg, region, blocks) {
  const { ref } = ctx
  const name = ctx.name(lb)
  const lbRef = `alicloud_gwlb_load_balancer.${name}.id`
  const vpc = lbVpc(ctx, lb)
  const vpcRef = vpc ? `${ref(vpc)}.id` : '""'
  const rows = [
    ['load_balancer_name', `"${clean(lb.data.name)}"`],
    ['address_ip_version', `"${cfg.ipVersion}"`],
  ]
  if (vpc) rows.push(['vpc_id', vpcRef])
  const zones = aliyunLbZoneMappings(ctx, lb, region)
    .map((m) => nestedBlock('zone_mappings', [['vswitch_id', m.vswId], ['zone_id', `"${m.zone}"`]], 2))
    .join('\n')
  blocks.push(resourceBlock('alicloud_gwlb_load_balancer', name, [hclLines(rows), zones].filter(Boolean).join('\n')))

  ;(lb.data.rules || []).forEach((rule, ri) => {
    const port = Number(rule.port) || 6081
    const ruleName = `${name}_${ri}`
    const sgName = `${ruleName}_sg`
    const sgRows = [
      ['vpc_id', vpcRef],
      ['server_group_name', `"${clean(lb.data.name)}-${ri}"`],
      ['protocol', '"GENEVE"'],
      ['scheduler', `"${cfg.scheduler}"`],
      ['server_failover_mode', `"${cfg.serverFailoverMode}"`],
    ]
    const sgBody = [hclLines(sgRows), nestedBlock('health_check_config', gwlbHealthRows(lbHealthCheck(rule)), 2)]
    if (cfg.connectionDrain) {
      sgBody.push(nestedBlock('connection_drain_config', [['connection_drain_enabled', 'true']], 2))
    }
    for (const { node, index } of lbBackendInstances(ctx, rule)) {
      sgBody.push(nestedBlock('servers', serverRows(ctx, node, index, port, false), 2))
    }
    blocks.push(resourceBlock('alicloud_gwlb_server_group', sgName, sgBody.join('\n')))
    blocks.push(resourceBlock('alicloud_gwlb_listener', ruleName, [
      `  load_balancer_id = ${lbRef}`,
      `  server_group_id  = alicloud_gwlb_server_group.${sgName}.id`,
    ].join('\n')))
  })
}

// 按 lbConfig.type 分发阿里云负载均衡导出
function exportAliyunLoadBalancer(ctx, lb, region, blocks) {
  const cfg = aliyunLbConfig(lb)
  if (cfg.type === 'alb') return exportAliyunAlb(ctx, lb, cfg, region, blocks)
  if (cfg.type === 'nlb') return exportAliyunNlb(ctx, lb, cfg, region, blocks)
  if (cfg.type === 'gwlb') return exportAliyunGwlb(ctx, lb, cfg, region, blocks)
  return exportAliyunClb(ctx, lb, cfg, blocks)
}


export function exportAliyunTerraform(nodes, edges, providerVersion) {
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

  let snatSeq = 0 // SNAT 条目的资源名后缀，保证多个网关/子网组合唯一
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
    // SNAT 来源：子网按 vswitch 生成；实例降级到其实例所属子网；VPC 用 source_cidr（阿里云原生支持）
    const eips = gatewayEips(ctx, gw)
    const { vpcs, subnets, instances } = gatewaySnatSources(ctx, gw)
    const vpcIds = new Set(vpcs.map((v) => v.id))
    const snatSubnets = new Map(subnets.map((s) => [s.id, s]))
    for (const inst of instances) {
      const instSub = findSubnet(inst)
      if (instSub) snatSubnets.set(instSub.id, instSub)
    }
    for (const snatSub of snatSubnets.values()) {
      // 该子网所属 VPC 已接入时由 source_cidr 覆盖，避免重复/冲突的 SNAT 条目
      const subVpc = findVpc(snatSub)
      if (subVpc && vpcIds.has(subVpc.id)) continue
      for (const eip of eips) {
        for (let ei = 0; ei < eipCount(eip); ei++) {
          blocks.push(`resource "alicloud_snat_entry" "${ctx.name(gw)}_snat_${snatSeq++}" {
  snat_table_id     = ${ref(gw)}.snat_table_ids
  source_vswitch_id = ${ref(snatSub)}.id
  snat_ip           = ${eipRef(ctx, eip, ei)}.ip_address
}`)
        }
      }
    }
    for (const vpcSrc of vpcs) {
      for (const eip of eips) {
        for (let ei = 0; ei < eipCount(eip); ei++) {
          blocks.push(`resource "alicloud_snat_entry" "${ctx.name(gw)}_snat_${snatSeq++}" {
  snat_table_id = ${ref(gw)}.snat_table_ids
  source_cidr   = "${vpcSrc.data.cidr}"
  snat_ip       = ${eipRef(ctx, eip, ei)}.ip_address
}`)
        }
      }
    }
  }

  for (const eip of nodes.filter((n) => n.type === 'Eip')) {
    const internetChargeType =
      eip.data.internetChargeType === 'payByBandwidth' ? 'PayByBandwidth' : 'PayByTraffic'
    const eipRows = [
      ...(isCountedInstance(eip)
        ? [
            ['count', String(eipCount(eip))],
            ['name', eipNameExpr(eip)],
          ]
        : []),
      ['bandwidth', `"${eip.data.bandwidth}"`],
      ['internet_charge_type', `"${internetChargeType}"`],
    ]
    blocks.push(`resource "alicloud_eip" "${ctx.name(eip)}" {
${hclLines(eipRows)}
}`)
    // 按编辑器选择的绑定生成关联（每个 EIP 绑定到选定的实例内网 IP）
    const eipTargets = eipInstanceCandidates(ctx, eip)
    eipBindings(eip, eipTargets).forEach((b, i) => {
      if (!b) return
      blocks.push(`resource "alicloud_eip_association" "${ctx.name(eip)}_${i}" {
  allocation_id = ${eipRef(ctx, eip, i)}.id
  instance_id   = ${instanceRef(ctx, b.node, b.index)}.id
}`)
    })
    // Eip -> Gateway：把 EIP 绑定到 NAT 网关作为公网出口（instance_type 需为 Nat）；
    // EIP 数量 >1 时全部绑定到网关作为多出口
    ctx
      .targetNodes(eip.id)
      .filter((n) => n.type === 'Gateway')
      .forEach((gw, gi) => {
        for (let i = 0; i < eipCount(eip); i++) {
          const resId = `${ctx.name(eip)}_gw_${gi}${eipCount(eip) > 1 ? `_${i}` : ''}`
          blocks.push(`resource "alicloud_eip_association" "${resId}" {
  allocation_id = ${eipRef(ctx, eip, i)}.id
  instance_id   = ${ref(gw)}.id
  instance_type = "Nat"
}`)
        }
      })
  }

  // 负载均衡：按 lbConfig.type 生成 CLB/ALB/NLB/GWLB 对应的资源组
  for (const lb of nodes.filter((n) => n.type === 'LoadBalancer')) {
    exportAliyunLoadBalancer(ctx, lb, region, blocks)
  }

  const keyPairs = collectKeyPairs(ctx, nodes)
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
    const kp = resolveInstanceKeyPair(ctx, inst)
    const sysDisk = systemDiskConfig(inst.data, 'cloud_essd')
    const dataDisks = dataDiskConfigs(inst.data, 'cloud_essd')
    const counted = isCountedInstance(inst)
    // 多实例按子网 CIDR 顺序分配私网 IP；单实例保持固定值
    const priv = counted
      ? instancePrivateIp(inst.data, sub && sub.data.cidr, 'count.index')
      : `"${inst.data.privateIp}"`
    const rows = [
      ...(counted ? [['count', String(instanceCount(inst))]] : []),
      ['instance_name', instanceNameExpr(inst)],
      ['instance_type', `"${inst.data.instanceType}"`],
      ['image_id', `"${inst.data.imageId}"`],
      ...aliyunChargeRows(inst.data.chargeType),
      ['vswitch_id', vswRef],
      ...(priv ? [['private_ip', priv]] : []),
      ['internet_max_bandwidth_out', '0'],
      ['system_disk_category', `"${sysDisk.type}"`],
      ['system_disk_size', String(sysDisk.size)],
    ]
    const gpuUserData = gpuUserDataExpr(inst.data)
    if (gpuUserData) rows.push(['user_data', gpuUserData])
    if (sgRefs.length) rows.push(['security_groups', `[${sgRefs.join(', ')}]`])
    if (kp) {
      // 新建密钥对引用生成的资源；关联现有密钥对直接按名称引用
      if (kp.mode === 'create') {
        rows.push(['key_name', `alicloud_key_pair.${keyPairs.get(kp.name)}.key_name`])
      } else {
        rows.push(['key_name', `"${kp.name}"`])
      }
    } else if (auth.type === 'password' && auth.value) {
      rows.push(['password', `"${auth.value}"`])
    }
    const dataDiskBlock = dataDisks.length
      ? '\n\n' +
        dataDisks
          .map(
            (d) => `  data_disks {
    category = "${d.type}"
    size     = ${d.size}
  }`
          )
          .join('\n')
      : ''
    blocks.push(`resource "alicloud_instance" "${ctx.name(inst)}" {
${hclLines(rows)}${dataDiskBlock}
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
        if (hop) nexthopId = (hop.type === 'Instance' ? instanceRef(ctx, hop, 0) : ref(hop)) + '.id'
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

  let peerSeq = 0
  for (const { ic, pairs } of resolveInterconnects(ctx)) {
    for (const pair of pairs) {
      const peerRegion = clean(pair.a.data.region) || region
      blocks.push(`resource "alicloud_vpc_peer_connection" "${ctx.name(ic)}_${pair.key}" {
  vpc_id         = ${ref(pair.a)}.id
  peer_vpc_id    = ${ref(pair.b)}.id
  peer_region_id = "${peerRegion}"
}`)
    }
    for (const pair of pairs) {
      for (const [from, to] of [[pair.a, pair.b], [pair.b, pair.a]]) {
        for (const rt of routeTablesOfVpc(ctx, from)) {
          blocks.push(`resource "alicloud_route_entry" "${ctx.name(rt)}_peer_${peerSeq++}" {
  route_table_id        = ${ref(rt)}.id
  destination_cidrblock = "${to.data.cidr}"
  nexthop_type          = "VpcPeer"
  nexthop_id            = ${ref(ic)}_${pair.key}.id
}`)
        }
      }
    }
  }

  return {
    provider: providerBlock(providerVersion),
    variables: variablesBlock(region),
    main: blocks.join('\n\n') + '\n',
    outputs: buildOutputs(ctx, nodes, 'aliyun'),
  }
}
