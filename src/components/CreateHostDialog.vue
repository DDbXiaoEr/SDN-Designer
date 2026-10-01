<script setup>
import { ref, reactive } from 'vue'
import { useI18n } from 'vue-i18n'

const emit = defineEmits(['confirm', 'cancel'])
const { t } = useI18n()

const error = ref('')

const form = reactive({
  name: 'host1',
  encapType: 'geneve',
  nics: [{ name: 'eth0', ip: '192.168.1.10', role: 'tunnel' }],
})

function addNic() {
  form.nics.push({ name: `eth${form.nics.length}`, ip: '', role: 'mgmt' })
}

function removeNic(i) {
  form.nics.splice(i, 1)
}

function onRoleChange(nic, role) {
  nic.role = role
  if (role === 'external') {
    if (!nic.bridge) nic.bridge = 'br-ex'
    if (!nic.networkName) nic.networkName = 'external'
  } else {
    delete nic.bridge
    delete nic.networkName
  }
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
    if (n.role === 'tunnel' && !n.ip.trim()) {
      error.value = t('createHost.errors.tunnelNicIpRequired', { name: n.name })
      return
    }
  }
  emit('confirm', {
    name,
    encapType: form.encapType,
    nics: nics.map((n) => {
      const out = { name: n.name.trim(), ip: n.ip.trim(), role: n.role || 'mgmt' }
      if (out.role === 'external') {
        out.bridge = (n.bridge || 'br-ex').trim()
        out.networkName = (n.networkName || 'external').trim()
      }
      return out
    }),
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
            <div class="nic-row">
              <select :value="nic.role || 'mgmt'" @change="onRoleChange(nic, $event.target.value)">
                <option value="tunnel">{{ t('createHost.nicRoles.tunnel') }}</option>
                <option value="external">{{ t('createHost.nicRoles.external') }}</option>
                <option value="mgmt">{{ t('createHost.nicRoles.mgmt') }}</option>
              </select>
              <button class="mini danger" @click="removeNic(i)">{{ t('common.delete') }}</button>
            </div>
            <div v-if="(nic.role || 'mgmt') === 'external'" class="nic-row">
              <input v-model="nic.networkName" :placeholder="t('createHost.nicNetworkNamePlaceholder')" />
              <input v-model="nic.bridge" :placeholder="t('createHost.nicBridgePlaceholder')" />
            </div>
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
input,
select {
  width: 100%;
  padding: 8px;
  border-radius: var(--radius-sm);
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  font-size: 12.5px;
}
input[type='checkbox'] {
  width: auto;
}
input::placeholder {
  color: var(--ink-dim);
}
.nic {
  background: var(--surface-2);
  border: 1px solid var(--rule);
  border-radius: var(--radius);
  padding: 10px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 8px;
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
  color: var(--ink-dim);
}
.nic-tunnel .mini {
  margin-left: auto;
}
button {
  border: 1px solid var(--rule-strong);
  background: var(--surface-2);
  color: var(--ink);
  border-radius: var(--radius-sm);
  padding: 7px 14px;
  font-size: 12.5px;
  font-weight: 600;
  transition: border-color 0.12s ease, background 0.12s ease, color 0.12s ease;
}
button:hover {
  border-color: var(--ink-2);
}
button.close {
  color: var(--ink-dim);
  border-color: transparent;
  background: transparent;
  padding: 5px 8px;
}
button.mini {
  padding: 4px 8px;
  font-size: 11px;
}
button.danger {
  color: var(--danger);
  border-color: var(--danger-line);
}
button.danger:hover {
  background: var(--danger);
  color: #fff;
  border-color: var(--danger);
}
button.add {
  width: 100%;
  color: var(--plot);
  border-color: var(--plot);
  background: var(--plot-soft);
}
button.ghost {
  color: var(--ink-dim);
  background: transparent;
}
button.primary {
  background: var(--plot);
  border-color: var(--plot);
  color: #fff;
  font-weight: 600;
}
button.primary:hover {
  background: #17489f;
  border-color: #17489f;
}
.error {
  color: var(--danger);
  font-size: 12px;
  margin: 0;
}
</style>
