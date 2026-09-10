import { ref } from 'vue'
import { DEFAULT_VENDOR, isVendor } from '../data/vendors.js'

const KEY = 'ovn-designer-vendor'

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
