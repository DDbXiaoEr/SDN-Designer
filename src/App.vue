<script setup>
import { ref, computed } from 'vue'
import { VueFlow } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { Background, BackgroundVariant } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { nodeTypes } from './nodes/index.js'
import { canConnect } from './data/nodeDefinitions.js'
import { createDesigner, nextId } from './store/designer.js'
import { exportOvn } from './export/ovn.js'
import { exportTerraform } from './export/terraform/index.js'
import { validateZones } from './export/terraform/common.js'
import { download } from './export/utils.js'
import { serializeDesign, deserializeDesign } from './store/persistence.js'
import { vendor } from './store/vendor.js'
import Palette from './components/Palette.vue'
import Toolbar from './components/Toolbar.vue'
import Inspector from './components/Inspector.vue'
import ExportModal from './components/ExportModal.vue'
import CreateHostDialog from './components/CreateHostDialog.vue'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@vue-flow/controls/dist/style.css'

const designer = createDesigner()
const { vf, selectedId, nodes, edges, addNode, removeEdge, clear, recomputeClusters } = designer
const { screenToFlowCoordinate } = vf
const { t } = useI18n()

const exportModal = ref(null)
const hostDialogOpen = ref(false)
const pendingDropPosition = ref(null)
const fileInput = ref(null)

function onDragOver(e) {
  e.preventDefault()
  e.dataTransfer.dropEffect = 'move'
}

function onDrop(e) {
  const type = e.dataTransfer.getData('application/ovn-designer')
  if (!type) return
  const position = screenToFlowCoordinate({ x: e.clientX, y: e.clientY })
  const pos = { x: position.x - 90, y: position.y - 24 }
  if (type === 'Host') {
    pendingDropPosition.value = pos
    hostDialogOpen.value = true
    return
  }
  addNode(type, pos)
}

function onHostConfirm(data) {
  addNode('Host', pendingDropPosition.value, data)
  hostDialogOpen.value = false
  pendingDropPosition.value = null
}

function onHostCancel() {
  hostDialogOpen.value = false
  pendingDropPosition.value = null
}

function onConnect(conn) {
  const source = nodes.value.find((n) => n.id === conn.source)
  const target = nodes.value.find((n) => n.id === conn.target)
  if (!source || !target) return
  const rule = canConnect(source.type, target.type)
  if (!rule) return
  const exists = edges.value.some(
    (e) => e.source === conn.source && e.target === conn.target
  )
  if (exists) return
  vf.addEdges([
    {
      id: nextId('e'),
      source: conn.source,
      target: conn.target,
      sourceHandle: conn.sourceHandle,
      targetHandle: conn.targetHandle,
      label: t(rule.label),
      type: 'default',
    },
  ])
  if (source.type === 'Host' && target.type === 'Host') {
    recomputeClusters()
  }
}

function onNodeClick({ node }) {
  selectedId.value = node.id
}

function onEdgeClick({ edge }) {
  const src = nodes.value.find((n) => n.id === edge.source)
  const tgt = nodes.value.find((n) => n.id === edge.target)
  const isTunnel = src && tgt && src.type === 'Host' && tgt.type === 'Host'
  removeEdge(edge.id)
  if (isTunnel) recomputeClusters()
}

function onPaneClick() {
  selectedId.value = null
}

function saveDesign() {
  download('ovn-design.json', serializeDesign(nodes.value, edges.value))
}

function triggerImport() {
  fileInput.value && fileInput.value.click()
}

function importDesign(e) {
  const file = e.target.files && e.target.files[0]
  if (!file) return
  const reader = new FileReader()
  reader.onload = () => {
    try {
      const { nodes: loadedNodes, edges: loadedEdges } = deserializeDesign(reader.result)
      vf.setNodes(loadedNodes)
      vf.setEdges(loadedEdges)
      selectedId.value = null
    } catch {
      window.alert(t('toolbar.importError'))
    }
  }
  reader.readAsText(file)
  e.target.value = ''
}

function showOvn() {
  const result = exportOvn(nodes.value, edges.value)
  const groups = [
    { id: 'all', label: t('export.allNodes'), content: result.all.content, filename: result.all.filename },
    ...result.targets.map((tg) => ({
      id: tg.id,
      label: tg.kind === 'central' ? (tg.name ? t('export.centralNodeOn', { name: tg.name }) : t('export.centralNode')) : t('export.hostNode', { name: tg.name }),
      content: tg.content,
      filename: tg.filename,
    })),
  ]
  exportModal.value = { title: t('export.ovnTitle'), groups }
}

function showTerraform() {
  const files = exportTerraform(nodes.value, edges.value, vendor.value)
  const warnings = validateZones(nodes.value, edges.value, vendor.value).map((issue) =>
    t('export.zoneMismatch', {
      subnet: issue.name,
      zone: issue.zone,
      region: issue.region,
      expected: issue.expected,
    })
  )
  exportModal.value = {
    title: t('export.terraformTitle', { vendor: t(`vendors.${vendor.value}`) }),
    groups: files.map((f) => ({
      id: f.id,
      label: f.filename,
      content: f.content,
      filename: f.filename,
    })),
    warnings,
  }
}

const nodesCount = computed(() => nodes.value.length)
</script>

<template>
  <div class="app">
    <Toolbar
      :nodes-count="nodesCount"
      @export-ovn="showOvn"
      @export-terraform="showTerraform"
      @clear="clear"
      @save-design="saveDesign"
      @import-design="triggerImport"
    />
    <div class="main">
      <Palette />
      <div class="canvas">
        <VueFlow
          :node-types="nodeTypes"
          :snap-to-grid="true"
          :snap-grid="[16, 16]"
          :default-edge-options="{
            animated: false,
            interactionWidth: 26,
            style: { stroke: '#4f8cff', strokeWidth: 2 },
            labelStyle: { fill: '#e6e8ee', fontSize: 11, fontWeight: 600 },
            labelBgStyle: { fill: '#1e222b' },
            labelBgPadding: [6, 3],
            labelBgBorderRadius: 4,
          }"
          @drop="onDrop"
          @dragover="onDragOver"
          @connect="onConnect"
          @node-click="onNodeClick"
          @edge-click="onEdgeClick"
          @pane-click="onPaneClick"
        >
          <Background :variant="BackgroundVariant.Dots" :gap="20" :size="1" />
          <Controls />
          <MiniMap :pannable="true" :zoomable="true" />
        </VueFlow>
      </div>
      <Inspector />
    </div>

    <ExportModal
      v-if="exportModal"
      :title="exportModal.title"
      :groups="exportModal.groups"
      :warnings="exportModal.warnings"
      @close="exportModal = null"
    />

    <CreateHostDialog
      v-if="hostDialogOpen"
      @confirm="onHostConfirm"
      @cancel="onHostCancel"
    />

    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      style="display: none"
      @change="importDesign"
    />
  </div>
</template>

<style scoped>
.app {
  display: flex;
  flex-direction: column;
  height: 100%;
}
.main {
  display: flex;
  flex: 1;
  min-height: 0;
}
.canvas {
  flex: 1;
  min-width: 0;
  position: relative;
}
:deep(.vue-flow__node) {
  cursor: grab;
}
:deep(.vue-flow__node.selected) {
  cursor: move;
}
:deep(.vue-flow__edge) {
  cursor: pointer;
}
:deep(.vue-flow__edge-interaction) {
  stroke-width: 26px;
}
:deep(.vue-flow__edge:hover .vue-flow__edge-path) {
  stroke: var(--danger) !important;
  stroke-width: 3 !important;
}
:deep(.vue-flow__edge:hover .vue-flow__edge-text) {
  fill: var(--danger);
}
:deep(.vue-flow__edge-text) {
  font-weight: 600;
}
:deep(.vue-flow__minimap) {
  background: var(--panel);
}
</style>
