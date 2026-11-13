import { names } from './session'
import type { Platform } from '../types'

export interface AutoTarget {
  model: string
  enabled: boolean
  availableAccounts?: number
  cooldownUntil?: number
  lastSuccessAt?: number
  lastFailureAt?: number
  errorCode?: string | null
}
export interface AutoGroup {
  id: string
  name: string
  enabled: boolean
  targets: AutoTarget[]
  attemptTimeoutMs: number
  totalTimeoutMs: number
  maxAttempts: number
  cooldownMs: number
  retryOnTimeout: boolean
}
export interface AutoModel { id: string; name?: string; availableAccounts: number }
export interface AutoSnapshot { groups: AutoGroup[]; warning?: string | null; models: AutoModel[] }

/** Only editable fields cross the write boundary; runtime health stays on the server. */
export function editableGroup(group: AutoGroup): AutoGroup {
  return {
    id: group.id, name: group.name, enabled: group.enabled,
    targets: group.targets.map(({ model, enabled }) => ({ model, enabled })),
    attemptTimeoutMs: group.attemptTimeoutMs, totalTimeoutMs: group.totalTimeoutMs,
    maxAttempts: group.maxAttempts, cooldownMs: group.cooldownMs, retryOnTimeout: group.retryOnTimeout,
  }
}
export const newAutoGroup = (): AutoGroup => ({ id: 'auto/', name: '', enabled: true, targets: [], attemptTimeoutMs: 30000, totalTimeoutMs: 120000, maxAttempts: 20, cooldownMs: 30000, retryOnTimeout: true })
export const modelPlatform = (id: string) => id.split('/')[0] || ''
export const modelPlatformName = (id: string) => names[modelPlatform(id) as Platform] || modelPlatform(id)

export function validateAutoGroup(group: AutoGroup): string {
  if (!/^auto\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(group.id)) return '模型 ID 须为 auto/ 加 1–64 位字符，以字母或数字开头，可包含点、横线或下划线。'
  if (!group.name.trim()) return '请填写模型组名称。'
  if (group.name.trim().length > 80) return '模型组名称最多 80 个字符。'
  if (group.targets.length > 20) return '每组最多选择 20 个候选模型。'
  if (group.enabled && !group.targets.some(target => target.enabled)) return '启用的模型组至少需要一个启用的候选模型。'
  if (new Set(group.targets.map(target => target.model)).size !== group.targets.length || group.targets.some(target => !target.model || target.model.startsWith('auto/'))) return '候选模型必须是去重的真实模型 ID。'
  for (const [value, min, max, name] of [[group.attemptTimeoutMs, 1000, 120000, '单次超时'], [group.totalTimeoutMs, 1000, 300000, '总超时'], [group.maxAttempts, 1, 60, '最多尝试'], [group.cooldownMs, 1000, 300000, '失败冷却']] as const) {
    if (!Number.isInteger(value) || value < min || value > max) return `${name}须为 ${min}–${max} 之间的整数。`
  }
  if (group.attemptTimeoutMs > group.totalTimeoutMs) return '单次超时不能超过总超时。'
  return ''
}
