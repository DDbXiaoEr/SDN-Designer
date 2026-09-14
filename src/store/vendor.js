import { ref, computed } from 'vue'
import { DEFAULT_VENDOR, VENDORS, DEFAULT_PROVIDER_VERSIONS, defaultProviderVersion, isVendor } from '../data/vendors.js'

const KEY = 'ovn-designer-vendor'
const VERSION_KEY = 'ovn-designer-provider-versions'

function initialVendor() {
  const saved = typeof localStorage !== 'undefined' ? localStorage.getItem(KEY) : null
  return saved && isVendor(saved) ? saved : DEFAULT_VENDOR
}

export const vendor = ref(initialVendor())

export function setVendor(v) {
  if (!isVendor(v)) return
  vendor.value = v
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(KEY, v)
  }
}

// 各厂商 provider 版本约束，按厂商分别持久化（缺省回退到内置默认值）
function initialProviderVersions() {
  const versions = { ...DEFAULT_PROVIDER_VERSIONS }
  if (typeof localStorage === 'undefined') return versions
  try {
    const saved = JSON.parse(localStorage.getItem(VERSION_KEY) || 'null')
    if (saved && typeof saved === 'object') {
      for (const v of VENDORS) {
        if (typeof saved[v.value] === 'string') versions[v.value] = saved[v.value]
      }
    }
  } catch {
    // 存储内容损坏时忽略，使用默认值
  }
  return versions
}

export const providerVersions = ref(initialProviderVersions())

// 当前厂商的 provider 版本约束
export const providerVersion = computed(() => providerVersions.value[vendor.value] ?? defaultProviderVersion(vendor.value))

export function setProviderVersion(v, version) {
  if (!isVendor(v)) return
  providerVersions.value = { ...providerVersions.value, [v]: version }
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(VERSION_KEY, JSON.stringify(providerVersions.value))
  }
}
