<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { nodeLabelKey } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'
import { useDesigner } from '../store/designer.js'

const emit = defineEmits(['edit'])
const { t } = useI18n()
const { nodes, selectedId, removeNode } = useDesigner()

const node = computed(() => nodes.value.find((n) => n.id === selectedId.value))
const def = computed(() => (node.value ? NODE_TYPES[node.value.type] : null))
const summary = computed(() =>
  def.value && def.value.summary
    ? def.value.summary(node.value.data).map(([k, v]) => [t(k), v])
    : []
)
</script>

<template>
  <aside class="inspector">
    <template v-if="node && def">
      <div class="inspector-header">
        <div>
          <div class="inspector-title">{{ t(nodeLabelKey(def, vendor)) }}</div>
          <div class="inspector-id">{{ node.id }}</div>
        </div>
      </div>

      <div class="inspector-actions">
        <button class="primary" @click="emit('edit')">{{ t('common.edit') }}</button>
        <button class="danger" @click="removeNode(node.id)">{{ t('common.delete') }}</button>
      </div>

      <div v-if="summary.length" class="summary">
        <div v-for="[k, v] in summary" :key="k" class="summary-row">
          <span class="k">{{ k }}</span>
          <span class="v">{{ v }}</span>
        </div>
      </div>

      <p class="hint">{{ t('inspector.editHint') }}</p>
    </template>

    <div v-else class="empty">
      <p>{{ t('inspector.empty') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  width: 280px;
  flex-shrink: 0;
  background: var(--panel);
  border-left: 1px solid var(--border);
  padding: 14px 14px;
  overflow-y: auto;
}
.inspector-header {
  display: flex;
  align-items: flex-start;
  justify-content: space-between;
  margin-bottom: 12px;
}
.inspector-title {
  font-size: 15px;
  font-weight: 700;
}
.inspector-id {
  font-size: 11px;
  color: var(--text-dim);
  font-family: monospace;
}
.inspector-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 16px;
}
.inspector-actions button {
  flex: 1;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 10px;
  font-size: 12px;
}
.inspector-actions button.primary {
  border-color: var(--accent);
  color: var(--accent);
}
.inspector-actions button.danger {
  color: var(--danger);
}
.summary {
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 3px 0;
}
.summary-row .k {
  color: var(--text-dim);
}
.summary-row .v {
  font-family: 'SF Mono', 'Menlo', monospace;
}
.hint {
  margin-top: 16px;
  font-size: 11px;
  color: var(--text-dim);
}
.empty {
  color: var(--text-dim);
  font-size: 13px;
  text-align: center;
  margin-top: 40px;
}
</style>
