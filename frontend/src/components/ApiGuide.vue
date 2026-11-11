<script setup lang="ts">
import { nextTick, ref, watch } from 'vue'
import { names, session } from '../modules/session'
import { copy } from '../modules/workspace'
import { useGuide } from '../modules/guide'
import type { Model, Platform } from '../types'
const props = defineProps<{ platform: Platform; models: Model[]; selected: string; testRevision: number; canConfirm: boolean; clientConfirmed: boolean; guided: boolean }>()
const emit = defineEmits<{ testResult: [model: string, revision: number, success: boolean]; modelChanged: [model: string]; confirmClient: [confirmed: boolean]; configCopied: []; chatClosed: [] }>()
const { model, prompt, stream, maxTokens, open, input, loading, message, bubbles, base, json, curl, send, stop, clear } = useGuide(props, (id, revision, success) => emit('testResult', id, revision, success))
const clientHeading = ref<HTMLElement>()
defineExpose({
  openChat: () => { open.value = true },
  closeChat: () => { open.value = false; stop() },
  focusClient: () => clientHeading.value?.focus(),
})
const log = ref<HTMLElement>()
watch(bubbles, async () => { await nextTick(); if (log.value) log.value.scrollTop = log.value.scrollHeight }, { deep: true })
async function copyConfig(includeStream = false) {
  const revision = props.testRevision
  const id = model.value
  const text = `Base URL: ${base.value}\nAPI Key: klee-YOUR_API_KEY\nmodel: ${id}`
  const copied = await copy(includeStream ? text + `\nstream: ${stream.value}` : text)
  if (copied && props.guided && revision === props.testRevision && id === model.value) emit('configCopied')
}
</script>
<template>
  <section class="panel"><div class="section-heading"><div><h2>API 接入指南</h2><p class="muted">OpenAI 兼容格式 · 示例使用占位 Key</p></div><el-button @click="copy(base)">复制 Base URL</el-button></div><code class="endpoint">{{ base }}</code><p class="muted">{{ platform === 'gateway' ? '应用只需配置此网关地址与网关 API Key，即可统一调用已接入的各平台模型。' : '此地址仅用于 ' + names[platform] + '，请搭配 ' + names[platform] + ' API Key。其他平台需分别配置地址与 Key，也可使用网关统一接入。' }}</p><p class="muted">模型目录：{{ base }}/models<br>对话接口：{{ base }}/chat/completions</p>
    <el-alert v-if="platform === 'qoder'" title="Qoder 支持工具、图片与推理参数；temperature 和 top_p 当前不映射到上游。" type="info" :closable="false" />
    <el-alert v-else-if="platform !== 'gateway'" title="请求参数的实际支持范围和行为取决于平台上游与所选模型。" type="info" :closable="false" />
    <el-form label-position="top" class="guide-form"><el-form-item label="模型 ID"><el-select v-model="model" filterable allow-create default-first-option placeholder="输入模型 ID" :disabled="loading" @change="emit('modelChanged', $event)"><el-option v-for="m in models" :key="m.id" :label="m.id" :value="m.id" /></el-select></el-form-item><el-form-item label="max_tokens（可选）"><el-input-number v-model="maxTokens" :min="1" :precision="0" :disabled="loading" /></el-form-item><el-form-item label="流式响应"><el-switch v-model="stream" :disabled="loading" /></el-form-item><el-form-item label="示例消息" class="full"><el-input v-model="prompt" type="textarea" :rows="2" /></el-form-item></el-form>
    <el-tabs><el-tab-pane label="cURL"><div class="code-heading"><span>Bash</span><el-button @click="copy(curl)">复制命令</el-button></div><pre>{{ curl }}</pre></el-tab-pane><el-tab-pane label="请求 JSON"><el-button @click="copy(json)">复制 JSON</el-button><pre>{{ json }}</pre></el-tab-pane></el-tabs>
  </section>
  <section class="panel client-config" aria-labelledby="client-config-title">
    <div class="section-heading"><div>
      <h2 id="client-config-title" ref="clientHeading" tabindex="-1">客户端配置</h2>
      <p class="muted">选择 OpenAI 兼容的 Chat Completions 接口，填入下列参数，在客户端发送一条消息。</p>
    </div></div>
    <dl>
      <div><dt>Base URL</dt><dd><code>{{ base }}</code></dd></div>
      <div><dt>API Key</dt><dd><code>klee-YOUR_API_KEY</code><el-button text :disabled="!session.keys[platform]" @click="copy(session.keys[platform])">复制实际 Key</el-button></dd></div>
      <div><dt>模型 ID</dt><dd><code>{{ model || '请先选择模型' }}</code></dd></div>
    </dl>
    <p class="muted">将示例中的占位 Key 替换为已保存的实际 Key。</p>
    <div class="actions">
      <el-button :disabled="!model" @click="copyConfig()">复制客户端配置</el-button>
      <el-button v-if="clientConfirmed" @click="emit('confirmClient', false)">撤销客户端确认</el-button>
      <el-button v-else type="primary" :disabled="!canConfirm" @click="emit('confirmClient', true)">我已在客户端收到回复</el-button>
    </div>
    <p v-if="clientConfirmed" class="muted" role="status">已确认客户端接通。</p>
    <p v-else-if="!canConfirm" class="muted">请从模型目录选择模型，并在测试聊天中收到回复。</p>
  </section>
  <el-dialog v-model="open" title="API 测试聊天" width="min(760px, 94vw)" :close-on-click-modal="false" destroy-on-close @closed="emit('chatClosed')">
    <p class="muted">{{ base }} · {{ model || '未选择模型' }} · Key {{ session.keys[platform] ? '已保存（隐藏）' : '未保存' }}</p>
    <div ref="log" class="chat-log" role="log" aria-label="测试对话记录" aria-live="polite"><p v-if="!bubbles.length" class="empty">从一条消息开始测试你的配置。</p><article v-for="(bubble, index) in bubbles" :key="index" class="bubble" :class="{ user: bubble.role === '你' }"><strong>{{ bubble.role }}</strong><div>{{ bubble.content }}</div></article></div>
    <p role="status" class="muted">{{ message }}</p>
    <el-form @submit.prevent="send">
      <el-form-item label="测试消息"><el-input v-model="input" type="textarea" :rows="3" :readonly="loading" /></el-form-item>
      <div class="actions"><el-button type="primary" native-type="submit" :loading="loading">发送</el-button><el-button :disabled="!loading" @click="stop()">停止</el-button><el-button :disabled="loading" @click="clear()">清空对话</el-button><el-button :disabled="guided && loading" @click="copyConfig(true)">复制接入配置</el-button></div>
    </el-form>
    <template v-if="guided && canConfirm && !loading" #footer>
      <el-button type="primary" @click="open = false">返回向导，继续接入</el-button>
    </template>
  </el-dialog>
</template>

<style scoped>
#client-config-title { scroll-margin-top: 90px; }
.client-config dl { display: grid; gap: 8px; margin: 12px 0; }
.client-config dl > div { display: grid; grid-template-columns: 88px minmax(0, 1fr); align-items: center; }
.client-config dd { display: flex; align-items: center; flex-wrap: wrap; gap: 8px; margin: 0; min-width: 0; overflow-wrap: anywhere; }
.client-config .actions { margin: 12px 0; }
</style>
