<script setup lang="ts">
import { computed, onMounted, onUnmounted, ref } from 'vue'
import { balancePercentage } from '../modules/balance'
import { number } from '../modules/session'
import type { Account } from '../types'
const props = defineProps<{ account: Account }>()
const percentage = computed(() => balancePercentage(props.account))
const unlimited = computed(() => props.account.unlimited === true && !props.account.quotaError)
const known = computed(() => !props.account.quotaError && typeof props.account.remaining === 'number' && Number.isFinite(props.account.remaining))
const used = computed(() => typeof props.account.used === 'number' && Number.isFinite(props.account.used) ? props.account.used : percentage.value !== null ? Math.max(0, props.account.limit! - props.account.remaining!) : undefined)
const entered = ref(false)
let frame = 0
onMounted(() => { frame = requestAnimationFrame(() => { frame = requestAnimationFrame(() => { entered.value = true }) }) })
onUnmounted(() => cancelAnimationFrame(frame))
const valueText = computed(() => unlimited.value ? '不限额度' : !known.value ? '余额未确认' : `余额 ${number(props.account.remaining)} ${props.account.unit || ''}` + (percentage.value === null ? '，总额度未知' : `，剩余 ${percentage.value}%`))
const detail = computed(() => percentage.value !== null ? `已用 ${number(used.value)} · 总额度 ${number(props.account.limit)}` : unlimited.value ? '平台未限制额度' : props.account.quotaError ? '额度查询失败，请刷新确认' : known.value ? '平台未提供总额度，暂不计算比例' : '尚未取得有效余额，请刷新确认')
</script>

<template>
  <span class="balance-progress" :title="detail" :class="{ flowing: percentage !== null && percentage > 0, low: percentage !== null && percentage <= 10, warning: percentage !== null && percentage > 10 && percentage <= 25, unknown: percentage === null && !unlimited }">
    <span class="balance-progress-value">余额 <strong>{{ unlimited ? '不限额度' : known ? number(account.remaining) : '—' }}</strong><span v-if="!unlimited">{{ account.unit || '未知单位' }}</span></span>
    <span class="balance-progress-track" role="progressbar" aria-label="余额进度" aria-valuemin="0" aria-valuemax="100" :aria-valuenow="percentage === null ? undefined : percentage" :aria-valuetext="valueText + '，' + detail"><span class="balance-progress-fill" :style="{ transform: `scaleX(${entered ? unlimited ? 1 : (percentage || 0) / 100 : 0})` }" /></span>
    <span class="balance-progress-percent">{{ unlimited ? '∞' : percentage !== null ? percentage + '%' : '—' }}</span>
  </span>
</template>

<style scoped>
.balance-progress { --balance-color: var(--accent); display: inline-flex; align-items: center; flex-wrap: wrap; gap: 5px 8px; max-width: 100%; color: var(--muted); font-size: 12px; line-height: 1.8; }
.balance-progress.low { --balance-color: var(--el-color-danger); }.balance-progress.warning { --balance-color: var(--el-color-warning); }.balance-progress.unknown { --balance-color: var(--muted); }
.balance-progress-value { display: inline-flex; align-items: baseline; flex-wrap: wrap; gap: 4px; }.balance-progress-value strong { color: var(--el-text-color-regular); font-size: 13px; font-weight: 500; font-variant-numeric: tabular-nums; }.balance-progress-percent { color: var(--balance-color); font-size: 11px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.balance-progress-track { display: inline-block; flex: none; position: relative; width: 100px; height: 4px; border-radius: 3px; overflow: hidden; background: color-mix(in srgb, var(--balance-color) 13%, var(--surface)); }
.balance-progress-fill { position: absolute; inset: 0; border-radius: inherit; transform-origin: left; overflow: hidden; background: var(--balance-color); transition: transform 900ms cubic-bezier(.22, 1, .36, 1); }
.flowing .balance-progress-fill::after { content: ''; position: absolute; inset: 0; width: 45%; background: linear-gradient(90deg, transparent, #ffffff55, transparent); animation: balance-progress-shine 2.8s ease-in-out infinite; }
@keyframes balance-progress-shine { from { transform: translateX(-120%); } 80%, to { transform: translateX(330%); } }
:global(html[data-klee-motion="off"] .balance-progress-fill), :global(html[data-klee-motion="off"] .balance-progress-fill::after) { animation: none !important; transition: none !important; }
@media (prefers-reduced-motion: reduce) { .balance-progress-fill, .balance-progress-fill::after { animation: none !important; transition: none !important; } }
</style>
