<script setup>
import { ref, computed, watch, nextTick, onMounted, onBeforeUnmount } from 'vue'
import { useI18n } from 'vue-i18n'

// 主 provider 版本约束输入框 + 已发布版本下拉（原生 datalist 会按输入文本过滤，
// 约束如 "~> 1.60" 会几乎匹配不到任何版本，故改为自定义下拉始终列出全部候选）。
const props = defineProps({
  modelValue: { type: String, default: '' },
  options: { type: Array, default: () => [] },
  title: { type: String, default: '' },
})

const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const root = ref(null)
const searchEl = ref(null)
const open = ref(false)
const query = ref('')

const filtered = computed(() => {
  const q = query.value.trim().toLowerCase()
  if (!q) return props.options
  return props.options.filter((v) => v.toLowerCase().includes(q))
})

// 选中已发布版本后生成约束 ~> 主.次（如 1.98.2 -> ~> 1.98）
function constraintOf(version) {
  const [major, minor] = String(version).split('.')
  return minor ? `~> ${major}.${minor}` : `~> ${major}`
}

function isActive(version) {
  const value = String(props.modelValue || '').trim()
  return value === version || value === constraintOf(version)
}

function onInput(e) {
  emit('update:modelValue', e.target.value)
}

function toggle() {
  open.value = !open.value
  if (open.value) query.value = ''
}

function pick(version) {
  emit('update:modelValue', constraintOf(version))
  open.value = false
}

function onDocPointerDown(e) {
  if (root.value && !root.value.contains(e.target)) open.value = false
}

function onKeydown(e) {
  if (e.key === 'Escape') open.value = false
}

watch(open, (v) => {
  if (v) nextTick(() => searchEl.value && searchEl.value.focus())
})

onMounted(() => document.addEventListener('mousedown', onDocPointerDown))
onBeforeUnmount(() => document.removeEventListener('mousedown', onDocPointerDown))
</script>

<template>
  <div ref="root" class="provider-version-select" @keydown="onKeydown">
    <input
      class="provider-input"
      :value="modelValue"
      :title="title"
      spellcheck="false"
      autocomplete="off"
      @input="onInput"
    />
    <button
      type="button"
      class="provider-toggle"
      :class="{ open }"
      :title="t('toolbar.providerVersionSelect')"
      :aria-expanded="open"
      @click="toggle"
    >
      <span class="caret" />
    </button>
    <div v-if="open" class="provider-panel">
      <input
        ref="searchEl"
        v-model="query"
        class="provider-search"
        :placeholder="t('toolbar.providerVersionSearch')"
        spellcheck="false"
      />
      <div v-if="filtered.length" class="provider-list">
        <button
          v-for="ver in filtered"
          :key="ver"
          type="button"
          class="provider-item"
          :class="{ active: isActive(ver) }"
          @click="pick(ver)"
        >
          {{ ver }}
        </button>
      </div>
      <div v-else class="provider-empty">
        {{ t('toolbar.providerVersionEmpty') }}
      </div>
      <div v-if="!options.length" class="provider-empty">
        {{ t('toolbar.providerVersionUnavailable') }}
      </div>
    </div>
  </div>
</template>

<style scoped>
.provider-version-select {
  position: relative;
  display: flex;
  align-items: center;
  gap: 4px;
}
.provider-input {
  width: 112px;
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 7px 10px;
  font-size: 12.5px;
  font-weight: 600;
  font-family: var(--font-mono);
}
.provider-toggle {
  display: flex;
  align-items: center;
  justify-content: center;
  width: 26px;
  height: 32px;
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  border-radius: var(--radius-sm);
  padding: 0;
}
.provider-toggle:hover,
.provider-toggle.open {
  border-color: var(--plot);
}
.caret {
  width: 0;
  height: 0;
  border-left: 4px solid transparent;
  border-right: 4px solid transparent;
  border-top: 5px solid var(--ink-dim);
}
.provider-panel {
  position: absolute;
  top: calc(100% + 4px);
  right: 0;
  z-index: 60;
  width: 196px;
  padding: 6px;
  background: var(--surface-2);
  border: 1px solid var(--rule-strong);
  border-radius: var(--radius);
  box-shadow: var(--shadow-modal);
}
.provider-search {
  width: 100%;
  border: 1px solid var(--rule-strong);
  background: var(--surface);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 12px;
  margin-bottom: 6px;
}
.provider-list {
  max-height: 260px;
  overflow-y: auto;
}
.provider-item {
  display: block;
  width: 100%;
  text-align: left;
  border: none;
  background: transparent;
  color: var(--ink-2);
  border-radius: var(--radius-sm);
  padding: 5px 8px;
  font-size: 12px;
  font-family: var(--font-mono);
}
.provider-item:hover {
  background: var(--paper);
  color: var(--ink);
}
.provider-item.active {
  background: var(--plot-soft);
  color: var(--plot);
  font-weight: 600;
}
.provider-empty {
  padding: 8px;
  font-size: 12px;
  color: var(--ink-dim);
  text-align: center;
}
</style>
