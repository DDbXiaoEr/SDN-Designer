<script setup>
import { ref, computed } from 'vue'
import { VueFlow, MarkerType } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { Background, BackgroundVariant } from '@vue-flow/background'
import { Controls } from '@vue-flow/controls'
import { MiniMap } from '@vue-flow/minimap'
import { nodeTypes } from './nodes/index.js'
import { NODE_TYPES, canConnect } from './data/nodeDefinitions.js'
import { nodeLabelKey } from './data/vendors.js'
import { createDemoDesign } from './data/demo.js'
import { createDesigner, nextId } from './store/designer.js'
import { exportOvn } from './export/ovn.js'
import { exportTerraform } from './export/terraform/index.js'
import { validateZones, validateInstanceZones, validateGatewaySources, validateLoadBalancers } from './export/terraform/common.js'
import { instanceTypeZones } from './store/catalog.js'
import { download } from './export/utils.js'
import { serializeDesign, deserializeDesign, loadFromStorage } from './store/persistence.js'
import { vendor, providerVersion } from './store/vendor.js'
import Palette from './components/Palette.vue'
import Toolbar from './components/Toolbar.vue'
import Inspector from './components/Inspector.vue'
import ExportModal from './components/ExportModal.vue'
import CreateHostDialog from './components/CreateHostDialog.vue'
import NodeEditorDialog from './components/NodeEditorDialog.vue'
import MessagePanel from './components/MessagePanel.vue'
import CanvasScrollbars from './components/CanvasScrollbars.vue'

import '@vue-flow/core/dist/style.css'
import '@vue-flow/core/dist/theme-default.css'
import '@vue-flow/minimap/dist/style.css'
import '@vue-flow/controls/dist/style.css'

const designer = createDesigner()
const { vf, selectedId, nodes, edges, addNode, removeEdge, updateNodeData, clear, recomputeClusters } = designer
const { screenToFlowCoordinate } = vf
const { t } = useI18n()

const exportModal = ref(null)
const hostDialogOpen = ref(false)
const editorOpen = ref(false)
const editorNodeId = ref(null)
const pendingDropPosition = ref(null)
const fileInput = ref(null)

// 实例规格可用区库存判定：连线时与导出/子网编辑校验共用同一逻辑
function stockIssues(edgesArg) {
  return validateInstanceZones(nodes.value, edgesArg || edges.value, vendor.value, (type) =>
    instanceTypeZones(vendor.value, type)
  )
}

// 轻量提示（连线时的库存告警），支持一个快捷修正动作，8 秒后自动消失
const toast = ref(null)
let toastTimer = null
function showToast(message, action) {
  toast.value = { message, action: action || null }
  if (toastTimer) clearTimeout(toastTimer)
  toastTimer = setTimeout(() => {
    toast.value = null
  }, 8000)
}
function runToastAction() {
  const action = toast.value && toast.value.action
  toast.value = null
  if (action) action.run()
}

// 消息区域：记录连线校验等提示（最新在下），由底部消息面板展示
const messages = ref([])
let messageSeq = 0
function pushMessage(level, text) {
  messages.value.push({
    id: `msg_${++messageSeq}`,
    level,
    text,
    time: new Date().toLocaleTimeString(),
  })
}
function clearMessages() {
  messages.value = []
}

// 节点在消息中的展示：类型名 + 名称
function nodeRef(node) {
  const def = NODE_TYPES[node.type]
  const label = def ? t(nodeLabelKey(def, vendor.value)) : node.type
  const name = (node.data && node.data.name) || ''
  return name ? `${label}「${name}」` : label
}

// 连线不合法时给出针对性提示：优先提示方向反了，其次引导常见场景，最后给通用说明
function connectionHint(source, target) {
  if (canConnect(target.type, source.type)) {
    return t('messages.reverseHint', { from: nodeRef(target), to: nodeRef(source) })
  }
  if (source.type === 'Instance' && (target.type === 'Gateway' || target.type === 'Eip')) {
    return t('messages.instanceEgressHint')
  }
  return t('messages.connectionHint')
}

// 载入内置示例拓扑；边标签按当前语言从连接规则解析
function applyDemo() {
  const { nodes: demoNodes, edges: demoEdges } = createDemoDesign()
  const withLabels = demoEdges.map((e) => {
    const source = demoNodes.find((n) => n.id === e.source)
    const target = demoNodes.find((n) => n.id === e.target)
    const rule = source && target ? canConnect(source.type, target.type) : null
    return { ...e, type: 'default', label: rule ? t(rule.label) : '' }
  })
  vf.setNodes(demoNodes)
  vf.setEdges(withLabels)
  selectedId.value = null
}

// 工具栏按钮：画布非空时先确认，避免覆盖现有设计
function onLoadDemo() {
  if (nodes.value.length && !window.confirm(t('toolbar.loadDemoConfirm'))) return
  applyDemo()
}

// 首次访问（从未保存过设计）时展示示例；用户清空后的空设计不会再次触发
if (!loadFromStorage()) applyDemo()

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
  if (!rule) {
    // 不允许的连线：写入消息区域并给出原因/建议，避免用户以为没反应
    pushMessage(
      'warn',
      `${t('messages.unsupportedConnection', { source: nodeRef(source), target: nodeRef(target) })}；${connectionHint(source, target)}`
    )
    return
  }
  const exists = edges.value.some(
    (e) => e.source === conn.source && e.target === conn.target
  )
  if (exists) {
    pushMessage(
      'info',
      t('messages.duplicateConnection', { source: nodeRef(source), target: nodeRef(target) })
    )
    return
  }
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
  // 云主机接入子网即确定了部署可用区，立即校验规格在该可用区是否有货
  if (source.type === 'Subnet' && target.type === 'Instance') {
    const issue = stockIssues([
      ...edges.value,
      { id: '_pending', source: conn.source, target: conn.target },
    ]).find((it) => it.nodeId === target.id)
    if (issue) {
      const zones = issue.sameRegion || []
      if (zones.length) {
        showToast(
          t('export.instanceZoneUnavailable', {
            instance: issue.name,
            type: issue.type,
            zone: issue.zone,
            zones: zones.join(', '),
          }),
          {
            label: t('inspector.changeSubnetZone', { zone: zones[0] }),
            run: () => updateNodeData(source.id, { zone: zones[0] }),
          }
        )
      } else {
        showToast(
          t('export.instanceZoneRegionUnavailable', {
            instance: issue.name,
            type: issue.type,
            region: issue.region,
          })
        )
      }
    }
  }
}

function onNodeClick({ node }) {
  selectedId.value = node.id
}

function onNodeDoubleClick({ node }) {
  selectedId.value = node.id
  editorNodeId.value = node.id
  editorOpen.value = true
}

function onEditSelected() {
  if (!selectedId.value) return
  editorNodeId.value = selectedId.value
  editorOpen.value = true
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
  exportModal.value = { title: t('export.ovnTitle'), groups, zipName: 'ovn-commands' }
}

const CREDENTIAL_FIELDS = {
  aliyun: [
    { key: 'access_key', label: 'export.aliyunAccessKey' },
    { key: 'secret_key', label: 'export.aliyunSecretKey' },
  ],
  tencent: [
    { key: 'secret_id', label: 'export.tencentSecretId' },
    { key: 'secret_key', label: 'export.tencentSecretKey' },
  ],
  aws: [
    { key: 'access_key', label: 'export.awsAccessKey' },
    { key: 'secret_key', label: 'export.awsSecretKey' },
  ],
  huawei: [
    { key: 'access_key', label: 'export.huaweiAccessKey' },
    { key: 'secret_key', label: 'export.huaweiSecretKey' },
  ],
}

function showTerraform() {
  const files = exportTerraform(nodes.value, edges.value, vendor.value, providerVersion.value)
  const warnings = validateZones(nodes.value, edges.value, vendor.value).map((issue) =>
    t('export.zoneMismatch', {
      subnet: issue.name,
      zone: issue.zone,
      region: issue.region,
      expected: issue.expected,
    })
  )
  // 实例规格可用区库存：有货可选在同地域时提示可切换的可用区，否则需更换规格/地域
  validateInstanceZones(
    nodes.value,
    edges.value,
    vendor.value,
    (type) => instanceTypeZones(vendor.value, type)
  ).forEach((issue) => {
    warnings.push(
      issue.sameRegion.length
        ? t('export.instanceZoneUnavailable', {
            instance: issue.name,
            type: issue.type,
            zone: issue.zone,
            zones: issue.sameRegion.join(', '),
          })
        : t('export.instanceZoneRegionUnavailable', {
            instance: issue.name,
            type: issue.type,
            region: issue.region,
          })
    )
  })
  // 网关 SNAT 来源的厂商降级提示（如阿里云/华为云实例级降级为子网级）
  validateGatewaySources(nodes.value, edges.value, vendor.value).forEach((w) => {
    warnings.push(t(w.key, { ...w.params, vendor: t(`vendors.${vendor.value}`) }))
  })
  // 负载均衡配置提示（未接入网络 / 监听规则未选后端）
  validateLoadBalancers(nodes.value, edges.value, vendor.value).forEach((w) => {
    warnings.push(t(w.key, w.params))
  })
  exportModal.value = {
    title: t('export.terraformTitle', { vendor: t(`vendors.${vendor.value}`) }),
    groups: files.map((f) => ({
      id: f.id,
      label: f.filename,
      content: f.content,
      filename: f.filename,
    })),
    warnings,
    zipName: `terraform-${vendor.value}`,
    credentialFields: CREDENTIAL_FIELDS[vendor.value] || [],
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
      @load-demo="onLoadDemo"
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
            markerEnd: { type: MarkerType.ArrowClosed, width: 20, height: 20 },
          }"
          @drop="onDrop"
          @dragover="onDragOver"
          @connect="onConnect"
          @node-click="onNodeClick"
          @node-double-click="onNodeDoubleClick"
          @edge-click="onEdgeClick"
          @pane-click="onPaneClick"
        >
          <Background :variant="BackgroundVariant.Dots" :gap="20" :size="1" />
          <Controls />
          <MiniMap :pannable="true" :zoomable="true" />
          <CanvasScrollbars />
        </VueFlow>
      </div>
      <Inspector @edit="onEditSelected" />
    </div>

    <MessagePanel :messages="messages" @clear="clearMessages" />

    <ExportModal
      v-if="exportModal"
      :title="exportModal.title"
      :groups="exportModal.groups"
      :warnings="exportModal.warnings"
      :zip-name="exportModal.zipName"
      :credential-fields="exportModal.credentialFields || []"
      @close="exportModal = null"
    />

    <CreateHostDialog
      v-if="hostDialogOpen"
      @confirm="onHostConfirm"
      @cancel="onHostCancel"
    />

    <NodeEditorDialog
      v-if="editorOpen"
      :node-id="editorNodeId"
      @close="editorOpen = false"
    />

    <input
      ref="fileInput"
      type="file"
      accept=".json,application/json"
      style="display: none"
      @change="importDesign"
    />

    <div v-if="toast" class="toast">
      <span class="toast-msg">{{ toast.message }}</span>
      <button v-if="toast.action" class="toast-action" @click="runToastAction">
        {{ toast.action.label }}
      </button>
      <button class="toast-close" @click="toast = null">×</button>
    </div>
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
.toast {
  position: fixed;
  left: 50%;
  bottom: 24px;
  transform: translateX(-50%);
  display: flex;
  align-items: center;
  gap: 10px;
  max-width: min(720px, 92vw);
  padding: 10px 14px;
  background: var(--panel);
  border: 1px solid var(--danger);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.4);
  z-index: 200;
}
.toast-msg {
  font-size: 12px;
  line-height: 1.5;
}
.toast-action {
  flex-shrink: 0;
  border: 1px solid var(--accent);
  color: var(--accent);
  background: transparent;
  border-radius: 6px;
  padding: 5px 10px;
  font-size: 12px;
}
.toast-close {
  flex-shrink: 0;
  border: none;
  background: transparent;
  color: var(--text-dim);
  font-size: 16px;
  line-height: 1;
}
</style>
