import type { EChartsOption } from 'echarts'
import type { Platform } from '../types'
import { names } from './session'

export interface GatewayCall {
  id: string
  startedAt: number
  model: string
  upstreamModel: string | null
  platform: Exclude<Platform, 'gateway'> | null
  region: string | null
  account: string | null
  status: 'success' | 'failed' | 'canceled'
  httpStatus: number
  errorCode: string | null
  durationMs: number
  stream: boolean
  attempts: number
  inputTokens: number | null
  outputTokens: number | null
  totalTokens: number | null
  credits: number | null
  hasConversation?: boolean
  estimatedCredits?: number | null
  creditEstimate?: { amount: number; balanceBefore: number; balanceAfter: number; unit: string; measuredAt: number } | null
}

export interface ConversationMessage {
  role: string
  name?: string
  index?: number
  content: string
  reasoning?: string
  tools?: { name: string; arguments: string }[]
}
export interface ConversationLog {
  request: ConversationMessage[]
  response: ConversationMessage[]
  truncated: boolean
  complete: boolean
}

export interface GatewayUsage {
  records: GatewayCall[]
  limit: number
  warning: string
}

export const callStatuses = { success: '成功', failed: '失败', canceled: '已取消' }
export const platformName = (row: GatewayCall) => row.platform ? names[row.platform] : '未路由'
export const regionName = (region: string | null) => region === 'cn' ? '国内版' : region === 'global' ? '国际版' : '未知地区'
export const creditGroup = (row: GatewayCall) => platformName(row) + ' · ' + regionName(row.region)
export const formatUsage = (value: number | null) => value === null
  ? '未上报'
  : value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
export const hasCreditEstimate = (row: GatewayCall) => row.credits === null && typeof row.estimatedCredits === 'number' && Number.isFinite(row.estimatedCredits)
export const creditText = (row: GatewayCall) => row.credits !== null ? formatUsage(row.credits) : hasCreditEstimate(row) ? formatUsage(row.estimatedCredits!) + '（估算）' : '暂无数据'

const dayLabel = (timestamp: number) => new Date(timestamp).toLocaleDateString('sv-SE')

/** 按当前筛选范围汇总，仅累加已上报的用量，各地区积分独立统计。 */
export function summarizeUsage(records: GatewayCall[]) {
  const knownTokens = records.filter(row => row.totalTokens !== null)
  const knownCredits = records.filter(row => row.credits !== null)
  const estimatedRows = records.filter(hasCreditEstimate)
  const estimatedCredits = new Map<string, number>()
  for (const row of estimatedRows) {
    const group = creditGroup(row)
    estimatedCredits.set(group, (estimatedCredits.get(group) ?? 0) + row.estimatedCredits!)
  }
  const credits = new Map<string, number>()
  for (const row of knownCredits) {
    const group = creditGroup(row)
    credits.set(group, (credits.get(group) ?? 0) + (row.credits ?? 0))
  }
  return {
    successful: records.filter(row => row.status === 'success').length,
    tokenCount: knownTokens.length,
    tokens: knownTokens.length ? knownTokens.reduce((sum, row) => sum + (row.totalTokens ?? 0), 0) : null,
    creditCount: knownCredits.length,
    credits,
    estimatedCredits,
    estimateCount: estimatedRows.length,
    latency: records.length ? Math.round(records.reduce((sum, row) => sum + row.durationMs, 0) / records.length) : null,
  }
}

/** 按本地日期生成趋势图，并保留没有积分数据的日期为缺失值。 */
export function usageTrend(records: GatewayCall[], metric: 'calls' | 'tokens' | 'credits', group: string, light: boolean): EChartsOption {
  const days = new Map<string, GatewayCall[]>()
  for (const row of records) {
    const day = dayLabel(row.startedAt)
    const bucket = days.get(day) ?? []
    bucket.push(row)
    days.set(day, bucket)
  }
  const labels = [...days.keys()].sort()
  const rows = labels.map(day => days.get(day) ?? [])
  const base = chartBase(light)
  return {
    ...base,
    grid: { top: 34, left: 12, right: 16, bottom: 10, containLabel: true },
    legend: { top: 0, textStyle: base.textStyle },
    xAxis: { type: 'category', data: labels, axisLabel: { hideOverlap: true, color: base.textStyle?.color } },
    yAxis: {
      type: 'value', minInterval: metric === 'credits' ? undefined : 1,
      axisLabel: { color: base.textStyle?.color },
      splitLine: { lineStyle: { color: light ? '#e5d4db' : '#323d50' } },
    },
    series: metric === 'calls'
      ? (Object.keys(callStatuses) as GatewayCall['status'][]).map(status => ({
          name: callStatuses[status], type: 'bar', stack: 'calls', barMaxWidth: 30,
          data: rows.map(bucket => bucket.filter(row => row.status === status).length),
        }))
      : (metric === 'tokens' ? ['tokens'] : ['reported', 'estimated']).map(source => ({
          name: source === 'tokens' ? 'Token' : source === 'estimated' ? '积分（估算）' : '平台上报积分',
          type: 'bar',
          barMaxWidth: 30,
          data: rows.map(bucket => {
            const values = bucket
              .filter(row => metric !== 'credits' || creditGroup(row) === group)
              .map(row => source === 'tokens' ? row.totalTokens : source === 'estimated' ? hasCreditEstimate(row) ? row.estimatedCredits! : null : row.credits)
              .filter((value): value is number => value !== null)
            return values.length ? values.reduce((sum, value) => sum + value, 0) : null
          }),
        })),
  }
}

/** 按调用次数显示前八个模型，以请求模型名称为统计口径。 */
export function usageModels(records: GatewayCall[], light: boolean): EChartsOption {
  const counts = new Map<string, number>()
  for (const row of records) counts.set(row.model, (counts.get(row.model) ?? 0) + 1)
  const top = [...counts].sort((a, b) => b[1] - a[1]).slice(0, 8)
  const base = chartBase(light)
  return {
    ...base,
    grid: { top: 12, left: 12, right: 18, bottom: 10, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, axisLabel: { color: base.textStyle?.color }, splitLine: { lineStyle: { color: light ? '#e5d4db' : '#323d50' } } },
    yAxis: { type: 'category', inverse: true, data: top.map(([model]) => model), axisLabel: { width: 110, overflow: 'truncate', color: base.textStyle?.color } },
    series: [{ type: 'bar', name: '调用次数', barMaxWidth: 18, data: top.map(([, count]) => count) }],
  }
}

function chartBase(light: boolean): EChartsOption {
  return {
    animation: false,
    color: light ? ['#4164ad', '#b84e68', '#86653d'] : ['#8ca9ff', '#f4978e', '#e1c18e'],
    textStyle: { color: light ? '#634c55' : '#bdc9dc' },
    tooltip: {
      trigger: 'axis', renderMode: 'richText', confine: true,
      valueFormatter: value => typeof value === 'number' ? formatUsage(value) : '未上报',
    },
  }
}
