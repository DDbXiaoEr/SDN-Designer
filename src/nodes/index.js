import { markRaw } from 'vue'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import BaseNode from './BaseNode.vue'
import ClusterNode from './ClusterNode.vue'

const nodeTypes = {}
for (const type of Object.keys(NODE_TYPES)) {
  nodeTypes[type] = markRaw(BaseNode)
}
nodeTypes.Cluster = markRaw(ClusterNode)

export { nodeTypes }
