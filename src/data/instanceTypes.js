// 各云厂商本地内置实例规格列表（在线清单拉取失败时的兜底；在线清单可按 value 覆盖/补充）
export const LOCAL_INSTANCE_TYPES = {
  aliyun: [
    { value: 'ecs.t5-lc1m2.small', label: 'ecs.t5-lc1m2.small (1 vCPU / 2 GiB)' },
    { value: 'ecs.t5-lc1m2.large', label: 'ecs.t5-lc1m2.large (2 vCPU / 4 GiB)' },
    { value: 'ecs.t6-c1m1.large', label: 'ecs.t6-c1m1.large (2 vCPU / 2 GiB)' },
    { value: 'ecs.c6.large', label: 'ecs.c6.large (2 vCPU / 4 GiB)' },
    { value: 'ecs.c6.xlarge', label: 'ecs.c6.xlarge (4 vCPU / 8 GiB)' },
    { value: 'ecs.g6.large', label: 'ecs.g6.large (2 vCPU / 8 GiB)' },
    { value: 'ecs.g6.xlarge', label: 'ecs.g6.xlarge (4 vCPU / 16 GiB)' },
    { value: 'ecs.r6.large', label: 'ecs.r6.large (2 vCPU / 16 GiB)' },
    { value: 'ecs.u1-c1m2.large', label: 'ecs.u1-c1m2.large (2 vCPU / 4 GiB)' },
    { value: 'ecs.e-c1m1.large', label: 'ecs.e-c1m1.large (2 vCPU / 2 GiB)' },
  ],
  tencent: [
    { value: 'S5.SMALL1', label: 'S5.SMALL1 (1 vCPU / 1 GiB)' },
    { value: 'S5.MEDIUM2', label: 'S5.MEDIUM2 (1 vCPU / 2 GiB)' },
    { value: 'S5.LARGE8', label: 'S5.LARGE8 (2 vCPU / 8 GiB)' },
    { value: 'S6.MEDIUM4', label: 'S6.MEDIUM4 (2 vCPU / 4 GiB)' },
    { value: 'S6.LARGE8', label: 'S6.LARGE8 (2 vCPU / 8 GiB)' },
    { value: 'SA3.MEDIUM4', label: 'SA3.MEDIUM4 (2 vCPU / 4 GiB)' },
    { value: 'SA3.LARGE8', label: 'SA3.LARGE8 (2 vCPU / 8 GiB)' },
    { value: 'SA3.2LARGE8', label: 'SA3.2LARGE8 (4 vCPU / 8 GiB)' },
  ],
  aws: [
    { value: 't3.micro', label: 't3.micro (2 vCPU / 1 GiB)' },
    { value: 't3.small', label: 't3.small (2 vCPU / 2 GiB)' },
    { value: 't3.medium', label: 't3.medium (2 vCPU / 4 GiB)' },
    { value: 'm5.large', label: 'm5.large (2 vCPU / 8 GiB)' },
    { value: 'm5.xlarge', label: 'm5.xlarge (4 vCPU / 16 GiB)' },
    { value: 'c5.large', label: 'c5.large (2 vCPU / 4 GiB)' },
    { value: 'c5.xlarge', label: 'c5.xlarge (4 vCPU / 8 GiB)' },
    { value: 'r5.large', label: 'r5.large (2 vCPU / 16 GiB)' },
  ],
  huawei: [
    { value: 's6.small.1', label: 's6.small.1 (1 vCPU / 1 GiB)' },
    { value: 's6.medium.2', label: 's6.medium.2 (1 vCPU / 2 GiB)' },
    { value: 's6.large.2', label: 's6.large.2 (2 vCPU / 4 GiB)' },
    { value: 's6.xlarge.2', label: 's6.xlarge.2 (4 vCPU / 8 GiB)' },
    { value: 'c6.large.2', label: 'c6.large.2 (2 vCPU / 4 GiB)' },
    { value: 'c6.xlarge.2', label: 'c6.xlarge.2 (4 vCPU / 8 GiB)' },
    { value: 'm6.large.8', label: 'm6.large.8 (2 vCPU / 16 GiB)' },
    { value: 'm6.xlarge.8', label: 'm6.xlarge.8 (4 vCPU / 32 GiB)' },
  ],
}

const FALLBACK_VENDOR = 'aliyun'

export function localInstanceTypeOptions(vendor) {
  return LOCAL_INSTANCE_TYPES[vendor] || LOCAL_INSTANCE_TYPES[FALLBACK_VENDOR]
}

export function localDefaultInstanceType(vendor) {
  const list = localInstanceTypeOptions(vendor)
  return list[0] ? list[0].value : ''
}
