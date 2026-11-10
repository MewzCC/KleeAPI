import type { Account, Platform, Snapshot } from '../types'
export interface CheckinTarget { all?: boolean; uid?: string; platform?: Platform }

export function summarizeCheckins(snapshot?: Snapshot, accounts?: Account[], now = Date.now()) {
  const key = (a: Account) => JSON.stringify([a.platform || '', a.uid])
  const results = new Map(snapshot?.accounts.map(a => [key(a), a]))
  const rows = accounts ?? snapshot?.accounts ?? []
  const summary = { done: 0, total: rows.length, noActivity: 0, disabled: 0, unknown: 0 }
  for (const account of rows) {
    const row = results.get(key(account))
    if ((account.enabled ?? row?.enabled) === false || ['disabled', 'skipped'].includes(row?.status || '')) { summary.disabled++; continue }
    const outsideWindow = row && (row.endsAt && now >= new Date(row.endsAt).getTime() || row.startsAt && now < new Date(row.startsAt).getTime())
    if (!row || outsideWindow || snapshot?.platforms?.some(p => p.platform === account.platform && p.error) || ['unknown', 'failed', 'pending'].includes(row.status || '')) { summary.unknown++; continue }
    if (row.checkedIn === true || ['claimed', 'already'].includes(row.status || '')) summary.done++
    else if (row.status === 'no_activity') summary.noActivity++
    else if (row.checkedIn !== false && row.status !== 'available') summary.unknown++
  }
  return summary
}

export function mergeCheckins(previous: Snapshot | undefined, data: Snapshot, target: CheckinTarget): Snapshot {
  const rows = previous?.accounts || []
  const same = (a: Account, b: Account) => a.uid === b.uid && a.platform === b.platform
  const metadata = (a?: Account): Partial<Account> => a ? Object.fromEntries(['uid', 'platform', 'nickname', 'region', 'enabled', 'active'].filter(key => key in a).map(key => [key, a[key as keyof Account]])) : {}
  const affected = (a: Account) => target.uid ? a.uid === target.uid && (!target.platform || a.platform === target.platform) : !target.platform || a.platform === target.platform
  const oldPlatforms = previous?.platforms || []
  const retained = rows.filter(a => !affected(a))
  const uncertain = rows.filter(a => affected(a) && data.platforms?.some(p => p.platform === a.platform && p.error)).map(a => ({ ...metadata(a), uid: a.uid, status: 'unknown', checkedIn: null, message: data.platforms?.find(p => p.platform === a.platform)?.error }))
  const updated = data.accounts.map(a => ({ ...metadata(rows.find(b => same(a, b))), ...a }))
  return { ...data, platforms: [...oldPlatforms.filter(a => !data.platforms?.some(b => b.platform === a.platform)), ...(data.platforms || [])], accounts: [...retained, ...uncertain, ...updated] }
}
