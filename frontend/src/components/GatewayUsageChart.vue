<script setup lang="ts">
import { onBeforeUnmount, onMounted, ref, watch } from 'vue'
import { init, use, type EChartsType } from 'echarts/core'
import { BarChart } from 'echarts/charts'
import { GridComponent, LegendComponent, TooltipComponent } from 'echarts/components'
import { CanvasRenderer } from 'echarts/renderers'
import type { EChartsOption } from 'echarts'

use([BarChart, GridComponent, LegendComponent, TooltipComponent, CanvasRenderer])

const props = defineProps<{ option: EChartsOption; label: string }>()
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
  <el-row class="usage-chart-shell">
    <el-col :span="24">
      <div ref="container" class="usage-chart" role="img" :aria-label="label"></div>
    </el-col>
  </el-row>
</template>

<style scoped>
.usage-chart-shell { min-width: 0; }
.usage-chart { width: 100%; height: 260px; }
</style>
