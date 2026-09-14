import { buildGraph, slug } from '../utils.js'

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
  ;['VPC', 'Subnet', 'Instance', 'SecurityGroup', 'Gateway', 'Eip', 'RouteTable', 'Interconnect'].forEach(assignUniqueNames)

  const name = (node) => resourceNames.get(node.id)

  const ref = (node) => {
    const type = node.type
    if (type === 'Subnet') return `${resourceTypes.subnet}.${name(node)}`
    if (type === 'VPC') return `${resourceTypes.vpc}.${name(node)}`
    if (type === 'Instance') return `${resourceTypes.instance}.${name(node)}`
    if (type === 'SecurityGroup') return `${resourceTypes.securityGroup}.${name(node)}`
    if (type === 'Gateway') return `${resourceTypes.natGateway}.${name(node)}`
    if (type === 'Eip') return `${resourceTypes.eip}.${name(node)}`
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

// 解析实例的密钥对来源：优先取直连的 KeyPair 节点（Instance -> KeyPair），
// 否则回退到实例内联的 keyPair 字段（兼容旧设计）；密码登录返回 null
export function resolveInstanceKeyPair(ctx, inst) {
  const linked = ctx.targetNodes(inst.id).find((n) => n.type === 'KeyPair')
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
