<script setup>
import { ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { download } from '../export/utils.js'

const props = defineProps({
  title: { type: String, required: true },
  content: { type: String, required: true },
  filename: { type: String, required: true },
})

const emit = defineEmits(['close'])
const { t } = useI18n()
const copied = ref(false)

async function copy() {
  try {
    await navigator.clipboard.writeText(props.content)
    copied.value = true
    setTimeout(() => (copied.value = false), 1500)
  } catch {
    /* 剪贴板不可用时忽略 */
  }
}
</script>

<template>
  <div class="overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">{{ title }}</span>
        <div class="modal-actions">
          <button @click="copy">{{ copied ? t('common.copied') : t('common.copy') }}</button>
          <button @click="download(filename, content)">{{ t('common.download') }}</button>
          <button class="close" @click="emit('close')">{{ t('common.close') }}</button>
        </div>
      </div>
      <pre class="content">{{ content }}</pre>
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
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  font-weight: 700;
}
.modal-actions {
  display: flex;
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
