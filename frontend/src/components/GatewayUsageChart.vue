<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart, LineChart } from 'echarts/charts'
import { DataZoomComponent, GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

use([BarChart, LineChart, DataZoomComponent, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = withDefaults(defineProps<{ option: EChartsOption; label: string; title?: string; expandable?: boolean; expanded?: boolean }>(), { expandable: true })
const emit = defineEmits<{ expand: [] }>()
const container = ref<HTMLElement>()
let chart: EChartsType | undefined
let observer: ResizeObserver | undefined

onMounted(() => {
  if (!container.value) return
  chart = init(container.value)
  chart.setOption(props.option)
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
.can-expand { cursor: zoom-in; border-radius: 8px; }
.can-expand:focus-visible { outline: 2px solid var(--accent); outline-offset: -2px; }
.usage-expand-hint { display: flex; margin: 4px 0 0 auto; color: var(--muted); font-size: 11px; }
.usage-expand-hint:hover { color: var(--accent); }
.is-expanded { min-width: 680px; }
.is-expanded .usage-chart { height: var(--usage-expanded-height, clamp(440px, 58dvh, 760px)); }
</style>
