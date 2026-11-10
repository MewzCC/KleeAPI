<script setup lang="ts">
import { computed } from 'vue'
import ConsoleIcon from './ConsoleIcon.vue'
import KeyEditor from './KeyEditor.vue'
import { baseURL, names, platformLink, platforms, statusName } from '../modules/session'
import { copy } from '../modules/workspace'
import { summarizeCheckins } from '../modules/checkin'
import { kleeTheme } from '../modules/decoration'
import plush from '../assets/klee/klee-plush.png'
import type { Account, Catalog, Platform, Snapshot } from '../types'
const props = defineProps<{ platform: Platform; accounts: Account[]; pool?: Snapshot; checkins?: Snapshot; checkinLoading: boolean; checkinError?: string; catalog?: Catalog; connected: boolean; loading: boolean; error?: string }>()
const emit = defineEmits<{ navigate: [tab: string]; connect: []; saved: [] }>()
const eligible = (a: Account) => a.enabled === true && a.status === 'ready' && (a.unlimited === true || typeof a.remaining === 'number' && a.remaining > 0) && !a.quotaError && !a.modelsError && !!a.models?.length
const rows = computed(() => props.platform === 'gateway' ? props.pool?.accounts || [] : props.accounts)
const loaded = computed(() => props.platform === 'gateway' ? !!props.pool : props.connected && !props.loading && !props.error)
const daily = computed(() => summarizeCheckins(props.checkins, loaded.value || rows.value.length ? rows.value : undefined))
const dailyNote = computed(() => {
  const notes = ['已签到 / 总账号']
  if (daily.value.noActivity) notes.push(daily.value.noActivity + ' 个无活动')
  if (daily.value.disabled) notes.push(daily.value.disabled + ' 个已停用')
  if (daily.value.unknown) notes.push(daily.value.unknown + ' 个待核对')
  const unavailable = props.checkins?.platforms?.filter(p => p.error).length
  if (unavailable) notes.push(unavailable + ' 个平台未读取')
  if (props.checkinError) notes.push(props.checkins ? '刷新失败，显示上次结果' : '读取失败，请刷新')
  else if (props.checkinLoading && props.checkins) notes.push('刷新中')
  return notes.join(' · ')
})
const metrics = computed(() => [
  { icon: 'accounts', label: '已连接账号', value: loaded.value ? rows.value.length : '—', note: props.platform === 'gateway' ? '汇集三个平台的账号' : '在本机保存与管理', tab: props.platform === 'gateway' ? 'pool' : 'accounts' },
  { icon: 'pool', label: props.platform === 'gateway' ? '可调度账号' : '已启用账号', value: loaded.value ? rows.value.filter(a => props.platform === 'gateway' ? eligible(a) : a.enabled !== false && a.status === 'ready').length : '—', note: '查看账号连接与授权状态', tab: props.platform === 'gateway' ? 'pool' : 'accounts' },
  { icon: 'models', label: '模型目录', value: (props.platform === 'gateway' ? props.pool : props.catalog) ? (props.pool?.models || props.catalog?.data || []).length : '—', note: '浏览模型与复制 ID', tab: 'models' },
  { icon: 'checkin', label: '今日签到', value: props.checkins ? daily.value.done + '/' + daily.value.total : props.checkinLoading ? '读取中' : '—', note: dailyNote.value, tab: 'checkin' },
])
</script>
<template>
  <el-alert v-if="error" :title="error" type="warning" :closable="false" />
  <div class="overview-metrics"><button v-for="item in metrics" :key="item.icon" :aria-label="item.label + '：' + item.value" class="metric-card" @click="emit('navigate', item.tab)"><span><ConsoleIcon :name="item.icon" :size="17" />{{ item.label }}</span><strong>{{ item.value }}</strong><small>{{ item.note }}<ConsoleIcon name="arrow" :size="15" /></small></button></div>
  <div class="overview-grid">
    <section class="panel quick-panel"><p class="eyebrow">下一步，轻松完成</p><h2>常用操作</h2><div class="quick-actions"><button @click="emit('navigate', 'checkin')"><span class="quick-icon"><ConsoleIcon name="checkin" /></span><span><strong>领取签到奖励</strong><small>{{ platform === 'gateway' ? '跨平台统一签到，逐个确认结果' : '查询状态，为已连接账号领取奖励' }}</small></span><ConsoleIcon name="arrow" :size="18" /></button><button @click="emit('navigate', 'guide')"><span class="quick-icon"><ConsoleIcon name="guide" /></span><span><strong>接入你的应用</strong><small>复制 Base URL，生成请求示例</small></span><ConsoleIcon name="arrow" :size="18" /></button><button @click="emit('navigate', platform === 'gateway' ? 'usage' : 'quota')"><span class="quick-icon"><ConsoleIcon :name="platform === 'gateway' ? 'usage' : 'quota'" /></span><span><strong>{{ platform === 'gateway' ? '查看调用统计' : '查看剩余额度' }}</strong><small>{{ platform === 'gateway' ? '了解请求量、Token 与积分使用' : '按实际单位查看余额与额度包' }}</small></span><ConsoleIcon name="arrow" :size="18" /></button></div></section>
    <section class="panel endpoint-panel"><p class="eyebrow">OPENAI COMPATIBLE</p><h2>一个地址，连接灵感</h2><p class="muted">{{ platform === 'gateway' ? '使用网关统一调用各平台模型。' : '使用当前平台的账号与模型。' }}</p><label>Base URL</label><div class="copy-endpoint"><code>{{ baseURL(platform) }}/v1</code><el-button aria-label="复制 Base URL" @click="copy(baseURL(platform) + '/v1')">复制</el-button></div><KeyEditor :platform="platform" plaintext @saved="emit('saved')" /><button class="text-link" @click="emit('navigate', 'guide')">打开接入指南 <ConsoleIcon name="arrow" :size="16" /></button><img v-if="kleeTheme" :src="plush" alt="可莉与嘟嘟可毛绒二创" class="endpoint-art" /></section>
  </div>
  <section class="panel"><div class="section-heading"><div><h2>{{ platform === 'gateway' ? '平台连接' : '账号概况' }}</h2><p class="muted">{{ platform === 'gateway' ? '账号由各平台独立管理，点击即可进入。' : '查看账号状态，快速处理授权与停用问题。' }}</p></div><el-button text @click="emit('navigate', platform === 'gateway' ? 'pool' : 'accounts')">查看全部 →</el-button></div><div v-if="platform === 'gateway'" class="platform-health"><a v-for="p in platforms.filter(x => x !== 'gateway')" :key="p" :href="platformLink(p)"><span class="platform-symbol">{{ names[p].slice(0, 1) }}</span><div><strong>{{ names[p] }}</strong><small>{{ pool?.platforms?.find(x => x.platform === p)?.error ? '连接异常 · 前往检查' : pool ? pool.accounts.filter(x => x.platform === p).length + ' 个账号' : '等待读取' }}</small></div><ConsoleIcon name="arrow" :size="16" /></a></div><template v-else><div v-for="a in accounts.slice(0, 4)" :key="a.uid" class="overview-account"><span class="avatar">{{ (a.nickname || 'A').slice(0, 1) }}</span><div><strong>{{ a.nickname || a.uid }}</strong><p class="muted">{{ a.region === 'cn' ? '国内版' : a.region === 'global' ? '国际版' : '未知区域' }} · {{ a.plan || '套餐未知' }}</p></div><el-tag :type="a.enabled === false || a.status !== 'ready' ? 'warning' : 'success'" effect="plain">{{ a.enabled === false ? '已停用' : statusName(a.status) }}</el-tag></div><el-empty v-if="!loading && !accounts.length" description="连接第一个账号，开始使用模型。"><el-button type="primary" @click="emit('connect')">添加账号</el-button></el-empty></template></section>
</template>
