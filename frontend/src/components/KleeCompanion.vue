<script setup lang="ts">
import { ref } from 'vue'
import avatar from '../assets/klee/klee-avatar.png'
import plush from '../assets/klee/klee-plush.png'
import { readMotionPaused, setMotionPaused } from '../modules/decoration'
const paused = ref(readMotionPaused())
const companion = ref<HTMLDetailsElement>()
const summary = ref<HTMLElement>()
function toggleMotion() {
  paused.value = !paused.value
  setMotionPaused(paused.value)
}
function closeNote() {
  if (companion.value?.open) {
    companion.value.open = false
    summary.value?.focus()
  }
}
</script>

<template>
  <details ref="companion" class="klee-companion" @keydown.esc.stop="closeNote">
    <summary ref="summary"><img :src="avatar" width="42" height="42" alt=""><span>可莉的旅行便笺</span></summary>
    <div class="companion-note">
      <img class="companion-plush" :src="plush" width="150" height="138" alt="可莉与嘟嘟可毛绒玩偶">
      <h2>今天也要开心冒险！</h2>
      <p>给每一次连接，添一点四叶草的好运。嘟嘟可和可莉，会在这里陪着你。</p>
      <button type="button" :aria-pressed="paused" @click="toggleMotion">{{ paused ? '恢复装饰动效' : '暂停装饰动效' }}</button>
      <small>角色素材 © HoYoverse · 非官方同人主题<br>素材由 <a href="https://enka.network/" target="_blank" rel="noreferrer">Enka.Network</a> 提供 · 全站无声</small>
    </div>
  </details>
</template>
