import { ref } from 'vue'

export const sidebarCollapsed = ref(false)
try { sidebarCollapsed.value = localStorage.getItem('klee.sidebar.collapsed') === 'true' } catch { /* 存储受限时使用展开状态。 */ }
export function toggleSidebar() {
  sidebarCollapsed.value = !sidebarCollapsed.value
  try { localStorage.setItem('klee.sidebar.collapsed', String(sidebarCollapsed.value)) } catch { /* 存储受限时保留本页状态。 */ }
}
