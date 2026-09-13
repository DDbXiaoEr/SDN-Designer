<script setup>
import { computed } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { nodeLabelKey } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'
import { useDesigner } from '../store/designer.js'

const props = defineProps({
  nodeId: { type: String, required: true },
})

const emit = defineEmits(['close'])
const { t, te } = useI18n()
const { nodes, updateNodeData } = useDesigner()

const node = computed(() => nodes.value.find((n) => n.id === props.nodeId))
const def = computed(() => (node.value ? NODE_TYPES[node.value.type] : null))

function tl(s) {
  return s && te(s) ? t(s) : s
}

function patch(key, value) {
  if (node.value) updateNodeData(node.value.id, { [key]: value })
}

function optionsFor(f) {
  const opts = typeof f.options === 'function' ? f.options(vendor.value) : f.options || []
  const cur = node.value.data[f.key]
  if (cur != null && cur !== '' && !opts.some((o) => o.value === cur)) {
    return [{ value: cur, label: cur }, ...opts]
  }
  return opts
}

function patchController(value) {
  patch('controller', value)
  if (!value) return
  for (const n of nodes.value) {
    if (n.type === 'Host' && n.id !== node.value.id && n.data.controller) {
      updateNodeData(n.id, { controller: false })
    }
  }
}

function addRule() {
  const rules = [...(node.value.data.rules || [])]
  rules.push({ direction: 'ingress', protocol: 'tcp', port: '22/22', cidr: '0.0.0.0/0', description: '' })
  patch('rules', rules)
}
function removeRule(i) {
  const rules = [...(node.value.data.rules || [])]
  rules.splice(i, 1)
  patch('rules', rules)
}
function rulePatch(i, key, value) {
  const rules = [...(node.value.data.rules || [])]
  rules[i] = { ...rules[i], [key]: value }
  patch('rules', rules)
}

function addRoute() {
  const routes = [...(node.value.data.routes || [])]
  routes.push({ destination: '0.0.0.0/0', nextHopType: 'NatGateway', nextHop: '' })
  patch('routes', routes)
}
function removeRoute(i) {
  const routes = [...(node.value.data.routes || [])]
  routes.splice(i, 1)
  patch('routes', routes)
}
function routePatch(i, key, value) {
  const routes = [...(node.value.data.routes || [])]
  routes[i] = { ...routes[i], [key]: value }
  patch('routes', routes)
}

function addNic() {
  const nics = [...(node.value.data.nics || [])]
  nics.push({ name: `eth${nics.length}`, ip: '', tunnel: false })
  patch('nics', nics)
}
function removeNic(i) {
  const nics = [...(node.value.data.nics || [])]
  nics.splice(i, 1)
  patch('nics', nics)
}
function nicPatch(i, key, value) {
  const nics = [...(node.value.data.nics || [])]
  nics[i] = { ...nics[i], [key]: value }
  patch('nics', nics)
}
</script>

<template>
  <div v-if="node && def" class="overlay" @click.self="emit('close')">
    <div class="modal">
      <div class="modal-header">
        <span class="modal-title">{{ t(nodeLabelKey(def, vendor)) }}</span>
        <span class="modal-id">{{ node.id }}</span>
        <button class="close" @click="emit('close')">{{ t('common.close') }}</button>
      </div>

      <div class="modal-body">
        <div v-for="f in def.fields" v-show="!f.when || f.when(node.data)" :key="f.key" class="field">
          <label>{{ t(f.label) }}</label>
          <select v-if="f.type === 'select'" :value="node.data[f.key]" @change="patch(f.key, $event.target.value)">
            <option v-for="o in optionsFor(f)" :key="o.value" :value="o.value">{{ tl(o.label) }}</option>
          </select>
          <template v-else-if="f.type === 'combo'">
            <input
              :list="`combo-${node.id}-${f.key}`"
              :value="node.data[f.key]"
              @input="patch(f.key, $event.target.value)"
            />
            <datalist :id="`combo-${node.id}-${f.key}`">
              <option v-for="o in optionsFor(f)" :key="o.value" :value="o.value">{{ tl(o.label) }}</option>
            </datalist>
          </template>
          <input
            v-else-if="f.type === 'checkbox'"
            type="checkbox"
            :checked="node.data[f.key]"
            @change="f.key === 'controller' ? patchController($event.target.checked) : patch(f.key, $event.target.checked)"
          />
          <input
            v-else-if="f.type === 'password'"
            type="password"
            :value="node.data[f.key]"
            @input="patch(f.key, $event.target.value)"
          />
          <input v-else :value="node.data[f.key]" @input="patch(f.key, $event.target.value)" />
        </div>

        <div v-if="node.type === 'Host'" class="section">
          <div class="section-title">{{ t('inspector.nicListTitle') }}</div>
          <div v-for="(nic, i) in node.data.nics" :key="i" class="rule">
            <div class="rule-row">
              <input :placeholder="t('inspector.nicNamePlaceholder')" :value="nic.name" @input="nicPatch(i, 'name', $event.target.value)" />
              <input :placeholder="t('inspector.ipPlaceholder')" :value="nic.ip" @input="nicPatch(i, 'ip', $event.target.value)" />
            </div>
            <label class="nic-tunnel">
              <input type="checkbox" :checked="nic.tunnel" @change="nicPatch(i, 'tunnel', $event.target.checked)" />
              {{ t('inspector.tunnelNic') }}
              <button class="mini danger" @click="removeNic(i)">{{ t('common.delete') }}</button>
            </label>
          </div>
          <button class="add" @click="addNic">{{ t('inspector.addNic') }}</button>
        </div>

        <div v-if="node.type === 'SecurityGroup'" class="section">
          <div class="section-title">{{ t('inspector.sgRulesTitle') }}</div>
          <div v-for="(rule, i) in node.data.rules" :key="i" class="rule">
            <div class="rule-row">
              <select :value="rule.direction" @change="rulePatch(i, 'direction', $event.target.value)">
                <option value="ingress">{{ t('inspector.ingress') }}</option>
                <option value="egress">{{ t('inspector.egress') }}</option>
              </select>
              <select :value="rule.protocol" @change="rulePatch(i, 'protocol', $event.target.value)">
                <option value="tcp">TCP</option>
                <option value="udp">UDP</option>
                <option value="icmp">ICMP</option>
                <option value="all">ALL</option>
              </select>
            </div>
            <div class="rule-row">
              <input :placeholder="t('inspector.portPlaceholder')" :value="rule.port" @input="rulePatch(i, 'port', $event.target.value)" />
              <input :placeholder="t('inspector.cidrPlaceholder')" :value="rule.cidr" @input="rulePatch(i, 'cidr', $event.target.value)" />
            </div>
            <input :placeholder="t('inspector.description')" :value="rule.description" @input="rulePatch(i, 'description', $event.target.value)" />
            <button class="mini danger" @click="removeRule(i)">{{ t('inspector.deleteRule') }}</button>
          </div>
          <button class="add" @click="addRule">{{ t('inspector.addRule') }}</button>
        </div>

        <div v-if="node.type === 'RouteTable'" class="section">
          <div class="section-title">{{ t('inspector.routeEntriesTitle') }}</div>
          <div v-for="(route, i) in node.data.routes" :key="i" class="rule">
            <div class="rule-row">
              <input :placeholder="t('inspector.destinationPlaceholder')" :value="route.destination" @input="routePatch(i, 'destination', $event.target.value)" />
              <select :value="route.nextHopType" @change="routePatch(i, 'nextHopType', $event.target.value)">
                <option value="NatGateway">{{ t('inspector.natGateway') }}</option>
                <option value="Instance">{{ t('inspector.ecsInstance') }}</option>
                <option value="VpnGateway">{{ t('inspector.vpnGateway') }}</option>
              </select>
            </div>
            <input :placeholder="t('inspector.nextHopPlaceholder')" :value="route.nextHop" @input="routePatch(i, 'nextHop', $event.target.value)" />
            <button class="mini danger" @click="removeRoute(i)">{{ t('inspector.deleteEntry') }}</button>
          </div>
          <button class="add" @click="addRoute">{{ t('inspector.addEntry') }}</button>
        </div>
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
  width: min(720px, 92vw);
  max-height: 85vh;
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
  gap: 10px;
  padding: 14px 16px;
  border-bottom: 1px solid var(--border);
}
.modal-title {
  font-weight: 700;
  font-size: 15px;
}
.modal-id {
  font-size: 11px;
  color: var(--text-dim);
  font-family: monospace;
}
.modal-header .close {
  margin-left: auto;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text-dim);
  border-radius: 6px;
  padding: 6px 12px;
  font-size: 12px;
}
.modal-body {
  flex: 1;
  overflow-y: auto;
  padding: 16px;
}
.field {
  margin-bottom: 12px;
}
.field label {
  display: block;
  font-size: 11px;
  color: var(--text-dim);
  margin-bottom: 4px;
}
.field input,
.field select,
.rule input,
.rule select {
  width: 100%;
  padding: 7px 8px;
  border-radius: 6px;
  border: 1px solid var(--border);
  background: var(--panel-2);
  color: var(--text);
  font-size: 12px;
}
.field input[type='checkbox'] {
  width: auto;
}
.section {
  margin-top: 16px;
  border-top: 1px solid var(--border);
  padding-top: 12px;
}
.section-title {
  font-size: 12px;
  font-weight: 700;
  margin-bottom: 8px;
}
.rule {
  background: var(--panel-2);
  border: 1px solid var(--border);
  border-radius: 8px;
  padding: 8px;
  margin-bottom: 8px;
  display: flex;
  flex-direction: column;
  gap: 6px;
}
.rule-row {
  display: flex;
  gap: 6px;
}
.rule-row > * {
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
  padding: 6px 10px;
  font-size: 12px;
}
button.danger {
  color: var(--danger);
}
button.mini {
  padding: 4px 8px;
  font-size: 11px;
}
button.add {
  width: 100%;
  color: var(--accent);
}
</style>
