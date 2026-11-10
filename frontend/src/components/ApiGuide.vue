<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { names, session } from '../modules/session'
import { copy } from '../modules/workspace'
import { useGuide } from '../modules/guide'
import type { Model, Platform } from '../types'
const props = defineProps<{ platform: Platform; models: Model[]; selected: string }>()
const { model, prompt, stream, maxTokens, open, input, loading, message, bubbles, base, json, curl, send, stop, clear } = useGuide(props)
defineExpose({ openChat: () => { open.value = true } })
const log = ref<HTMLElement>()
watch(bubbles, async () => { await nextTick(); if (log.value) log.value.scrollTop = log.value.scrollHeight }, { deep: true })
</script>
<template>
  <section class="panel"><div class="section-heading"><div><h2>API 接入指南</h2><p class="muted">OpenAI 兼容格式 · 示例使用占位 Key</p></div><el-button @click="copy(base)">复制 Base URL</el-button></div><code class="endpoint">{{ base }}</code><p class="muted">{{ platform === 'gateway' ? '应用只需配置此网关地址与网关 API Key，即可统一调用已接入的各平台模型。' : '此地址仅用于 ' + names[platform] + '，请搭配 ' + names[platform] + ' API Key。其他平台需分别配置地址与 Key，也可使用网关统一接入。' }}</p><p class="muted">模型目录：{{ base }}/models<br>对话接口：{{ base }}/chat/completions</p>
    <el-alert v-if="platform === 'qoder'" title="Qoder 支持工具、图片与推理参数；temperature 和 top_p 当前不映射到上游。" type="info" :closable="false" />
    <el-alert v-else-if="platform !== 'gateway'" title="请求参数的实际支持范围和行为取决于平台上游与所选模型。" type="info" :closable="false" />
    <el-form label-position="top" class="guide-form"><el-form-item label="模型 ID"><el-select v-model="model" filterable allow-create default-first-option placeholder="输入模型 ID" :disabled="loading"><el-option v-for="m in models" :key="m.id" :label="m.id" :value="m.id" /></el-select></el-form-item><el-form-item label="max_tokens（可选）"><el-input-number v-model="maxTokens" :min="1" :precision="0" :disabled="loading" /></el-form-item><el-form-item label="流式响应"><el-switch v-model="stream" :disabled="loading" /></el-form-item><el-form-item label="示例消息" class="full"><el-input v-model="prompt" type="textarea" :rows="2" /></el-form-item></el-form>
    <el-tabs><el-tab-pane label="cURL"><div class="code-heading"><span>Bash</span><el-button @click="copy(curl)">复制命令</el-button></div><pre>{{ curl }}</pre></el-tab-pane><el-tab-pane label="请求 JSON"><el-button @click="copy(json)">复制 JSON</el-button><pre>{{ json }}</pre></el-tab-pane></el-tabs>
  </section>
  <el-dialog v-model="open" title="API 测试聊天" width="min(760px, 94vw)" :close-on-click-modal="false" destroy-on-close><p class="muted">{{ base }} · {{ model || '未选择模型' }} · Key {{ session.keys[platform] ? '已保存（隐藏）' : '未保存' }}</p><div ref="log" class="chat-log" role="log" aria-label="测试对话记录" aria-live="polite"><p v-if="!bubbles.length" class="empty">从一条消息开始测试你的配置。</p><article v-for="(bubble, index) in bubbles" :key="index" class="bubble" :class="{ user: bubble.role === '你' }"><strong>{{ bubble.role }}</strong><div>{{ bubble.content }}</div></article></div><p role="status" class="muted">{{ message }}</p><el-form @submit.prevent="send"><el-form-item label="测试消息"><el-input v-model="input" type="textarea" :rows="3" :readonly="loading" /></el-form-item><div class="actions"><el-button type="primary" native-type="submit" :loading="loading">发送</el-button><el-button :disabled="!loading" @click="stop()">停止</el-button><el-button :disabled="loading" @click="clear()">清空对话</el-button><el-button @click="copy(`Base URL: ${base}\nAPI Key: klee-YOUR_API_KEY\nmodel: ${model}\nstream: ${stream}`)">复制接入配置</el-button></div></el-form></el-dialog>
</template>
