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
  ;['VPC', 'Subnet', 'Instance', 'SecurityGroup', 'Gateway', 'Eip', 'RouteTable'].forEach(assignUniqueNames)

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

// 收集实例使用的密钥对名称，去重后返回 keyName -> 资源标识
export function collectKeyPairs(nodes) {
  const keyPairs = new Map()
  for (const inst of nodes.filter((n) => n.type === 'Instance')) {
    const auth = instanceLoginAuth(inst.data)
    if (auth.type === 'keyPair' && clean(auth.value)) {
      const keyName = clean(auth.value)
      if (!keyPairs.has(keyName)) keyPairs.set(keyName, slug(keyName) || 'keyPair')
    }
  }
  return keyPairs
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

// 解析端口区间，返回 { from, to }；icmp/all 返回 null
export function parsePortRange(port, protocol) {
  if (protocol === 'icmp' || protocol === 'all') return null
  const [a, b] = String(port || '').split('/')
  const from = parseInt(a, 10)
  if (Number.isNaN(from)) return null
  const to = b !== undefined && b !== '' ? parseInt(b, 10) : from
  return { from, to: Number.isNaN(to) ? from : to }
}
