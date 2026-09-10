import { createI18n } from 'vue-i18n'
import zhCN from './locales/zh-CN.js'
import enUS from './locales/en-US.js'

export const SUPPORTED_LOCALES = ['zh-CN', 'en-US']
const STORAGE_KEY = 'ovn-designer-locale'

function initialLocale() {
  const saved =
    typeof localStorage !== 'undefined' ? localStorage.getItem(STORAGE_KEY) : null
  if (saved && SUPPORTED_LOCALES.includes(saved)) return saved
  const nav = typeof navigator !== 'undefined' ? navigator.language : 'zh-CN'
  const match = SUPPORTED_LOCALES.find((l) => l.toLowerCase() === (nav || '').toLowerCase())
  return match || 'zh-CN'
}

const i18n = createI18n({
  legacy: false,
  globalInjection: true,
  locale: initialLocale(),
  fallbackLocale: 'en-US',
  messages: {
    'zh-CN': zhCN,
    'en-US': enUS,
  },
})

export function setLocale(locale) {
  if (!SUPPORTED_LOCALES.includes(locale)) return
  i18n.global.locale.value = locale
  if (typeof localStorage !== 'undefined') {
    localStorage.setItem(STORAGE_KEY, locale)
  }
}

export function translate(key, params) {
  return i18n.global.t(key, params)
}

export default i18n
