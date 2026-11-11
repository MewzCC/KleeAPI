<script setup lang="ts">
import { computed } from 'vue'
import { names, platformLink, platforms } from '../modules/session'
import type { getOnboarding, OnboardingAction } from '../modules/onboarding'
import type { Platform } from '../types'

const props = defineProps<{ platform: Platform; progress: ReturnType<typeof getOnboarding> }>()
const emit = defineEmits<{ navigate: [action: OnboardingAction] }>()
const current = computed(() => props.progress.steps.findIndex(step => !step.done))
</script>

<template>
  <section class="panel onboarding" aria-labelledby="onboarding-title">
    <div class="section-heading">
      <div>
        <h2 id="onboarding-title">首次接入</h2>
        <p class="muted">测试和客户端确认状态保留在当前页面会话。</p>
      </div>
      <span class="onboarding-count" role="status">已完成 {{ progress.completed }} / {{ progress.steps.length }} 步</span>
    </div>
    <ol class="onboarding-steps">
      <li v-for="(step, index) in progress.steps" :key="step.title" :aria-current="current === index ? 'step' : undefined" :class="{ current: current === index, done: step.done }">
        <div class="onboarding-step-heading">
          <span class="step-index" aria-hidden="true">{{ index + 1 }}</span>
          <h3>{{ step.title }}</h3>
          <span class="step-state">{{ step.done ? '已完成' : current === index ? '当前步骤' : '待完成' }}</span>
        </div>
        <p class="muted">{{ step.description }}</p>
        <div v-if="step.action === 'accounts' && platform === 'gateway'" class="onboarding-actions">
          <RouterLink v-for="item in platforms.filter(p => p !== 'gateway')" :key="item" class="text-link" :to="platformLink(item, 'accounts')" :aria-label="`管理 ${names[item]} 账号`">{{ names[item] }}</RouterLink>
        </div>
        <el-button v-else :type="current === index ? 'primary' : 'default'" :disabled="step.disabled" @click="emit('navigate', step.action)">{{ step.button }}</el-button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
.onboarding-count { color: var(--accent); font-size: 13px; white-space: nowrap; }
.onboarding-steps { display: grid; grid-template-columns: repeat(4, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; padding: 0; list-style: none; }
.onboarding-steps li { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; border: 1px solid var(--border); border-radius: 9px; padding: 12px; }
.onboarding-steps li.current { border-color: var(--accent); }
.onboarding-step-heading { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.onboarding-step-heading h3 { margin: 0; font-size: 14px; }
.step-index { display: grid; place-items: center; inline-size: 23px; block-size: 23px; border: 1px solid var(--border); border-radius: 50%; font-size: 12px; }
.step-state { font-size: 11px; color: var(--muted); }
.current .step-state, .done .step-state { color: var(--accent); }
.onboarding-steps p { flex: 1; margin: 0; overflow-wrap: anywhere; }
.onboarding-actions { display: flex; flex-wrap: wrap; gap: 4px 10px; }
@media (max-width: 1120px) { .onboarding-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 540px) { .onboarding-steps { grid-template-columns: 1fr; } }
</style>
