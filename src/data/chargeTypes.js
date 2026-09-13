// 各云厂商实例计费方式：包年包月 / 按量付费 / 抢占式
export const VENDOR_CHARGE_TYPES = {
  aliyun: [
    { value: 'subscription', label: 'chargeTypes.subscription' },
    { value: 'payAsYouGo', label: 'chargeTypes.payAsYouGo' },
    { value: 'spot', label: 'chargeTypes.spot' },
  ],
  tencent: [
    { value: 'subscription', label: 'chargeTypes.subscription' },
    { value: 'payAsYouGo', label: 'chargeTypes.payAsYouGo' },
    { value: 'spot', label: 'chargeTypes.spot' },
  ],
  huawei: [
    { value: 'subscription', label: 'chargeTypes.subscription' },
    { value: 'payAsYouGo', label: 'chargeTypes.payAsYouGo' },
    { value: 'spot', label: 'chargeTypes.spot' },
  ],
  aws: [
    { value: 'payAsYouGo', label: 'chargeTypes.payAsYouGo' },
    { value: 'spot', label: 'chargeTypes.spot' },
  ],
}

const FALLBACK_VENDOR = 'aliyun'

export function chargeTypeOptions(vendor) {
  return VENDOR_CHARGE_TYPES[vendor] || VENDOR_CHARGE_TYPES[FALLBACK_VENDOR]
}

export function defaultChargeType() {
  return 'payAsYouGo'
}
