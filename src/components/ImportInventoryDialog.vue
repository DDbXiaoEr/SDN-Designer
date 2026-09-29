<script setup>
import { ref, computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { vendor } from '../store/vendor.js'
import { regionOptions, defaultRegion } from '../data/regions.js'
import { fetchInventory } from '../store/inventory.js'
import { graphToDesign, inventorySummary } from '../data/inventoryLayout.js'

const emit = defineEmits(['confirm', 'cancel'])
const { t } = useI18n()

const region = ref(defaultRegion(vendor.value))
const loading = ref(false)
const error = ref('')
const preview = ref(null)

const regions = computed(() => regionOptions(vendor.value))
const summary = computed(() => (preview.value ? inventorySummary(preview.value.graph) : null))

async function load() {
  error.value = ''
  preview.value = null
  loading.value = true
  try {
    const graph = await fetchInventory(vendor.value, region.value)
    const design = graphToDesign(graph, vendor.value)
    if (!design.nodes.length) {
      error.value = t('importInventory.empty')
      return
    }
    preview.value = { graph, design }
  } catch (e) {
    error.value = t('importInventory.error', { message: String((e && e.message) || e) })
  } finally {
    loading.value = false
  }
}

function confirm() {
  if (!preview.value) return
  emit('confirm', preview.value.design)
}
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">{{ t('importInventory.title') }}</span>
        <button class="close" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      </div>
      <div class="modal-body">
        <p class="hint">{{ t('importInventory.hint') }}</p>
        <div class="field">
          <label>{{ t('importInventory.region') }}</label>
          <select v-model="region">
            <option v-for="r in regions" :key="r.value" :value="r.value">{{ r.label }}</option>
          </select>
        </div>
        <button class="primary" :disabled="loading" @click="load">
          {{ loading ? t('importInventory.loading') : t('importInventory.fetch') }}
        </button>
        <p v-if="error" class="error">{{ error }}</p>
        <div v-if="summary" class="summary">
          <div class="summary-caption">{{ t('importInventory.preview') }}</div>
          <div class="summary-row"><span>{{ t('importInventory.vpcs') }}</span><span>{{ summary.vpcs }}</span></div>
          <div class="summary-row"><span>{{ t('importInventory.subnets') }}</span><span>{{ summary.subnets }}</span></div>
          <div class="summary-row"><span>{{ t('importInventory.instances') }}</span><span>{{ summary.instances }}</span></div>
          <div class="summary-row"><span>{{ t('importInventory.sgs') }}</span><span>{{ summary.securityGroups }}</span></div>
          <div class="summary-row"><span>{{ t('importInventory.eips') }}</span><span>{{ summary.eips }}</span></div>
          <div class="summary-row"><span>{{ t('importInventory.gateways') }}</span><span>{{ summary.gateways }}</span></div>
          <div class="summary-row"><span>{{ t('importInventory.keyPairs') }}</span><span>{{ summary.keyPairs }}</span></div>
        </div>
      </div>
      <div class="modal-footer">
        <button class="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="primary" :disabled="!preview" @click="confirm">{{ t('importInventory.draw') }}</button>
      </div>
    </div>
  </div>
</template>

<style scoped>
.overlay {
  position: fixed;
  inset: 0;
  background: var(--overlay);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
  backdrop-filter: blur(2px);
}
.modal {
  width: min(480px, 92vw);
  max-height: 82vh;
  background: var(--surface);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius-lg);
  display: flex;
  flex-direction: column;
  overflow: hidden;
  box-shadow: var(--shadow-modal);
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 13px 16px;
  border-bottom: 1px solid var(--rule);
  background: var(--surface-2);
}
.modal-title {
  font-weight: 700;
  font-size: 14px;
}
.modal-body {
  padding: 16px;
  overflow-y: auto;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 13px 16px;
  border-top: 1px solid var(--rule);
  background: var(--surface-2);
}
.hint {
  font-size: 12px;
  color: var(--ink-dim);
  margin: 0 0 14px;
  line-height: 1.5;
}
.field {
  margin-bottom: 14px;
}
.field > label {
  display: block;
  font-size: 11px;
  color: var(--ink-dim);
  margin-bottom: 6px;
  font-weight: 600;
}
select {
  width: 100%;
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 12.5px;
}
button {
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
}
button.close {
  color: var(--ink-dim);
  border-color: transparent;
  background: transparent;
  padding: 5px 8px;
}
button.ghost {
  color: var(--ink-dim);
  background: transparent;
}
button.primary {
  background: var(--plot);
  border-color: var(--plot);
  color: #fff;
}
button.primary:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}
.error {
  color: var(--danger);
  font-size: 12px;
  margin: 12px 0 0;
}
.summary {
  margin-top: 16px;
  padding: 10px 12px;
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  background: var(--surface-2);
}
.summary-caption {
  font-size: 11px;
  font-weight: 600;
  color: var(--ink-dim);
  margin-bottom: 8px;
}
.summary-row {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  padding: 2px 0;
}
</style>
