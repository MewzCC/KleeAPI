import { createApp } from 'vue'
import { createRouter, createWebHistory } from 'vue-router'
import ElementPlus from 'element-plus'
import 'element-plus/dist/index.css'
import 'element-plus/theme-chalk/dark/css-vars.css'
import './style.css'
import App from './App.vue'
import PortalView from './views/PortalView.vue'
import WorkspaceView from './views/WorkspaceView.vue'
const router = createRouter({ history: createWebHistory(), routes: [
  { path: '/admin', component: PortalView },
  { path: '/admin/:platform(gateway|workbuddy|trae|qoder)', component: WorkspaceView },
  { path: '/:pathMatch(.*)*', redirect: '/admin' },
] })
// 路由首次导航完成后再读取并清除 fragment，避免首次导航把密钥重新写回地址栏。
const app = createApp(App).use(router).use(ElementPlus)
void router.isReady().then(() => app.mount('#app'))
