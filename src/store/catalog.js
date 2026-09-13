import { ref, computed } from 'vue'
import { LOCAL_IMAGES } from '../data/images.js'
import { LOCAL_INSTANCE_TYPES } from '../data/instanceTypes.js'

const FALLBACK_VENDOR = 'aliyun'
const VENDORS = ['aliyun', 'tencent', 'aws', 'huawei']

const remoteJson = ref({ images: {}, instanceTypes: {} })
const remoteApi = ref({ images: {}, instanceTypes: {} })

function normalizeItems(items) {
  if (!Array.isArray(items)) return []
  return items
    .map((it) => {
      if (it == null) return null
      if (typeof it === 'string') return { value: it, label: it }
      const value = it.value ?? it.id ?? it.name
      if (value == null) return null
      return { value: String(value), label: it.label != null ? String(it.label) : String(value) }
    })
    .filter(Boolean)
}

function normalizeVendorMap(input) {
  if (!input || typeof input !== 'object') return {}
  const out = {}
  for (const [vendor, items] of Object.entries(input)) {
    const list = normalizeItems(items)
    if (list.length) out[vendor] = list
  }
  return out
}

function normalizeCatalog(data) {
  if (!data || typeof data !== 'object') return { images: {}, instanceTypes: {} }
  return {
    images: normalizeVendorMap(data.images || data.imagesByVendor),
    instanceTypes: normalizeVendorMap(
      data.instanceTypes || data.instance_types || data.instanceTypesByVendor
    ),
  }
}

// 本地清单为基底；某厂商存在在线（JSON 优先，其次厂商 API）清单时按 value 覆盖/补充
function compose(localMap, jsonMap, apiMap) {
  const vendors = new Set([
    ...Object.keys(localMap),
    ...Object.keys(jsonMap),
    ...Object.keys(apiMap),
  ])
  const out = {}
  for (const vendor of vendors) {
    const overlay =
      jsonMap[vendor] && jsonMap[vendor].length ? jsonMap[vendor] : apiMap[vendor] || []
    const map = new Map()
    for (const item of localMap[vendor] || []) map.set(item.value, item)
    for (const item of overlay) map.set(item.value, item)
    out[vendor] = [...map.values()]
  }
  return out
}

export const imagesByVendor = computed(() =>
  compose(LOCAL_IMAGES, remoteJson.value.images, remoteApi.value.images)
)

export const instanceTypesByVendor = computed(() =>
  compose(LOCAL_INSTANCE_TYPES, remoteJson.value.instanceTypes, remoteApi.value.instanceTypes)
)

export const catalogStatus = ref({ state: 'local', sources: [], error: null })

export function imageOptions(vendor) {
  const map = imagesByVendor.value
  return map[vendor] || map[FALLBACK_VENDOR] || []
}

export function instanceTypeOptions(vendor) {
  const map = instanceTypesByVendor.value
  return map[vendor] || map[FALLBACK_VENDOR] || []
}

export function defaultImage(vendor) {
  const list = imageOptions(vendor)
  return list[0] ? list[0].value : ''
}

export function defaultInstanceType(vendor) {
  const list = instanceTypeOptions(vendor)
  return list[0] ? list[0].value : ''
}

async function fetchJson(url) {
  const res = await fetch(url, { headers: { Accept: 'application/json' } })
  if (!res.ok) throw new Error(`HTTP ${res.status}`)
  return res.json()
}

async function fetchApiItems(template, vendor, kind) {
  const url = template
    .replaceAll('{vendor}', encodeURIComponent(vendor))
    .replaceAll('{kind}', encodeURIComponent(kind))
  const data = await fetchJson(url)
  return normalizeItems(Array.isArray(data) ? data : data.items || data.values)
}

// 云厂商 API 代理：URL 含 {vendor}/{kind} 占位符时按厂商/类型逐个请求，否则视为返回完整清单
async function loadFromApi(template) {
  if (!template.includes('{vendor}') && !template.includes('{kind}')) {
    return normalizeCatalog(await fetchJson(template))
  }
  const images = {}
  const instanceTypes = {}
  await Promise.all(
    VENDORS.map(async (vendor) => {
      const [imgs, insts] = await Promise.all([
        fetchApiItems(template, vendor, 'images').catch(() => []),
        fetchApiItems(template, vendor, 'instanceTypes').catch(() => []),
      ])
      if (imgs.length) images[vendor] = imgs
      if (insts.length) instanceTypes[vendor] = insts
    })
  )
  return { images, instanceTypes }
}

export async function loadCatalog(config) {
  const env = import.meta.env || {}
  const jsonUrl = (config && config.jsonUrl) || env.VITE_CATALOG_URL
  const apiUrl = (config && config.apiUrl) || env.VITE_CATALOG_API_URL
  if (!jsonUrl && !apiUrl) return

  catalogStatus.value = { state: 'loading', sources: [], error: null }
  const sources = []
  let error = null

  if (jsonUrl) {
    try {
      remoteJson.value = normalizeCatalog(await fetchJson(jsonUrl))
      sources.push('json')
    } catch (e) {
      error = String((e && e.message) || e)
    }
  }

  if (apiUrl) {
    try {
      remoteApi.value = await loadFromApi(apiUrl)
      sources.push('api')
    } catch (e) {
      error = error || String((e && e.message) || e)
    }
  }

  catalogStatus.value = {
    state: sources.length ? 'online' : 'error',
    sources,
    error,
  }
}
