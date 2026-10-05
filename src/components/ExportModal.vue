<script setup>
import { ref, computed, reactive } from 'vue'
import { useI18n } from 'vue-i18n'
import { download, downloadBlob, createZip } from '../export/utils.js'

const props = defineProps({
  title: { type: String, required: true },
  groups: { type: Array, required: true },
  warnings: { type: Array, default: () => [] },
  zipName: { type: String, default: 'export' },
  credentialFields: { type: Array, default: () => [] },
  credentialGroupId: { type: String, default: 'variables' },
  // Terraform 接管模式：为已有资源生成 resource + import 块（可 import 后 destroy）
  adopt: { type: Boolean, default: false },
  adoptable: { type: Boolean, default: false },
})

const emit = defineEmits(['close', 'toggle-adopt'])
const { t } = useI18n()
const copied = ref(false)
const selectedId = ref(props.groups.length ? props.groups[0].id : null)
const credentials = reactive({})
const credentialsOpen = ref(false)

const selected = computed(() => props.groups.find((g) => g.id === selectedId.value) || props.groups[0])
const hasSelector = computed(() => props.groups.length > 1)

function hclEscape(value) {
  return String(value).replace(/\\/g, '\\\\').replace(/"/g, '\\"').replace(/\r?\n/g, '\\n')
}

// 将填写的凭证注入 variables.tf 对应变量的 default，未填写则保持 default = ""
function injectCredentials(content) {
  let out = content
  for (const f of props.credentialFields) {
    const value = credentials[f.key]
    if (value == null || value === '') continue
    const re = new RegExp(`(variable\\s+"${f.key}"\\s*\\{[^}]*?default\\s*=\\s*)"[^"]*"`)
    out = out.replace(re, `$1"${hclEscape(value)}"`)
  }
  return out
}

function contentOf(group) {
  if (!group) return ''
  return group.id === props.credentialGroupId ? injectCredentials(group.content) : group.content
}

const selectedContent = computed(() => contentOf(selected.value))

async function copy() {
  try {
    await navigator.clipboard.writeText(selectedContent.value)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}

function downloadAll() {
  if (props.groups.length > 1) {
    const blob = createZip(
      props.groups.map((g) => ({ filename: g.filename, content: contentOf(g) }))
    )
    downloadBlob(`${props.zipName}.zip`, blob)
    return
  }
  props.groups.forEach((g) => download(g.filename, contentOf(g)))
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">{{ title }}</span>
        <div class="modal-actions">
          <select v-if="hasSelector" v-model="selectedId" class="group-select">
            <option v-for="g in groups" :key="g.id" :value="g.id">{{ g.label }}</option>
          </select>
          <button @click="copy">{{ copied ? t('common.copied') : t('common.copy') }}</button>
          <button @click="download(selected.filename, selectedContent)">{{ t('common.download') }}</button>
          <button v-if="hasSelector" @click="downloadAll">{{ t('common.downloadAllZip') }}</button>
          <button class="close" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
      <div v-if="adoptable" class="adopt">
        <label class="adopt-toggle">
          <input
            type="checkbox"
            :checked="adopt"
            @change="emit('toggle-adopt', $event.target.checked)"
          />
          <span>{{ t('export.adoptExisting') }}</span>
        </label>
        <p v-if="adopt" class="adopt-hint">{{ t('export.adoptExistingHint') }}</p>
      </div>
      <div v-if="warnings.length" class="warnings">
        <div class="warnings-title">{{ t('export.warningsTitle') }}</div>
        <ul>
          <li v-for="(w, i) in warnings" :key="i">{{ w }}</li>
        </ul>
      </div>
      <div v-if="credentialFields.length" class="credentials">
        <button type="button" class="credentials-toggle" @click="credentialsOpen = !credentialsOpen">
          <span>{{ credentialsOpen ? '▾' : '▸' }}</span>
          {{ t('export.credentialsTitle') }}
        </button>
        <div v-if="credentialsOpen" class="credentials-body">
          <p class="credentials-hint">{{ t('export.credentialsHint') }}</p>
          <div v-for="f in credentialFields" :key="f.key" class="credential-field">
            <label>{{ t(f.label) }}</label>
            <input v-model="credentials[f.key]" type="password" autocomplete="off" spellcheck="false" />
          </div>
        </div>
      </div>
      <pre class="content">{{ selectedContent }}</pre>
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
  width: min(880px, 92vw);
  height: min(82vh, 760px);
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
  flex-wrap: wrap;
  gap: 12px;
  padding: 13px 16px;
  border-bottom: 1px solid var(--rule);
  background: var(--surface-2);
}
.modal-title {
  font-weight: 700;
  font-size: 14px;
}
.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
  flex-wrap: wrap;
}
.modal-actions button {
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 6px 12px;
  font-size: 12px;
  font-weight: 600;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
.modal-actions button:hover {
  border-color: var(--plot);
  color: var(--plot);
}
.modal-actions button.close {
  color: var(--ink-dim);
  border-color: var(--rule);
}
.modal-actions button.close:hover {
  border-color: var(--ink-2);
  color: var(--ink);
}
.group-select {
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 6px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
}
.adopt {
  padding: 10px 16px;
  border-bottom: 1px solid var(--rule);
  background: var(--surface-2);
}
.adopt-toggle {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  font-weight: 700;
  cursor: pointer;
}
.adopt-toggle input {
  accent-color: var(--plot);
}
.adopt-hint {
  margin: 6px 0 0;
  font-size: 11px;
  line-height: 1.6;
  color: var(--ink-dim);
}
.warnings {
  padding: 10px 16px;
  border-bottom: 1px solid var(--rule);
  background: var(--warn-soft);
  border-left: 3px solid var(--warn);
  color: var(--ink-2);
  font-size: 12px;
  line-height: 1.6;
}
.warnings-title {
  font-weight: 700;
  font-size: 11px;
  letter-spacing: 0.03em;
  color: var(--warn);
  margin-bottom: 4px;
}
.warnings ul {
  margin: 0;
  padding-left: 18px;
}
.credentials {
  border-bottom: 1px solid var(--rule);
  background: var(--surface-2);
}
.credentials-toggle {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--ink);
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 7px;
}
.credentials-toggle:hover {
  color: var(--plot);
}
.credentials-body {
  padding: 0 16px 14px;
}
.credentials-hint {
  margin: 0 0 10px;
  font-size: 11px;
  line-height: 1.6;
  color: var(--danger);
}
.credential-field {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 6px;
}
.credential-field label {
  flex: 0 0 160px;
  font-size: 11px;
  color: var(--ink-dim);
}
.credential-field input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 12px;
  font-family: var(--font-mono);
}
.content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 16px 18px;
  font-family: var(--font-mono);
  font-size: 12px;
  line-height: 1.7;
  color: var(--term-text);
  background: var(--term-bg);
  border-top: 1px solid var(--term-rule);
  tab-size: 2;
}
</style>
