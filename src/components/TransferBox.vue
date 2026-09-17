<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'

const props = defineProps({
  options: { type: Array, default: () => [] },
  modelValue: { type: Array, default: () => [] },
  leftTitle: { type: String, default: '' },
  rightTitle: { type: String, default: '' },
})
const emit = defineEmits(['update:modelValue'])
const { t } = useI18n()

const checkedLeft = ref([])
const checkedRight = ref([])

// 已选项可能因连线变动不再在候选中，仍按 value 展示，避免出现"幽灵"后端
const allOptions = computed(() => {
  const known = new Set(props.options.map((o) => o.value))
  const extra = props.modelValue.filter((v) => !known.has(v)).map((v) => ({ value: v, label: v }))
  return [...props.options, ...extra]
})
const selected = computed(() => new Set(props.modelValue))
const left = computed(() => allOptions.value.filter((o) => !selected.value.has(o.value)))
const right = computed(() => allOptions.value.filter((o) => selected.value.has(o.value)))

function toggle(target, value, checked) {
  const list = target === 'left' ? checkedLeft : checkedRight
  const next = new Set(list.value)
  if (checked) next.add(value)
  else next.delete(value)
  list.value = [...next]
}

function moveRight() {
  if (!checkedLeft.value.length) return
  emit('update:modelValue', [...props.modelValue, ...checkedLeft.value])
  checkedLeft.value = []
}

function moveLeft() {
  if (!checkedRight.value.length) return
  const drop = new Set(checkedRight.value)
  emit('update:modelValue', props.modelValue.filter((v) => !drop.has(v)))
  checkedRight.value = []
}
</script>

<template>
  <div class="transfer">
    <div class="transfer-panel">
      <div class="transfer-title">{{ leftTitle }}</div>
      <ul class="transfer-list">
        <li v-for="o in left" :key="o.value">
          <label>
            <input
              type="checkbox"
              :checked="checkedLeft.includes(o.value)"
              @change="toggle('left', o.value, $event.target.checked)"
            />
            <span class="transfer-label">{{ o.label }}</span>
          </label>
        </li>
        <li v-if="!left.length" class="transfer-empty">{{ t('common.none') }}</li>
      </ul>
    </div>

    <div class="transfer-actions">
      <button
        type="button"
        :disabled="!checkedLeft.length"
        :title="t('transfer.add')"
        @click="moveRight"
      >
        &gt;
      </button>
      <button
        type="button"
        :disabled="!checkedRight.length"
        :title="t('transfer.remove')"
        @click="moveLeft"
      >
        &lt;
      </button>
    </div>

    <div class="transfer-panel">
      <div class="transfer-title">{{ rightTitle }}</div>
      <ul class="transfer-list">
        <li v-for="o in right" :key="o.value">
          <label>
            <input
              type="checkbox"
              :checked="checkedRight.includes(o.value)"
              @change="toggle('right', o.value, $event.target.checked)"
            />
            <span class="transfer-label">{{ o.label }}</span>
          </label>
        </li>
        <li v-if="!right.length" class="transfer-empty">{{ t('common.none') }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.transfer {
  display: flex;
  align-items: stretch;
  gap: 6px;
}
.transfer-panel {
  flex: 1;
  min-width: 0;
  border: 1px solid var(--border);
  border-radius: 6px;
  background: var(--panel);
  overflow: hidden;
}
.transfer-title {
  padding: 4px 8px;
  font-size: 11px;
  color: var(--text-dim);
  border-bottom: 1px solid var(--border);
}
.transfer-list {
  list-style: none;
  margin: 0;
  padding: 4px;
  max-height: 120px;
  overflow-y: auto;
}
.transfer-list li {
  padding: 2px 4px;
}
.transfer-list label {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  cursor: pointer;
}
.transfer-list input {
  width: auto;
}
.transfer-label {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
.transfer-empty {
  color: var(--text-dim);
  font-size: 11px;
}
.transfer-actions {
  display: flex;
  flex-direction: column;
  justify-content: center;
  gap: 6px;
}
.transfer-actions button {
  width: 30px;
  padding: 4px 0;
}
.transfer-actions button:disabled {
  opacity: 0.4;
  cursor: default;
}
</style>
