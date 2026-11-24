import { baseURL, saveLocal, session } from '../modules/session'
import type { Platform } from '../types'
export class ApiError extends Error { constructor(message: string, public status = 0, public code = '') { super(message) } }
/** 所有业务请求只读取已保存的密钥；轮换流程可显式提供旧密钥。 */
export async function request<T>(platform: Platform, path: string, options: RequestInit = {}, key = session.keys[platform]): Promise<T> {
  if (!key && path !== '/api/key/local') throw new Error('请先填写并保存此服务的 API Key。')
  const controller = new AbortController()
  const timeout = setTimeout(() => controller.abort(), /monitor|checkin|gateway/.test(path) ? 120000 : 30000)
  try {
    const response = await fetch(baseURL(platform) + path, { ...options, signal: controller.signal, headers: { 'Content-Type': 'application/json', ...(key ? { Authorization: `Bearer ${key}` } : {}), ...options.headers } })
    let data
    try { const text = await response.text(); data = text ? JSON.parse(text) : {} } catch { throw new Error('服务返回了无效 JSON。') }
    if (!response.ok) {
      const message = data.error?.message || (typeof data.error === 'string' ? data.error : data.message)
      const invalidKey = data.error?.code === 'invalid_api_key' || (!data.error?.code && response.status === 401 && (!message || /api[ _-]?key/i.test(message)))
      throw new ApiError(invalidKey ? 'API Key 无效，请在连接设置中保存自定义 Key。' : message || `请求失败 (${response.status})`, response.status, invalidKey ? 'invalid_api_key' : data.error?.code)
    }
    return data as T
  } catch (e) {
    if (controller.signal.aborted) throw new Error('请求超时；保留上次结果，请稍后重试。')
    if (e instanceof TypeError) throw new Error('无法连接本地服务，请检查启动状态与端口。')
    throw e
  } finally { clearTimeout(timeout) }
}
export const post = <T>(p: Platform, path: string, body: unknown) => request<T>(p, path, { method: 'POST', body: JSON.stringify(body) })
/** 本机控制台直接设置自定义 Key，不依赖浏览器中的旧值。 */
export async function saveKey(p: Platform, next: string, remember: boolean) {
  next = next.trim()
  if (!/^klee-[\x21-\x7e]{3,251}$/.test(next)) throw new Error('API Key 须以 klee- 开头，长度 8–256 个可见 ASCII 字符，不含空白。')
  await request(p, '/api/key/local', { method: 'POST', body: JSON.stringify({ apiKey: next }) }, '')
  saveLocal(p, next, remember)
}
/** 仅用户点击报错后的补填按钮时读取当前值，不写入浏览器或轮换服务端 Key。 */
export async function recoverKey(p: Platform) {
  const data = await request<{ apiKey: string }>(p, '/api/key/local', { method: 'POST', body: '{}' }, '')
  if (typeof data.apiKey !== 'string' || !/^klee-[\x21-\x7e]{3,251}$/.test(data.apiKey)) throw new Error('未读取到有效 Key，请检查本地服务。')
  return data.apiKey
}
