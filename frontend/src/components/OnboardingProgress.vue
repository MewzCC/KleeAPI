<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { names, platformLink, platforms } from '../modules/session'
import type { getOnboarding, OnboardingAction } from '../modules/onboarding'
import type { Platform } from '../types'
import { onboardingCompletion } from '../modules/onboarding-sync'

const props = defineProps<{ platform: Platform; progress: ReturnType<typeof getOnboarding>; clientCopied: boolean }>()
const emit = defineEmits<{ navigate: [action: OnboardingAction]; confirmClient: [] }>()
const current = computed(() => props.progress.steps.findIndex(step => !step.done))
const finished = computed(() => onboardingCompletion.value.completed || current.value === -1)
const expanded = ref(false)
const heading = ref<HTMLElement>()
const stepsList = ref<HTMLOListElement>()
const toggle = ref<HTMLButtonElement>()
watch(finished, complete => {
  expanded.value = false
  if (complete && stepsList.value?.contains(document.activeElement)) void nextTick(() => toggle.value?.focus())
})
defineExpose({ focus: () => heading.value?.focus() })
</script>

<template>
  <section class="panel onboarding" :class="{ 'is-collapsed': finished && !expanded }" aria-labelledby="onboarding-title">
    <div class="section-heading">
      <div>
        <h2 id="onboarding-title" ref="heading" tabindex="-1">首次接入</h2>
        <p v-if="!finished || expanded" class="muted">{{ onboardingCompletion.completed ? `已在${names[onboardingCompletion.platform || platform]}完成首次接入，所有平台已同步。以下为当前平台的实际状态。` : '任一平台完成首次接入后，所有平台会同步收起引导。' }}</p>
      </div>
      <div class="onboarding-summary">
        <span class="onboarding-count" role="status">{{ finished ? '首次接入已完成' : `已完成 ${progress.completed} / ${progress.steps.length} 步` }}</span>
        <button v-if="finished" ref="toggle" class="text-link" type="button" :aria-expanded="expanded" aria-controls="onboarding-steps" @click="expanded = !expanded">{{ expanded ? '收起步骤' : '展开步骤' }}</button>
      </div>
    </div>
    <ol v-show="!finished || expanded" id="onboarding-steps" ref="stepsList" class="onboarding-steps">
      <li v-for="(step, index) in progress.steps" :key="step.title" :aria-current="current === index ? 'step' : undefined" :class="{ current: current === index, done: step.done }">
        <div class="onboarding-step-heading">
          <span class="step-index" aria-hidden="true">{{ index + 1 }}</span>
          <h3>{{ step.title }}</h3>
          <span class="step-state">{{ step.done ? '已完成' : current === index ? '当前步骤' : '待完成' }}</span>
        </div>
        <p class="muted">{{ step.action === 'client' && clientCopied && !step.done && !step.disabled ? '将已复制的配置粘贴到客户端，替换占位 Key。发送消息并收到回复后，在这里确认。' : step.description }}</p>
        <div v-if="step.action === 'accounts' && platform === 'gateway' && !step.disabled" class="onboarding-actions">
          <RouterLink v-for="item in platforms.filter(p => p !== 'gateway')" :key="item" class="text-link" :to="platformLink(item, 'accounts') + '&onboarding=gateway'" :aria-label="`管理 ${names[item]} 账号`">{{ names[item] }}</RouterLink>
        </div>
        <template v-else-if="step.action === 'client' && clientCopied && !step.done && !step.disabled">
          <el-button type="primary" @click="emit('confirmClient')">我已在客户端收到回复</el-button>
          <button class="text-link" type="button" @click="emit('navigate', step.action)">{{ step.button }}</button>
        </template>
        <el-button v-else :type="current === index ? 'primary' : 'default'" :disabled="step.disabled" @click="emit('navigate', step.action)">{{ step.button }}</el-button>
      </li>
    </ol>
  </section>
</template>

<style scoped>
#onboarding-title { scroll-margin-top: 100px; }
.onboarding.is-collapsed > .section-heading { margin-bottom: 0; }
.onboarding-summary { display: flex; align-items: center; flex-wrap: wrap; gap: 4px 14px; }
.onboarding-count { color: var(--accent); font-size: 13px; white-space: nowrap; }
.onboarding-steps { display: grid; grid-template-columns: repeat(5, minmax(0, 1fr)); gap: 12px; margin: 14px 0 0; padding: 0; list-style: none; }
.onboarding-steps li { display: flex; flex-direction: column; align-items: flex-start; gap: 10px; min-width: 0; border: 1px solid var(--border); border-radius: 9px; padding: 12px; }
.onboarding-steps li.current { border-color: var(--accent); }
.onboarding-step-heading { display: flex; align-items: center; gap: 7px; flex-wrap: wrap; }
.onboarding-step-heading h3 { margin: 0; font-size: 14px; }
.step-index { display: grid; place-items: center; inline-size: 23px; block-size: 23px; border: 1px solid var(--border); border-radius: 50%; font-size: 12px; }
.step-state { font-size: 11px; color: var(--muted); }
.current .step-state, .done .step-state { color: var(--accent); }
.onboarding-steps p { flex: 1; margin: 0; overflow-wrap: anywhere; }
.onboarding-actions { display: flex; flex-wrap: wrap; gap: 4px 10px; }
@media (max-width: 1400px) { .onboarding-steps { grid-template-columns: repeat(3, minmax(0, 1fr)); } }
@media (max-width: 1120px) { .onboarding-steps { grid-template-columns: repeat(2, minmax(0, 1fr)); } }
@media (max-width: 540px) { .onboarding-steps { grid-template-columns: 1fr; } }
</style>
