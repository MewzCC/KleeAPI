import { toRef } from 'vue'
import { post } from '../api/client'
import { session } from './session'
import type { Platform } from '../types'

type Completion = { completed: boolean; platform?: Platform }
export const onboardingCompletion = toRef(session, 'onboarding')
let revision = 0

export async function saveOnboardingCompletion(platform: Platform, completed: boolean) {
  revision++
  const result = await post<Completion>(platform, '/api/onboarding', { completed })
  revision++
  onboardingCompletion.value = result
}

/** 同一页面立即共享，其他端口和标签页通过本机服务同步。 */
export function syncOnboardingCompletion() {
  let pending = false, stopped = false
  async function refresh() {
    if (pending || document.hidden || stopped) return
    pending = true
    const currentRevision = revision
    try {
      const response = await fetch('/api/config', { cache: 'no-store', signal: AbortSignal.timeout(5000) })
      if (!response.ok) return
      const { onboarding } = await response.json()
      if (!stopped && currentRevision === revision && typeof onboarding?.completed === 'boolean') onboardingCompletion.value = onboarding
    } catch { /* 本地服务暂不可达时保留上次确认的状态。 */ }
    finally { pending = false }
  }
  void refresh()
  const timer = setInterval(() => void refresh(), 3000)
  window.addEventListener('focus', refresh)
  window.addEventListener('pageshow', refresh)
  document.addEventListener('visibilitychange', refresh)
  return () => {
    stopped = true
    clearInterval(timer)
    window.removeEventListener('focus', refresh)
    window.removeEventListener('pageshow', refresh)
    document.removeEventListener('visibilitychange', refresh)
  }
}
