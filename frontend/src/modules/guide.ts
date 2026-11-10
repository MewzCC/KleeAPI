import { computed, onUnmounted, ref, watch } from 'vue'
import { ElMessage } from 'element-plus'
import { baseURL, safe, session } from './session'
import { readStream } from './chat'
import type { Delta } from './chat'
import type { Model, Platform } from '../types'
/** 构造占位密钥示例并管理手动聊天会话、取消和成功上下文。 */
export function useGuide(props: { platform: Platform; models: Model[]; selected: string }) {
const model = ref(props.selected), prompt = ref('你好，请简要介绍你自己。'), stream = ref(true), maxTokens = ref<number>(), open = ref(false), input = ref(''), loading = ref(false), message = ref('填写消息后点击发送。测试会实际调用模型并可能消耗额度。')
const bubbles = ref<{ role: string; content: string }[]>([])
let history: { role: string; content: string }[] = [], controller: AbortController | undefined
const base = computed(() => baseURL(props.platform) + '/v1')
const body = computed(() => ({ model: model.value.trim() || 'YOUR_MODEL_ID', messages: [{ role: 'user', content: prompt.value || 'Hello' }], stream: stream.value, ...(maxTokens.value && Number.isInteger(maxTokens.value) && maxTokens.value > 0 ? { max_tokens: maxTokens.value } : {}) }))
const quote = (text: string) => "'" + text.replace(/'/g, "'\"'\"'") + "'"
const json = computed(() => JSON.stringify(body.value, null, 2))
const curl = computed(() => `curl ${stream.value ? '-N ' : ''}${quote(base.value + '/chat/completions')} \\\n  -H 'Content-Type: application/json' \\\n  -H 'Authorization: Bearer klee-YOUR_API_KEY' \\\n  --data-raw ${quote(json.value)}`)
watch(() => props.selected, value => { model.value = value })
watch(() => props.models, value => { if (!model.value && value.length) model.value = value[0]!.id }, { immediate: true })
watch(model, () => { if (loading.value) controller?.abort(); history = []; bubbles.value = []; message.value = '模型已切换，已开始新的对话。' })
watch(open, value => { if (!value) controller?.abort(); else if (!input.value) input.value = prompt.value })
async function send() {
  if (loading.value) return
  if (!session.keys[props.platform]) { ElMessage.error('请先保存 API Key。'); return }
  if (!model.value.trim() || model.value === 'YOUR_MODEL_ID') { ElMessage.error('请填写实际模型 ID。'); return }
  const text = input.value.trim(); if (!text) return
  controller = new AbortController(); const signal = controller.signal
  loading.value = true
  let timedOut = false
  const timer = setTimeout(() => { timedOut = true; controller?.abort() }, 300000)
  const messages = [...history, { role: 'user', content: text }]
  bubbles.value.push({ role: '你', content: text }, { role: '模型', content: '等待模型回复…' })
  const index = bubbles.value.length - 1
  let content = '', reasoning = '', tools = false
  function update(delta: Delta) {
    if (typeof delta.content === 'string') content += delta.content
    if (typeof delta.reasoning_content === 'string') reasoning += delta.reasoning_content
    if (delta.tool_calls?.length) tools = true
    bubbles.value[index]!.content = safe((reasoning ? '思考过程：\n' + reasoning + '\n\n' : '') + content || (tools ? '模型返回工具调用；测试窗不执行工具。' : '等待模型回复…'))
  }
  message.value = '正在请求 ' + model.value + '…'
  try {
    const response = await fetch(base.value + '/chat/completions', { method: 'POST', headers: { 'Content-Type': 'application/json', Authorization: `Bearer ${session.keys[props.platform]}` }, body: JSON.stringify({ ...body.value, messages }), signal })
    if (!response.ok) { let data; try { data = await response.json() } catch {} throw new Error(`HTTP ${response.status}：${data?.error?.message || '请求失败，请检查账号与模型。'}`) }
    if (stream.value) await readStream(response, signal, delta => { void update(delta) })
    else { const data = await response.json(); if (data.error) throw new Error(data.error.message || '模型返回错误。'); if (!data.choices?.[0]?.message) throw new Error('响应不是有效的 Chat Completions 格式。'); await update(data.choices[0].message) }
    signal.throwIfAborted()
    if (!content && !reasoning && !tools) throw new Error('模型返回空内容。')
    if (content && !tools) history = [...messages, { role: 'assistant', content }]
    input.value = ''; message.value = tools ? '请求已完成；模型要求调用工具，测试窗不执行工具。' : '请求已完成。'
  } catch (e) { message.value = safe(timedOut ? '请求已超时。' : signal.aborted ? '已停止生成；未完成的回复不会加入上下文。' : e); if (!content && !reasoning && !tools) bubbles.value[index]!.content = '未收到完整回复。' }
  finally { clearTimeout(timer); controller = undefined; loading.value = false }
}
const stop = () => controller?.abort()
const clear = () => { if (!loading.value) { history = []; bubbles.value = [] } }
onUnmounted(stop)
return { model, prompt, stream, maxTokens, open, input, loading, message, bubbles, base, json, curl, send, stop, clear }
}
