import { baseURL, saveLocal, session } from '../modules/session'
import type { Platform } from '../types'
export class ApiError extends Error { constructor(message: string, public status = 0) { super(message) } }
/** 所有业务请求只读取已保存的密钥；轮换流程可显式提供旧密钥。 */
export async function request<T>(platform: Platform, path: string, options: RequestInit = {}, key = session.keys[platform]): Promise<T> {
  if (!key) throw new Error('请先填写并保存此服务的 API Key。')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), /monitor|checkin|gateway/.test(path) ? 120000 : 30000)
  try {
    const response = await fetch(baseURL(platform) + path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${key}`, ...options.headers } })
    let data
    try { const text = await response.text(); data = text ? JSON.parse(text) : {} } catch { throw new Error('服务返回了无效 JSON。') }
    if (!response.ok) throw new ApiError([401, 403].includes(response.status) ? 'API Key 无效，请输入当前服务端密钥并保存。' : data.error?.message || (typeof data.error === 'string' ? data.error : data.message) || `请求失败 (${response.status})`, response.status)
    return data as T
  } catch (e) {
    if (controller.signal.aborted) throw new Error('请求超时；保留上次结果，请稍后重试。')
    if (e instanceof TypeError) throw new Error('无法连接本地服务，请检查启动状态与端口。')
    throw e
  } finally { clearTimeout(timeout) }
}
export const post = <T>(p: Platform, path: string, body: unknown) => request<T>(p, path, { method: 'POST', body: JSON.stringify(body) })
/** 平台先验证旧密钥再轮换；网关直接由旧密钥授权更新，支持重新接入已轮换服务。 */
export async function saveKey(p: Platform, next: string, remember: boolean) {
  if (!/^klee-[\x21-\x7e]{3,251}$/.test(next)) throw new Error('API Key 须以 klee- 开头，长度 8–256 个可见 ASCII 字符，不含空白。')
  const previous = session.keys[p]
  const path = p === 'gateway' ? '/api/gateway/status' : '/api/accounts'
  if (p === 'gateway') {
    try { await request(p, '/api/key', { method: 'POST', body: JSON.stringify({ apiKey: next }) }, previous || next) }
    catch (e) { if (!previous || !(e instanceof ApiError) || ![401, 403].includes(e.status)) throw e; await request(p, path, {}, next) }
  } else {
    let valid = false
    if (previous) { try { await request(p, path, {}, previous); valid = true } catch (e) { if (!(e instanceof ApiError) || ![401, 403].includes(e.status)) throw e } }
    if (valid && previous !== next) await request(p, '/api/key', { method: 'POST', body: JSON.stringify({ apiKey: next }) }, previous)
    else if (!valid) await request(p, path, {}, next)
  }
  saveLocal(p, next, remember)
}
