import { createApp } from 'vue'
import App from './App.vue'
import i18n from './i18n/index.js'
import { loadCatalog } from './store/catalog.js'
import './styles/main.css'

loadCatalog().catch(() => {})

createApp(App).use(i18n).mount('#app')
