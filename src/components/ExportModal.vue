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
})

const emit = defineEmits(['close'])
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
  background: rgba(0, 0, 0, 0.6);
  display: flex;
  align-items: center;
  justify-content: center;
  z-index: 100;
}
.modal {
  width: min(860px, 90vw);
  height: min(80vh, 720px);
  background: var(--panel);
  border: 1px solid var(--border);
  border-radius: 12px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}
.modal-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  gap: 12px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  font-weight: 700;
}
.modal-actions {
  display: flex;
  align-items: center;
  gap: 8px;
}
.modal-actions button {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
}
.modal-actions button.close {
  color: var(--text-dim);
}
.group-select {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 6px 8px;
  font-size: 12px;
}
.warnings {
  padding: 10px 16px;
  border-bottom: 1px solid var(--border);
  background: rgba(248, 113, 113, 0.12);
  color: var(--danger);
  font-size: 12px;
  line-height: 1.6;
}
.warnings-title {
  font-weight: 700;
  margin-bottom: 4px;
}
.warnings ul {
  margin: 0;
  padding-left: 18px;
}
.credentials {
  border-bottom: 1px solid var(--border);
  background: var(--panel-2);
}
.credentials-toggle {
  width: 100%;
  text-align: left;
  border: 0;
  background: transparent;
  color: var(--text);
  padding: 10px 16px;
  font-size: 12px;
  font-weight: 700;
  display: flex;
  align-items: center;
  gap: 6px;
}
.credentials-body {
  padding: 0 16px 12px;
}
.credentials-hint {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.5;
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
  color: var(--text-dim);
}
.credential-field input {
  flex: 1;
  min-width: 0;
  padding: 6px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel);
  color: var(--text);
  font-size: 12px;
}
.content {
  flex: 1;
  overflow: auto;
  margin: 0;
  padding: 16px;
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 12px;
  line-height: 1.6;
  color: #d6e2ff;
  background: #0b0e14;
}
</style>
