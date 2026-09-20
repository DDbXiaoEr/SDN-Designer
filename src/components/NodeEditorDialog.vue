<script setup>
import { computed, ref, watch } from 'vue'
import { useI18n } from 'vue-i18n'
import { NODE_TYPES } from '../data/nodeDefinitions.js'
import { diskTypeOptions, defaultDiskType } from '../data/disks.js'
import { outputOptions } from '../data/outputs.js'
import { nodeLabelKey } from '../data/vendors.js'
import { vendor } from '../store/vendor.js'
import { useDesigner } from '../store/designer.js'
import { instanceTypeZones } from '../store/catalog.js'
import { resolveZone, validateInstanceZones, createCloudContext, lbBackendCandidates, lbHealthCheck, instanceCount, eipInstanceCandidates, eipBindings } from '../export/terraform/common.js'
import TransferBox from './TransferBox.vue'

const props = defineProps({
  nodeId: { type: String, required: true },
})

const emit = defineEmits(['close'])
const { t, te } = useI18n()
const { nodes, edges, updateNodeData } = useDesigner()

const node = computed(() => nodes.value.find((n) => n.id === props.nodeId))
const def = computed(() => (node.value ? NODE_TYPES[node.value.type] : null))

// 实例关联的 KeyPair 节点（兼容两种连线方向）；连接后登录密钥对由该节点提供
const linkedKeyPair = computed(() => {
  if (!node.value || node.value.type !== 'Instance') return null
  const id = node.value.id
  for (const e of edges.value) {
    const otherId = e.source === id ? e.target : e.target === id ? e.source : null
    if (!otherId) continue
    const other = nodes.value.find((n) => n.id === otherId)
    if (other && other.type === 'KeyPair') return other
  }
  return null
})
const hasKeyPairNode = computed(() => !!linkedKeyPair.value)

// 已连接密钥对节点时，登录方式固定为密钥登录（写回数据，保持与导出逻辑一致）
watch(
  linkedKeyPair,
  (kp) => {
    if (kp && node.value && node.value.data.loginType !== 'keyPair') {
      patch('loginType', 'keyPair')
    }
  },
  { immediate: true }
)

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

// 负载均衡后端候选：来自直接连接的 ECS 及接入的子网/VPC 内的所有 ECS（多实例按序展开）
const lbCandidates = computed(() => {
  if (!node.value || node.value.type !== 'LoadBalancer') return []
  const ctx = createCloudContext(nodes.value, edges.value, {})
  return lbBackendCandidates(ctx, node.value).map((inst) => ({
    value: `${inst.id}#${inst.index}`,
    label: inst.ip ? `${inst.name} (${inst.ip})` : inst.name,
  }))
})

// EIP 直连实例的可绑定候选（多实例按序展开为「名称-序号 (内网 IP)」）
const eipCandidates = computed(() => {
  if (!node.value || node.value.type !== 'Eip') return []
  const ctx = createCloudContext(nodes.value, edges.value, {})
  return eipInstanceCandidates(ctx, node.value)
})

const eipCount = computed(() =>
  node.value && node.value.type === 'Eip' ? instanceCount(node.value) : 1
)

// 归一化后的绑定（含默认按序回退），用于回显每个 EIP 的下拉
const eipResolved = computed(() =>
  node.value && node.value.type === 'Eip' ? eipBindings(node.value, eipCandidates.value) : []
)

function eipSelectValue(i) {
  const b = eipResolved.value[i]
  return b ? `${b.id}#${b.index}` : ''
}

function setEipBinding(i, value) {
  const cur = node.value.data.bindings
  const raw = cur && !Array.isArray(cur) && typeof cur === 'object' ? { ...cur } : {}
  if (value) {
    const [id, index] = value.split('#')
    raw[i] = { id, index: Number(index) || 0 }
  } else {
    // null 表示显式不绑定（缺省键才是「未设置，按序回退」）
    raw[i] = null
  }
  patch('bindings', raw)
}

// 各厂商支持的负载均衡类型（腾讯云无 NLB；ALB 暂无 Terraform 资源）
const LB_TYPES = {
  aliyun: ['clb', 'alb', 'nlb', 'gwlb'],
  tencent: ['clb', 'gwlb', 'alb'],
}
// 各厂商各类型支持的监听协议（gwlb 固定 GENEVE）
const LB_PROTOCOLS = {
  aliyun: {
    clb: ['tcp', 'udp', 'http', 'https'],
    alb: ['http', 'https', 'quic'],
    nlb: ['tcp', 'udp', 'tcpssl'],
    gwlb: ['geneve'],
  },
  tencent: {
    clb: ['tcp', 'udp', 'http', 'https'],
    alb: ['http', 'https'],
    gwlb: ['geneve'],
  },
}
// 各厂商各类型支持的健康检查协议
const LB_HEALTH_PROTOCOLS = {
  aliyun: {
    clb: ['tcp', 'http', 'https'],
    alb: ['http', 'https', 'tcp'],
    nlb: ['tcp', 'http'],
    gwlb: ['tcp', 'http'],
  },
  tencent: {
    clb: ['tcp', 'http', 'https'],
    alb: ['http', 'https'],
    gwlb: ['tcp'],
  },
}
// IP 协议版本（缺省表示该类型不暴露该字段）
const LB_IP_VERSIONS = {
  aliyun: {
    alb: ['IPv4', 'DualStack'],
    nlb: ['ipv4', 'DualStack'],
    gwlb: ['Ipv4'],
  },
  tencent: {},
}
// 调度算法（取值随厂商/类型不同，导出时原样使用）
const LB_SCHEDULERS = {
  aliyun: {
    clb: ['wrr', 'rr', 'wlc', 'sch'],
    alb: ['Wrr', 'Wlc', 'Sch'],
    nlb: ['Wrr', 'Rr', 'Sch', 'Tch', 'Qch'],
    gwlb: ['5TCH', '3TCH', '2TCH'],
  },
  tencent: {},
}
const LB_SPECS = ['slb.s1.small', 'slb.s2.small', 'slb.s2.medium', 'slb.s3.small', 'slb.s3.medium', 'slb.s3.large']
const LB_EDITIONS = ['Basic', 'Standard']

// 负载均衡支持类型选择的厂商（阿里云 / 腾讯云）
const lbVendor = computed(() =>
  node.value && node.value.type === 'LoadBalancer' && ['aliyun', 'tencent'].includes(vendor.value)
    ? vendor.value
    : null
)
const isVendorLb = computed(() => !!lbVendor.value)
const isAliyunLb = computed(() => lbVendor.value === 'aliyun')
const isTencentLb = computed(() => lbVendor.value === 'tencent')
const lbConf = computed(() => (node.value && node.value.data.lbConfig) || {})
const lbTypeOptions = computed(() => (LB_TYPES[lbVendor.value] || []).map((t) => ({ value: t, label: `inspector.lbTypes.${t}` })))
const lbType = computed(() => {
  const list = LB_TYPES[lbVendor.value] || ['clb']
  const t = String(lbConf.value.type || 'clb').toLowerCase()
  return list.includes(t) ? t : list[0]
})
const lbProtocolOptions = computed(() => (LB_PROTOCOLS[lbVendor.value] || {})[lbType.value] || LB_PROTOCOLS.aliyun.clb)
const lbHealthProtocolOptions = computed(
  () => (LB_HEALTH_PROTOCOLS[lbVendor.value] || {})[lbType.value] || LB_HEALTH_PROTOCOLS.aliyun.clb
)
const lbIpVersionOptions = computed(() => (LB_IP_VERSIONS[lbVendor.value] || {})[lbType.value] || [])
const lbSchedulerOptions = computed(() => (LB_SCHEDULERS[lbVendor.value] || {})[lbType.value] || [])

function lbConfigPatch(key, value) {
  patch('lbConfig', { ...lbConf.value, [key]: value })
}

// 切换类型时，把不适用于新类型的监听/健康检查协议重置为该类型的首个可用值
function onLbTypeChange(value) {
  const v = lbVendor.value
  const type = String(value).toLowerCase()
  const protos = (LB_PROTOCOLS[v] || {})[type] || LB_PROTOCOLS.aliyun.clb
  const hcProtos = (LB_HEALTH_PROTOCOLS[v] || {})[type] || LB_HEALTH_PROTOCOLS.aliyun.clb
  const rules = (node.value.data.rules || []).map((r) => {
    const proto = protos.includes(String(r.protocol || '').toLowerCase()) ? r.protocol : protos[0]
    const hc = { ...lbHealthCheck(r) }
    if (!hcProtos.includes(hc.protocol)) hc.protocol = hcProtos[0]
    return { ...r, protocol: proto, healthCheck: hc }
  })
  patch('lbConfig', { ...lbConf.value, type })
  patch('rules', rules)
}

function addLbRule() {
  const rules = [...(node.value.data.rules || [])]
  rules.push({ protocol: lbProtocolOptions.value[0] || 'tcp', port: '80', backends: [], healthCheck: lbHealthCheck({}) })
  patch('rules', rules)
}
function removeLbRule(i) {
  const rules = [...(node.value.data.rules || [])]
  rules.splice(i, 1)
  patch('rules', rules)
}
function lbRulePatch(i, key, value) {
  const rules = [...(node.value.data.rules || [])]
  rules[i] = { ...rules[i], [key]: value }
  patch('rules', rules)
}

// 回显监听规则的健康检查（含默认值回退）
function lbHealth(rule) {
  return lbHealthCheck(rule)
}
// 修改某条监听规则的健康检查，仅写回 healthCheck 字段
function lbHealthPatch(i, key, value) {
  const rules = [...(node.value.data.rules || [])]
  const hc = { ...lbHealthCheck(rules[i]) }
  if (['enabled', 'protocol', 'method', 'path', 'body', 'port'].includes(key)) {
    hc[key] = value
  } else {
    hc[key] = Number(value) || 0
  }
  rules[i] = { ...rules[i], healthCheck: hc }
  patch('rules', rules)
}

function isFieldVisible(f) {
  // 已连接密钥对节点时，「登录密钥对」字段始终展示（只读显示节点名称）
  if (f.key === 'keyPair' && hasKeyPairNode.value) return true
  if (f.when && !f.when(node.value.data)) return false
  // 已连接密钥对节点时禁用密码登录，隐藏密码字段
  if (f.key === 'password' && hasKeyPairNode.value) return false
  return true
}

function tl(s) {
  return s && te(s) ? t(s) : s
}

// 多实例时 Instance/Eip 的「名称」实为名称前缀，标签随之调整
function fieldLabel(f) {
  const multi = node.value.type === 'Instance' || node.value.type === 'Eip'
  if (multi && f.key === 'name' && Number(node.value.data.count) > 1) {
    return t('fields.namePrefix')
  }
  return t(f.label)
}

function patch(key, value) {
  if (node.value) updateNodeData(node.value.id, { [key]: value })
}

function optionsFor(f) {
  const opts = typeof f.options === 'function' ? f.options(vendor.value) : f.options || []
  // 已连接密钥对节点时登录方式只能是密钥登录
  if (f.key === 'loginType' && hasKeyPairNode.value) {
    return opts.filter((o) => o.value === 'keyPair')
  }
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
          <label>{{ fieldLabel(f) }}</label>
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
            v-else-if="f.type === 'number'"
            type="number"
            min="1"
            step="1"
            :value="node.data[f.key] ?? 1"
            @input="patch(f.key, Number($event.target.value))"
          />
          <input
            v-else-if="f.type === 'password'"
            type="password"
            :value="node.data[f.key]"
            @input="patch(f.key, $event.target.value)"
          />
          <input
            v-else-if="f.key === 'keyPair' && hasKeyPairNode"
            :value="linkedKeyPair.data.name"
            disabled
          />
          <input v-else :value="node.data[f.key]" @input="patch(f.key, $event.target.value)" />
        </div>

        <p v-if="node.type === 'Instance' && hasKeyPairNode" class="section-hint">
          {{ t('inspector.keyPairFromNodeHint', { name: linkedKeyPair.data.name }) }}
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

        <div v-if="node.type === 'Eip' && eipCandidates.length" class="section">
          <div class="section-title">{{ t('inspector.eipBindingTitle') }}</div>
          <p class="section-hint">{{ t('inspector.eipBindingHint') }}</p>
          <div v-for="i in eipCount" :key="i - 1" class="rule">
            <div class="rule-row">
              <input v-if="eipCount > 1" :value="`EIP ${i}`" disabled />
              <select :value="eipSelectValue(i - 1)" @change="setEipBinding(i - 1, $event.target.value)">
                <option value="">{{ t('inspector.eipUnbound') }}</option>
                <option
                  v-for="c in eipCandidates"
                  :key="`${c.id}#${c.index}`"
                  :value="`${c.id}#${c.index}`"
                >
                  {{ c.ip ? `${c.name} (${c.ip})` : c.name }}
                </option>
              </select>
            </div>
          </div>
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

        <div v-if="isVendorLb" class="section">
          <div class="section-title">{{ t('inspector.lbTypeTitle') }}</div>
          <p class="section-hint">{{ t('inspector.lbTypeHint') }}</p>
          <div class="field">
            <label>{{ t('inspector.lbType') }}</label>
            <select :value="lbType" @change="onLbTypeChange($event.target.value)">
              <option v-for="o in lbTypeOptions" :key="o.value" :value="o.value">{{ t(o.label) }}</option>
            </select>
          </div>
          <p v-if="isTencentLb && lbType === 'alb'" class="section-hint warning">
            {{ t('inspector.lbAlbUnsupported') }}
          </p>
          <div class="hc-grid">
            <label v-if="isAliyunLb && lbType === 'clb'" class="hc-field">
              <span>{{ t('inspector.lbSpec') }}</span>
              <select :value="lbConf.spec || 'slb.s2.small'" @change="lbConfigPatch('spec', $event.target.value)">
                <option v-for="s in LB_SPECS" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label v-if="isAliyunLb && lbType === 'clb'" class="hc-field">
              <span>{{ t('inspector.lbInternetChargeType') }}</span>
              <select
                :value="lbConf.internetChargeType || 'paybytraffic'"
                @change="lbConfigPatch('internetChargeType', $event.target.value)"
              >
                <option value="paybytraffic">{{ t('inspector.lbChargeTraffic') }}</option>
                <option value="paybybandwidth">{{ t('inspector.lbChargeBandwidth') }}</option>
              </select>
            </label>
            <label v-if="isAliyunLb && lbType === 'clb'" class="hc-field">
              <span>{{ t('inspector.lbBandwidth') }}</span>
              <input
                type="number"
                min="1"
                :value="lbConf.bandwidth ?? 10"
                @input="lbConfigPatch('bandwidth', Number($event.target.value))"
              />
            </label>
            <label v-if="isAliyunLb && lbType === 'alb'" class="hc-field">
              <span>{{ t('inspector.lbEdition') }}</span>
              <select :value="lbConf.edition || 'Basic'" @change="lbConfigPatch('edition', $event.target.value)">
                <option v-for="e in LB_EDITIONS" :key="e" :value="e">{{ e }}</option>
              </select>
            </label>
            <label v-if="isAliyunLb && lbType === 'alb'" class="hc-field">
              <span>{{ t('inspector.lbAddressAllocatedMode') }}</span>
              <select
                :value="lbConf.addressAllocatedMode || 'Dynamic'"
                @change="lbConfigPatch('addressAllocatedMode', $event.target.value)"
              >
                <option value="Dynamic">{{ t('inspector.lbAllocatedDynamic') }}</option>
                <option value="Fixed">{{ t('inspector.lbAllocatedFixed') }}</option>
              </select>
            </label>
            <label v-if="isAliyunLb && lbType === 'gwlb'" class="hc-field">
              <span>{{ t('inspector.lbServerFailoverMode') }}</span>
              <select
                :value="lbConf.serverFailoverMode || 'NoRebalance'"
                @change="lbConfigPatch('serverFailoverMode', $event.target.value)"
              >
                <option value="NoRebalance">NoRebalance</option>
                <option value="Rebalance">Rebalance</option>
              </select>
            </label>
            <label v-if="isTencentLb && lbType === 'gwlb'" class="hc-field">
              <span>{{ t('inspector.lbGeneveProtocol') }}</span>
              <select
                :value="lbConf.geneveProtocol || 'TENCENT_GENEVE'"
                @change="lbConfigPatch('geneveProtocol', $event.target.value)"
              >
                <option value="TENCENT_GENEVE">TENCENT_GENEVE</option>
                <option value="AWS_GENEVE">AWS_GENEVE</option>
              </select>
            </label>
            <label v-if="lbIpVersionOptions.length" class="hc-field">
              <span>{{ t('inspector.lbIpVersion') }}</span>
              <select :value="lbConf.ipVersion" @change="lbConfigPatch('ipVersion', $event.target.value)">
                <option v-for="v in lbIpVersionOptions" :key="v" :value="v">{{ v }}</option>
              </select>
            </label>
            <label v-if="lbSchedulerOptions.length" class="hc-field">
              <span>{{ t('inspector.lbScheduler') }}</span>
              <select :value="lbConf.scheduler" @change="lbConfigPatch('scheduler', $event.target.value)">
                <option v-for="s in lbSchedulerOptions" :key="s" :value="s">{{ s }}</option>
              </select>
            </label>
            <label v-if="isAliyunLb && lbType === 'alb'" class="hc-field">
              <input
                type="checkbox"
                :checked="!!lbConf.stickySession"
                @change="lbConfigPatch('stickySession', $event.target.checked)"
              />
              {{ t('inspector.lbStickySession') }}
            </label>
            <label v-if="isAliyunLb && ['alb', 'nlb', 'gwlb'].includes(lbType)" class="hc-field">
              <input
                type="checkbox"
                :checked="!!lbConf.connectionDrain"
                @change="lbConfigPatch('connectionDrain', $event.target.checked)"
              />
              {{ t('inspector.lbConnectionDrain') }}
            </label>
            <label v-if="isAliyunLb && lbType === 'nlb'" class="hc-field">
              <input
                type="checkbox"
                :checked="lbConf.crossZone !== false"
                @change="lbConfigPatch('crossZone', $event.target.checked)"
              />
              {{ t('inspector.lbCrossZone') }}
            </label>
            <label v-if="isAliyunLb && lbType === 'nlb'" class="hc-field">
              <input
                type="checkbox"
                :checked="!!lbConf.preserveClientIp"
                @change="lbConfigPatch('preserveClientIp', $event.target.checked)"
              />
              {{ t('inspector.lbPreserveClientIp') }}
            </label>
            <label v-if="isAliyunLb && lbType === 'nlb'" class="hc-field">
              <input
                type="checkbox"
                :checked="!!lbConf.proxyProtocol"
                @change="lbConfigPatch('proxyProtocol', $event.target.checked)"
              />
              {{ t('inspector.lbProxyProtocol') }}
            </label>
          </div>
        </div>

        <div v-if="node.type === 'LoadBalancer'" class="section">
          <div class="section-title">{{ t('inspector.lbRulesTitle') }}</div>
          <p class="section-hint">{{ t('inspector.lbBackendHint') }}</p>
          <div v-for="(rule, i) in node.data.rules || []" :key="i" class="rule">
            <div class="rule-row">
              <input v-if="isVendorLb && lbType === 'gwlb'" value="GENEVE" disabled />
              <select v-else :value="rule.protocol" @change="lbRulePatch(i, 'protocol', $event.target.value)">
                <option v-for="p in lbProtocolOptions" :key="p" :value="p">{{ p.toUpperCase() }}</option>
              </select>
              <input
                :placeholder="t('inspector.lbPortPlaceholder')"
                :value="rule.port"
                @input="lbRulePatch(i, 'port', $event.target.value)"
              />
            </div>
            <TransferBox
              :options="lbCandidates"
              :model-value="rule.backends || []"
              :left-title="t('inspector.lbCandidates')"
              :right-title="t('inspector.lbSelected')"
              @update:model-value="lbRulePatch(i, 'backends', $event)"
            />
            <div class="hc">
              <label class="hc-head">
                <input
                  type="checkbox"
                  :checked="lbHealth(rule).enabled"
                  @change="lbHealthPatch(i, 'enabled', $event.target.checked)"
                />
                {{ t('inspector.lbHealthCheckTitle') }}
              </label>
              <template v-if="lbHealth(rule).enabled">
                <div class="hc-grid">
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthProtocol') }}</span>
                    <select :value="lbHealth(rule).protocol" @change="lbHealthPatch(i, 'protocol', $event.target.value)">
                      <option v-for="p in lbHealthProtocolOptions" :key="p" :value="p">{{ p.toUpperCase() }}</option>
                    </select>
                  </label>
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthPath') }}</span>
                    <input :value="lbHealth(rule).path" @input="lbHealthPatch(i, 'path', $event.target.value)" />
                  </label>
                  <label v-if="lbHealth(rule).protocol !== 'tcp'" class="hc-field">
                    <span>{{ t('inspector.lbHealthMethod') }}</span>
                    <select :value="lbHealth(rule).method" @change="lbHealthPatch(i, 'method', $event.target.value)">
                      <option value="GET">GET</option>
                      <option value="HEAD">HEAD</option>
                      <option value="POST">POST</option>
                    </select>
                  </label>
                  <label v-if="lbHealth(rule).protocol !== 'tcp'" class="hc-field wide">
                    <span>{{ t('inspector.lbHealthBody') }}</span>
                    <input
                      :placeholder="t('inspector.lbHealthBodyPlaceholder')"
                      :value="lbHealth(rule).body"
                      @input="lbHealthPatch(i, 'body', $event.target.value)"
                    />
                  </label>
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthPort') }}</span>
                    <input :value="lbHealth(rule).port" @input="lbHealthPatch(i, 'port', $event.target.value)" />
                  </label>
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthInterval') }}</span>
                    <input
                      type="number"
                      min="1"
                      :value="lbHealth(rule).interval"
                      @input="lbHealthPatch(i, 'interval', $event.target.value)"
                    />
                  </label>
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthTimeout') }}</span>
                    <input
                      type="number"
                      min="1"
                      :value="lbHealth(rule).timeout"
                      @input="lbHealthPatch(i, 'timeout', $event.target.value)"
                    />
                  </label>
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthHealthy') }}</span>
                    <input
                      type="number"
                      min="1"
                      :value="lbHealth(rule).healthyThreshold"
                      @input="lbHealthPatch(i, 'healthyThreshold', $event.target.value)"
                    />
                  </label>
                  <label class="hc-field">
                    <span>{{ t('inspector.lbHealthUnhealthy') }}</span>
                    <input
                      type="number"
                      min="1"
                      :value="lbHealth(rule).unhealthyThreshold"
                      @input="lbHealthPatch(i, 'unhealthyThreshold', $event.target.value)"
                    />
                  </label>
                </div>
                <p class="section-hint">{{ t('inspector.lbHealthHint') }}</p>
              </template>
            </div>
            <button class="mini danger" @click="removeLbRule(i)">{{ t('common.delete') }}</button>
          </div>
          <button class="add" @click="addLbRule">{{ t('inspector.lbAddRule') }}</button>
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
.hc {
  border: 1px dashed var(--border);
  border-radius: 6px;
  padding: 6px 8px;
}
.hc-head {
  display: flex;
  align-items: center;
  gap: 6px;
  font-size: 11px;
  color: var(--text-dim);
  cursor: pointer;
}
.hc-head input {
  width: auto;
}
.hc-grid {
  margin-top: 6px;
  display: grid;
  grid-template-columns: repeat(2, minmax(0, 1fr));
  gap: 6px;
}
.hc-field {
  display: flex;
  flex-direction: column;
  gap: 2px;
  font-size: 10px;
  color: var(--text-dim);
}
.hc-field.wide {
  grid-column: 1 / -1;
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
