import { NODE_TYPES } from './nodeDefinitions.js'
import { VENDOR_REGIONS, defaultRegion, defaultZone } from './regions.js'
import { chargeTypeOptions, defaultChargeType } from './chargeTypes.js'
import { diskTypeOptions, defaultDiskType } from './disks.js'
import {
  imageOptions,
  defaultImage,
  instanceTypeOptions,
  defaultInstanceType,
} from '../store/catalog.js'

// 支持的云厂商
export const VENDORS = [
  { value: 'aliyun', label: 'vendors.aliyun' },
  { value: 'tencent', label: 'vendors.tencent' },
  { value: 'aws', label: 'vendors.aws' },
  { value: 'huawei', label: 'vendors.huawei' },
]

export const DEFAULT_VENDOR = 'aliyun'

// 各厂商主 provider 的默认版本约束（工具栏可覆盖，写入 provider.tf 的 required_providers）
export const DEFAULT_PROVIDER_VERSIONS = {
  aliyun: '>= 1.200.0',
  tencent: '~> 1.81',
  aws: '~> 5.0',
  huawei: '~> 1.60',
}

export function defaultProviderVersion(v) {
  return DEFAULT_PROVIDER_VERSIONS[v] || ''
}

export function isVendor(v) {
  return VENDORS.some((x) => x.value === v)
}

// 返回节点展示名的 i18n key：
// - OVN 节点直接返回原 key
// - 云资源节点返回 `label.<vendor>`（不同厂商对应不同资源名）
export function nodeLabelKey(typeOrDef, vendor) {
  const def = typeof typeOrDef === 'string' ? NODE_TYPES[typeOrDef] : typeOrDef
  if (!def) return ''
  return def.category === 'cloud' ? `${def.label}.${vendor}` : def.label
}

// 云资源节点徽标按厂商展示（OVN 节点沿用 def.badge）
const CLOUD_BADGES = {
  VPC: { aliyun: 'VPC', tencent: 'VPC', aws: 'VPC', huawei: 'VPC' },
  Subnet: { aliyun: 'VSW', tencent: 'Subnet', aws: 'Subnet', huawei: 'Subnet' },
  Gateway: { aliyun: 'GW', tencent: 'GW', aws: 'GW', huawei: 'GW' },
  Eip: { aliyun: 'EIP', tencent: 'EIP', aws: 'EIP', huawei: 'EIP' },
  SecurityGroup: { aliyun: 'SG', tencent: 'SG', aws: 'SG', huawei: 'SG' },
  Instance: { aliyun: 'ECS', tencent: 'CVM', aws: 'EC2', huawei: 'ECS' },
  KeyPair: { aliyun: 'KEY', tencent: 'KEY', aws: 'KEY', huawei: 'KEY' },
  RouteTable: { aliyun: 'RT', tencent: 'RT', aws: 'RT', huawei: 'RT' },
  Interconnect: { aliyun: 'PEER', tencent: 'PEER', aws: 'PEER', huawei: 'PEER' },
  LoadBalancer: { aliyun: 'SLB', tencent: 'CLB', aws: 'ALB', huawei: 'ELB' },
}

export function nodeBadge(type, vendor) {
  if (CLOUD_BADGES[type]) {
    return CLOUD_BADGES[type][vendor] || CLOUD_BADGES[type][DEFAULT_VENDOR]
  }
  return NODE_TYPES[type]?.badge || ''
}

function optionValues(list) {
  return new Set((list || []).map((o) => o.value))
}

// 判断可用区是否属于目标厂商：region 为可用区 ID 的前缀（如 cn-hangzhou-b / us-east-1a）
function zoneBelongsToVendor(zone, vendor) {
  if (!zone) return false
  return (VENDOR_REGIONS[vendor] || []).some((r) => zone.startsWith(r))
}

// 切换云厂商时，把节点的厂商相关配置迁移到目标厂商：
// 当前值在目标厂商候选中仍有效时保留，否则替换为目标厂商默认值。
// 返回需要合并进 data 的补丁；无需变更时返回 null。
export function retargetCloudNodeData(type, data, vendor) {
  if (!data) return null
  const patch = {}
  switch (type) {
    case 'VPC': {
      if (!(VENDOR_REGIONS[vendor] || []).includes(data.region)) {
        patch.region = defaultRegion(vendor)
      }
      break
    }
    case 'Subnet': {
      if (!zoneBelongsToVendor(data.zone, vendor)) {
        patch.zone = defaultZone(vendor)
      }
      break
    }
    case 'Instance': {
      const images = optionValues(imageOptions(vendor))
      const types = optionValues(instanceTypeOptions(vendor))
      const charges = optionValues(chargeTypeOptions(vendor))
      const disks = optionValues(diskTypeOptions(vendor))
      if (!images.has(data.imageId)) patch.imageId = defaultImage(vendor)
      if (!types.has(data.instanceType)) patch.instanceType = defaultInstanceType(vendor)
      if (!charges.has(data.chargeType)) patch.chargeType = defaultChargeType()
      const sys = data.systemDisk || {}
      if (!disks.has(sys.type)) patch.systemDisk = { ...sys, type: defaultDiskType(vendor) }
      if (Array.isArray(data.dataDisks)) {
        const mapped = data.dataDisks.map((d) =>
          disks.has(d.type) ? d : { ...d, type: defaultDiskType(vendor) }
        )
        if (mapped.some((d, i) => d !== data.dataDisks[i])) patch.dataDisks = mapped
      }
      break
    }
    default:
      break
  }
  return Object.keys(patch).length ? patch : null
}
