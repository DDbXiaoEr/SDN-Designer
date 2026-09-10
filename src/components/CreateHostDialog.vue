<script setup>
import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits(['confirm', 'cancel'])
const { t } = useI18n()

const error = ref('')

const form = reactive({
  name: 'host1',
  encapType: 'geneve',
  nics: [{ name: 'eth0', ip: '192.168.1.10', tunnel: true }],
})

function addNic() {
  form.nics.push({ name: `eth${form.nics.length}`, ip: '', tunnel: false })
}

function removeNic(i) {
  form.nics.splice(i, 1)
}

function confirm() {
  const name = form.name.trim()
  if (!name) {
    error.value = t('createHost.errors.nameRequired')
    return
  }
  const nics = form.nics.filter((n) => n.name.trim() || n.ip.trim())
  if (nics.length === 0) {
    error.value = t('createHost.errors.nicRequired')
    return
  }
  for (const n of nics) {
    if (!n.name.trim()) {
      error.value = t('createHost.errors.nicNameRequired')
      return
    }
    if (!n.ip.trim()) {
      error.value = t('createHost.errors.nicIpRequired', { name: n.name })
      return
    }
  }
  emit('confirm', {
    name,
    encapType: form.encapType,
    nics: nics.map((n) => ({ name: n.name.trim(), ip: n.ip.trim(), tunnel: !!n.tunnel })),
  })
}
</script>

<template>
  <div class="overlay" @click.self="emit('cancel')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">{{ t('createHost.title') }}</span>
        <button class="close" @click="emit('cancel')">{{ t('common.cancel') }}</button>
      </div>

      <div class="modal-body">
        <div class="field">
          <label>{{ t('createHost.name') }}</label>
          <input v-model="form.name" placeholder="host1" />
        </div>

        <div class="field">
          <label>{{ t('createHost.encapType') }}</label>
          <select v-model="form.encapType">
            <option value="geneve">Geneve</option>
            <option value="vxlan">VXLAN</option>
            <option value="stt">STT</option>
          </select>
        </div>

        <div class="field">
          <label>{{ t('createHost.nicInfo') }}</label>
          <div v-for="(nic, i) in form.nics" :key="i" class="nic">
            <div class="nic-row">
              <input v-model="nic.name" :placeholder="t('createHost.nicNamePlaceholder')" />
              <input v-model="nic.ip" :placeholder="t('createHost.ipPlaceholder')" />
            </div>
            <label class="nic-tunnel">
              <input type="checkbox" v-model="nic.tunnel" />
              {{ t('createHost.tunnelNic') }}
              <button class="mini danger" @click="removeNic(i)">{{ t('common.delete') }}</button>
            </label>
          </div>
          <button class="add" @click="addNic">{{ t('createHost.addNic') }}</button>
        </div>

        <p v-if="error" class="error">{{ error }}</p>
      </div>

      <div class="modal-footer">
        <button class="ghost" @click="emit('cancel')">{{ t('common.cancel') }}</button>
        <button class="primary" @click="confirm">{{ t('common.confirm') }}</button>
      </div>
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
  width: min(460px, 90vw);
  max-height: 80vh;
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
.modal-body {
  padding: 16px;
  overflow-y: auto;
}
.modal-footer {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
  padding: 14px 16px;
  border-top: 1px solid var(--border);
}
.field {
  margin-bottom: 14px;
}
.field > label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 6px;
  font-weight: 600;
}
input,
select {
  width: 100%;
  padding: 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  font-size: 13px;
}
.nic {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.nic-row {
  display: flex;
  gap: 6px;
}
.nic-row > input {
  flex: 1;
  min-width: 0;
}
.nic-tunnel {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 12px;
  color: var(--text-dim);
}
.nic-tunnel input {
  width: auto;
}
.nic-tunnel .mini {
  margin-left: auto;
}
button {
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  border-radius: 6px;
  padding: 7px 14px;
  font-size: 13px;
}
button.close {
  color: var(--text-dim);
  padding: 4px 10px;
}
button.mini {
  padding: 4px 8px;
  font-size: 11px;
}
button.danger {
  color: var(--danger);
}
button.add {
  width: 100%;
  color: var(--accent);
}
button.ghost {
  color: var(--text-dim);
}
button.primary {
  background: var(--accent);
  border-color: var(--accent);
  color: #0f1117;
  font-weight: 700;
}
.error {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}
</style>
