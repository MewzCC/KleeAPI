import type { Account } from '../types'

/** 仅用平台明确返回的余额和总额度计算比例；不拿账号之间的余额作比较。 */
export function balancePercentage(account: Account): number | null {
  if (account.quotaError || account.unlimited || typeof account.remaining !== 'number' || !Number.isFinite(account.remaining)
    || typeof account.limit !== 'number' || !Number.isFinite(account.limit) || account.limit < 0) return null
  if (account.limit === 0) return account.remaining === 0 ? 0 : null
  return Math.max(0, Math.min(100, Math.round(account.remaining / account.limit * 1000) / 10))
}
