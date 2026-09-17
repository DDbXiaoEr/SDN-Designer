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
  flex-shrink: 0;
  background: var(--panel);
  border-top: 1px solid var(--border);
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
  color: var(--text-dim);
  font-size: 12px;
  line-height: 1;
  padding: 2px;
}
.messages-title {
  font-size: 12px;
  font-weight: 600;
}
.messages-count {
  min-width: 18px;
  padding: 0 5px;
  border-radius: 9px;
  background: var(--panel-2);
  color: var(--text-dim);
  font-size: 11px;
  line-height: 16px;
  text-align: center;
}
.messages-spacer {
  flex: 1;
}
.messages-clear {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 3px 10px;
  font-size: 11px;
}
.messages-clear:disabled {
  opacity: 0.4;
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
  gap: 8px;
  padding: 3px 0;
  font-size: 12px;
  line-height: 1.5;
  border-top: 1px solid var(--border);
}
.messages-time {
  flex-shrink: 0;
  color: var(--text-dim);
  font-family: 'SF Mono', 'Menlo', monospace;
  font-size: 11px;
  padding-top: 1px;
}
.messages-text {
  white-space: pre-line;
}
.messages-item.warn .messages-text {
  color: var(--danger);
}
.messages-item.info .messages-text {
  color: var(--ovn);
}
.messages-empty {
  margin: 0;
  padding: 4px 0;
  font-size: 11px;
  color: var(--text-dim);
}
</style>
