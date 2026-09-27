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
      <span class="logo" aria-hidden="true">
        <svg viewBox="0 0 28 28" fill="none">
          <path class="wire" d="M6.5 8.5h15M6.5 8.5v11M21.5 8.5v11M6.5 19.5h15" />
          <circle class="pin" cx="6.5" cy="8.5" r="2.6" />
          <circle class="pin" cx="21.5" cy="8.5" r="2.6" />
          <circle class="pin" cx="14" cy="19.5" r="2.6" />
        </svg>
      </span>
      <span class="title">{{ t('common.appName') }}</span>
    </div>
    <div class="meta">
      <span class="meta-k">{{ t('common.nodes') }}</span>
      <span class="meta-v">{{ nodesCount }}</span>
    </div>
    <div class="actions">
      <select class="vendor-select" :value="vendor" @change="onVendorChange">
        <option v-for="v in VENDORS" :key="v.value" :value="v.value">{{ t(v.label) }}</option>
      </select>
      <label class="provider-version">
        <span class="pv-label">{{ t('toolbar.providerVersion') }}</span>
        <ProviderVersionSelect
          :model-value="providerVersion"
          :options="providerVersionOptions(vendor)"
          :title="t('toolbar.providerVersionHint')"
          @update:model-value="onProviderVersionChange"
        />
      </label>
      <span class="divider" aria-hidden="true" />
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
      <span class="divider" aria-hidden="true" />
      <button class="ovn" @click="emit('export-ovn')">{{ t('toolbar.exportOvn') }}</button>
      <button class="cloud" @click="emit('export-terraform')">{{ t('toolbar.exportTerraform') }}</button>
    </div>
  </header>
</template>

<style scoped>
.toolbar {
  min-height: 54px;
  display: flex;
  align-items: center;
  gap: 14px;
  flex-wrap: wrap;
  padding: 8px 16px;
  background: var(--surface);
  border-bottom: 1px solid var(--rule);
  flex-shrink: 0;
}
.brand {
  display: flex;
  align-items: center;
  gap: 10px;
}
.logo {
  display: grid;
  place-items: center;
  width: 30px;
  height: 30px;
  border: 1px solid var(--ink);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.logo svg {
  width: 22px;
  height: 22px;
}
.logo .wire {
  stroke: var(--plot);
  stroke-width: 1.4;
}
.logo .pin {
  fill: var(--surface-2);
  stroke: var(--plot);
  stroke-width: 1.6;
}
.title {
  font-weight: 700;
  font-size: 14px;
  letter-spacing: 0.01em;
}
.meta {
  display: flex;
  align-items: baseline;
  gap: 6px;
  padding: 3px 8px;
  border: 1px solid var(--rule);
  border-radius: var(--radius-sm);
  background: var(--surface-2);
}
.meta-k {
  font-size: 10.5px;
  color: var(--ink-dim);
}
.meta-v {
  font-family: var(--font-mono);
  font-size: 12px;
  font-weight: 600;
}
.actions {
  margin-left: auto;
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.divider {
  width: 1px;
  align-self: stretch;
  margin: 2px 2px;
  background: var(--rule);
}
button {
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 7px 12px;
  font-size: 12.5px;
  font-weight: 600;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
button:hover {
  border-color: var(--ink-2);
}
button.ovn {
  background: var(--ovn-soft);
  border-color: var(--ovn);
  color: var(--ovn);
}
button.ovn:hover {
  background: var(--ovn);
  color: #fff;
}
button.cloud {
  background: var(--cloud-soft);
  border-color: var(--cloud);
  color: var(--cloud);
}
button.cloud:hover {
  background: var(--cloud);
  color: #fff;
}
button.ghost {
  background: transparent;
  border-color: transparent;
  color: var(--ink-dim);
  padding: 7px 9px;
}
button.ghost:hover {
  color: var(--ink);
  background: var(--paper);
}
.vendor-select {
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 12.5px;
  font-weight: 600;
}
.provider-version {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11.5px;
  color: var(--ink-dim);
  white-space: nowrap;
}
.pv-label {
  letter-spacing: 0.01em;
}
.demo-menu {
  position: relative;
}
.demo-list {
  position: absolute;
  right: 0;
  top: calc(100% + 6px);
  min-width: 168px;
  display: flex;
  flex-direction: column;
  gap: 2px;
  padding: 4px;
  background: var(--surface-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  box-shadow: var(--shadow-modal);
  z-index: 30;
}
.demo-item {
  border: none;
  background: transparent;
  text-align: left;
  padding: 7px 10px;
  border-radius: var(--radius-sm);
}
.demo-item:hover {
  background: var(--paper);
  border-color: transparent;
}
</style>
