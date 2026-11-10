<script setup lang="ts">
import { onMounted, onUnmounted, ref } from 'vue'
import { readMotionPaused } from '../modules/decoration'

const canScrollDown = ref(false)
let frame = 0
let observer: ResizeObserver | undefined

function update() {
  frame = 0
  const page = document.scrollingElement
  canScrollDown.value = !!page && page.scrollHeight - page.scrollTop - page.clientHeight > 8
}
function scheduleUpdate() {
  if (!frame) frame = requestAnimationFrame(update)
}
function scrollDown() {
  const reduced = matchMedia('(prefers-reduced-motion: reduce)').matches || readMotionPaused()
  window.scrollBy({ top: window.innerHeight * 0.65, behavior: reduced ? 'auto' : 'smooth' })
}

onMounted(() => {
  document.documentElement.classList.add('main-scroll-hidden')
  window.addEventListener('scroll', scheduleUpdate, { passive: true })
  window.addEventListener('resize', scheduleUpdate)
  observer = new ResizeObserver(scheduleUpdate)
  observer.observe(document.body)
  scheduleUpdate()
})
onUnmounted(() => {
  document.documentElement.classList.remove('main-scroll-hidden')
  window.removeEventListener('scroll', scheduleUpdate)
  window.removeEventListener('resize', scheduleUpdate)
  observer?.disconnect()
  cancelAnimationFrame(frame)
})
</script>

<template>
  <button v-if="canScrollDown" type="button" class="scroll-hint" aria-label="向下滚动查看更多内容" @click="scrollDown">
    <span>下滑查看更多</span>
    <svg width="18" height="20" viewBox="0 0 20 24" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m5 6 5 5 5-5 M5 13l5 5 5-5" /></svg>
  </button>
</template>
