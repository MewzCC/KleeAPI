import { ref } from 'vue'

/**
 * 读取当前页与浏览器保存的装饰动效偏好，存储受限时仍保持本页状态。
 */
export function readMotionPaused(): boolean {
  const current = document.documentElement.dataset.kleeMotion
  if (current === 'off' || current === 'on') return current === 'off'
  try { return localStorage.getItem('klee.decoration.motion') === 'off' } catch { return false }
}

/**
 * 即时应用动效开关；存储受限时仍允许在当前页面暂停。
 */
export function setMotionPaused(paused: boolean): void {
  document.documentElement.dataset.kleeMotion = paused ? 'off' : 'on'
  try { localStorage.setItem('klee.decoration.motion', paused ? 'off' : 'on') } catch { /* 隐私模式下仅保持本页偏好。 */ }
}
export const kleeTheme = ref(false)

/**
 * 只更新展示状态，Element Plus 弹层也通过根节点继承同一主题。
 */
function applyTheme(enabled: boolean): void {
  kleeTheme.value = enabled
  document.documentElement.classList.toggle('klee-theme', enabled)
  document.documentElement.classList.toggle('dark', !enabled)
  document.querySelector('meta[name="color-scheme"]')?.setAttribute('content', enabled ? 'light' : 'dark')
}

/**
 * 保存主题偏好；不允许浏览器存储时仍可在当前页面切换。
 */
export function setKleeTheme(enabled: boolean): void {
  applyTheme(enabled)
  try { localStorage.setItem('klee.theme', enabled ? 'klee' : 'default') } catch { /* 存储受限时保持本页状态。 */ }
}

/**
 * 首次进入默认使用原主题；跨端口入口通过 fragment 传递外观偏好。
 */
export function initializeDecoration(): void {
  const incoming = new URLSearchParams(location.hash.slice(1)).get('theme')
  if (incoming === 'klee' || incoming === 'default') setKleeTheme(incoming === 'klee')
  else {
    let enabled = false
    try { enabled = localStorage.getItem('klee.theme') === 'klee' } catch { /* 默认保留原深色界面。 */ }
    applyTheme(enabled)
  }
  document.documentElement.dataset.kleeMotion = readMotionPaused() ? 'off' : 'on'
  window.addEventListener('storage', event => {
    if (event.key === 'klee.theme' || event.key === null) applyTheme(event.newValue === 'klee')
  })
}
