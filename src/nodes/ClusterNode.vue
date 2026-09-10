<script setup>
import { computed } from 'vue'
import { Handle, Position } from '@vue-flow/core'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  type: { type: String, required: true },
  data: { type: Object, required: true },
  selected: { type: Boolean, default: false },
})

const { t } = useI18n()
const hostCount = computed(() => props.data.hostCount ?? 0)
</script>

<template>
  <div class="cluster" :class="{ selected }">
    <div class="cluster-header">
      <span class="badge">CLUSTER</span>
      <span class="cluster-name">{{ data.name }}</span>
      <span class="cluster-count">{{ hostCount }} {{ t('summary.hosts') }}</span>
    </div>
    <Handle type="target" id="target-0" :position="Position.Left" class="handle" />
    <Handle type="source" id="source-0" :position="Position.Right" class="handle" />
  </div>
</template>

<style scoped>
.cluster {
  width: 100%;
  height: 100%;
  border-radius: 12px;
  border: 2px dashed rgba(79, 140, 255, 0.6);
  background: rgba(79, 140, 255, 0.06);
  box-shadow: 0 2px 16px rgba(0, 0, 0, 0.4);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cluster.selected {
  border-color: var(--accent);
  box-shadow: 0 0 0 2px rgba(79, 140, 255, 0.4);
}
.cluster-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  border-bottom: 1px solid rgba(79, 140, 255, 0.3);
  background: rgba(79, 140, 255, 0.1);
  border-radius: 11px 11px 0 0;
}
.badge {
  color: #0f1117;
  font-weight: 700;
  font-size: 11px;
  border-radius: 4px;
  padding: 2px 6px;
  letter-spacing: 0.5px;
  background: var(--ovn);
}
.cluster-name {
  font-weight: 600;
  font-size: 13px;
}
.cluster-count {
  margin-left: auto;
  font-size: 11px;
  color: var(--text-dim);
}
.handle {
  width: 12px;
  height: 12px;
  background: var(--accent);
  border: 2px solid var(--panel-2);
}
</style>
