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
      <span class="badge">{{ nodeBadge(props.type, vendor, props.data) }}</span>
      <span class="node-name">{{ displayName }}</span>
      <span v-if="data.count > 1" class="count">×{{ data.count }}</span>
      <span v-if="data.existing" class="existing">{{ t('summary.existing') }}</span>
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
  min-width: 184px;
  max-width: 264px;
  border-radius: var(--radius);
  border: 1px solid var(--rule-strong);
  border-left: 3px solid var(--ink-dim);
  background: var(--surface-2);
  overflow: hidden;
  box-shadow: var(--node-shadow);
  transition: box-shadow 0.15s ease, border-color 0.15s ease;
}
.node.ovn {
  border-left-color: var(--ovn);
}
.node.cloud {
  border-left-color: var(--cloud);
}
.node.selected {
  border-color: var(--plot);
  border-left-color: var(--plot);
  box-shadow: 0 0 0 2px var(--plot-soft), 2px 2px 0 rgba(27, 84, 184, 0.12);
}
.node-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  border-bottom: 1px solid var(--rule);
  background: var(--surface);
}
.ovn .badge {
  color: var(--ovn);
  background: var(--ovn-soft);
  border-color: var(--ovn-line);
}
.cloud .badge {
  color: var(--cloud);
  background: var(--cloud-soft);
  border-color: var(--cloud-line);
}
.badge {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
  padding: 2px 5px;
  border: 1px solid transparent;
}
.node-name {
  font-weight: 600;
  font-size: 12.5px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.ctrl {
  margin-left: auto;
  flex-shrink: 0;
  background: var(--plot);
  color: #fff;
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 9.5px;
  border-radius: var(--radius-sm);
  padding: 1px 5px;
  letter-spacing: 0.04em;
}
.count {
  flex-shrink: 0;
  background: var(--cloud-soft);
  color: var(--cloud);
  border: 1px solid var(--cloud-line);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 9.5px;
  border-radius: var(--radius-sm);
  padding: 1px 5px;
}
.existing {
  flex-shrink: 0;
  background: var(--surface-2);
  color: var(--ink-dim);
  border: 1px dashed var(--rule-strong);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 9.5px;
  border-radius: var(--radius-sm);
  padding: 1px 5px;
}
.node-body {
  padding: 8px 10px 9px;
}
.node-kind {
  font-size: 10.5px;
  color: var(--ink-dim);
  margin-bottom: 6px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  gap: 8px;
  font-size: 10.5px;
  padding: 1.5px 0;
}
.summary-row .k {
  color: var(--ink-dim);
}
.summary-row .v {
  font-family: var(--font-mono);
  color: var(--ink-2);
  text-align: right;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.handle {
  width: 9px;
  height: 9px;
  background: var(--plot);
  border: 2px solid var(--surface-2);
}
</style>
