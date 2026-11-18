<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

use([BarChart, LineChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(defineProps<{ option: EChartsOption; label: string; title?: string; expandable?: boolean; expanded?: boolean; canDrillDown?: (model: string) => boolean }>(), { expandable: true })
const emit = defineEmits<{ expand: []; drillDown: [model: string] }>()
const container = ref<HTMLElement>()
let chart: EChartsType | undefined
let observer: ResizeObserver | undefined

onMounted(() => {
  if (!container.value) return
  chart = init(container.value)
  chart.setOption(props.option)
  chart.on('click', 'series.bar', params => {
    if (!props.canDrillDown?.(params.name)) return
    params.event?.event?.stopPropagation()
    emit('drillDown', params.name)
  })
  observer = new ResizeObserver(() => chart?.resize())
  observer.observe(container.value)
})
watch(() => props.option, option => chart?.setOption(option, { notMerge: true }))
onBeforeUnmount(() => {
  observer?.disconnect()
  chart?.dispose()
})
</script>

<template>
  <el-row class="usage-chart-shell" :class="{ 'is-expanded': expanded }">
    <el-col :span="24">
      <div class="usage-chart-interactive" :class="{ 'can-expand': expandable }" :role="expandable ? 'button' : undefined" :tabindex="expandable ? 0 : undefined" :aria-label="expandable ? '放大查看' + (title || label) : undefined" @click="expandable && emit('expand')" @keydown.enter.prevent="expandable && emit('expand')" @keydown.space.prevent="expandable && emit('expand')">
        <div ref="container" class="usage-chart" role="img" :aria-label="label"></div>
      </div>
      <el-button v-if="expandable" class="usage-expand-hint" text :aria-label="'点击放大查看' + (title || label)" @click="emit('expand')"><span aria-hidden="true">⛶</span> 点击放大查看</el-button>
    </el-col>
  </el-row>
</template>

<style scoped>
.usage-chart-shell { min-width: 0; }
.usage-chart { width: 100%; height: 260px; }
.usage-chart :deep(.usage-tooltip-title) { display: flex; align-items: flex-start; gap: 7px; padding-bottom: 9px; margin-bottom: 8px; border-bottom: 1px solid var(--usage-tooltip-rule); font-weight: 600; overflow-wrap: anywhere; }
.usage-chart :deep(.is-klee .usage-tooltip-title) { border-bottom-style: dashed; }
.usage-chart :deep(.is-klee .usage-tooltip-title::before) { content: ''; flex: 0 0 13px; height: 13px; margin-top: 3px; background: url('../assets/klee/clover.svg') center / contain no-repeat; }
.usage-chart :deep(.usage-tooltip-rows) { display: grid; gap: 7px; }
.usage-chart :deep(.usage-tooltip-row) { display: flex; align-items: center; gap: 8px; }
.usage-chart :deep(.usage-tooltip-dot) { flex: 0 0 7px; height: 7px; border-radius: 50%; }
.usage-chart :deep(.usage-tooltip-label) { color: var(--usage-tooltip-muted); overflow-wrap: anywhere; }
.usage-chart :deep(.usage-tooltip-value) { display: flex; align-items: baseline; gap: 5px; margin-left: auto; padding-left: 12px; white-space: nowrap; font-variant-numeric: tabular-nums; }
.usage-chart :deep(.usage-tooltip-value strong) { font-size: 14px; font-weight: 650; }
.usage-chart :deep(.usage-tooltip-value small) { color: var(--usage-tooltip-muted); font-size: 10px; }
.can-expand { cursor: zoom-in; border-radius: 8px; }
.can-expand:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.usage-expand-hint { display: flex; margin: 4px 0 0 auto; color: var(--muted); font-size: 11px; }
.usage-expand-hint:hover { color: var(--accent); }
.is-expanded { min-width: 680px; }
.is-expanded .usage-chart { height: var(--usage-expanded-height, clamp(440px, 58dvh, 760px)); }
</style>
