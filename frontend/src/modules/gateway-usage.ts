import type { EChartsOption } from 'echarts'
import type { Platform } from '../types'
// 显式扩展名让 Node 的单元测试也能直接加载本模块（tsconfig 已开启 allowImportingTsExtensions）。
import { names } from './session.ts'

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
  routeAttempts?: GatewayRouteAttempt[]
  estimatedCredits?: number | null
  creditEstimate?: { amount: number; balanceBefore: number; balanceAfter: number; unit: string; measuredAt: number } | null
}

export type GatewayRouteAttempt = Pick<GatewayCall, 'model' | 'platform' | 'region' | 'account' | 'status' | 'httpStatus' | 'errorCode' | 'durationMs' | 'inputTokens' | 'outputTokens' | 'totalTokens' | 'credits' | 'estimatedCredits' | 'creditEstimate'>

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
  settings: UsageSettings
  storedConversations: number
}

export interface UsageSettings {
  mode: 'stats' | 'content'
  retentionDays: 0 | 7 | 30 | 90
}

export const callStatuses = { success: '成功', failed: '失败', canceled: '已取消' }
export const platformName = (row: Pick<GatewayCall, 'platform'>) => row.platform ? names[row.platform] : '未路由'
export const regionName = (region: string | null) => region === 'cn' ? '国内版' : region === 'global' ? '国际版' : '未知地区'
export const creditGroup = (row: GatewayCall) => platformName(row) + ' · ' + regionName(row.region)
export const formatUsage = (value: number | null) => value === null
  ? '未上报'
  : value.toLocaleString('zh-CN', { maximumFractionDigits: 6 })
export const hasCreditEstimate = (row: Pick<GatewayCall, 'credits' | 'estimatedCredits'>) => row.credits === null && typeof row.estimatedCredits === 'number' && Number.isFinite(row.estimatedCredits)
export const creditText = (row: GatewayCall) => row.credits !== null ? formatUsage(row.credits) : hasCreditEstimate(row) ? formatUsage(row.estimatedCredits!) + '（估算）' : '暂无数据'

export const isAutoUsageModel = (model: string) => model.startsWith('auto/')

/** 按已记录的实际尝试归属用量。同一请求重试时，每次尝试都单独计数。 */
export function summarizeAutoModelUsage(records: GatewayCall[], groupId: string) {
  const requests = records.filter(row => row.model === groupId)
  const byModel = new Map<string, GatewayRouteAttempt[]>()
  let untrackedRequests = 0
  for (const request of requests) {
    // 旧记录未保存路径时，最后返回的上游名无法还原完整的尝试归属。
    const attempts = request.routeAttempts ?? []
    if (attempts.length < request.attempts) untrackedRequests++
    for (const attempt of attempts) {
      const rows = byModel.get(attempt.model)
      if (rows) rows.push(attempt)
      else byModel.set(attempt.model, [attempt])
    }
  }
  const models = [...byModel].map(([model, attempts]) => {
    const first = attempts[0]!
    const totals = (values: (number | null | undefined)[]) => {
      const known = values.filter((value): value is number => typeof value === 'number' && Number.isFinite(value))
      return { value: known.length ? known.reduce((sum, value) => sum + value, 0) : null, count: known.length }
    }
    return {
      model,
      platform: platformName(first),
      region: regionName(first.region),
      attempts: attempts.length,
      success: attempts.filter(row => row.status === 'success').length,
      failed: attempts.filter(row => row.status === 'failed').length,
      canceled: attempts.filter(row => row.status === 'canceled').length,
      tokens: totals(attempts.map(row => row.totalTokens)),
      credits: totals(attempts.map(row => row.credits)),
      estimatedCredits: totals(attempts.map(row => hasCreditEstimate(row) ? row.estimatedCredits : null)),
    }
  }).sort((a, b) => b.attempts - a.attempts || a.model.localeCompare(b.model))
  return { requests: requests.length, untrackedRequests, attempts: models.reduce((sum, model) => sum + model.attempts, 0), models }
}

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
export function usageTrend(records: GatewayCall[], metric: 'calls' | 'tokens' | 'credits', group: string, light: boolean, view: { type?: 'bar' | 'line'; stacked?: boolean; showValues?: boolean; expanded?: boolean } = {}): EChartsOption {
  const days = new Map<string, GatewayCall[]>()
  for (const row of records) {
    const day = dayLabel(row.startedAt)
    const bucket = days.get(day) ?? []
    bucket.push(row)
    days.set(day, bucket)
  }
  const labels = [...days.keys()].sort()
  const rows = labels.map(day => days.get(day) ?? [])
  const skin = chartSkin(light)
  const type = view.type ?? 'bar'
  const stacked = view.stacked !== false
  const base = chartBase(light, type, metric === 'calls' ? '次' : metric === 'tokens' ? 'Token' : '')
  const barStyle = type === 'line' ? {} : {
    barMaxWidth: 26,
    barCategoryGap: '42%',
    itemStyle: { borderColor: skin.paper, borderWidth: stacked ? 1 : 0, borderRadius: stacked ? [3, 3, 0, 0] : [6, 6, 0, 0] },
  }
  const emphasis = (index: number) => type === 'bar'
    ? barEmphasis(skin.palette[index % skin.palette.length]!)
    : { focus: 'none' as const, lineStyle: { width: 3.5 } }
  // 柱体由浅到深渐变，避免大色块压过手账的柔和质感；折线保持纯色以突出走势。
  const tinted = (index: number) => type === 'line' ? undefined : { ...barStyle.itemStyle, color: gradient(alpha(skin.palette[index % skin.palette.length], light ? .55 : .45), skin.palette[index % skin.palette.length], 'y') }
  return {
    ...base,
    grid: { top: view.expanded ? 46 : 40, left: 12, right: 30, bottom: view.expanded ? 60 : 10, containLabel: true },
    dataZoom: view.expanded ? [{ type: 'slider', bottom: 4, height: 22, borderColor: skin.axis, fillerColor: skin.filler, textStyle: { color: skin.text, fontFamily: skin.fontFamily }, dataBackground: { lineStyle: { color: skin.accent }, areaStyle: { color: skin.accent } }, handleStyle: { color: skin.paper, borderColor: skin.accent }, moveHandleStyle: { color: skin.filler } }, { type: 'inside' }] : [],
    legend: { top: 0, icon: type === 'line' ? 'circle' : 'roundRect', itemWidth: 12, itemHeight: 8, itemGap: 16, textStyle: { color: skin.text, fontFamily: skin.fontFamily, fontSize: 11 }, inactiveColor: skin.inactive },
    xAxis: { type: 'category', data: labels, axisLabel: { hideOverlap: true, color: skin.text, fontFamily: skin.fontFamily, fontSize: 11 }, axisLine: { lineStyle: { color: skin.axis } }, axisTick: { show: false } },
    yAxis: {
      type: 'value', minInterval: metric === 'credits' ? undefined : 1,
      axisLabel: { color: skin.text, fontFamily: skin.fontFamily, fontSize: 11 },
      axisLine: { show: false }, axisTick: { show: false },
      splitLine: { lineStyle: { color: skin.split, type: 'dashed' } },
    },
    series: metric === 'calls'
      ? (Object.keys(callStatuses) as GatewayCall['status'][]).map((status, index) => ({
          name: callStatuses[status], type, stack: stacked ? 'calls' : undefined, ...barStyle,
          itemStyle: tinted(index),
          emphasis: emphasis(index),
          smooth: type === 'line', symbol: 'circle', symbolSize: 7, lineStyle: { width: 2.5 },
          label: { show: !!view.showValues, position: type === 'line' ? 'top' : 'inside', color: type === 'line' ? skin.text : skin.labelOnBar, fontSize: 11, fontFamily: skin.fontFamily },
          data: rows.map(bucket => bucket.filter(row => row.status === status).length),
        }))
      : (metric === 'tokens' ? ['tokens'] : ['reported', 'estimated']).map((source, index) => ({
          name: source === 'tokens' ? 'Token' : source === 'estimated' ? '积分（估算）' : '平台上报积分',
          type,
          smooth: type === 'line', symbol: 'circle', symbolSize: 7, lineStyle: { width: 2.5 },
          ...barStyle,
          itemStyle: tinted(index),
          emphasis: emphasis(index),
          label: { show: !!view.showValues, position: 'top', color: skin.text, fontSize: 11, fontFamily: skin.fontFamily },
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

export function rankUsageModels(records: GatewayCall[], limit = 8): [string, number][] {
  const counts = new Map<string, number>()
  for (const row of records) counts.set(row.model, (counts.get(row.model) ?? 0) + 1)
  return [...counts].sort((a, b) => b[1] - a[1]).slice(0, limit)
}

/** 以请求模型名称为统计口径，默认显示调用次数前八名。 */
export function usageModels(records: GatewayCall[], light: boolean, view: { limit?: number; showValues?: boolean; expanded?: boolean } = {}): EChartsOption {
  const top = rankUsageModels(records, view.limit)
  const skin = chartSkin(light)
  const base = chartBase(light, 'bar')
  return {
    ...base,
    grid: { top: 12, left: 12, right: view.showValues ? 52 : 26, bottom: 10, containLabel: true },
    xAxis: { type: 'value', minInterval: 1, splitNumber: 3, axisLabel: { hideOverlap: true, color: skin.text, fontFamily: skin.fontFamily, fontSize: 11 }, axisLine: { show: false }, axisTick: { show: false }, splitLine: { lineStyle: { color: skin.split, type: 'dashed' } } },
    yAxis: { type: 'category', inverse: true, data: top.map(([model]) => model), axisLabel: { width: view.expanded ? 260 : 110, overflow: view.expanded ? 'break' : 'truncate', color: skin.text, fontFamily: skin.fontFamily, fontSize: 11 }, axisLine: { lineStyle: { color: skin.axis } }, axisTick: { show: false } },
    series: [{
      type: 'bar', name: '调用次数', barMaxWidth: 16, barCategoryGap: '38%',
      itemStyle: { color: gradient(skin.barFrom, skin.barTo, 'x'), borderRadius: [0, 6, 6, 0] },
      emphasis: barEmphasis(skin.palette[0]!),
      label: { show: !!view.showValues, position: 'right', color: skin.text, fontSize: 11, fontFamily: skin.fontFamily },
      data: top.map(([, count]) => count),
    }],
  }
}

function gradient(from: string, to: string, axis: 'x' | 'y') {
  return { type: 'linear' as const, x: 0, y: 0, x2: axis === 'x' ? 1 : 0, y2: axis === 'x' ? 0 : 1, colorStops: [{ offset: 0, color: from }, { offset: 1, color: to }] }
}

/** 把 #rrggbb 与透明度合成 rgba，让柱体渐变在两种主题下都保持柔和。 */
function alpha(hex: string, opacity: number) {
  const value = parseInt(hex.slice(1), 16)
  return `rgba(${value >> 16 & 255}, ${value >> 8 & 255}, ${value & 255}, ${opacity})`
}

function barEmphasis(hex: string) {
  const value = parseInt(hex.slice(1), 16)
  const brighten = (channel: number) => Math.round(channel + (255 - channel) * .15)
  const color = `rgb(${brighten(value >> 16 & 255)}, ${brighten(value >> 8 & 255)}, ${brighten(value & 255)})`
  // 同色描边只将柱体外扩约 1px，不改变堆叠高度或数据刻度。
  return { focus: 'none' as const, itemStyle: { color, borderColor: color, borderWidth: 2, shadowBlur: 0 } }
}

/** 两种外观共用同一套图表语义：可莉主题以玫瑰粉为主色，默认主题保持冷灰。 */
interface ChartSkin {
  palette: string[]
  text: string
  ink: string
  axis: string
  split: string
  paper: string
  labelOnBar: string
  accent: string
  filler: string
  inactive: string
  shadow: string
  barFrom: string
  barTo: string
  fontFamily: string
}

function chartSkin(light: boolean): ChartSkin {
  return light
    ? {
        // 可莉主题以玫瑰粉为主色：趋势图“成功”与“模型调用量”同色，两图观感一致。
        palette: ['#b3546a', '#7a6a94', '#c08a3e', '#4c7d63'],
        text: '#846071', ink: '#784559', axis: '#e4c9d1', split: '#f0dde2', paper: '#fffdfb',
        labelOnBar: '#fffdfb', accent: '#b34462', filler: '#b3446218', inactive: '#d9c2c9',
        shadow: '#b3446233', barFrom: '#c9768a', barTo: '#b3546a', fontFamily: '"Segoe UI", "Microsoft YaHei", sans-serif',
      }
    : {
        palette: ['#a5ddc5', '#e49c97', '#e1bc7b', '#9db4d8'],
        text: '#98a3a3', ink: '#edf3f0', axis: '#343c3d', split: '#2a3031', paper: '#181c1d',
        labelOnBar: '#101314', accent: '#a5ddc5', filler: '#a5ddc518', inactive: '#4a5253',
        shadow: '#00000055', barFrom: '#a5ddc5', barTo: '#5f8f7b', fontFamily: '"Segoe UI Variable", "Segoe UI", "Microsoft YaHei", sans-serif',
      }
}

// 模型名来自调用记录，HTML 提示卡必须先转义再插入。
function escapeTooltip(value: string) {
  return value.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;').replace(/'/g, '&#39;')
}

function chartBase(light: boolean, type: 'bar' | 'line', unit = '次'): EChartsOption {
  const skin = chartSkin(light)
  return {
    animation: false,
    color: skin.palette,
    textStyle: { color: skin.text, fontFamily: skin.fontFamily },
    tooltip: {
      trigger: 'axis', renderMode: 'html', confine: true, padding: [12, 14],
      className: 'usage-chart-tooltip' + (light ? ' is-klee' : ''),
      enterable: false, transitionDuration: 0, hideDelay: 0,
      backgroundColor: skin.paper, borderColor: skin.axis, borderWidth: 1,
      textStyle: { color: skin.ink, fontFamily: skin.fontFamily, fontSize: 12, lineHeight: 20 },
      extraCssText: `border-radius:12px;box-shadow:0 8px 24px ${skin.shadow};white-space:normal;min-width:156px;max-width:min(300px, calc(100% - 16px));box-sizing:border-box;--usage-tooltip-muted:${skin.text};--usage-tooltip-rule:${skin.split};`,
      formatter: params => {
        const items = Array.isArray(params) ? params : [params]
        if (!items.length) return ''
        const title = escapeTooltip(String(items[0]!.name ?? ''))
        const rows = items.map(item => {
          const known = typeof item.value === 'number' && Number.isFinite(item.value)
          const value = known ? formatUsage(item.value as number) : '未上报'
          const color = skin.palette[(item.seriesIndex ?? 0) % skin.palette.length]
          return `<div class="usage-tooltip-row"><span class="usage-tooltip-dot" style="background:${color}"></span><span class="usage-tooltip-label">${escapeTooltip(item.seriesName ?? '')}</span><span class="usage-tooltip-value"><strong>${value}</strong>${known && unit ? `<small>${unit}</small>` : ''}</span></div>`
        }).join('')
        return `<div class="usage-tooltip-title">${title}</div><div class="usage-tooltip-rows">${rows}</div>`
      },
      position: (point, _params, _element, _rect, size) => {
        const [width, height] = size.contentSize
        const [viewWidth, viewHeight] = size.viewSize
        const x = point[0] + width + 20 <= viewWidth ? point[0] + 12 : point[0] - width - 12
        const y = point[1] - height - 12 >= 8 ? point[1] - height - 12 : point[1] + 12
        return [Math.max(8, Math.min(x, viewWidth - width - 8)), Math.max(8, Math.min(y, viewHeight - height - 8))]
      },
      axisPointer: { type: type === 'bar' ? 'none' : 'line', lineStyle: { color: alpha(skin.accent, .4), width: 1, type: 'dashed' } },
    },
  }
}
