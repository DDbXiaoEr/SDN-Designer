<script setup>
import { ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  messages: { type: Array, default: () => [] },
})
const emit = defineEmits(['clear'])
const { t } = useI18n()

const collapsed = ref(false)

// 有新消息时自动展开，方便用户立即看到连线等提示
watch(
  () => props.messages.length,
  (len, prev) => {
    if (len > prev) collapsed.value = false
  }
)
</script>

<template>
  <section class="messages" :class="{ collapsed }">
    <header class="messages-head">
      <button class="messages-toggle" :title="t('messages.toggle')" @click="collapsed = !collapsed">
        {{ collapsed ? '▸' : '▾' }}
      </button>
      <span class="messages-title">{{ t('messages.title') }}</span>
      <span v-if="messages.length" class="messages-count">{{ messages.length }}</span>
      <span class="messages-spacer" />
      <button class="messages-clear" :disabled="!messages.length" @click="emit('clear')">
        {{ t('messages.clear') }}
      </button>
    </header>

    <div v-show="!collapsed" class="messages-body">
      <ul v-if="messages.length" class="messages-list">
        <li v-for="m in messages" :key="m.id" class="messages-item" :class="m.level">
          <span class="messages-time">{{ m.time }}</span>
          <span class="messages-text">{{ m.text }}</span>
        </li>
      </ul>
      <p v-else class="messages-empty">{{ t('messages.empty') }}</p>
    </div>
  </section>
</template>

<style scoped>
.messages {
  flex: 1;
  min-width: 0;
  background: var(--surface);
}
.messages-head {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 5px 12px;
}
.messages-toggle {
  border: none;
  background: transparent;
  color: var(--ink-dim);
  font-size: 11px;
  line-height: 1;
  padding: 3px 4px;
}
.messages-toggle:hover {
  color: var(--ink);
}
.messages-title {
  font-size: 11.5px;
  font-weight: 600;
  letter-spacing: 0.01em;
}
.messages-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--surface-2);
  border: 1px solid var(--rule);
  color: var(--ink-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
  line-height: 15px;
  text-align: center;
}
.messages-spacer {
  flex: 1;
}
.messages-clear {
  border: 1px solid var(--rule);
  background: var(--surface-2);
  color: var(--ink-2);
  border-radius: var(--radius-sm);
  padding: 3px 10px;
  font-size: 11px;
  font-weight: 600;
}
.messages-clear:hover:not(:disabled) {
  border-color: var(--ink-2);
}
.messages-clear:disabled {
  opacity: 0.45;
  cursor: default;
}
.messages-body {
  max-height: 132px;
  overflow-y: auto;
  padding: 0 12px 8px;
}
.messages-list {
  list-style: none;
  margin: 0;
  padding: 0;
}
.messages-item {
  display: flex;
  align-items: baseline;
  gap: 9px;
  padding: 5px 0;
  font-size: 12px;
  line-height: 1.5;
  border-top: 1px solid var(--rule);
}
.messages-item::before {
  content: '';
  flex-shrink: 0;
  width: 7px;
  height: 7px;
  border-radius: 1px;
  background: var(--ink-dim);
  transform: translateY(-1px);
}
.messages-item.warn::before {
  background: var(--danger);
}
.messages-item.info::before {
  background: var(--ovn);
}
.messages-time {
  flex-shrink: 0;
  color: var(--ink-dim);
  font-family: var(--font-mono);
  font-size: 10.5px;
}
.messages-text {
  white-space: pre-line;
  color: var(--ink-2);
}
.messages-item.warn .messages-text {
  color: var(--danger);
}
.messages-item.info .messages-text {
  color: var(--ink-2);
}
.messages-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 11px;
  color: var(--ink-dim);
}
</style>
