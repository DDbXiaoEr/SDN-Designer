// 各云厂商云盘类型（系统盘/数据盘，来自官方文档）
export const VENDOR_DISK_TYPES = {
  aliyun: [
    { value: 'cloud_essd', label: 'cloud_essd (ESSD)' },
    { value: 'cloud_ssd', label: 'cloud_ssd (SSD)' },
    { value: 'cloud_efficiency', label: 'cloud_efficiency (高效云盘)' },
    { value: 'cloud', label: 'cloud (普通云盘)' },
  ],
  tencent: [
    { value: 'CLOUD_PREMIUM', label: 'CLOUD_PREMIUM (高性能云硬盘)' },
    { value: 'CLOUD_SSD', label: 'CLOUD_SSD (SSD 云硬盘)' },
    { value: 'CLOUD_HSSD', label: 'CLOUD_HSSD (增强型 SSD)' },
    { value: 'CLOUD_BSSD', label: 'CLOUD_BSSD (通用型 SSD)' },
  ],
  huawei: [
    { value: 'GPSSD', label: 'GPSSD (通用型 SSD)' },
    { value: 'SSD', label: 'SSD (超高 IO)' },
    { value: 'SAS', label: 'SAS (高 IO)' },
    { value: 'ESSD', label: 'ESSD (极速型 SSD)' },
  ],
  aws: [
    { value: 'gp3', label: 'gp3 (General Purpose SSD)' },
    { value: 'gp2', label: 'gp2 (General Purpose SSD)' },
    { value: 'io2', label: 'io2 (Provisioned IOPS SSD)' },
    { value: 'io1', label: 'io1 (Provisioned IOPS SSD)' },
    { value: 'st1', label: 'st1 (Throughput Optimized HDD)' },
    { value: 'sc1', label: 'sc1 (Cold HDD)' },
    { value: 'standard', label: 'standard (Magnetic)' },
  ],
}

const FALLBACK_VENDOR = 'aliyun'

export function diskTypeOptions(vendor) {
  return VENDOR_DISK_TYPES[vendor] || VENDOR_DISK_TYPES[FALLBACK_VENDOR]
}

export function defaultDiskType(vendor) {
  const list = diskTypeOptions(vendor)
  return list[0] ? list[0].value : ''
}
