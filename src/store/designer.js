import { ref, provide, inject } from 'vue'
import { useVueFlow } from '@vue-flow/core'
import { NODE_TYPES } from '../data/nodeDefinitions.js'

const KEY = Symbol('ovn-designer')

let uid = 0
export function nextId(prefix = 'n') {
  uid += 1
  return `${prefix}_${Date.now().toString(36)}_${uid}`
}

// 在 VueFlow 宿主组件中调用，创建并向下提供设计器状态
export function createDesigner() {
  const vf = useVueFlow()
  const selectedId = ref(null)

  function addNode(type, position, dataOverrides) {
    const def = NODE_TYPES[type]
    if (!def) return null
    const node = {
      id: nextId(type.toLowerCase()),
      type,
      position,
      data: { ...def.defaults(), ...(dataOverrides || {}) },
    }
    vf.addNodes([node])
    return node
  }

  function removeNode(id) {
    vf.removeNodes([id])
    if (selectedId.value === id) selectedId.value = null
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
