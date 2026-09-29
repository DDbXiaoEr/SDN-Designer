<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { nodeLabelKey, nodeBadge } from '../data/vendors.js'
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
        <span class="badge" :class="def.category">{{ nodeBadge(node.type, vendor, node.data) }}</span>
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
        <div class="summary-caption">{{ t('inspector.specTitle') }}</div>
        <div v-for="[k, v] in summary" :key="k" class="summary-row">
          <span class="k">{{ k }}</span>
          <span class="v">{{ v }}</span>
        </div>
      </div>

      <p class="hint">{{ t('inspector.editHint') }}</p>
    </template>

    <div v-else class="empty">
      <svg class="empty-mark" viewBox="0 0 48 48" fill="none" aria-hidden="true">
        <rect x="5.5" y="5.5" width="37" height="37" rx="2" stroke="currentColor" stroke-dasharray="4 4" />
        <path d="M14 24h20M24 14v20" stroke="currentColor" stroke-width="1.4" />
      </svg>
      <p>{{ t('inspector.empty') }}</p>
    </div>
  </aside>
</template>

<style scoped>
.inspector {
  width: 288px;
  flex-shrink: 0;
  order: 2;
  background: var(--surface);
  border-left: 1px solid var(--rule);
  padding: 16px;
  overflow-y: auto;
}
.inspector-header {
  display: flex;
  align-items: center;
  gap: 10px;
  margin-bottom: 14px;
  padding-bottom: 12px;
  border-bottom: 1px solid var(--rule);
}
.badge {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
  padding: 3px 6px;
  border: 1px solid transparent;
}
.badge.ovn {
  color: var(--ovn);
  background: var(--ovn-soft);
  border-color: var(--ovn-line);
}
.badge.cloud {
  color: var(--cloud);
  background: var(--cloud-soft);
  border-color: var(--cloud-line);
}
.inspector-title {
  font-size: 14px;
  font-weight: 700;
}
.inspector-id {
  font-size: 10.5px;
  color: var(--ink-dim);
  font-family: var(--font-mono);
}
.inspector-actions {
  display: flex;
  gap: 8px;
  margin-bottom: 18px;
}
.inspector-actions button {
  flex: 1;
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 12px;
  font-weight: 600;
  transition: background 0.12s ease, border-color 0.12s ease, color 0.12s ease;
}
.inspector-actions button.primary {
  border-color: var(--plot);
  color: var(--plot);
}
.inspector-actions button.primary:hover {
  background: var(--plot);
  color: #fff;
}
.inspector-actions button.danger {
  border-color: var(--danger-line);
  color: var(--danger);
}
.inspector-actions button.danger:hover {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}
.summary-caption {
  font-size: 10.5px;
  font-weight: 600;
  letter-spacing: 0.04em;
  color: var(--ink-dim);
  margin-bottom: 8px;
}
.summary-row {
  display: flex;
  align-items: baseline;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
}
.summary-row .k {
  flex: 0 1 auto;
  display: flex;
  align-items: baseline;
  overflow: hidden;
  white-space: nowrap;
  color: var(--ink-dim);
}
.summary-row .k::after {
  content: '';
  flex: 1;
  min-width: 12px;
  margin: 0 6px 2px;
  border-bottom: 1px dotted var(--rule-strong);
}
.summary-row .v {
  flex: 0 0 auto;
  font-family: var(--font-mono);
  color: var(--ink);
  text-align: right;
  max-width: 60%;
  overflow: hidden;
  text-overflow: ellipsis;
}
.hint {
  margin-top: 18px;
  padding-top: 12px;
  border-top: 1px solid var(--rule);
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-dim);
}
.empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 12px;
  color: var(--ink-dim);
  font-size: 12px;
  text-align: center;
  margin-top: 64px;
  padding: 0 16px;
  line-height: 1.6;
}
.empty-mark {
  width: 48px;
  height: 48px;
  color: var(--rule-strong);
}
.empty p {
  margin: 0;
}
</style>
