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
  downloadBlob(filename, new Blob([text], { type: 'text/plain;charset=utf-8' }))
}

export function downloadBlob(filename, blob) {
  const url = URL.createObjectURL(blob)
  const a = document.createElement('a')
  a.href = url
  a.download = filename
  document.body.appendChild(a)
  a.click()
  document.body.removeChild(a)
  setTimeout(() => URL.revokeObjectURL(url), 1000)
}

const CRC_TABLE = (() => {
  const table = new Uint32Array(256)
  for (let n = 0; n < 256; n++) {
    let c = n
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1
    table[n] = c >>> 0
  }
  return table
})()

function crc32(bytes) {
  let crc = 0xffffffff
  for (let i = 0; i < bytes.length; i++) {
    crc = CRC_TABLE[(crc ^ bytes[i]) & 0xff] ^ (crc >>> 8)
  }
  return (crc ^ 0xffffffff) >>> 0
}

// 生成 store 模式的 zip（无压缩），避免引入第三方依赖
export function createZip(files) {
  const encoder = new TextEncoder()
  const entries = files.map((f) => {
    const data = typeof f.content === 'string' ? encoder.encode(f.content) : f.content
    return { nameBytes: encoder.encode(f.filename), data, crc: crc32(data) }
  })

  const now = new Date()
  const dosTime = ((now.getHours() << 11) | (now.getMinutes() << 5) | (now.getSeconds() >> 1)) & 0xffff
  const dosDate =
    (((now.getFullYear() - 1980) << 9) | ((now.getMonth() + 1) << 5) | now.getDate()) & 0xffff

  const parts = []
  const central = []
  let offset = 0

  for (const entry of entries) {
    const local = new Uint8Array(30 + entry.nameBytes.length)
    const lv = new DataView(local.buffer)
    lv.setUint32(0, 0x04034b50, true)
    lv.setUint16(4, 20, true)
    lv.setUint16(6, 0x0800, true)
    lv.setUint16(8, 0, true)
    lv.setUint16(10, dosTime, true)
    lv.setUint16(12, dosDate, true)
    lv.setUint32(14, entry.crc, true)
    lv.setUint32(18, entry.data.length, true)
    lv.setUint32(22, entry.data.length, true)
    lv.setUint16(26, entry.nameBytes.length, true)
    lv.setUint16(28, 0, true)
    local.set(entry.nameBytes, 30)
    parts.push(local, entry.data)

    const cen = new Uint8Array(46 + entry.nameBytes.length)
    const cv = new DataView(cen.buffer)
    cv.setUint32(0, 0x02014b50, true)
    cv.setUint16(4, 20, true)
    cv.setUint16(6, 20, true)
    cv.setUint16(8, 0x0800, true)
    cv.setUint16(10, 0, true)
    cv.setUint16(12, dosTime, true)
    cv.setUint16(14, dosDate, true)
    cv.setUint32(16, entry.crc, true)
    cv.setUint32(20, entry.data.length, true)
    cv.setUint32(24, entry.data.length, true)
    cv.setUint16(28, entry.nameBytes.length, true)
    cv.setUint32(42, offset, true)
    cen.set(entry.nameBytes, 46)
    central.push(cen)

    offset += local.length + entry.data.length
  }

  const centralSize = central.reduce((sum, c) => sum + c.length, 0)
  const eocd = new Uint8Array(22)
  const ev = new DataView(eocd.buffer)
  ev.setUint32(0, 0x06054b50, true)
  ev.setUint16(8, entries.length, true)
  ev.setUint16(10, entries.length, true)
  ev.setUint32(12, centralSize, true)
  ev.setUint32(16, offset, true)

  return new Blob([...parts, ...central, eocd], { type: 'application/zip' })
}

export function slug(str) {
  return String(str || '')
    .trim()
    .replace(/[^a-zA-Z0-9_-]/g, '_')
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
