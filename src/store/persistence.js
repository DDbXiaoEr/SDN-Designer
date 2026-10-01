// 设计文件序列化 / 反序列化，以及 localStorage 持久化

import { orientControlPlaneConnection, nicRole } from '../data/nodeDefinitions.js'

const STORAGE_KEY = 'ovn-designer-design'

// 旧设计迁移：补齐新增字段，且不覆盖已有值
function normalizeNic(nic) {
  const role = nicRole(nic)
  const next = { ...nic, role }
  if (role === 'tunnel') next.tunnel = true
  else delete next.tunnel
  if (role === 'external') {
    if (!next.bridge) next.bridge = 'br-ex'
    if (!next.networkName) next.networkName = 'external'
  }
  return next
}

function normalizeNode(n) {
  if (!n || !n.data) return n
  const d = n.data
  if (n.type === 'Host') {
    return { ...n, data: { ...d, nics: (d.nics || []).map(normalizeNic) } }
  }
  if (n.type === 'LogicalSwitch') {
    return {
      ...n,
      data: { isExternal: false, networkName: 'external', unknownAddresses: true, ...d },
    }
  }
  if (n.type === 'LogicalRouter') {
    return {
      ...n,
      data: {
        externalNetwork: false,
        externalNetworkName: 'external',
        externalIp: '',
        externalMac: '',
        distributed: false,
        gatewayChassis: [],
        nats: [],
        ...d,
      },
    }
  }
  return n
}

function sanitizeNode(n) {
  const node = {
    id: n.id,
    type: n.type,
    position: { x: n.position?.x ?? 0, y: n.position?.y ?? 0 },
    data: n.data,
  }
  if (n.parentNode) node.parentNode = n.parentNode
  if (n.width != null) node.width = n.width
  if (n.height != null) node.height = n.height
  if (n.expandParent != null) node.expandParent = n.expandParent
  return node
}

function sanitizeEdge(e) {
  const edge = { id: e.id, source: e.source, target: e.target }
  if (e.sourceHandle) edge.sourceHandle = e.sourceHandle
  if (e.targetHandle) edge.targetHandle = e.targetHandle
  if (e.label != null) edge.label = e.label
  if (e.type) edge.type = e.type
  return edge
}

export function serializeDesign(nodes, edges) {
  return JSON.stringify(
    { version: 1, nodes: nodes.map(sanitizeNode), edges: edges.map(sanitizeEdge) },
    null,
    2
  )
}

export function deserializeDesign(json) {
  const data = typeof json === 'string' ? JSON.parse(json) : json
  if (!data || !Array.isArray(data.nodes) || !Array.isArray(data.edges)) {
    throw new Error('invalid design file')
  }
  const nodes = data.nodes.map(normalizeNode)
  const byId = new Map(nodes.map((n) => [n.id, n]))
  const edges = data.edges.map((e) =>
    orientControlPlaneConnection(byId.get(e.source), byId.get(e.target), e)
  )
  return { nodes, edges }
}

export function saveToStorage(nodes, edges) {
  if (typeof localStorage === 'undefined') return
  try {
    localStorage.setItem(STORAGE_KEY, serializeDesign(nodes, edges))
  } catch {
    /* 存储不可用时忽略 */
  }
}

export function loadFromStorage() {
  if (typeof localStorage === 'undefined') return null
  const raw = localStorage.getItem(STORAGE_KEY)
  if (!raw) return null
  try {
    return deserializeDesign(raw)
  } catch {
    return null
  }
}

export function clearStorage() {
  if (typeof localStorage === 'undefined') return
  localStorage.removeItem(STORAGE_KEY)
}
