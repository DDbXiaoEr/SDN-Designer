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
  ;['VPC', 'Subnet', 'Instance', 'SecurityGroup', 'Gateway', 'RouteTable'].forEach(assignUniqueNames)

  const name = (node) => resourceNames.get(node.id)

  const ref = (node) => {
    const type = node.type
    if (type === 'Subnet') return `${resourceTypes.subnet}.${name(node)}`
    if (type === 'VPC') return `${resourceTypes.vpc}.${name(node)}`
    if (type === 'Instance') return `${resourceTypes.instance}.${name(node)}`
    if (type === 'SecurityGroup') return `${resourceTypes.securityGroup}.${name(node)}`
    if (type === 'Gateway') {
      return node.data.kind === 'eip'
        ? `${resourceTypes.eip}.${name(node)}`
        : `${resourceTypes.natGateway}.${name(node)}`
    }
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
    const gws = ctx.nodes.filter((n) => n.type === 'Gateway' && n.data.kind !== 'eip')
    return gws.find((g) => ctx.findVpc(g)?.id === vpc?.id) || gws[0] || null
  }
  if (route.nextHopType === 'Instance') {
    const insts = ctx.nodes.filter((n) => n.type === 'Instance')
    return insts.find((i) => ctx.findVpc(i)?.id === vpc?.id) || insts[0] || null
  }
  return null
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
