<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES, CATEGORIES } from '../data/nodeDefinitions.js'
import { nodeLabelKey, nodeBadge } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'

const { t } = useI18n()

const groups = computed(() => {
  const map = {}
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    if (!map[def.category]) map[def.category] = []
    map[def.category].push({ type, def })
  }
  return Object.keys(CATEGORIES).map((cat) => ({
    key: cat,
    label: t(CATEGORIES[cat].label),
    items: map[cat] || [],
  }))
})

function onDragStart(e, type) {
  e.dataTransfer.setData('application/ovn-designer', type)
  e.dataTransfer.effectAllowed = 'move'
}
</script>

<template>
  <aside class="palette">
    <div class="palette-title">{{ t('palette.title') }}</div>
    <p class="palette-hint">{{ t('palette.hint') }}</p>
    <div v-for="group in groups" :key="group.key" class="group">
      <div class="group-label" :class="group.key">{{ group.label }}</div>
      <div
        v-for="item in group.items"
        :key="item.type"
        class="palette-item"
        :class="group.key"
        draggable="true"
        @dragstart="onDragStart($event, item.type)"
      >
        <span class="badge">{{ nodeBadge(item.type, vendor) }}</span>
        <span class="item-label">{{ t(nodeLabelKey(item.def, vendor)) }}</span>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.palette {
  width: 220px;
  flex-shrink: 0;
  background: var(--panel);
  border-right: 1px solid var(--border);
  padding: 14px 12px;
  overflow-y: auto;
}
.palette-title {
  font-size: 14px;
  font-weight: 700;
}
.palette-hint {
  font-size: 11px;
  color: var(--text-dim);
  margin: 4px 0 14px;
}
.group {
  margin-bottom: 16px;
}
.group-label {
  font-size: 11px;
  text-transform: uppercase;
  letter-spacing: 0.5px;
  margin-bottom: 6px;
  font-weight: 600;
}
.group-label.ovn {
  color: var(--ovn);
}
.group-label.cloud {
  color: var(--cloud);
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--border);
  border-radius: 8px;
  background: var(--panel-2);
  cursor: grab;
  user-select: none;
  transition: border-color 0.12s ease;
}
.palette-item:hover {
  border-color: var(--accent);
}
.palette-item .badge {
  color: #0f1117;
  font-weight: 700;
  font-size: 10px;
  border-radius: 4px;
  padding: 2px 5px;
}
.palette-item.ovn .badge {
  background: var(--ovn);
}
.palette-item.cloud .badge {
  background: var(--cloud);
}
.item-label {
  font-size: 13px;
}
</style>
