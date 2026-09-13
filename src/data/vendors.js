import { NODE_TYPES } from './nodeDefinitions.js'

// 支持的云厂商
export const VENDORS = [
  { value: 'aliyun', label: 'vendors.aliyun' },
  { value: 'tencent', label: 'vendors.tencent' },
  { value: 'aws', label: 'vendors.aws' },
  { value: 'huawei', label: 'vendors.huawei' },
]

export const DEFAULT_VENDOR = 'aliyun'

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
  RouteTable: { aliyun: 'RT', tencent: 'RT', aws: 'RT', huawei: 'RT' },
  Interconnect: { aliyun: 'PEER', tencent: 'PEER', aws: 'PEER', huawei: 'PEER' },
}

export function nodeBadge(type, vendor) {
  if (CLOUD_BADGES[type]) {
    return CLOUD_BADGES[type][vendor] || CLOUD_BADGES[type][DEFAULT_VENDOR]
  }
  return NODE_TYPES[type]?.badge || ''
}
