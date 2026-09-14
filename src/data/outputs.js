// 云资源「创建后才可知」的属性定义（Terraform computed attributes）
// 每个属性项：
//   key    —— 与厂商无关的勾选标识，存入 node.data.outputs
//   label  —— i18n key
//   suffix —— 生成的 output 名称后缀（资源名 + 后缀）
//   attr   —— 该厂商 Terraform 资源上的只读属性名

// 资源 ID：所有云资源节点通用
const ID = { key: 'id', label: 'outputs.id', suffix: 'id', attr: 'id' }

// 支持输出的云资源类型，需与各导出器实际生成的资源保持一致
const CLOUD_TYPES = [
  'VPC',
  'Subnet',
  'SecurityGroup',
  'Gateway',
  'Eip',
  'Instance',
  'RouteTable',
  'Interconnect',
]

// 公网 IP 属性名按厂商/资源类型区分（阿里云 EIP 为 ip_address、华为云 EIP 为 address）
const PUBLIC_IP_ATTR = {
  aliyun: { Eip: 'ip_address', Instance: 'public_ip' },
  tencent: { Eip: 'public_ip', Instance: 'public_ip' },
  aws: { Eip: 'public_ip', Instance: 'public_ip' },
  huawei: { Eip: 'address', Instance: 'public_ip' },
}

// 返回指定厂商下某节点类型可勾选输出的属性列表
export function outputOptions(vendor, type) {
  if (!CLOUD_TYPES.includes(type)) return []
  const options = [ID]
  const attr = PUBLIC_IP_ATTR[vendor] && PUBLIC_IP_ATTR[vendor][type]
  if (attr) {
    options.push({ key: 'publicIp', label: 'outputs.publicIp', suffix: 'public_ip', attr })
  }
  return options
}
