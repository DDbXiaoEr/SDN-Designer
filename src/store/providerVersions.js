import { ref } from 'vue'
import { VENDORS } from '../data/vendors.js'

// 各厂商 Terraform provider 已发布版本（来自 server 的 /api/providerVersions）
// 缺省为空表示只能手输版本约束（回退内置默认值）
const versionsByVendor = ref({})
export const providerVersionsStatus = ref({ state: 'local', source: null, error: null })

function toList(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((it) => (typeof it === 'string' ? it : it && (it.version || it.value)))
    .filter((v) => v != null && v !== '')
    .map(String)
}

// 兼容三种响应：单厂商 { vendor, versions:[...] }、全量 { versions:{vendor:[...]} }、以及以厂商为键的对象
function mergeVersions(data) {
  if (!data || typeof data !== 'object') return
  if (data.vendor && Array.isArray(data.versions)) {
    const list = toList(data.versions)
    if (list.length) versionsByVendor.value = { ...versionsByVendor.value, [data.vendor]: list }
    return
  }
  const map =
    data.versions && !Array.isArray(data.versions) && typeof data.versions === 'object'
      ? data.versions
      : data
  const next = { ...versionsByVendor.value }
  for (const [vendor, items] of Object.entries(map)) {
    if (!VENDORS.some((v) => v.value === vendor)) continue
    const list = toList(items)
    if (list.length) next[vendor] = list
  }
  versionsByVendor.value = next
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

// 当前厂商可选版本列表；未配置/拉取失败时返回空数组
export function providerVersionOptions(vendor) {
  return versionsByVendor.value[vendor] || []
}

// 拉取可用 provider 版本：URL 含 {vendor} 占位符时按厂商逐个请求，否则视为一次性返回全部厂商
export async function loadProviderVersions(config) {
  const env = import.meta.env || {}
  const url = (config && config.url) || env.VITE_PROVIDER_VERSIONS_URL
  if (!url) return

  providerVersionsStatus.value = { state: 'loading', source: null, error: null }
  try {
    if (url.includes('{vendor}')) {
      const results = await Promise.allSettled(
        VENDORS.map((v) => fetchJson(url.replaceAll('{vendor}', encodeURIComponent(v.value))))
      )
      results.forEach((r) => {
        if (r.status === 'fulfilled') mergeVersions(r.value)
      })
      const failed = results.filter((r) => r.status === 'rejected')
      providerVersionsStatus.value = {
        state: failed.length ? 'partial' : 'online',
        source: 'api',
        error: failed.length ? String(failed[0].reason && failed[0].reason.message) : null,
      }
    } else {
      mergeVersions(await fetchJson(url))
      providerVersionsStatus.value = { state: 'online', source: 'api', error: null }
    }
  } catch (e) {
    providerVersionsStatus.value = {
      state: 'error',
      source: null,
      error: String((e && e.message) || e),
    }
  }
}
