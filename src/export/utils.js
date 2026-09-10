// 通用导出工具：IP/CIDR 解析与图关系解析

export function ipToInt(ip) {
  return ip.split('.').reduce((acc, octet) => (acc << 8) + (parseInt(octet, 10) || 0), 0) >>> 0
}

export function intToIp(int) {
  return [(int >>> 24) & 255, (int >>> 16) & 255, (int >>> 8) & 255, int & 255].join('.')
}

// 解析 CIDR，返回 { network, prefix, gateway }
export function parseCidr(cidr) {
  if (!cidr || !cidr.includes('/')) return null
  const [ip, prefixStr] = cidr.split('/')
  const prefix = parseInt(prefixStr, 10)
  if (Number.isNaN(prefix)) return null
  const ipInt = ipToInt(ip)
  const mask = prefix === 0 ? 0 : (0xffffffff << (32 - prefix)) >>> 0
  const network = ipInt & mask
  const gateway = intToIp(network + 1)
  return { network: intToIp(network), prefix, gateway }
}

export function generateMac(seed) {
  const n = (seed % 0xffffff).toString(16).padStart(6, '0')
  return `02:00:00:${n.slice(0, 2)}:${n.slice(2, 4)}:${n.slice(4, 6)}`
}

// 建立图关系查询
export function buildGraph(nodes, edges) {
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const outgoing = new Map() // nodeId -> [edge]
  const incoming = new Map() // nodeId -> [edge]
  for (const e of edges) {
    if (!outgoing.has(e.source)) outgoing.set(e.source, [])
    outgoing.get(e.source).push(e)
    if (!incoming.has(e.target)) incoming.set(e.target, [])
    incoming.get(e.target).push(e)
  }
  const sourceNodes = (id) => (incoming.get(id) || []).map((e) => byId.get(e.source)).filter(Boolean)
  const targetNodes = (id) => (outgoing.get(id) || []).map((e) => byId.get(e.target)).filter(Boolean)
  return { byId, sourceNodes, targetNodes }
}

export function download(filename, text) {
  const blob = new Blob([text], { type: 'text/plain;charset=utf-8' })
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  a.click()
  URL.revokeObjectURL(url)
}

export function slug(str) {
  return String(str || '').replace(/[^a-zA-Z0-9_-]/g, '_')
}

// 计算区域（zone）：Host 节点通过隧道连线形成的连通分量
// 返回 host node id 的连通分量数组
export function computeZones(nodes, edges) {
  const hostIds = nodes.filter((n) => n.type === 'Host').map((n) => n.id)
  const hostSet = new Set(hostIds)
  const adj = new Map(hostIds.map((id) => [id, []]))
  for (const e of edges) {
    if (hostSet.has(e.source) && hostSet.has(e.target)) {
      adj.get(e.source).push(e.target)
      adj.get(e.target).push(e.source)
    }
  }
  const visited = new Set()
  const zones = []
  for (const id of hostIds) {
    if (visited.has(id)) continue
    const comp = []
    const stack = [id]
    visited.add(id)
    while (stack.length) {
      const cur = stack.pop()
      comp.push(cur)
      for (const nb of adj.get(cur)) {
        if (!visited.has(nb)) {
          visited.add(nb)
          stack.push(nb)
        }
      }
    }
    zones.push(comp)
  }
  return zones
}
