import { ref, provide, inject, watch } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { computeZones } from '../export/utils.js'
import { saveToStorage, loadFromStorage } from './persistence.js'
import { vendor } from './vendor.js'

const KEY = Symbol('ovn-designer')

let uid = 0
export function nextId(prefix = 'n') {
  uid += 1
  return `${prefix}_${Date.now().toString(36)}_${uid}`
}

let clusterSeq = 0
const CLUSTER_PAD = { top: 40, right: 32, bottom: 24, left: 32 }

function absPos(node, nodes) {
  if (!node.parentNode) return { x: node.position.x, y: node.position.y }
  const parent = nodes.find((n) => n.id === node.parentNode)
  if (!parent) return { x: node.position.x, y: node.position.y }
  const p = absPos(parent, nodes)
  return { x: node.position.x + p.x, y: node.position.y + p.y }
}

function computeBBox(hostNodes, abs) {
  let minX = Infinity
  let minY = Infinity
  let maxX = -Infinity
  let maxY = -Infinity
  for (const h of hostNodes) {
    const p = abs.get(h.id)
    const w = (h.dimensions && h.dimensions.width) || 200
    const ht = (h.dimensions && h.dimensions.height) || 90
    if (p.x < minX) minX = p.x
    if (p.y < minY) minY = p.y
    if (p.x + w > maxX) maxX = p.x + w
    if (p.y + ht > maxY) maxY = p.y + ht
  }
  return { minX, minY, width: maxX - minX, height: maxY - minY }
}

// 在 VueFlow 宿主组件中调用，创建并向下提供设计器状态
export function createDesigner() {
  const vf = useVueFlow()
  const selectedId = ref(null)

  const saved = loadFromStorage()
  if (saved) {
    vf.setNodes(saved.nodes)
    vf.setEdges(saved.edges)
  }

  let saveTimer = null
  watch(
    [vf.nodes, vf.edges],
    ([n, e]) => {
      if (saveTimer) clearTimeout(saveTimer)
      saveTimer = setTimeout(() => saveToStorage(n, e), 300)
    },
    { deep: true }
  )

  function addNode(type, position, dataOverrides) {
    const def = NODE_TYPES[type]
    if (!def) return null
    const node = {
      id: nextId(type.toLowerCase()),
      type,
      position,
      data: { ...def.defaults(vendor.value), ...(dataOverrides || {}) },
    }
    vf.addNodes([node])
    return node
  }

  function removeNode(id) {
    const node = vf.nodes.value.find((n) => n.id === id)
    if (node && node.type === 'Cluster') {
      const children = vf.nodes.value.filter((n) => n.type === 'Host' && n.parentNode === id)
      const childSet = new Set(children.map((n) => n.id))
      const tunnelEdges = vf.edges.value.filter(
        (e) => childSet.has(e.source) && childSet.has(e.target)
      )
      const ungrouped = vf.nodes.value.map((n) => {
        if (n.type === 'Host' && n.parentNode === id) {
          return {
            ...n,
            parentNode: undefined,
            position: { x: n.position.x + node.position.x, y: n.position.y + node.position.y },
          }
        }
        return n
      })
      vf.setNodes(ungrouped)
      if (tunnelEdges.length) vf.removeEdges(tunnelEdges.map((e) => e.id))
      vf.removeNodes([id])
      if (selectedId.value === id) selectedId.value = null
      return
    }
    vf.removeNodes([id])
    if (selectedId.value === id) selectedId.value = null
    if (node && node.type === 'Host') {
      recomputeClusters()
    }
  }

  function removeEdge(id) {
    vf.removeEdges([id])
  }

  function updateNodeData(id, patch) {
    vf.updateNodeData(id, patch)
  }

  function clear() {
    vf.setNodes([])
    vf.setEdges([])
    selectedId.value = null
  }

  // 将互相通过隧道连线的 Host 自动归并为一个「集群 Cluster」分组节点
  function recomputeClusters() {
    const nodes = vf.nodes.value
    const edges = vf.edges.value
    const hosts = nodes.filter((n) => n.type === 'Host')

    if (!hosts.length) {
      const clusters = nodes.filter((n) => n.type === 'Cluster')
      if (clusters.length) {
        vf.setNodes(nodes.filter((n) => n.type !== 'Cluster'))
        vf.setEdges(edges.filter((e) => !clusters.some((c) => c.id === e.source || c.id === e.target)))
      }
      return
    }

    const zones = computeZones(nodes, edges)
    const zoneOf = new Map()
    zones.forEach((ids) => {
      if (ids.length >= 2) ids.forEach((id) => zoneOf.set(id, ids))
    })
    const desiredZones = zones.filter((ids) => ids.length >= 2)

    const abs = new Map()
    hosts.forEach((h) => abs.set(h.id, absPos(h, nodes)))

    const existingClusters = nodes.filter((n) => n.type === 'Cluster')
    const childrenOf = new Map()
    for (const n of nodes) {
      if (n.type === 'Host' && n.parentNode) {
        if (!childrenOf.has(n.parentNode)) childrenOf.set(n.parentNode, [])
        childrenOf.get(n.parentNode).push(n.id)
      }
    }

    const zoneToClusterId = new Map()
    const clusterById = new Map()
    const usedClusterIds = new Set()

    for (const c of existingClusters) {
      const kids = childrenOf.get(c.id) || []
      let chosen = null
      let usable = true
      for (const kid of kids) {
        const z = zoneOf.get(kid)
        if (!z) continue
        if (!chosen) chosen = z
        else if (chosen !== z) {
          usable = false
          break
        }
      }
      if (usable && chosen && !zoneToClusterId.has(chosen)) {
        zoneToClusterId.set(chosen, c.id)
        clusterById.set(c.id, c)
        usedClusterIds.add(c.id)
      }
    }

    for (const zone of desiredZones) {
      let cluster = clusterById.get(zoneToClusterId.get(zone))
      if (!cluster) {
        clusterSeq += 1
        cluster = {
          id: nextId('cluster'),
          type: 'Cluster',
          position: { x: 0, y: 0 },
          data: { ...NODE_TYPES.Cluster.defaults(), name: `cluster${clusterSeq}` },
        }
        zoneToClusterId.set(zone, cluster.id)
        clusterById.set(cluster.id, cluster)
        usedClusterIds.add(cluster.id)
      }
      const hostNodes = zone.map((id) => hosts.find((h) => h.id === id)).filter(Boolean)
      const bbox = computeBBox(hostNodes, abs)
      cluster.position = { x: bbox.minX - CLUSTER_PAD.left, y: bbox.minY - CLUSTER_PAD.top }
      cluster.width = bbox.width + CLUSTER_PAD.left + CLUSTER_PAD.right
      cluster.height = bbox.height + CLUSTER_PAD.top + CLUSTER_PAD.bottom
      cluster.data = { ...cluster.data, hostCount: zone.length }
    }

    const freshNodes = []
    for (const n of nodes) {
      if (n.type === 'Host' || n.type === 'Cluster') continue
      freshNodes.push({ id: n.id, type: n.type, position: { ...n.position }, data: n.data })
    }
    for (const c of clusterById.values()) freshNodes.push(c)

    for (const h of hosts) {
      const clusterId = zoneToClusterId.get(zoneOf.get(h.id))
      const node = {
        id: h.id,
        type: 'Host',
        position: { ...h.position },
        data: h.data,
        expandParent: true,
      }
      if (clusterId) {
        const cluster = clusterById.get(clusterId)
        node.parentNode = clusterId
        node.position = {
          x: abs.get(h.id).x - cluster.position.x,
          y: abs.get(h.id).y - cluster.position.y,
        }
      } else {
        node.position = { ...abs.get(h.id) }
      }
      freshNodes.push(node)
    }

    const staleClusterIds = new Set(
      existingClusters.map((c) => c.id).filter((id) => !usedClusterIds.has(id))
    )
    let freshEdges = edges
    if (staleClusterIds.size) {
      freshEdges = edges.filter(
        (e) => !staleClusterIds.has(e.source) && !staleClusterIds.has(e.target)
      )
    }

    vf.setNodes(freshNodes)
    if (freshEdges !== edges) vf.setEdges(freshEdges)
  }

  const api = {
    vf,
    selectedId,
    nodes: vf.nodes,
    edges: vf.edges,
    addNode,
    removeNode,
    removeEdge,
    updateNodeData,
    clear,
    recomputeClusters,
  }

  provide(KEY, api)
  return api
}

export function useDesigner() {
  const api = inject(KEY)
  if (!api) {
    throw new Error('useDesigner() 必须在调用了 createDesigner() 的组件树内使用')
  }
  return api
}
