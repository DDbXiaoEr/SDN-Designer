import { createApp } from 'vue'
import App from './App.vue'
import i18n from './i18n/index.js'
import { loadCatalog } from './store/catalog.js'
import { loadProviderVersions } from './store/providerVersions.js'
import './styles/main.css'

loadCatalog().catch(() => {})
loadProviderVersions().catch(() => {})

createApp(App).use(i18n).mount('#app')
