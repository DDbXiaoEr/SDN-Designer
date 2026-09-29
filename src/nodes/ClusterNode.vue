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
    <Handle type="target" id="target-0" :position="Position.Left" class="handle" style="top: 40%" />
    <Handle type="target" id="target-1" :position="Position.Left" class="handle" style="top: 70%" />
    <Handle type="source" id="source-0" :position="Position.Right" class="handle" style="top: 40%" />
    <Handle type="source" id="source-1" :position="Position.Right" class="handle" style="top: 70%" />
  </div>
</template>

<style scoped>
.cluster {
  width: 100%;
  height: 100%;
  border-radius: var(--radius);
  border: 1.5px dashed var(--plot-line);
  background: var(--plot-soft);
  transition: border-color 0.15s ease, box-shadow 0.15s ease;
}
.cluster.selected {
  border-color: var(--plot);
  box-shadow: 0 0 0 2px var(--plot-soft);
}
.cluster-header {
  position: absolute;
  top: 0;
  left: 0;
  right: 0;
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 7px 12px;
  border-bottom: 1px solid var(--plot-line);
  background: var(--surface-2);
  border-radius: var(--radius) var(--radius) 0 0;
}
.badge {
  color: var(--ovn);
  background: var(--ovn-soft);
  border: 1px solid rgba(11, 138, 120, 0.35);
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
  padding: 2px 5px;
}
.cluster-name {
  font-weight: 600;
  font-size: 12.5px;
}
.cluster-count {
  margin-left: auto;
  font-size: 10.5px;
  color: var(--ink-dim);
}
.handle {
  width: 11px;
  height: 11px;
  background: var(--plot);
  border: 2px solid var(--surface-2);
}
</style>
