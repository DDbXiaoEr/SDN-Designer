<script setup>
import { computed, ref } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { diskTypeOptions, defaultDiskType } from '../data/disks.js'
import { outputOptions } from '../data/outputs.js'
import { nodeLabelKey } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'
import { useDesigner } from '../store/designer.js'
import { instanceTypeZones } from '../store/catalog.js'
import { resolveZone, validateInstanceZones } from '../export/terraform/common.js'

const props = defineProps({
  nodeId: { type: String, required: true },
})

const emit = defineEmits(['close'])
const { t, te } = useI18n()
const { nodes, edges, updateNodeData } = useDesigner()

const node = computed(() => nodes.value.find((n) => n.id === props.nodeId))
const def = computed(() => (node.value ? NODE_TYPES[node.value.type] : null))

// 实例是否已连接 KeyPair 节点（Instance -> KeyPair）；连接后登录密钥对由该节点提供
const hasKeyPairNode = computed(() => {
  if (!node.value || node.value.type !== 'Instance') return false
  return edges.value.some((e) => {
    if (e.source !== node.value.id) return false
    const target = nodes.value.find((n) => n.id === e.target)
    return target && target.type === 'KeyPair'
  })
})

// 从连线中找指向 nodeId 的指定类型源节点（如 Subnet -> Instance、VPC -> Subnet）
function sourceNodeOf(nodeId, type) {
  for (const e of edges.value) {
    if (e.target !== nodeId) continue
    const src = nodes.value.find((n) => n.id === e.source)
    if (src && src.type === type) return src
  }
  return null
}

// 实例关联的子网（Subnet -> Instance）及其所属 VPC（VPC -> Subnet）
const instanceSubnet = computed(() =>
  node.value && node.value.type === 'Instance' ? sourceNodeOf(node.value.id, 'Subnet') : null
)
const instanceVpc = computed(() =>
  instanceSubnet.value ? sourceNodeOf(instanceSubnet.value.id, 'VPC') : null
)

// 可用区库存校验：腾讯云 CVM 必须与子网同可用区，故提示需改子网可用区而非实例
const instanceZoneCheck = computed(() => {
  if (!node.value || node.value.type !== 'Instance') return null
  const type = node.value.data.instanceType
  const zones = instanceTypeZones(vendor.value, type)
  if (!zones.length) return null
  const subnet = instanceSubnet.value
  if (!subnet) return { state: 'noSubnet', type }
  const region = (instanceVpc.value && instanceVpc.value.data.region) || ''
  const rawZone = String(subnet.data.zone || '').trim()
  if (!region || !rawZone) return null
  const az = resolveZone(rawZone, region, vendor.value)
  if (zones.includes(az)) return null
  const sameRegion = zones.filter((z) => z === resolveZone(z, region, vendor.value))
  return sameRegion.length
    ? { state: 'zoneUnavailable', type, zone: az, sameRegion }
    : { state: 'regionUnavailable', type, region }
})

function applySubnetZone(zone) {
  if (instanceSubnet.value) updateNodeData(instanceSubnet.value.id, { zone })
}

// 子网下的实例规格库存：编辑子网可用区（部署可用区）时即时提示无货实例
const subnetStockIssues = computed(() => {
  if (!node.value || node.value.type !== 'Subnet') return []
  return validateInstanceZones(nodes.value, edges.value, vendor.value, (type) =>
    instanceTypeZones(vendor.value, type)
  ).filter((it) => it.subnetId === node.value.id)
})

function isFieldVisible(f) {
  if (f.when && !f.when(node.value.data)) return false
  // 已连接 KeyPair 节点时隐藏内联「登录密钥对」字段，避免与节点冲突
  if (f.key === 'keyPair' && hasKeyPairNode.value) return false
  return true
}

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

// combo 字段（镜像/实例规格）用「下拉 + 可手输」：选择列表项，或选「自定义」后手动输入
const CUSTOM = '__custom__'
const customMode = ref({})

function comboOptions(f) {
  return typeof f.options === 'function' ? f.options(vendor.value) : f.options || []
}

// 当前值不在候选列表中，或用户显式选择了「自定义」
function isCustomCombo(f) {
  if (customMode.value[f.key]) return true
  const cur = node.value.data[f.key]
  return cur != null && cur !== '' && !comboOptions(f).some((o) => o.value === cur)
}

function onComboSelect(f, value) {
  if (value === CUSTOM) {
    customMode.value = { ...customMode.value, [f.key]: true }
    return
  }
  const next = { ...customMode.value }
  delete next[f.key]
  customMode.value = next
  patch(f.key, value)
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

const diskOptions = computed(() => diskTypeOptions(vendor.value))
const systemDisk = computed(() => {
  const d = node.value && node.value.data.systemDisk
  return d || { type: defaultDiskType(vendor.value), size: 40 }
})

function systemDiskPatch(key, value) {
  const cur = node.value.data.systemDisk || { type: defaultDiskType(vendor.value), size: 40 }
  patch('systemDisk', { ...cur, [key]: key === 'size' ? Number(value) : value })
}
function addDataDisk() {
  const disks = [...(node.value.data.dataDisks || [])]
  disks.push({ type: defaultDiskType(vendor.value), size: 100 })
  patch('dataDisks', disks)
}
function removeDataDisk(i) {
  const disks = [...(node.value.data.dataDisks || [])]
  disks.splice(i, 1)
  patch('dataDisks', disks)
}
function dataDiskPatch(i, key, value) {
  const disks = [...(node.value.data.dataDisks || [])]
  disks[i] = { ...disks[i], [key]: key === 'size' ? Number(value) : value }
  patch('dataDisks', disks)
}

// 「创建后获取」的可输出属性（按当前厂商/节点类型解析），勾选结果存入 data.outputs
const nodeOutputs = computed(() => (node.value ? outputOptions(vendor.value, node.value.type) : []))
const selectedOutputs = computed(() =>
  Array.isArray(node.value?.data.outputs) ? node.value.data.outputs : []
)

function toggleOutput(key, checked) {
  const next = new Set(selectedOutputs.value)
  if (checked) next.add(key)
  else next.delete(key)
  // 固定顺序，避免勾选顺序影响导出结果
  const ordered = nodeOutputs.value.map((o) => o.key).filter((k) => next.has(k))
  patch('outputs', ordered)
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
        <div v-for="f in def.fields" v-show="isFieldVisible(f)" :key="f.key" class="field">
          <label>{{ t(f.label) }}</label>
          <select v-if="f.type === 'select'" :value="node.data[f.key]" @change="patch(f.key, $event.target.value)">
            <option v-for="o in optionsFor(f)" :key="o.value" :value="o.value">{{ tl(o.label) }}</option>
          </select>
          <template v-else-if="f.type === 'combo'">
            <select
              :value="isCustomCombo(f) ? CUSTOM : node.data[f.key]"
              @change="onComboSelect(f, $event.target.value)"
            >
              <option v-for="o in comboOptions(f)" :key="o.value" :value="o.value">{{ tl(o.label) }}</option>
              <option :value="CUSTOM">{{ t('common.custom') }}</option>
            </select>
            <input
              v-if="isCustomCombo(f)"
              class="combo-custom"
              :placeholder="t('common.customValuePlaceholder')"
              :value="node.data[f.key]"
              @input="patch(f.key, $event.target.value)"
            />
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

        <p v-if="node.type === 'Instance' && hasKeyPairNode" class="section-hint">
          {{ t('inspector.keyPairFromNodeHint') }}
        </p>

        <div v-if="instanceZoneCheck" class="section stock">
          <div class="section-title">{{ t('inspector.instanceZoneTitle') }}</div>
          <p v-if="instanceZoneCheck.state === 'noSubnet'" class="section-hint">
            {{ t('inspector.instanceZoneNoSubnet') }}
          </p>
          <template v-else-if="instanceZoneCheck.state === 'zoneUnavailable'">
            <p class="section-hint warning">
              {{
                t('inspector.instanceZoneUnavailable', {
                  zone: instanceZoneCheck.zone,
                  type: instanceZoneCheck.type,
                  zones: instanceZoneCheck.sameRegion.join(', '),
                })
              }}
            </p>
            <button
              v-for="z in instanceZoneCheck.sameRegion"
              :key="z"
              class="mini"
              @click="applySubnetZone(z)"
            >
              {{ t('inspector.changeSubnetZone', { zone: z }) }}
            </button>
          </template>
          <p v-else-if="instanceZoneCheck.state === 'regionUnavailable'" class="section-hint warning">
            {{
              t('inspector.instanceZoneRegionUnavailable', {
                type: instanceZoneCheck.type,
                region: instanceZoneCheck.region,
              })
            }}
          </p>
        </div>

        <div v-if="subnetStockIssues.length" class="section stock">
          <div class="section-title">{{ t('inspector.subnetStockTitle') }}</div>
          <div v-for="issue in subnetStockIssues" :key="issue.nodeId" class="rule">
            <p class="section-hint warning">
              {{
                issue.sameRegion.length
                  ? t('inspector.subnetStockUnavailable', {
                      instance: issue.name,
                      type: issue.type,
                      zone: issue.zone,
                      zones: issue.sameRegion.join(', '),
                    })
                  : t('inspector.subnetStockRegionUnavailable', {
                      instance: issue.name,
                      type: issue.type,
                      region: issue.region,
                    })
              }}
            </p>
            <button
              v-for="z in issue.sameRegion"
              :key="z"
              class="mini"
              @click="patch('zone', z)"
            >
              {{ t('inspector.changeSubnetZone', { zone: z }) }}
            </button>
          </div>
        </div>

        <div v-if="node.type === 'Instance'" class="section">
          <div class="section-title">{{ t('inspector.systemDiskTitle') }}</div>
          <div class="rule">
            <div class="rule-row">
              <select :value="systemDisk.type" @change="systemDiskPatch('type', $event.target.value)">
                <option v-for="o in diskOptions" :key="o.value" :value="o.value">{{ tl(o.label) }}</option>
              </select>
              <input
                :placeholder="t('inspector.diskSizePlaceholder')"
                :value="systemDisk.size"
                @input="systemDiskPatch('size', $event.target.value)"
              />
            </div>
          </div>

          <div class="section-title">{{ t('inspector.dataDiskTitle') }}</div>
          <div v-for="(disk, i) in node.data.dataDisks || []" :key="i" class="rule">
            <div class="rule-row">
              <select :value="disk.type" @change="dataDiskPatch(i, 'type', $event.target.value)">
                <option v-for="o in diskOptions" :key="o.value" :value="o.value">{{ tl(o.label) }}</option>
              </select>
              <input
                :placeholder="t('inspector.diskSizePlaceholder')"
                :value="disk.size"
                @input="dataDiskPatch(i, 'size', $event.target.value)"
              />
            </div>
            <button class="mini danger" @click="removeDataDisk(i)">{{ t('common.delete') }}</button>
          </div>
          <button class="add" @click="addDataDisk">{{ t('inspector.addDataDisk') }}</button>
        </div>

        <div v-if="nodeOutputs.length" class="section">
          <div class="section-title">{{ t('inspector.outputsTitle') }}</div>
          <p class="section-hint">{{ t('inspector.outputsHint') }}</p>
          <label v-for="o in nodeOutputs" :key="o.key" class="output-option">
            <input
              type="checkbox"
              :checked="selectedOutputs.includes(o.key)"
              @change="toggleOutput(o.key, $event.target.checked)"
            />
            {{ tl(o.label) }}
          </label>
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
.combo-custom {
  margin-top: 6px;
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
.section-hint {
  margin: 0 0 8px;
  font-size: 11px;
  line-height: 1.5;
  color: var(--text-dim);
}
.section-hint.warning {
  color: var(--danger);
}
.stock .mini {
  margin: 4px 6px 0 0;
}
.output-option {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 12px;
  padding: 4px 0;
  cursor: pointer;
}
.output-option input {
  width: auto;
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
