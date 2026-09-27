import { ref } from 'vue'

// 主题：浅色「图纸」为默认，可切到深色。通过 <html data-theme> 驱动 CSS 变量，
// 并写入 localStorage 记忆；index.html 内联脚本会在首屏前预设，避免闪烁。
const STORAGE_KEY = 'ovn-designer-theme'

export const THEMES = ['light', 'dark']

function readStored() {
  try {
    const saved = localStorage.getItem(STORAGE_KEY)
    return THEMES.includes(saved) ? saved : 'light'
  } catch {
    return 'light'
  }
}

export const theme = ref(readStored())

function apply(value) {
  if (typeof document !== 'undefined') {
    document.documentElement.dataset.theme = value
  }
}

apply(theme.value)

export function setTheme(value) {
  if (!THEMES.includes(value) || value === theme.value) return
  theme.value = value
  try {
    localStorage.setItem(STORAGE_KEY, value)
  } catch {
    /* localStorage 不可用时忽略 */
  }
  apply(value)
}

export function toggleTheme() {
  setTheme(theme.value === 'dark' ? 'light' : 'dark')
}
