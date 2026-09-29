import { ref } from 'vue'
import { defaultRegion } from '../data/regions.js'

export const inventoryStatus = ref({ state: 'idle', error: null })

function inventoryUrl(vendor, region) {
  const env = import.meta.env || {}
  const template = env.VITE_INVENTORY_API_URL || env.VITE_CATALOG_API_URL || ''
  if (!template) return ''
  if (template.includes('{kind}')) {
    return template
      .replaceAll('{kind}', 'inventory')
      .replaceAll('{vendor}', encodeURIComponent(vendor))
      .replaceAll('{region}', encodeURIComponent(region || ''))
  }
  // 完整清单 URL 不含占位符时，按 /api/inventory/:vendor/:region 拼接
  const base = template.replace(/\/api\/.*$/, '')
  const path = `/api/inventory/${encodeURIComponent(vendor)}/${encodeURIComponent(region)}`
  return `${base}${path}`
}

export async function fetchInventory(vendor, region) {
  const url = inventoryUrl(vendor, region || defaultRegion(vendor))
  if (!url) {
    const err = new Error('inventory url not configured')
    inventoryStatus.value = { state: 'error', error: err.message }
    throw err
  }
  inventoryStatus.value = { state: 'loading', error: null }
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) {
    let detail = `HTTP ${res.status}`
    try {
      const body = await res.json()
      if (body && body.error) detail = body.error
    } catch {
      /* ignore */
    }
    inventoryStatus.value = { state: 'error', error: detail }
    const err = new Error(detail)
    err.status = res.status
    throw err
  }
  const data = await res.json()
  inventoryStatus.value = { state: 'ok', error: null }
  return data
}

export function isExistingNode(node) {
  return !!(node && node.data && node.data.existing && node.data.cloudId)
}
