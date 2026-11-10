<script setup lang="ts">
import { computed, ref } from 'vue'
import { date, names, number, platformLink, safe, statusName } from '../modules/session'
import type { Account, Platform, Snapshot } from '../types'
import ConsoleIcon from './ConsoleIcon.vue'
const props = defineProps<{ platform: Platform; rows: Account[]; snapshot?: Snapshot; busy: boolean; loading: boolean; blocked: boolean; error?: string; connected: boolean }>()
const emit = defineEmits<{ refresh: []; claim: [target: boolean | Account, platform?: Platform] }>()
const filter = ref<Platform | ''>(''), state = ref('all'), search = ref('')
const done = (a: Account) => a.checkedIn === true || ['already', 'claimed'].includes(a.status || '')
const needsAttention = (a: Account) => ['failed', 'pending', 'unknown'].includes(a.status || 'unknown')
const scoped = computed(() => props.rows.filter(a => !filter.value || a.platform === filter.value))
const filtered = computed(() => scoped.value.filter(a => `${a.nickname || ''} ${a.uid}`.toLowerCase().includes(search.value.toLowerCase()) && (state.value === 'all' || state.value === 'done' && done(a) || state.value === 'available' && a.checkedIn === false && !done(a) && a.enabled !== false && !['no_activity', 'disabled', 'skipped'].includes(a.status || '') || state.value === 'attention' && needsAttention(a))))
const canClaim = (a: Account) => a.enabled !== false && !done(a) && !['disabled', 'skipped', 'no_activity'].includes(a.status || '')
const locked = computed(() => props.busy || props.loading || props.blocked || !props.connected)
</script>
<template>
  <section class="panel checkin-summary">
    <div class="section-heading"><div><h2>{{ platform === 'gateway' ? '所有平台，一起签到' : '今日签到' }}</h2><p class="muted">{{ platform === 'gateway' ? '在这里查看与领取各平台奖励，无需来回切换。' : '领取前查询，领取后复查；以平台确认的状态为准。' }}</p></div><div class="actions"><el-button :loading="loading" :disabled="busy || !connected" @click="emit('refresh')"><ConsoleIcon name="refresh" :size="15" />刷新状态</el-button><el-button type="primary" :loading="busy" :disabled="locked || !scoped.some(canClaim)" @click="emit('claim', true, filter || undefined)"><ConsoleIcon name="checkin" :size="16" />{{ filter ? names[filter] + ' 全部签到' : '全部账号签到' }}</el-button></div></div>
    <div class="checkin-metrics"><div><strong>{{ connected && snapshot ? scoped.length : '—' }}</strong><span>账号总数</span></div><div><strong>{{ connected && snapshot ? scoped.filter(done).length : '—' }}</strong><span>已确认签到</span></div><div><strong>{{ connected && snapshot ? scoped.filter(a => a.status === 'available').length : '—' }}</strong><span>可领取</span></div><div><strong>{{ connected && snapshot ? scoped.filter(needsAttention).length : '—' }}</strong><span>需要核对</span></div></div>
    <p class="snapshot-note" role="status">{{ busy ? '正在签到，请等待本次结果，避免重复领取…' : loading ? '正在查询平台状态，保留上次快照…' : snapshot ? '更新于 ' + date(snapshot.fetchedAt) : '点击刷新状态，查看可领取的奖励。' }}</p>
  </section>
  <el-alert v-if="error" :title="error" type="error" :closable="false" />
  <el-alert v-for="item in snapshot?.platforms?.filter(x => x.error)" :key="item.platform" :title="names[item.platform] + '：' + safe(item.error)" type="warning" :closable="false" />
  <section class="panel">
    <div class="filter-bar"><div class="filter-tabs" aria-label="签到结果筛选"><button v-for="item in [{ id: 'all', label: '全部账号' }, { id: 'available', label: '未签到' }, { id: 'done', label: '已签到' }, { id: 'attention', label: '需核对' }]" :key="item.id" :aria-pressed="state === item.id" :class="{ active: state === item.id }" @click="state = item.id">{{ item.label }}</button></div><div class="filter-inputs"><el-select v-if="platform === 'gateway'" v-model="filter" placeholder="所有平台" aria-label="签到平台筛选"><el-option label="所有平台" value="" /><el-option v-for="p in (['workbuddy', 'trae', 'qoder'] as const)" :key="p" :label="names[p]" :value="p" /></el-select><el-input v-model="search" clearable placeholder="搜索账号" aria-label="搜索签到账号" /></div></div>
    <el-skeleton v-if="loading && !snapshot" :rows="5" animated />
    <div v-else class="checkin-list" aria-live="polite" :aria-busy="busy">
      <article v-for="a in filtered" :key="(a.platform || platform) + ':' + a.uid" class="checkin-row" :class="{ 'needs-attention': needsAttention(a) }">
        <div class="checkin-row-head"><span class="avatar">{{ (a.nickname || 'A').slice(0, 1) }}</span><div class="account-info"><h3>{{ a.nickname || a.uid }}</h3><p class="muted">{{ names[a.platform || platform] }} · {{ a.region === 'cn' ? '国内版' : a.region === 'global' ? '国际版' : '未知区域' }} · {{ a.uid }}</p></div><el-tag :type="done(a) ? 'success' : needsAttention(a) ? 'warning' : 'info'" effect="plain">{{ statusName(a.status) }}</el-tag></div>
        <div class="checkin-row-content"><div><p>{{ safe(a.message || statusName(a.status)) }}</p><p v-if="a.hint" class="checkin-hint">{{ safe(a.hint) }}</p><p v-if="a.reward != null" class="muted">平台活动奖励 {{ a.reward }}<span v-if="!done(a)"> · 尚未确认领取</span></p><p v-if="a.balanceBefore != null || a.balanceAfter != null" class="muted">余额 {{ number(a.balanceBefore) }} → {{ number(a.balanceAfter) }}</p><p v-if="a.startsAt || a.endsAt" class="muted">活动时间 {{ date(a.startsAt) }} — {{ date(a.endsAt) }}</p></div><div class="actions"><a v-if="needsAttention(a)" class="text-link" :href="platformLink(a.platform || platform, 'accounts')">管理账号 ↗</a><el-button v-if="canClaim(a)" :disabled="locked" @click="emit('claim', a)">{{ needsAttention(a) ? '重新尝试' : '领取奖励' }}</el-button></div></div>
      </article>
      <el-empty v-if="!filtered.length" :description="rows.length ? '没有符合筛选条件的账号。' : connected ? '暂无签到账号，先连接账号或刷新状态。' : '请先在连接设置中保存 API Key。'" />
    </div>
    <p class="snapshot-note">不同平台的奖励分别记录。平台拒绝、设备限制或待确认的请求不会记作签到成功。</p>
  </section>
</template>
