<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { request } from '../api/client'
import { kleeTheme } from '../modules/decoration'
import { date, names, safe, session } from '../modules/session'
import {
  callStatuses, creditGroup, creditText, hasCreditEstimate, formatUsage, platformName, regionName, summarizeUsage,
  usageModels, usageTrend, type GatewayCall, type GatewayUsage, type ConversationLog,
} from '../modules/gateway-usage'
import GatewayUsageChart from './GatewayUsageChart.vue'

const snapshot = ref<GatewayUsage>()
const busy = ref(false)
const error = ref('')
const days = ref(7)
const platform = ref('all')
const status = ref('all')
const search = ref('')
const metric = ref<'calls' | 'tokens' | 'credits'>('calls')
const preferredGroup = ref('')
const page = ref(1)
const selected = ref<GatewayCall>()
const detailOpen = ref(false)
const detailTab = ref('info')
const conversation = ref<ConversationLog | null>(null)
const detailLoading = ref(false), detailError = ref('')
let detailVersion = 0
const fetchedAt = ref(Date.now())
let requestVersion = 0
const pageSize = 15

/** 刷新保留上次成功结果，切换 Key 后隔离旧请求和记录。 */
async function refresh() {
  const version = ++requestVersion
  if (!session.keys.gateway) return
  busy.value = true
  error.value = ''
  try {
    const data = await request<GatewayUsage>('gateway', '/api/gateway/usage')
    if (version !== requestVersion) return
    if (!Array.isArray(data.records)) throw new Error('网关返回了无效的调用记录。')
    snapshot.value = data
    fetchedAt.value = Date.now()
    page.value = 1
  } catch (failure) {
    if (version === requestVersion) error.value = safe(failure)
  } finally {
    if (version === requestVersion) busy.value = false
  }
}

watch(() => session.keys.gateway, () => {
  snapshot.value = undefined
  detailOpen.value = false
  detailVersion++
  conversation.value = null
  detailLoading.value = false
  detailError.value = ''
  error.value = ''
  busy.value = false
  void refresh()
}, { immediate: true })
watch([days, platform, status, search], () => { page.value = 1 })

const filtered = computed(() => {
  const since = new Date(fetchedAt.value)
  since.setHours(0, 0, 0, 0)
  since.setDate(since.getDate() - days.value + 1)
  const query = search.value.trim().toLowerCase()
  return (snapshot.value?.records ?? []).filter(row =>
    (!days.value || row.startedAt >= since.getTime()) &&
    (platform.value === 'all' || row.platform === platform.value) &&
    (status.value === 'all' || row.status === status.value) &&
    (!query || [row.model, row.upstreamModel, row.account].some(value => value?.toLowerCase().includes(query))),
  )
})
const visible = computed(() => filtered.value.slice((page.value - 1) * pageSize, page.value * pageSize))
const summary = computed(() => summarizeUsage(filtered.value))
const creditGroups = computed(() => [...new Set([...summary.value.credits.keys(), ...summary.value.estimatedCredits.keys()])].sort())
const group = computed({
  get: () => creditGroups.value.includes(preferredGroup.value) ? preferredGroup.value : creditGroups.value[0] ?? '',
  set: (value: string) => { preferredGroup.value = value },
})
const trend = computed(() => usageTrend(filtered.value, metric.value, group.value, kleeTheme.value))
const models = computed(() => usageModels(filtered.value, kleeTheme.value))
const hasMetricData = computed(() =>
  metric.value === 'calls' ? filtered.value.length > 0 :
    metric.value === 'tokens' ? summary.value.tokenCount > 0 : !!group.value,
)
const latency = (value: number | null) => value === null ? '—' : value >= 1000
  ? (value / 1000).toFixed(2) + ' s' : value + ' ms'

const messageRole = (role: string) => ({ user: '用户', assistant: '助手', system: '系统', developer: '开发者', tool: '工具' }[role] || role)
async function showDetail(row: GatewayCall) {
  const version = ++detailVersion
  selected.value = row
  detailTab.value = row.hasConversation ? 'conversation' : 'info'
  detailOpen.value = true
  conversation.value = null
  detailError.value = ''
  detailLoading.value = false
  if (!row.hasConversation) return
  detailLoading.value = true
  try {
    const data = await request<{ conversation: ConversationLog | null; warning: string }>('gateway', '/api/gateway/usage/' + encodeURIComponent(row.id))
    if (version !== detailVersion) return
    if (data.conversation && (!Array.isArray(data.conversation.request) || !Array.isArray(data.conversation.response))) throw Error('此记录的对话内容格式无效。')
    conversation.value = data.conversation
    detailError.value = data.warning || (data.conversation ? '' : '此记录的本地对话内容暂不可用。')
  } catch (failure) { if (version === detailVersion) detailError.value = safe(failure) }
  finally { if (version === detailVersion) detailLoading.value = false }
}
</script>

<template>
  <el-card shadow="never" class="usage-panel" v-loading="busy">
    <el-row align="middle" justify="space-between" class="usage-heading">
      <el-text tag="h2">网关用量</el-text>
      <el-button :loading="busy" :disabled="!session.keys.gateway" @click="refresh">刷新记录</el-button>
    </el-row>
    <el-alert v-if="error" :title="error" type="error" :closable="false" show-icon />
    <el-alert v-if="snapshot?.warning" :title="snapshot.warning" type="warning" :closable="false" show-icon />
    <el-empty v-if="!session.keys.gateway" description="请先保存网关 API Key。" />
    <template v-else-if="snapshot">
      <el-row class="usage-filters">
        <el-select v-model="days" aria-label="时间范围">
          <el-option label="最近 7 天" :value="7" />
          <el-option label="最近 30 天" :value="30" />
          <el-option label="全部保留记录" :value="0" />
        </el-select>
        <el-select v-model="platform" aria-label="平台">
          <el-option label="全部平台" value="all" />
          <el-option v-for="p in (['workbuddy', 'trae', 'qoder'] as const)" :key="p" :label="names[p]" :value="p" />
        </el-select>
        <el-select v-model="status" aria-label="调用状态">
          <el-option label="全部状态" value="all" />
          <el-option v-for="(label, key) in callStatuses" :key="key" :label="label" :value="key" />
        </el-select>
        <el-input v-model="search" clearable placeholder="搜索模型或账号" aria-label="搜索模型或账号" />
      </el-row>

      <el-row class="usage-stats">
        <el-statistic title="调用次数" :value="filtered.length" />
        <el-statistic title="成功率" :value="filtered.length ? summary.successful / filtered.length * 100 : '—'" :precision="1">
          <template v-if="filtered.length" #suffix>%</template>
        </el-statistic>
        <el-statistic title="已上报 Token" :value="summary.tokens ?? '—'" />
        <el-statistic title="平均耗时" :value="latency(summary.latency)" />
      </el-row>
      <el-row class="usage-credits" align="middle">
        <el-text tag="strong">平台上报积分</el-text>
        <el-tag v-for="[label, value] in summary.credits" :key="label" effect="plain">
          {{ label }}　{{ formatUsage(value) }}
        </el-tag>
        <el-text v-if="!summary.creditCount" type="info">暂无单次积分数据</el-text>
        <el-text type="info">覆盖 {{ summary.creditCount }} / {{ filtered.length }} 次调用</el-text>
      </el-row>
      <el-row class="usage-credits" align="middle">
        <el-text tag="strong">余额差估算</el-text>
        <el-tag v-for="[label, value] in summary.estimatedCredits" :key="label" type="warning" effect="plain">{{ label }}　{{ formatUsage(value) }}（估算）</el-tag>
        <el-text v-if="!summary.estimateCount" type="info">暂无估算数据</el-text>
        <el-text type="info">覆盖 {{ summary.estimateCount }} / {{ filtered.length }} 次调用</el-text>
      </el-row>
      <el-text tag="p" type="info" size="small" class="usage-note">
        优先使用平台上报值；缺失时按调用前后余额差估算，两者分开汇总。估算可能受计费延迟、签到奖励及其他客户端使用影响；估算为 0 仅表示暂未观察到余额减少。历史缺失记录不能补算。
      </el-text>

      <el-empty v-if="!filtered.length" :description="snapshot.records.length ? '当前筛选条件下没有记录。' : '暂无调用记录。通过统一网关发起调用后可在这里查看。'" />
      <template v-else>
        <el-row class="usage-charts">
          <el-card shadow="never" class="usage-chart-panel">
            <template #header>
              <el-row align="middle" justify="space-between" class="usage-heading">
                <el-text tag="h3">每日趋势</el-text>
                <el-select v-model="metric" size="small" aria-label="趋势指标" class="usage-metric">
                  <el-option label="调用次数" value="calls" />
                  <el-option label="Token" value="tokens" />
                  <el-option label="积分消耗" value="credits" />
                </el-select>
              </el-row>
            </template>
            <el-select v-if="metric === 'credits' && creditGroups.length" v-model="group" size="small" aria-label="积分统计范围" class="usage-credit-group">
              <el-option v-for="label in creditGroups" :key="label" :label="label" :value="label" />
            </el-select>
            <GatewayUsageChart v-if="hasMetricData" :option="trend" label="按日期统计的网关调用趋势" />
            <el-empty v-else :image-size="64" description="当前范围内没有上报此指标。" />
          </el-card>
          <el-card shadow="never" class="usage-chart-panel">
            <template #header><el-text tag="h3">模型调用量 · 前 8</el-text></template>
            <GatewayUsageChart :option="models" label="按调用次数排名的前八个模型" />
          </el-card>
        </el-row>

        <el-row align="middle" justify="space-between" class="usage-heading">
          <el-text tag="h3">调用明细</el-text>
          <el-text type="info" size="small">最多保留最近 {{ snapshot.limit }} 条</el-text>
        </el-row>
        <el-table :data="visible" row-key="id" stripe>
          <el-table-column label="时间" min-width="160">
            <template #default="{ row }">{{ date(row.startedAt) }}</template>
          </el-table-column>
          <el-table-column prop="model" label="请求模型" min-width="155" show-overflow-tooltip />
          <el-table-column label="平台" min-width="95">
            <template #default="{ row }">{{ platformName(row) }}</template>
          </el-table-column>
          <el-table-column label="状态" width="82">
            <template #default="{ row }">
              <el-tag :type="row.status === 'success' ? 'success' : row.status === 'failed' ? 'danger' : 'info'" effect="plain" size="small">{{ callStatuses[row.status as GatewayCall['status']] }}</el-tag>
            </template>
          </el-table-column>
          <el-table-column label="耗时" width="86">
            <template #default="{ row }">{{ latency(row.durationMs) }}</template>
          </el-table-column>
          <el-table-column label="Token" width="95">
            <template #default="{ row }">{{ formatUsage(row.totalTokens) }}</template>
          </el-table-column>
          <el-table-column label="消耗积分" width="148">
            <template #default="{ row }"><span :class="{ 'estimated-credit': hasCreditEstimate(row) }" :title="hasCreditEstimate(row) ? '调用前后余额差估算，可能受计费延迟和其他客户端影响。' : row.credits === null ? '本次未记录到单次积分，也没有有效的余额差快照，不代表未扣费。' : '平台上报的单次积分'">{{ creditText(row) }}</span></template>
          </el-table-column>
          <el-table-column label="操作" width="72">
            <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
          </el-table-column>
        </el-table>
        <el-pagination v-model:current-page="page" :total="filtered.length" :page-size="pageSize" :pager-count="5" layout="prev, pager, next" class="usage-pagination" />
      </template>
    </template>
  </el-card>

  <el-dialog v-model="detailOpen" title="调用详情" width="min(820px, calc(100vw - 24px))">
    <el-tabs v-model="detailTab">
    <el-tab-pane label="调用信息" name="info">
    <el-descriptions v-if="selected" :column="1" border class="usage-detail">
      <el-descriptions-item label="记录 ID">{{ selected.id }}</el-descriptions-item>
      <el-descriptions-item label="调用时间">{{ date(selected.startedAt) }}</el-descriptions-item>
      <el-descriptions-item label="请求模型">{{ selected.model }}</el-descriptions-item>
      <el-descriptions-item label="实际模型">{{ selected.upstreamModel ?? '—' }}</el-descriptions-item>
      <el-descriptions-item label="平台和账号">{{ platformName(selected) }}<template v-if="selected.platform"> · {{ regionName(selected.region) }} · {{ selected.account || '—' }}</template></el-descriptions-item>
      <el-descriptions-item label="调用结果">{{ callStatuses[selected.status] }} · HTTP {{ selected.httpStatus }}<template v-if="selected.errorCode"> · {{ selected.errorCode }}</template></el-descriptions-item>
      <el-descriptions-item label="响应模式">{{ selected.stream ? '流式' : '非流式' }} · {{ selected.attempts }} 次路由尝试</el-descriptions-item>
      <el-descriptions-item label="总耗时">{{ latency(selected.durationMs) }}</el-descriptions-item>
      <el-descriptions-item label="输入 / 输出 Token">{{ formatUsage(selected.inputTokens) }} / {{ formatUsage(selected.outputTokens) }}</el-descriptions-item>
      <el-descriptions-item label="总 Token">{{ formatUsage(selected.totalTokens) }}</el-descriptions-item>
      <el-descriptions-item label="消耗积分">{{ creditText(selected) }}<template v-if="selected.credits !== null || hasCreditEstimate(selected)"> · {{ creditGroup(selected) }}</template></el-descriptions-item>
      <template v-if="hasCreditEstimate(selected) && selected.creditEstimate">
        <el-descriptions-item label="余额快照">{{ formatUsage(selected.creditEstimate.balanceBefore) }} → {{ formatUsage(selected.creditEstimate.balanceAfter) }} {{ selected.creditEstimate.unit }}</el-descriptions-item>
        <el-descriptions-item label="估算时间">{{ date(selected.creditEstimate.measuredAt) }}</el-descriptions-item>
        <el-descriptions-item label="计量说明">余额差估算，可能受计费延迟、签到奖励及其他客户端使用影响；不等于官方单次账单，估算为 0 不代表免费。</el-descriptions-item>
      </template>
    </el-descriptions>
    </el-tab-pane>
    <el-tab-pane label="对话内容" name="conversation">
    <section class="conversation-detail" aria-label="对话内容">
      <h3>对话内容</h3>
      <p class="usage-note muted">对话内容仅保存在本机，图片和音频原始数据不保存。</p>
      <el-skeleton v-if="detailLoading" :rows="3" animated />
      <el-alert v-else-if="detailError" :title="detailError" type="warning" :closable="false" />
      <template v-else-if="conversation">
        <el-alert v-if="conversation.truncated" title="对话较长，仅保留部分内容；请求和回复各最多保存 16,384 个字符。" type="info" :closable="false" />
        <el-alert v-if="!conversation.complete" title="本次调用未正常完成，下方回复可能不完整。" type="warning" :closable="false" />
        <h4>请求消息</h4>
        <article v-for="(message, index) in conversation.request" :key="index" class="conversation-message">
          <strong>{{ messageRole(message.role) }}<span v-if="message.name"> · {{ message.name }}</span></strong>
          <pre>{{ message.content || '（无文本内容）' }}</pre>
        </article>
        <h4>模型回复</h4>
        <p v-if="!conversation.response.length" class="muted">未收到模型回复。</p>
        <article v-for="(message, index) in conversation.response" :key="index" class="conversation-message assistant">
          <strong>助手<span v-if="conversation.response.length > 1"> · 回复 {{ (message.index ?? index) + 1 }}</span></strong>
          <details v-if="message.reasoning"><summary>思考内容</summary><pre>{{ message.reasoning }}</pre></details>
          <pre v-if="message.content">{{ message.content }}</pre>
          <div v-for="(tool, toolIndex) in message.tools" :key="toolIndex"><strong>工具调用 · {{ tool.name || '未命名工具' }}</strong><pre>{{ tool.arguments }}</pre></div>
          <p v-if="!message.content && !message.reasoning && !message.tools?.length" class="muted">未返回文本内容。</p>
        </article>
      </template>
      <p v-else class="muted">此历史记录未保存对话原文，无法恢复。新调用会在此展示请求消息和模型回复。</p>
    </section>
    </el-tab-pane>
    </el-tabs>
  </el-dialog>
</template>

<style scoped>
.usage-panel { --el-card-border-color: var(--border); --el-card-bg-color: var(--surface); border-radius: 13px; margin-bottom: 22px; }
.usage-heading { gap: 8px; margin-bottom: 12px; }
.usage-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.5fr); gap: 10px; margin-bottom: 16px; }
.usage-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 10px; }
.usage-credits { gap: 8px 12px; }
.usage-note { margin-top: 6px; }
.estimated-credit { color: var(--el-color-warning); }
.usage-charts { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 14px; margin: 16px 0 20px; }
.usage-chart-panel { min-width: 0; }
.usage-chart-panel .usage-heading { margin: 0; }
.usage-metric { width: 110px; }
.usage-credit-group { max-width: 230px; margin-bottom: 8px; }
.usage-pagination { justify-content: flex-end; margin-top: 12px; }
.usage-detail { overflow-wrap: anywhere; }
.conversation-detail { margin-top: 10px; }
.conversation-detail h4 { margin: 20px 0 10px; }
.conversation-message { padding: 14px; border: 1px solid var(--border); border-radius: 8px; margin: 10px 0; background: var(--surface); }
.conversation-message > strong { color: var(--accent); font-size: 12px; }
.conversation-message pre { white-space: pre-wrap; overflow-wrap: anywhere; word-break: break-word; font: inherit; line-height: 1.7; margin: 10px 0 0; max-height: 360px; overflow-y: auto; background: transparent; padding: 0; border: 0; }
.conversation-message details { margin-top: 10px; }
@media (max-width: 1100px) {
  .usage-charts { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .usage-filters, .usage-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
