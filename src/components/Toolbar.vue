<script setup>
import { ref, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'
import { setLocale, SUPPORTED_LOCALES } from '../i18n/index.js'
import { VENDORS } from '../data/vendors.js'
import { DEMO_LIST } from '../data/demo.js'
import { vendor, providerVersion, setProviderVersion } from '../store/vendor.js'
import { providerVersionOptions } from '../store/providerVersions.js'
import ProviderVersionSelect from './ProviderVersionSelect.vue'

defineProps({
  nodesCount: { type: Number, default: 0 },
})

const emit = defineEmits(['export-ovn', 'export-terraform', 'clear', 'save-design', 'import-design', 'load-demo', 'change-vendor'])

const { t, locale } = useI18n()

// 示例下拉：选择具体示例后携带 key 触发加载
const demoMenu = ref(null)
const demoOpen = ref(false)
function onPickDemo(key) {
  demoOpen.value = false
  emit('load-demo', key)
}
function onDocClick(e) {
  if (demoOpen.value && demoMenu.value && !demoMenu.value.contains(e.target)) demoOpen.value = false
}
onMounted(() => document.addEventListener('click', onDocClick))
onBeforeUnmount(() => document.removeEventListener('click', onDocClick))

function switchLocale() {
  const idx = SUPPORTED_LOCALES.indexOf(locale.value)
  const next = SUPPORTED_LOCALES[(idx + 1) % SUPPORTED_LOCALES.length]
  setLocale(next)
}

function onVendorChange(e) {
  emit('change-vendor', e.target.value)
}

function onProviderVersionChange(value) {
  setProviderVersion(vendor.value, value)
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
      <select class="vendor-select" :value="vendor" @change="onVendorChange">
        <option v-for="v in VENDORS" :key="v.value" :value="v.value">{{ t(v.label) }}</option>
      </select>
      <label class="provider-version">
        <span>{{ t('toolbar.providerVersion') }}</span>
        <ProviderVersionSelect
          :model-value="providerVersion"
          :options="providerVersionOptions(vendor)"
          :title="t('toolbar.providerVersionHint')"
          @update:model-value="onProviderVersionChange"
        />
      </label>
      <button class="ghost" @click="switchLocale">{{ t('toolbar.language') }}: {{ locale }}</button>
      <div ref="demoMenu" class="demo-menu">
        <button class="ghost" @click="demoOpen = !demoOpen">{{ t('toolbar.loadDemo') }} ▾</button>
        <div v-if="demoOpen" class="demo-list">
          <button v-for="d in DEMO_LIST" :key="d" class="demo-item" @click="onPickDemo(d)">
            {{ t(`toolbar.demo_${d}`) }}
          </button>
        </div>
      </div>
      <button class="ghost" @click="emit('clear')">{{ t('toolbar.clear') }}</button>
      <button class="ghost" @click="emit('save-design')">{{ t('toolbar.saveDesign') }}</button>
      <button class="ghost" @click="emit('import-design')">{{ t('toolbar.importDesign') }}</button>
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
.vendor-select {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 7px;
  padding: 7px 10px;
  font-size: 13px;
  font-weight: 600;
}
.provider-version {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
  white-space: nowrap;
}
.demo-menu {
  position: relative;
}
.demo-list {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 150px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.35);
  z-index: 30;
}
.demo-item {
  border: none;
  background: transparent;
  text-align: left;
  padding: 7px 10px;
  border-radius: 6px;
}
.demo-item:hover {
  background: var(--panel);
}
</style>
