<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { nodeLabelKey, nodeBadge } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'

const props = defineProps({
  type: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const { t } = useI18n()
const def = computed(() => NODE_TYPES[props.type])
const kindLabel = computed(() => t(nodeLabelKey(def.value, vendor.value)))
const summary = computed(() =>
  def.value.summary ? def.value.summary(props.data).map(([k, v]) => [t(k), v]) : []
)

// 多实例（数量>1）时节点名称转为前缀，展示为 name-* 以区别于单个资源
const displayName = computed(() => {
  const count = Number(props.data.count)
  const multi = props.type === 'Instance' || props.type === 'Eip'
  return multi && count > 1 ? `${props.data.name}-*` : props.data.name
})

const handles = computed(() => def.value.handles || { source: 2, target: 2 })
const targetIds = computed(() => Array.from({ length: handles.value.target }, (_, i) => `target-${i}`))
const sourceIds = computed(() => Array.from({ length: handles.value.source }, (_, i) => `source-${i}`))
function handleTop(i, total) {
  return `${((i + 1) / (total + 1)) * 100}%`
}
</script>

<template>
  <div class="node" :class="{ selected, ovn: def.category === 'ovn', cloud: def.category === 'cloud' }">
    <Handle
      v-for="(id, i) in targetIds"
      :key="id"
      type="target"
      :id="id"
      :position="Position.Left"
      class="handle"
      :style="{ top: handleTop(i, targetIds.length) }"
    />
    <div class="node-header">
      <span class="badge">{{ nodeBadge(props.type, vendor) }}</span>
      <span class="node-name">{{ displayName }}</span>
      <span v-if="data.count > 1" class="count">×{{ data.count }}</span>
      <span v-if="data.controller" class="ctrl">{{ t('nodes.controllerBadge') }}</span>
    </div>
    <div class="node-body">
      <div class="node-kind">{{ kindLabel }}</div>
      <div v-if="summary.length" class="node-summary">
        <div v-for="[k, v] in summary" :key="k" class="summary-row">
          <span class="k">{{ k }}</span>
          <span class="v">{{ v }}</span>
        </div>
      </div>
    </div>
    <Handle
      v-for="(id, i) in sourceIds"
      :key="id"
      type="source"
      :id="id"
      :position="Position.Right"
      class="handle"
      :style="{ top: handleTop(i, sourceIds.length) }"
    />
  </div>
</template>

<style scoped>
.node {
  min-width: 180px;
  border-radius: 10px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  overflow: hidden;
  box-shadow: 0 2px 8px rgba(0, 0, 0, 0.4);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.node.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.4);
}
.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--border);
  background: rgba(0, 0, 0, 0.2);
}
.ovn .badge {
  background: var(--ovn);
}
.cloud .badge {
  background: var(--cloud);
}
.badge {
  color: #0f1117;
  font-weight: 700;
  font-size: 11px;
  border-radius: 4px;
  padding: 2px 6px;
  letter-spacing: 0.5px;
}
.node-name {
  font-weight: 600;
  font-size: 13px;
}
.ctrl {
  margin-left: auto;
  background: var(--accent);
  color: #0f1117;
  font-weight: 700;
  font-size: 10px;
  border-radius: 4px;
  padding: 1px 5px;
  letter-spacing: 0.5px;
}
.count {
  background: var(--cloud);
  color: #0f1117;
  font-weight: 700;
  font-size: 10px;
  border-radius: 4px;
  padding: 1px 5px;
  letter-spacing: 0.5px;
}
.node-body {
  padding: 8px 10px;
}
.node-kind {
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  padding: 1px 0;
}
.summary-row .k {
  color: var(--text-dim);
}
.summary-row .v {
  font-family: 'SF Mono', 'Menlo', monospace;
}
.handle {
  width: 10px;
  height: 10px;
  background: var(--accent);
  border: 2px solid var(--panel-2);
}
</style>
