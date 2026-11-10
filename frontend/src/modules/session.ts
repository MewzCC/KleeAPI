import { reactive } from 'vue'
import { kleeTheme } from './decoration'
import type { Platform } from '../types'
export const platforms: Platform[] = ['gateway', 'workbuddy', 'trae', 'qoder']
export const names: Record<Platform, string> = { gateway: '统一网关', workbuddy: 'WorkBuddy', trae: 'Trae', qoder: 'Qoder' }
export const session = reactive({ ready: false, error: '', platform: 'gateway' as Platform, ports: { gateway: 18887, workbuddy: 18791, trae: 17864, qoder: 17865 }, keys: {} as Record<Platform, string> })
export function storedKey(p: Platform) { try { return sessionStorage.getItem(`klee.${p}`) || localStorage.getItem(`klee.${p}`) || '' } catch { return '' } }
export function remembered(p: Platform) { try { return !!localStorage.getItem(`klee.${p}`) } catch { return false } }
let pendingFragment: URLSearchParams | undefined
/** 跨端口仅通过 fragment 携带已保存密钥，进入页面立即移除地址中的凭据。 */
export async function initialize() {
  session.error = ''; session.ready = false
  const incoming = pendingFragment ||= new URLSearchParams(location.hash.slice(1))
  if (location.hash) history.replaceState(history.state, '', location.pathname + location.search)
  for (const p of platforms) session.keys[p] = storedKey(p)
  try {
    const response = await fetch('/api/config', { signal: AbortSignal.timeout(15000) })
    if (!response.ok) throw new Error('无法读取本地服务配置，请检查服务是否启动。')
    const config = await response.json()
    for (const p of platforms) {
      const port = config.ports?.[p]
      if (!Number.isInteger(port) || port < 1 || port > 65535) throw new Error('本地服务端口配置无效。')
      session.ports[p] = port
    }
    if (!platforms.includes(config.platform)) throw new Error('本地服务平台配置无效。')
    session.platform = config.platform
    const current = import.meta.env.DEV ? location.pathname.split('/')[2] as Platform : config.platform
    for (const p of platforms) {
      const candidate = incoming.get(p)
      if (!candidate) continue
      let accept = true
      if (p === current && session.keys[p] && session.keys[p] !== candidate) {
        try {
          const check = await fetch(baseURL(p) + (p === 'gateway' ? '/api/gateway/status' : '/api/accounts'), { headers: { Authorization: `Bearer ${session.keys[p]}` }, signal: AbortSignal.timeout(30000) })
          accept = check.status === 401 || check.status === 403
        } catch { accept = false }
      }
      if (accept) saveLocal(p, candidate, remembered(p))
    }
    session.ready = true
    pendingFragment = undefined
  } catch (e) { session.error = safe(e) }
}
export function baseURL(p: Platform) { return !import.meta.env.DEV && p === session.platform ? location.origin : `${location.protocol}//${location.hostname}:${session.ports[p]}` }
export function fragment() { const params = new URLSearchParams(); for (const p of platforms) if (session.keys[p]) params.set(p, session.keys[p]); params.set('theme', kleeTheme.value ? 'klee' : 'default'); return '#' + params }
export function platformLink(p: Platform, tab?: string) {
  const sameOrigin = import.meta.env.DEV || baseURL(p) === location.origin
  return (sameOrigin ? '' : baseURL(p)) + '/admin/' + p + (tab ? '?tab=' + encodeURIComponent(tab) : '') + (sameOrigin ? '' : fragment())
}
export function portalLink() { return '/admin' }
export function saveLocal(p: Platform, key: string, remember: boolean) {
  session.keys[p] = key
  try { sessionStorage.setItem(`klee.${p}`, key); if (remember) localStorage.setItem(`klee.${p}`, key); else localStorage.removeItem(`klee.${p}`) } catch { /* 浏览器禁止存储时仍保留本页会话。 */ }
}
/** 错误与服务端文本遮蔽已知密钥及常见凭据格式。 */
export function safe(value: unknown, extra = '') {
  let text = value instanceof Error ? value.message : String(value ?? '')
  for (const key of [...Object.values(session.keys), extra].filter(Boolean)) text = text.split(key).join('[Key 已隐藏]')
  return text.replace(/klee-[\x21-\x7e]{3,251}/g, '[Key 已隐藏]').replace(/(access_token|refresh_token|authorization)(["'\s:=]+)[^\s,"'}]+/gi, '$1$2[已隐藏]')
}
export const date = (value?: string | number) => value && Number.isFinite(new Date(value).getTime()) ? new Date(value).toLocaleString('zh-CN') : '未知'
export const number = (value?: number) => typeof value === 'number' && Number.isFinite(value) ? value.toLocaleString('zh-CN', { maximumFractionDigits: 4 }) : '未知'
export const statusName = (value?: string) => ({ ready: '可用', expired: '已过期', disabled: '已停用', claimed: '签到成功', already: '已签到', available: '未签到', unknown: '状态未知', pending: '待确认', failed: '失败', no_activity: '无签到活动', skipped: '已跳过', canceled: '已取消' }[value || 'unknown'] || value)
