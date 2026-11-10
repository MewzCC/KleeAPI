<script setup lang="ts">
import { computed, ref, watch } from 'vue'
import { request } from '../api/client'
import { kleeTheme } from '../modules/decoration'
import { date, names, safe, session } from '../modules/session'
import {
  callStatuses, creditGroup, formatUsage, platformName, regionName, summarizeUsage,
  usageModels, usageTrend, type GatewayCall, type GatewayUsage,
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
const creditGroups = computed(() => [...summary.value.credits.keys()].sort())
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

function showDetail(row: GatewayCall) {
  selected.value = row
  detailOpen.value = true
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
        <el-text tag="strong">已上报积分</el-text>
        <el-tag v-for="[label, value] in summary.credits" :key="label" effect="plain">
          {{ label }}　{{ formatUsage(value) }}
        </el-tag>
        <el-text v-if="!summary.creditCount" type="info">暂无上报</el-text>
        <el-text type="info">覆盖 {{ summary.creditCount }} / {{ filtered.length }} 次调用</el-text>
      </el-row>
      <el-text tag="p" type="info" size="small" class="usage-note">
        积分按平台和地区分别汇总。上游未上报的调用不计入积分合计，Token 不换算为积分。
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
          <el-table-column label="消耗积分" width="100">
            <template #default="{ row }">{{ formatUsage(row.credits) }}</template>
          </el-table-column>
          <el-table-column label="操作" width="72">
            <template #default="{ row }"><el-button link type="primary" @click="showDetail(row)">详情</el-button></template>
          </el-table-column>
        </el-table>
        <el-pagination v-model:current-page="page" :total="filtered.length" :page-size="pageSize" :pager-count="5" layout="prev, pager, next" class="usage-pagination" />
      </template>
    </template>
  </el-card>

  <el-dialog v-model="detailOpen" title="调用详情" width="min(620px, calc(100vw - 24px))">
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
      <el-descriptions-item label="消耗积分">{{ formatUsage(selected.credits) }}<template v-if="selected.credits !== null"> · {{ creditGroup(selected) }}</template></el-descriptions-item>
    </el-descriptions>
  </el-dialog>
</template>

<style scoped>
.usage-panel { --el-card-border-color: var(--border); --el-card-bg-color: var(--surface); border-radius: 13px; margin-bottom: 22px; }
.usage-heading { gap: 8px; margin-bottom: 12px; }
.usage-filters { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)) minmax(0, 1.5fr); gap: 10px; margin-bottom: 16px; }
.usage-stats { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; padding: 14px; margin-bottom: 14px; border: 1px solid var(--border); border-radius: 10px; }
.usage-credits { gap: 8px 12px; }
.usage-note { margin-top: 6px; }
.usage-charts { display: grid; grid-template-columns: minmax(0, 1.35fr) minmax(0, 1fr); gap: 14px; margin: 16px 0 20px; }
.usage-chart-panel { min-width: 0; }
.usage-chart-panel .usage-heading { margin: 0; }
.usage-metric { width: 110px; }
.usage-credit-group { max-width: 230px; margin-bottom: 8px; }
.usage-pagination { justify-content: flex-end; margin-top: 12px; }
.usage-detail { overflow-wrap: anywhere; }
@media (max-width: 1100px) {
  .usage-charts { grid-template-columns: 1fr; }
}
@media (max-width: 620px) {
  .usage-filters, .usage-stats { grid-template-columns: repeat(2, minmax(0, 1fr)); }
}
</style>
