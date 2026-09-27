<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES, CATEGORIES } from '../data/nodeDefinitions.js'
import { nodeLabelKey, nodeBadge } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'
import { theme, setTheme } from '../store/theme.js'

const { t } = useI18n()

const groups = computed(() => {
  const map = {}
  for (const [type, def] of Object.entries(NODE_TYPES)) {
    if (def.hidden) continue
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
    <div class="palette-scroll">
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
    </div>

    <div class="palette-footer">
      <span class="theme-label">{{ t('theme.title') }}</span>
      <div class="theme-switch" role="group" :aria-label="t('theme.title')">
        <button
          type="button"
          class="theme-option"
          :class="{ active: theme === 'light' }"
          :aria-pressed="theme === 'light'"
          :title="t('theme.light')"
          @click="setTheme('light')"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <circle cx="8" cy="8" r="3.1" stroke="currentColor" stroke-width="1.4" />
            <path
              d="M8 1.2v1.9M8 12.9v1.9M1.2 8h1.9M12.9 8h1.9M3.4 3.4l1.3 1.3M11.3 11.3l1.3 1.3M12.6 3.4l-1.3 1.3M4.7 11.3l-1.3 1.3"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linecap="round"
            />
          </svg>
          <span>{{ t('theme.light') }}</span>
        </button>
        <button
          type="button"
          class="theme-option"
          :class="{ active: theme === 'dark' }"
          :aria-pressed="theme === 'dark'"
          :title="t('theme.dark')"
          @click="setTheme('dark')"
        >
          <svg viewBox="0 0 16 16" fill="none" aria-hidden="true">
            <path
              d="M13.4 9.7A5.6 5.6 0 0 1 6.3 2.6a5.6 5.6 0 1 0 7.1 7.1Z"
              stroke="currentColor"
              stroke-width="1.4"
              stroke-linejoin="round"
            />
          </svg>
          <span>{{ t('theme.dark') }}</span>
        </button>
      </div>
    </div>
  </aside>
</template>

<style scoped>
.palette {
  width: 228px;
  flex-shrink: 0;
  display: flex;
  flex-direction: column;
  background: var(--surface);
  border-right: 1px solid var(--rule);
  min-height: 0;
}
.palette-scroll {
  flex: 1;
  overflow-y: auto;
  padding: 16px 14px;
}
.palette-title {
  font-size: 13px;
  font-weight: 700;
  letter-spacing: 0.01em;
}
.palette-hint {
  font-size: 11px;
  color: var(--ink-dim);
  margin: 4px 0 18px;
}
.group {
  margin-bottom: 20px;
}
.group-label {
  display: flex;
  align-items: center;
  gap: 7px;
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
  margin-bottom: 8px;
  color: var(--ink-2);
}
.group-label::before {
  content: '';
  width: 8px;
  height: 8px;
  border-radius: 2px;
  background: var(--ink-dim);
}
.group-label.ovn::before {
  background: var(--ovn);
}
.group-label.cloud::before {
  background: var(--cloud);
}
.palette-item {
  display: flex;
  align-items: center;
  gap: 9px;
  padding: 8px 10px;
  margin-bottom: 6px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--surface-2);
  cursor: grab;
  user-select: none;
  transition: border-color 0.12s ease, transform 0.12s ease,
    box-shadow 0.12s ease;
}
.palette-item:hover {
  border-color: var(--plot);
  transform: translateX(2px);
  box-shadow: -2px 0 0 var(--plot);
}
.palette-item:active {
  cursor: grabbing;
}
.palette-item .badge {
  font-family: var(--font-mono);
  font-weight: 600;
  font-size: 10px;
  letter-spacing: 0.04em;
  border-radius: var(--radius-sm);
  padding: 2px 5px;
  border: 1px solid transparent;
}
.palette-item.ovn .badge {
  color: var(--ovn);
  background: var(--ovn-soft);
  border-color: var(--ovn-line);
}
.palette-item.cloud .badge {
  color: var(--cloud);
  background: var(--cloud-soft);
  border-color: var(--cloud-line);
}
.item-label {
  font-size: 12.5px;
}
.palette-footer {
  flex-shrink: 0;
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 8px;
  padding: 10px 12px;
  border-top: 1px solid var(--rule);
  background: var(--surface);
}
.theme-label {
  font-size: 11px;
  color: var(--ink-dim);
}
.theme-switch {
  display: flex;
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-sm);
  overflow: hidden;
  background: var(--surface-2);
}
.theme-option {
  display: flex;
  align-items: center;
  gap: 5px;
  border: 0;
  background: transparent;
  color: var(--ink-dim);
  font-size: 11px;
  font-weight: 600;
  padding: 5px 8px;
  transition: background 0.12s ease, color 0.12s ease;
}
.theme-option + .theme-option {
  border-left: 1px solid var(--rule);
}
.theme-option svg {
  width: 13px;
  height: 13px;
}
.theme-option:hover {
  color: var(--ink);
}
.theme-option.active {
  background: var(--plot-soft);
  color: var(--plot);
}
</style>
