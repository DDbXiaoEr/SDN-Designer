<script setup>
import { useI18n } from 'vue-i18n'
import { setLocale, SUPPORTED_LOCALES } from '../i18n/index.js'

defineProps({
  nodesCount: { type: Number, default: 0 },
})

const emit = defineEmits(['export-ovn', 'export-terraform', 'clear'])

const { t, locale } = useI18n()

function switchLocale() {
  const idx = SUPPORTED_LOCALES.indexOf(locale.value)
  const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length]
  setLocale(next)
}
</script>

<template>
  <header class="toolbar">
    <div class="brand">
      <span class="logo">OVN</span>
      <span class="title">{{ t('common.appName') }}</span>
    </div>
    <div class="meta">{{ t('toolbar.nodeCount', { count: nodesCount }) }}</div>
    <div class="actions">
      <button class="ghost" @click="switchLocale">{{ t('toolbar.language') }}: {{ locale }}</button>
      <button class="ghost" @click="emit('clear')">{{ t('toolbar.clear') }}</button>
      <button class="ovn" @click="emit('export-ovn')">{{ t('toolbar.exportOvn') }}</button>
      <button class="cloud" @click="emit('export-terraform')">{{ t('toolbar.exportTerraform') }}</button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  height: 52px;
  display: flex;
  align-items: center;
  gap: 16px;
  padding: 0 16px;
  background: var(--panel);
  border-bottom: 1px solid var(--border);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 8px;
}
.logo {
  background: var(--accent);
  color: #0f1117;
  font-weight: 800;
  font-size: 13px;
  padding: 3px 7px;
  border-radius: 5px;
}
.title {
  font-weight: 700;
  font-size: 15px;
}
.meta {
  font-size: 12px;
  color: var(--text-dim);
}
.actions {
  margin-left: auto;
  display: flex;
  gap: 8px;
}
button {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 7px;
  padding: 7px 14px;
  font-size: 13px;
  font-weight: 600;
}
button.ovn {
  background: rgba(110, 231, 183, 0.12);
  border-color: var(--ovn);
  color: var(--ovn);
}
button.cloud {
  background: rgba(251, 191, 36, 0.12);
  border-color: var(--cloud);
  color: var(--cloud);
}
button.ghost {
  color: var(--text-dim);
}
</style>
