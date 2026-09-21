import { buildGraph, slug, parseCidr, ipToInt, intToIp } from '../utils.js'

// 取首个配置了地域的 VPC 的地域，作为 Terraform provider 的默认地域
export function resolveVpcRegion(nodes, fallback) {
  const vpc = nodes.find((n) => n.type === 'VPC' && n.data && n.data.region)
  return vpc ? vpc.data.region : fallback
}

// 云资源导出共享上下文：资源唯一命名、引用解析、VPC/子网归属
export function createCloudContext(nodes, edges, resourceTypes) {
  const { byId, sourceNodes, targetNodes } = buildGraph(nodes, edges)

  const resourceNames = new Map()
  function assignUniqueNames(type) {
    const seen = new Map()
    for (const n of nodes.filter((x) => x.type === type)) {
      const base = slug(n.data.name) || 'unnamed'
      const count = (seen.get(base) || 0) + 1
      seen.set(base, count)
      resourceNames.set(n.id, count === 1 ? base : `${base}_${count}`)
    }
  }
  ;['VPC', 'Subnet', 'Instance', 'SecurityGroup', 'Gateway', 'Eip', 'LoadBalancer', 'RouteTable', 'Interconnect'].forEach(assignUniqueNames)

  const name = (node) => resourceNames.get(node.id)

  const ref = (node) => {
    const type = node.type
    if (type === 'Subnet') return `${resourceTypes.subnet}.${name(node)}`
    if (type === 'VPC') return `${resourceTypes.vpc}.${name(node)}`
    if (type === 'Instance') return `${resourceTypes.instance}.${name(node)}`
    if (type === 'SecurityGroup') return `${resourceTypes.securityGroup}.${name(node)}`
    if (type === 'Gateway') return `${resourceTypes.natGateway}.${name(node)}`
    if (type === 'Eip') return `${resourceTypes.eip}.${name(node)}`
    if (type === 'LoadBalancer') return `${resourceTypes.loadBalancer}.${name(node)}`
    if (type === 'RouteTable') return `${resourceTypes.routeTable}.${name(node)}`
    if (type === 'Interconnect') return `${resourceTypes.interconnect}.${name(node)}`
    return null
  }

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

  return { byId, sourceNodes, targetNodes, nodes, edges, name, ref, findVpc, findSubnet }
}

// 根据路由条目的下一跳类型，在所属 VPC 内自动解析目标节点
export function resolveNextHopNode(ctx, route, vpc) {
  if (route.nextHop) return null
  if (route.nextHopType === 'NatGateway') {
    const gws = ctx.nodes.filter((n) => n.type === 'Gateway')
    return gws.find((g) => ctx.findVpc(g)?.id === vpc?.id) || gws[0] || null
  }
  if (route.nextHopType === 'Instance') {
    const insts = ctx.nodes.filter((n) => n.type === 'Instance')
    return insts.find((i) => ctx.findVpc(i)?.id === vpc?.id) || insts[0] || null
  }
  return null
}

// 网关绑定的出口 EIP（Eip -> Gateway 连线）；未显式连线时回退到未绑定实例的 EIP，
// 使「多 ECS 共享一个 EIP 出口」的 NAT 网关导出仍可落地
export function gatewayEips(ctx, gateway) {
  const bound = ctx.sourceNodes(gateway.id).filter((n) => n.type === 'Eip')
  if (bound.length) return bound
  return ctx.nodes.filter(
    (n) => n.type === 'Eip' && !ctx.targetNodes(n.id).some((t) => t.type === 'Instance')
  )
}

// 网关的 SNAT 来源（VPC -> Gateway、Subnet -> Gateway、Instance -> Gateway），
// 各厂商按自身能力原生支持或降级处理
export function gatewaySnatSources(ctx, gateway) {
  const sources = ctx.sourceNodes(gateway.id)
  return {
    vpcs: sources.filter((n) => n.type === 'VPC'),
    subnets: sources.filter((n) => n.type === 'Subnet'),
    instances: sources.filter((n) => n.type === 'Instance'),
  }
}

// VPC 下的全部子网（VPC 级 SNAT 降级时使用）
export function vpcSubnets(ctx, vpc) {
  return ctx.nodes.filter((n) => n.type === 'Subnet' && ctx.findVpc(n)?.id === vpc.id)
}

// 负载均衡的后端候选实例：直接连接的实例 + 接入的子网/VPC 内的所有实例（多实例按序展开）
export function lbBackendCandidates(ctx, lb) {
  const set = new Map()
  const sources = ctx.sourceNodes(lb.id)
  for (const n of sources) {
    if (n.type === 'Instance') set.set(n.id, n)
  }
  if (sources.some((n) => n.type === 'Subnet' || n.type === 'VPC')) {
    const subnets = new Set(sources.filter((n) => n.type === 'Subnet').map((n) => n.id))
    const vpcs = new Set(sources.filter((n) => n.type === 'VPC').map((n) => n.id))
    for (const inst of ctx.nodes) {
      if (inst.type !== 'Instance') continue
      const sub = ctx.findSubnet(inst)
      const vpc = ctx.findVpc(inst)
      if ((sub && subnets.has(sub.id)) || (vpc && vpcs.has(vpc.id))) set.set(inst.id, inst)
    }
  }
  // 展开多实例：每台实例一项，含名称与内网 IP
  const out = []
  for (const inst of set.values()) {
    const sub = ctx.findSubnet(inst)
    const count = instanceCount(inst)
    for (let k = 0; k < count; k++) {
      out.push({
        id: inst.id,
        index: k,
        node: inst,
        name: count > 1 ? `${clean(inst.data.name)}-${k + 1}` : clean(inst.data.name),
        ip: instancePrivateIpAt(inst, sub && sub.data.cidr, k),
      })
    }
  }
  return out
}

// 负载均衡的部署子网：优先接入的子网，其次接入 VPC 内的子网
export function lbSubnets(ctx, lb) {
  const sources = ctx.sourceNodes(lb.id)
  const subnets = sources.filter((n) => n.type === 'Subnet')
  if (subnets.length) return subnets
  const result = []
  for (const vpc of sources.filter((n) => n.type === 'VPC')) result.push(...vpcSubnets(ctx, vpc))
  return result
}

// 负载均衡所属 VPC：直接接入的 VPC，或部署子网所属 VPC
export function lbVpc(ctx, lb) {
  const direct = ctx.sourceNodes(lb.id).find((n) => n.type === 'VPC')
  if (direct) return direct
  const sub = lbSubnets(ctx, lb)[0]
  return sub ? ctx.findVpc(sub) : null
}

// 展开监听规则的后端为具体实例（多实例按序展开；指定 #index 时只取该台）
export function lbBackendInstances(ctx, rule) {
  const out = []
  for (const bid of rule.backends || []) {
    const [instId, indexStr] = String(bid).split('#')
    const inst = ctx.byId.get(instId)
    if (!inst || inst.type !== 'Instance') continue
    const count = instanceCount(inst)
    const index = indexStr != null ? Number(indexStr) : -1
    if (index >= 0) out.push({ node: inst, index })
    else for (let k = 0; k < count; k++) out.push({ node: inst, index: k })
  }
  return out
}

// 各厂商 HTTP 健康检查支持的「请求方法」（Terraform 资源无请求体字段，见 validateLoadBalancers）
const LB_HEALTH_METHOD_SUPPORT = {
  aliyun: ['GET', 'HEAD'],
  tencent: ['GET', 'HEAD'],
  huawei: ['GET', 'HEAD', 'POST'],
  // AWS 目标组不暴露请求方法；GET 为其隐含默认，保持不告警
  aws: ['GET'],
}

// 阿里云四类负载均衡：监听协议支持与最少可用区数（校验用）
const ALIYUN_LB_PROTOCOLS = {
  clb: ['tcp', 'udp', 'http', 'https'],
  alb: ['http', 'https', 'quic'],
  nlb: ['tcp', 'udp', 'tcpssl'],
  gwlb: ['geneve'],
}
const ALIYUN_LB_MIN_ZONES = { clb: 0, alb: 2, nlb: 2, gwlb: 1 }

// 腾讯云负载均衡：类型与监听协议（ALB 暂无 Terraform 资源，仅校验并告警）
const TENCENT_LB_TYPES = ['clb', 'alb', 'gwlb']
const TENCENT_LB_PROTOCOLS = {
  clb: ['tcp', 'udp', 'http', 'https'],
  alb: ['http', 'https'],
  gwlb: ['geneve'],
}

const LB_PROTOCOLS_BY_VENDOR = {
  aliyun: ALIYUN_LB_PROTOCOLS,
  tencent: TENCENT_LB_PROTOCOLS,
}

// 健康检查请求方法支持：阿里云 ALB 额外支持 POST，其余按厂商默认
function lbHealthMethods(vendor, lbType) {
  if (vendor === 'aliyun' && lbType === 'alb') return ['GET', 'HEAD', 'POST']
  return LB_HEALTH_METHOD_SUPPORT[vendor] || []
}


// 监听规则的健康检查配置：归一化并回退默认值（兼容缺少 healthCheck 的旧设计）
export function lbHealthCheck(rule) {
  const h = (rule && rule.healthCheck) || {}
  const num = (v, d) => (Number(v) > 0 ? Number(v) : d)
  return {
    enabled: h.enabled !== false,
    protocol: String(h.protocol || 'tcp').toLowerCase(),
    method: String(h.method || 'GET').toUpperCase(),
    path: clean(h.path) || '/',
    body: clean(h.body),
    port: clean(h.port),
    interval: num(h.interval, 5),
    timeout: num(h.timeout, 2),
    healthyThreshold: num(h.healthyThreshold, 3),
    unhealthyThreshold: num(h.unhealthyThreshold, 3),
  }
}

// 解析互联节点关联的 VPC 组合与两两对等连接（3 个及以上按全互联展开）
export function resolveInterconnects(ctx) {
  const { nodes, sourceNodes } = ctx
  const links = []
  for (const ic of nodes.filter((n) => n.type === 'Interconnect')) {
    const vpcs = sourceNodes(ic.id).filter((n) => n.type === 'VPC')
    if (vpcs.length < 2) continue
    const pairs = []
    for (let i = 0; i < vpcs.length; i++) {
      for (let j = i + 1; j < vpcs.length; j++) {
        pairs.push({ a: vpcs[i], b: vpcs[j], key: `${i}_${j}` })
      }
    }
    links.push({ ic, vpcs, pairs })
  }
  return links
}

// 返回 VPC 关联的路由表节点
export function routeTablesOfVpc(ctx, vpc) {
  return ctx.nodes.filter((n) => n.type === 'RouteTable' && ctx.findVpc(n)?.id === vpc.id)
}

// 将 [key, value] 列表格式化为键名对齐的 HCL 属性行
export function hclLines(rows) {
  const width = rows.reduce((max, [k]) => Math.max(max, k.length), 0)
  return rows.map(([k, v]) => `  ${k.padEnd(width)} = ${v}`).join('\n')
}

// 清理字符串首尾空白，避免导出的资源名/属性因尾随空格触发无谓变更
export function clean(value) {
  return String(value ?? '').trim()
}

// 实例数量：一个 Instance 节点代表多台同规格实例，非法值回退为 1
export function instanceCount(node) {
  const n = Number(node && node.data && node.data.count)
  return Number.isFinite(n) && n > 1 ? Math.floor(n) : 1
}

// 多实例（count>1）时资源使用 Terraform count，引用需带索引
export function isCountedInstance(node) {
  return instanceCount(node) > 1
}

// 实例资源引用：多实例时按索引取用（默认第 0 台）
export function instanceRef(ctx, node, index = 0) {
  const base = ctx.ref(node)
  if (!base || !isCountedInstance(node)) return base
  return `${base}[${index}]`
}

// 实例名称 HCL 表达式：多实例以节点名称作为前缀并追加序号（从 1 开始，需配合 count）
export function instanceNameExpr(node) {
  const base = clean(node && node.data && node.data.name)
  return isCountedInstance(node) ? `"${base}-\${count.index + 1}"` : `"${base}"`
}

// EIP 数量：一个 Eip 节点代表多个同规格公网 IP（复用实例的 count 语义）
export function eipCount(eip) {
  return instanceCount(eip)
}

// EIP 资源引用：数量 >1 时按索引取用
export function eipRef(ctx, eip, index = 0) {
  return instanceRef(ctx, eip, index)
}

// EIP 名称 HCL 表达式：数量 >1 时以节点名称为前缀追加序号
export function eipNameExpr(eip) {
  return instanceNameExpr(eip)
}

// 展开 EIP 直连目标的可绑定候选：每台实例（多实例按序展开）一项，含名称与内网 IP；负载均衡器也作为候选
export function eipInstanceCandidates(ctx, eip) {
  const out = []
  for (const target of ctx.targetNodes(eip.id)) {
    if (target.type === 'Instance') {
      const sub = ctx.findSubnet(target)
      const count = instanceCount(target)
      for (let k = 0; k < count; k++) {
        out.push({
          id: target.id,
          index: k,
          node: target,
          type: 'Instance',
          name: count > 1 ? `${clean(target.data.name)}-${k + 1}` : clean(target.data.name),
          ip: instancePrivateIpAt(target, sub && sub.data.cidr, k),
        })
      }
    } else if (target.type === 'LoadBalancer') {
      out.push({
        id: target.id,
        index: 0,
        node: target,
        type: 'LoadBalancer',
        name: clean(target.data.name),
        ip: '',
      })
    }
  }
  return out
}

// 归一化 EIP 绑定：返回按 EIP 序号排列的候选（或 null）。
// 存储为按 EIP 序号的对象映射 { [i]: { id, index } | null }：缺省键按同序候选回退（连上即绑定），
// null 表示显式不绑定（可跨 JSON 序列化保留）；兼容旧格式 { 实例节点id: 序号 } 与早期数组格式。
export function eipBindings(eip, candidates) {
  const raw = (eip && eip.data && eip.data.bindings) || {}
  const count = instanceCount(eip)
  const result = new Array(count).fill(null)
  const findCand = (b) =>
    b && typeof b === 'object'
      ? candidates.find((c) => c.id === b.id && c.index === (Number(b.index) || 0)) || null
      : null
  if (Array.isArray(raw)) {
    // 数组格式无法区分「未设置」与「不绑定」，统一按回退处理
    for (let i = 0; i < count; i++) result[i] = findCand(raw[i])
    for (let i = 0; i < count; i++) if (!result[i] && candidates[i]) result[i] = candidates[i]
    return result
  }
  // 旧格式：{ 实例节点id: 序号 }（键非纯数字、值为数字）
  const keys = Object.keys(raw)
  const isLegacy = keys.length > 0 && !keys.every((k) => /^\d+$/.test(k))
  if (isLegacy) {
    const first = Object.entries(raw)[0]
    result[0] = candidates.find((c) => c.id === first[0] && c.index === (Number(first[1]) || 0)) || null
    for (let i = 0; i < count; i++) if (!result[i] && candidates[i]) result[i] = candidates[i]
    return result
  }
  for (let i = 0; i < count; i++) {
    const b = raw[i]
    if (b === undefined) result[i] = candidates[i] || null
    else if (b !== null) result[i] = findCand(b)
  }
  return result
}

// 实例第 index 台的实际私网 IP（用于展示）：
// 如果 privateIp 包含逗号（多实例手动指定 IP），直接返回对应 index 的 IP
// 否则按子网 CIDR 顺序分配，无法计算时回退到基础私网 IP；单实例直接返回其私网 IP
export function instancePrivateIpAt(node, subnetCidr, index = 0) {
  const raw = clean(node && node.data && node.data.privateIp)
  if (!raw) return ''
  // 多实例手动指定 IP（逗号分隔）：直接返回对应 index 的 IP
  if (raw.includes(',')) {
    const ips = raw.split(',').map((s) => s.trim())
    return ips[index] || ips[0] || ''
  }
  if (instanceCount(node) <= 1) return raw
  const info = parseCidr(subnetCidr)
  if (!info) return raw
  const offset = ipToInt(raw) - ipToInt(info.network)
  if (!(offset > 0)) return raw
  return intToIp(ipToInt(info.network) + offset + index)
}

// 实例私网 IP 表达式：多实例（indexExpr 非空）时以子网 CIDR 为基础按序分配，
// 无法计算时返回 null（由云平台自动分配）；单实例返回固定值字面量
export function instancePrivateIp(data, subnetCidr, indexExpr) {
  const ip = clean(data && data.privateIp)
  if (!indexExpr) return ip ? `"${ip}"` : null
  if (!ip) return null
  // 逗号分隔多 IP：按 index 直接取对应 IP
  if (ip.includes(',')) {
    return `element(split(",", "${ip}"), ${indexExpr})`
  }
  const info = parseCidr(subnetCidr)
  if (!info) return null
  const offset = ipToInt(ip) - ipToInt(info.network)
  if (!(offset > 0)) return null
  return `cidrhost("${clean(subnetCidr)}", ${offset} + ${indexExpr})`
}

// 各厂商可用区命名：region + 分隔符 + 后缀（阿里云/腾讯云带连字符，AWS/华为云直接拼接）
const ZONE_SEPARATOR = { aliyun: '-', tencent: '-', aws: '', huawei: '' }

// 按目标地域重写可用区，保证可用区与 VPC 地域一致（如 cn-hangzhou-b -> cn-wulanchabu-b）
export function resolveZone(zone, region, vendor) {
  const z = clean(zone)
  const r = clean(region)
  if (!r) return z
  const v = ZONE_SEPARATOR[vendor] !== undefined ? vendor : 'aliyun'
  const sep = ZONE_SEPARATOR[v]
  const match = z.match(/([a-z]+|\d+)$/i)
  let suffix = match ? match[1].toLowerCase() : ''
  if (v === 'tencent') {
    if (/^[a-z]+$/.test(suffix)) {
      const index = suffix.charCodeAt(0) - 96
      suffix = String(index >= 1 && index <= 26 ? index : 1)
    }
    if (!suffix) suffix = '1'
  } else if (!/^[a-z]+$/.test(suffix)) {
    suffix = 'a'
  }
  return `${r}${sep}${suffix}`
}

// 校验各资源可用区与所属 VPC 地域是否一致，返回需要提示的项
export function validateZones(nodes, edges, vendor) {
  const ctx = createCloudContext(nodes, edges, {})
  const issues = []
  for (const sub of nodes.filter((n) => n.type === 'Subnet')) {
    const vpc = ctx.findVpc(sub)
    const region = clean(vpc && vpc.data && vpc.data.region)
    const zone = clean(sub.data && sub.data.zone)
    if (!region || !zone) continue
    const expected = resolveZone(zone, region, vendor)
    if (expected !== zone) {
      issues.push({ nodeId: sub.id, name: clean(sub.data.name), zone, region, expected })
    }
  }
  return issues
}

// 校验实例规格是否在其所属子网的可用区有货：zonesOf(type) 返回该规格的可用区列表，
// 返回空数组视为不限制；sameRegion 为该地域内可选的有货可用区（供提示/快捷修复）
export function validateInstanceZones(nodes, edges, vendor, zonesOf) {
  if (typeof zonesOf !== 'function') return []
  const ctx = createCloudContext(nodes, edges, {})
  const issues = []
  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const zones = zonesOf(inst.data && inst.data.instanceType)
    if (!zones || !zones.length) continue
    const sub = ctx.findSubnet(inst)
    const rawZone = clean(sub && sub.data && sub.data.zone)
    if (!rawZone) continue
    const vpc = ctx.findVpc(inst)
    const region = clean(vpc && vpc.data && vpc.data.region)
    const az = resolveZone(rawZone, region, vendor)
    if (zones.includes(az)) continue
    // 该规格在此地域是否有货：resolveZone 重写前缀后与原值相同即同地域
    const sameRegion = region
      ? zones.filter((z) => z === resolveZone(z, region, vendor))
      : []
    issues.push({
      nodeId: inst.id,
      subnetId: sub ? sub.id : '',
      name: clean(inst.data.name),
      type: clean(inst.data.instanceType),
      zone: az,
      region,
      sameRegion,
    })
  }
  return issues
}

// NAT 网关各来源类型的厂商能力：native 原生支持、subnet 降级到子网、none 不支持（仅告警）
const GATEWAY_SOURCE_SUPPORT = {
  aliyun: { instance: 'subnet', vpc: 'native' },
  tencent: { instance: 'native', vpc: 'subnet' },
  huawei: { instance: 'subnet', vpc: 'subnet' },
  aws: { instance: 'none', vpc: 'none' },
}

// 校验网关 SNAT 来源的厂商降级情况，返回可翻译的告警项（key + params）
export function validateGatewaySources(nodes, edges, vendor) {
  const ctx = createCloudContext(nodes, edges, {})
  const support = GATEWAY_SOURCE_SUPPORT[vendor] || {}
  const issues = []
  for (const gw of nodes.filter((n) => n.type === 'Gateway')) {
    const { vpcs, instances } = gatewaySnatSources(ctx, gw)
    for (const inst of instances) {
      if (support.instance === 'subnet') {
        const sub = ctx.findSubnet(inst)
        issues.push(
          sub
            ? { key: 'export.gatewayInstanceDegraded', params: { source: clean(inst.data.name), subnet: clean(sub.data.name) } }
            : { key: 'export.gatewayInstanceNoSubnet', params: { source: clean(inst.data.name) } }
        )
      } else if (support.instance === 'none') {
        issues.push({ key: 'export.gatewaySourceIgnored', params: { source: clean(inst.data.name) } })
      }
    }
    for (const vpc of vpcs) {
      if (support.vpc === 'subnet') {
        issues.push({ key: 'export.gatewayVpcDegraded', params: { source: clean(vpc.data.name) } })
      } else if (support.vpc === 'none') {
        issues.push({ key: 'export.gatewaySourceIgnored', params: { source: clean(vpc.data.name) } })
      }
    }
  }
  return issues
}

// 校验负载均衡配置：未接入网络、监听规则未选后端，返回可翻译的告警项
export function validateLoadBalancers(nodes, edges, vendor) {
  const ctx = createCloudContext(nodes, edges, {})
  const issues = []
  for (const lb of nodes.filter((n) => n.type === 'LoadBalancer')) {
    const rawType = (lb.data.lbConfig && String(lb.data.lbConfig.type || '').toLowerCase()) || 'clb'
    const vendorTypes =
      vendor === 'aliyun'
        ? Object.keys(ALIYUN_LB_PROTOCOLS)
        : vendor === 'tencent'
          ? TENCENT_LB_TYPES
          : []
    const lbType = vendorTypes.includes(rawType) ? rawType : 'clb'
    const protos = (LB_PROTOCOLS_BY_VENDOR[vendor] || {})[lbType] || null
    const hasNet = ctx.sourceNodes(lb.id).some((n) => n.type === 'Subnet' || n.type === 'VPC')
    if (!hasNet) {
      issues.push({ key: 'export.lbNoNetwork', params: { name: clean(lb.data.name) } })
    }
    // 阿里云按类型校验可用区数量与监听协议（其他厂商保持单一类型行为）
    if (vendor === 'aliyun') {
      const zones = new Set(
        lbSubnets(ctx, lb)
          .map((s) => {
            const vpc = ctx.findVpc(s)
            return resolveZone(s.data.zone, (vpc && vpc.data.region) || '', 'aliyun')
          })
          .filter(Boolean)
      )
      const minZones = ALIYUN_LB_MIN_ZONES[lbType] || 0
      if (minZones > 1 && zones.size < minZones) {
        issues.push({
          key: 'export.lbZonesInsufficient',
          params: { name: clean(lb.data.name), type: lbType.toUpperCase(), count: minZones, actual: zones.size },
        })
      } else if (lbType !== 'clb' && hasNet && zones.size === 0) {
        issues.push({
          key: 'export.lbNoZone',
          params: { name: clean(lb.data.name), type: lbType.toUpperCase() },
        })
      }
      // GWLB 需要较新的 provider（>= 1.234）
      if (lbType === 'gwlb') {
        issues.push({ key: 'export.lbGwlbProviderVersion', params: { name: clean(lb.data.name) } })
      }
    }
    // 腾讯云 ALB 暂无 Terraform 资源，导出时跳过
    if (vendor === 'tencent' && lbType === 'alb') {
      issues.push({ key: 'export.lbAlbUnsupported', params: { name: clean(lb.data.name) } })
    }
    for (const rule of lb.data.rules || []) {
      if (!(rule.backends || []).length) {
        issues.push({
          key: 'export.lbNoBackend',
          params: { name: clean(lb.data.name), port: clean(rule.port) },
        })
      }
      if (protos) {
        const proto = String(rule.protocol || '').toLowerCase()
        if (proto && !protos.includes(proto)) {
          issues.push({
            key: 'export.lbProtocolInvalid',
            params: { name: clean(lb.data.name), protocol: proto.toUpperCase(), type: lbType.toUpperCase() },
          })
        }
      }
      // HTTP(S) 健康检查的请求方法/请求体：请求体各厂商均无对应字段，方法超出厂商支持范围时提示
      const hc = lbHealthCheck(rule)
      if (!hc.enabled || hc.protocol === 'tcp') continue
      if (hc.body) {
        issues.push({
          key: 'export.lbHealthBodyUnsupported',
          params: { name: clean(lb.data.name), port: clean(rule.port) },
        })
      }
      if (!lbHealthMethods(vendor, lbType).includes(hc.method)) {
        issues.push({
          key: 'export.lbHealthMethodUnsupported',
          params: { name: clean(lb.data.name), port: clean(rule.port), method: hc.method },
        })
      }
    }
  }
  return issues
}

// 解析实例的密钥对来源：优先取直连的 KeyPair 节点（KeyPair -> Instance，
// 兼容旧设计的 Instance -> KeyPair），否则回退到实例内联的 keyPair 字段；密码登录返回 null
export function resolveInstanceKeyPair(ctx, inst) {
  const linked =
    ctx.sourceNodes(inst.id).find((n) => n.type === 'KeyPair') ||
    ctx.targetNodes(inst.id).find((n) => n.type === 'KeyPair')
  if (linked) {
    return {
      mode: linked.data.mode === 'existing' ? 'existing' : 'create',
      name: clean(linked.data.name),
    }
  }
  const auth = instanceLoginAuth(inst.data)
  if (auth.type === 'keyPair' && clean(auth.value)) {
    return { mode: 'create', name: clean(auth.value) }
  }
  return null
}

// 收集实例使用的「新建」密钥对名称，去重后返回 keyName -> 资源标识
export function collectKeyPairs(ctx, nodes) {
  return collectKeyPairsByMode(ctx, nodes, 'create')
}

// 收集实例关联的「现有」密钥对名称，去重后返回 keyName -> 资源标识（供腾讯云 data source）
export function collectExistingKeyPairs(ctx, nodes) {
  return collectKeyPairsByMode(ctx, nodes, 'existing')
}

function collectKeyPairsByMode(ctx, nodes, mode) {
  const keyPairs = new Map()
  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const kp = resolveInstanceKeyPair(ctx, inst)
    if (kp && kp.mode === mode && kp.name && !keyPairs.has(kp.name)) {
      keyPairs.set(kp.name, slug(kp.name) || 'keyPair')
    }
  }
  return keyPairs
}

// 转义正则特殊字符（腾讯云按名称查询密钥对使用正则匹配）
export function escapeRegex(value) {
  return String(value ?? '').replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
}

// 生成 tls 私钥与 local_file，将私钥保存到本地 <keyName>.pem
export function tlsKeyBlocks(keyName, resName) {
  return `resource "tls_private_key" "${resName}" {
  algorithm = "RSA"
  rsa_bits  = 2048
}

resource "local_file" "${resName}" {
  filename        = "${keyName}.pem"
  content         = tls_private_key.${resName}.private_key_pem
  file_permission = "0600"
}`
}

// 部署 GPU 且选择安装 NVIDIA 驱动时，生成 cloud-init user_data 脚本。
// 未勾选 GPU、驱动为 none、或镜像已带驱动时返回空，不写入 user_data。
export function gpuDriverUserData(data) {
  if (!data || !data.gpu || data.gpuDriver !== 'nvidia') return ''
  const version = clean(data.gpuDriverVersion)
  const pin = version
    ? `DRIVER_PKG="nvidia-driver-${version}"`
    : 'DRIVER_PKG="nvidia-driver-535"'
  return `#!/bin/bash
set -eux
${pin}
if command -v apt-get >/dev/null 2>&1; then
  apt-get update -y
  DEBIAN_FRONTEND=noninteractive apt-get install -y "$DRIVER_PKG" || DEBIAN_FRONTEND=noninteractive apt-get install -y nvidia-driver
elif command -v yum >/dev/null 2>&1; then
  yum install -y gcc kernel-devel
  yum install -y nvidia-driver || true
fi
nvidia-smi || true
`
}

// GPU 驱动安装脚本的 HCL 表达式（<<-EOT heredoc）；无需安装时返回空串
export function gpuUserDataExpr(data) {
  const script = gpuDriverUserData(data)
  if (!script) return ''
  return `<<-EOT
${script}EOT`
}

// 实例登录认证：password 优先，否则使用密钥对
export function instanceLoginAuth(data) {
  if (data && data.loginType === 'password') {
    return { type: 'password', value: data.password || '' }
  }
  return { type: 'keyPair', value: (data && data.keyPair) || '' }
}

// 系统盘配置：类型回退到厂商默认，容量回退到 40 GiB
export function systemDiskConfig(data, fallbackType) {
  const d = (data && data.systemDisk) || {}
  const size = Number(d.size)
  return {
    type: clean(d.type) || fallbackType,
    size: Number.isFinite(size) && size > 0 ? size : 40,
  }
}

// 数据盘配置列表：忽略容量非法或为 0 的条目
export function dataDiskConfigs(data, fallbackType) {
  return ((data && data.dataDisks) || [])
    .map((d) => {
      const size = Number(d.size)
      return {
        type: clean(d.type) || fallbackType,
        size: Number.isFinite(size) && size > 0 ? size : 0,
      }
    })
    .filter((d) => d.size > 0)
}

// 解析端口区间，返回 { from, to }；icmp/all 返回 null
export function parsePortRange(port, protocol) {
  if (protocol === 'icmp' || protocol === 'all') return null
  const [a, b] = String(port || '').split('/')
  const from = parseInt(a, 10)
  if (Number.isNaN(from)) return null
  const to = b !== undefined && b !== '' ? parseInt(b, 10) : from
  return { from, to: Number.isNaN(to) ? from : to }
}
