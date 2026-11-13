<script setup lang="ts">
import { computed, nextTick, onActivated, onDeactivated, onUnmounted, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { request } from '../api/client'
import { safe, session } from '../modules/session'
import { copy } from '../modules/workspace'
import { editableGroup, modelPlatform, modelPlatformName, newAutoGroup, validateAutoGroup, type AutoGroup, type AutoSnapshot, type AutoTarget } from '../modules/auto-models'
import ConsoleIcon from './ConsoleIcon.vue'
import { readMotionPaused } from '../modules/decoration'

const emit = defineEmits<{ changed: [] }>()
const snapshot = ref<AutoSnapshot>()
const loading = ref(false), changing = ref(false), error = ref(''), formError = ref('')
const draft = ref<AutoGroup>(), editingId = ref(''), baseline = ref('')
const search = ref(''), platform = ref('all')
const editor = ref<HTMLElement>()
const editorOpen = ref(false)
const catalogLimit = 10
const catalogExpanded = ref(false), canScrollMore = ref(false)
let scrollArea: HTMLElement | undefined
let scrollObserver: ResizeObserver | undefined
let scrollFrame = 0
let revision = 0
const path = '/api/gateway/auto-models'
const dirty = computed(() => !!draft.value && JSON.stringify(editableGroup(draft.value)) !== baseline.value)
const groups = computed(() => snapshot.value?.groups || [])
const connected = computed(() => !!session.keys.gateway)
const blocked = computed(() => changing.value || loading.value || !connected.value || !snapshot.value || !!snapshot.value.warning)
const catalog = computed(() => (snapshot.value?.models || []).filter(model => !model.id.startsWith('auto/')))
const platforms = computed(() => [...new Set(catalog.value.map(model => modelPlatform(model.id)))])
const filteredModels = computed(() => catalog.value.filter(model => (platform.value === 'all' || modelPlatform(model.id) === platform.value) && `${model.id} ${model.name || ''}`.toLowerCase().includes(search.value.toLowerCase())))
const visibleModels = computed(() => catalogExpanded.value ? filteredModels.value : filteredModels.value.slice(0, catalogLimit))
watch([search, platform], () => { catalogExpanded.value = false })
watch(editorOpen, open => { if (!open) stopScrollTracking() })

function scheduleScrollHint() {
  if (!scrollArea || scrollFrame) return
  scrollFrame = requestAnimationFrame(() => {
    scrollFrame = 0
    canScrollMore.value = !!scrollArea && scrollArea.scrollHeight - scrollArea.scrollTop - scrollArea.clientHeight > 8
  })
}
function stopScrollTracking() {
  scrollArea?.removeEventListener('scroll', scheduleScrollHint)
  scrollObserver?.disconnect()
  cancelAnimationFrame(scrollFrame)
  scrollFrame = 0; scrollArea = undefined; canScrollMore.value = false
}
function trackEditorScroll() {
  stopScrollTracking()
  scrollArea = editor.value?.closest<HTMLElement>('.el-dialog__body') ?? undefined
  if (!scrollArea || !editor.value) return
  scrollArea.addEventListener('scroll', scheduleScrollHint, { passive: true })
  scrollObserver = new ResizeObserver(scheduleScrollHint)
  scrollObserver.observe(scrollArea)
  scrollObserver.observe(editor.value)
  scheduleScrollHint()
}
const scrollBehavior = (): ScrollBehavior => matchMedia('(prefers-reduced-motion: reduce)').matches || readMotionPaused() ? 'auto' : 'smooth'
function scrollMore() { if (scrollArea) scrollArea.scrollBy({ top: scrollArea.clientHeight * .65, behavior: scrollBehavior() }) }
async function toggleCatalog() {
  if (!catalogExpanded.value) { catalogExpanded.value = true; return }
  catalogExpanded.value = false
  await nextTick()
  editor.value?.focus({ preventScroll: true })
  scrollArea?.scrollTo({ top: 0, behavior: scrollBehavior() })
}

function accept(data: AutoSnapshot) {
  if (!Array.isArray(data.groups) || !Array.isArray(data.models)) throw new Error('服务返回了无效的自动模型配置。')
  snapshot.value = data
}
async function refresh() {
  if (!connected.value || changing.value) return
  const version = ++revision
  loading.value = true; error.value = ''
  try {
    const data = await request<AutoSnapshot>('gateway', path)
    if (version === revision) accept(data)
  } catch (failure) { if (version === revision) error.value = safe(failure) }
  finally { if (version === revision) loading.value = false }
}
watch(() => session.keys.gateway, () => {
  revision++; snapshot.value = undefined; draft.value = undefined; editingId.value = ''; baseline.value = ''
  editorOpen.value = false
  loading.value = false; changing.value = false; error.value = ''; formError.value = ''
  void refresh()
}, { immediate: true, flush: 'sync' })
onUnmounted(() => { revision++; stopScrollTracking() })
onActivated(() => { editorOpen.value = !!draft.value })
onDeactivated(() => { editorOpen.value = false })

async function discardDraft() {
  if (!dirty.value) return true
  try {
    await ElMessageBox.confirm('未保存的修改将被丢弃。', '离开当前编辑', { confirmButtonText: '丢弃修改', cancelButtonText: '继续编辑', type: 'warning' })
    return true
  } catch { return false }
}
async function edit(group?: AutoGroup) {
  const version = revision
  if (blocked.value || !await discardDraft()) return
  if (version !== revision || blocked.value) return
  const next = group ? editableGroup(group) : newAutoGroup()
  draft.value = next; editingId.value = group?.id || ''; baseline.value = JSON.stringify(next)
  formError.value = ''; search.value = ''; platform.value = 'all'
  catalogExpanded.value = false
  editorOpen.value = true
}
function focusEditor() {
  editor.value?.querySelector<HTMLInputElement>('input[aria-label="模型组名称"]')?.focus({ preventScroll: true })
  trackEditorScroll()
}
async function closeEditor(done?: () => void) {
  if (changing.value) return
  const version = revision
  if (!await discardDraft() || version !== revision) return
  editorOpen.value = false; draft.value = undefined; formError.value = ''
  done?.()
}
function cancel() { void closeEditor() }
function addTarget(id: string) {
  if (!draft.value || draft.value.targets.length >= 20 || draft.value.targets.some(target => target.model === id)) return
  draft.value.targets.push({ model: id, enabled: true })
}
function moveTarget(index: number, offset: number) {
  if (!draft.value) return
  const targets = draft.value.targets
  const target = targets.splice(index, 1)[0]
  if (target) targets.splice(index + offset, 0, target)
}
function health(target: AutoTarget) {
  const actual = groups.value.find(group => group.id === editingId.value)?.targets.find(item => item.model === target.model)
  const available = actual?.availableAccounts ?? catalog.value.find(model => model.id === target.model)?.availableAccounts
  if (!target.enabled) return '候选已停用'
  if (actual?.cooldownUntil && actual.cooldownUntil > Date.now()) return '冷却中 · 至 ' + new Date(actual.cooldownUntil).toLocaleTimeString('zh-CN')
  return available === undefined ? '可用账号未知' : available === 0 ? '暂时无可用账号' : available + ' 个可用账号'
}
async function mutate(method: string, url: string, body?: object, message = '配置已保存。') {
  if (blocked.value) return false
  const version = ++revision
  changing.value = true; formError.value = ''
  try {
    const data = await request<AutoSnapshot>('gateway', url, { method, ...(body ? { body: JSON.stringify(body) } : {}) })
    if (version !== revision) return false
    accept(data); error.value = ''; ElMessage.success(message); emit('changed')
    return true
  } catch (failure) { if (version === revision) formError.value = safe(failure); return false }
  finally { if (version === revision) changing.value = false }
}
async function save() {
  if (!draft.value || blocked.value) return
  formError.value = validateAutoGroup(draft.value)
  if (formError.value) return
  const body = editableGroup(draft.value)
  body.name = body.name.trim()
  if (await mutate(editingId.value ? 'PATCH' : 'POST', editingId.value ? path + '/' + encodeURIComponent(editingId.value) : path, body)) {
    editorOpen.value = false; draft.value = undefined; editingId.value = ''; baseline.value = ''; formError.value = ''
  }
}
async function toggle(group: AutoGroup) {
  const next = editableGroup(group); next.enabled = !next.enabled
  const validation = validateAutoGroup(next)
  if (validation) { formError.value = validation; return }
  if (await mutate('PATCH', path + '/' + encodeURIComponent(group.id), { enabled: next.enabled }, next.enabled ? '模型组已启用。' : '模型组已停用。')) {
    if (editingId.value === group.id && draft.value) { draft.value.enabled = next.enabled; baseline.value = JSON.stringify(editableGroup(next)) }
  }
}
async function remove(group: AutoGroup) {
  if (blocked.value) return
  const version = revision
  try {
    await ElMessageBox.confirm(`删除「${group.name}」后，客户端将无法再调用 ${group.id}。正在处理的请求继续使用原配置。`, '删除自动模型', { confirmButtonText: '确认删除', cancelButtonText: '取消', type: 'warning' })
    if (version !== revision) return
    if (await mutate('DELETE', path + '/' + encodeURIComponent(group.id), undefined, '模型组已删除。') && editingId.value === group.id) draft.value = undefined
  } catch (failure) { if (failure !== 'cancel' && failure !== 'close') formError.value = safe(failure) }
}
</script>

<template>
  <section class="auto-models" aria-label="自动模型管理">
    <div class="auto-toolbar"><p class="muted">配置保存在本机；修改仅影响新请求。</p><div class="actions"><el-button :loading="loading" :disabled="!connected || changing" @click="refresh"><ConsoleIcon name="refresh" :size="16" />刷新配置</el-button><el-button type="primary" :disabled="blocked || groups.length >= 50" @click="edit()"><ConsoleIcon name="add" :size="16" />新建模型组</el-button></div></div>
    <el-alert v-if="error" :title="error + (snapshot ? ' 当前显示上次成功读取的配置。' : '')" type="error" :closable="false" show-icon />
    <el-alert v-if="snapshot?.warning" :title="safe(snapshot.warning) + ' 为保护原文件，已暂停配置修改。'" type="warning" :closable="false" show-icon />
    <el-alert v-if="formError && !editorOpen" class="auto-error" :title="formError" type="error" :closable="false" show-icon />
    <el-skeleton v-if="loading && !snapshot" class="panel" :rows="6" animated />
    <div v-else-if="snapshot" class="auto-layout">
      <section class="auto-list panel" aria-label="本地模型组">
        <div class="section-heading"><h2>本地模型组 <span class="count">{{ groups.length }}/50</span></h2></div>
        <div v-if="!groups.length" class="auto-empty"><ConsoleIcon name="auto-models" :size="36" /><h3>先为常用任务建一个组</h3><p class="muted">例如：编程助手、日常问答。保存后，客户端直接使用你的 auto/ 模型 ID。</p><el-button type="primary" :disabled="blocked" @click="edit()">创建第一个模型组</el-button></div>
        <article v-for="group in groups" :key="group.id" class="auto-group" :class="{ selected: editingId === group.id && draft }">
          <div class="auto-group-top"><h3>{{ group.name }}</h3><el-tag :type="group.enabled ? 'success' : 'info'" effect="plain">{{ group.enabled ? '已启用' : '已停用' }}</el-tag></div>
          <code>{{ group.id }}</code><p class="muted">{{ group.targets.filter(target => target.enabled).length }} / {{ group.targets.length }} 个候选启用 · 按优先级尝试</p>
          <div class="auto-group-route"><span v-for="(target, index) in group.targets.slice(0, 3)" :key="target.model" :class="{ disabled: !target.enabled }">{{ index + 1 }}. {{ target.model }}</span><small v-if="group.targets.length > 3">还有 {{ group.targets.length - 3 }} 个候选</small></div>
          <div class="auto-group-actions"><el-button :disabled="blocked" @click="edit(group)">编辑</el-button><el-button text @click="copy(group.id)">复制 ID</el-button><el-button text :disabled="blocked || (editingId === group.id && dirty)" @click="toggle(group)">{{ group.enabled ? '停用' : '启用' }}</el-button><el-button text type="danger" :disabled="blocked" @click="remove(group)">删除</el-button></div>
        </article>
      </section>

    </div>
  </section>

  <el-dialog v-model="editorOpen" :title="editingId ? '编辑模型组' : '新建模型组'" width="min(960px, calc(100vw - 24px))" top="4vh" class="auto-model-dialog" :modal-class="editorOpen ? 'auto-model-overlay is-open' : 'auto-model-overlay'" append-to-body destroy-on-close :lock-scroll="false" :close-on-click-modal="false" :before-close="closeEditor" @opened="focusEditor">
      <section v-if="draft" ref="editor" class="auto-editor" aria-label="模型组编辑器" tabindex="-1">
        <div class="section-heading"><p class="muted">选择候选模型并调整优先顺序，通过固定 ID 调用。</p><el-tag v-if="dirty" type="warning" effect="plain">未保存</el-tag></div><el-alert v-if="formError" class="auto-error" :title="formError" type="error" :closable="false" show-icon />
        <el-form id="auto-model-form" label-position="top" @submit.prevent="save">
          <fieldset :disabled="changing || !connected || !!snapshot?.warning" class="auto-fields">
            <div class="auto-base-fields"><el-form-item label="模型组名称"><el-input v-model="draft.name" aria-label="模型组名称" maxlength="80" placeholder="例如：编程助手" /></el-form-item><el-form-item label="模型 ID"><el-input v-model="draft.id" aria-label="模型组 ID" :disabled="!!editingId" maxlength="69" placeholder="auto/coding" /><p class="auto-hint muted">{{ editingId ? '创建后 ID 固定，客户端配置可一直使用。' : 'auto/ 后以字母或数字开头，最多 64 位，可包含点、横线或下划线。' }}</p></el-form-item></div>
            <el-checkbox v-model="draft.enabled">启用此模型组</el-checkbox>
            <div class="auto-candidate-heading"><div><h3>候选模型 <span class="count">{{ draft.targets.length }}/20</span></h3><p class="muted">从上到下依次尝试；停用的候选会被跳过。</p></div></div>
            <ol v-if="draft.targets.length" class="auto-targets">
              <li v-for="(target, index) in draft.targets" :key="target.model" class="auto-target">
                <span class="auto-order">{{ String(index + 1).padStart(2, '0') }}</span><div class="auto-target-info"><code>{{ target.model }}</code><span class="muted">{{ modelPlatformName(target.model) }} · {{ health(target) }}</span></div>
                <div class="auto-target-controls"><el-checkbox v-model="target.enabled" :aria-label="'启用候选 ' + target.model">启用</el-checkbox><button type="button" :aria-label="'上移 ' + target.model" :disabled="index === 0" @click="moveTarget(index, -1)">↑</button><button type="button" :aria-label="'下移 ' + target.model" :disabled="index === draft.targets.length - 1" @click="moveTarget(index, 1)">↓</button><button type="button" class="auto-remove" :aria-label="'移除 ' + target.model" @click="draft.targets.splice(index, 1)">移除</button></div>
              </li>
            </ol><p v-else class="auto-no-targets muted">还没有候选模型，请从下方目录添加。</p>
            <section class="auto-picker" aria-label="添加候选模型"><div class="auto-picker-filters"><el-input v-model="search" clearable aria-label="搜索候选模型" placeholder="搜索模型名称或 ID" /><el-select v-model="platform" aria-label="筛选候选平台"><el-option label="全部平台" value="all" /><el-option v-for="item in platforms" :key="item" :label="modelPlatformName(item + '/')" :value="item" /></el-select></div><div class="auto-catalog-summary"><strong>可选模型</strong><span aria-live="polite">显示 {{ visibleModels.length }} / {{ filteredModels.length }} 个模型</span></div><div id="auto-model-catalog" class="auto-catalog"><article v-for="model in visibleModels" :key="model.id"><div><strong>{{ model.name || model.id }}</strong><code>{{ model.id }}</code><small class="muted">{{ modelPlatformName(model.id) }} · {{ model.availableAccounts === 0 ? '暂时无可用账号，可保留备用' : model.availableAccounts + ' 个可用账号' }}</small></div><el-button :disabled="draft.targets.length >= 20 || draft.targets.some(target => target.model === model.id)" @click="addTarget(model.id)">{{ draft.targets.some(target => target.model === model.id) ? '已添加' : '添加' }}</el-button></article><p v-if="!filteredModels.length" class="muted">{{ catalog.length ? '没有匹配的模型，试试其他关键词或平台。' : '尚未发现真实模型。请先连接平台账号，再刷新配置。' }}</p></div></section>
            <details class="auto-advanced"><summary>高级设置 <span>超时、尝试次数与冷却</span></summary><div class="auto-advanced-grid"><el-form-item label="单次超时（毫秒）"><el-input-number v-model="draft.attemptTimeoutMs" aria-label="单次超时（毫秒）" :min="1000" :max="120000" :step="1000" /></el-form-item><el-form-item label="总超时（毫秒）"><el-input-number v-model="draft.totalTimeoutMs" aria-label="总超时（毫秒）" :min="1000" :max="300000" :step="1000" /></el-form-item><el-form-item label="最多尝试次数"><el-input-number v-model="draft.maxAttempts" aria-label="最多尝试次数" :min="1" :max="60" /></el-form-item><el-form-item label="失败冷却（毫秒）"><el-input-number v-model="draft.cooldownMs" aria-label="失败冷却（毫秒）" :min="1000" :max="300000" :step="1000" /></el-form-item></div><el-checkbox v-model="draft.retryOnTimeout">未开始输出时，允许超时后切换</el-checkbox><p class="auto-risk">超时后，上游可能仍在生成。开启超时切换可能产生额外消耗。</p></details>
          </fieldset>

        </el-form>
      </section>
    <template #footer>
      <div v-if="canScrollMore || filteredModels.length > catalogLimit" class="auto-scroll-guidance">
        <button v-if="canScrollMore" type="button" class="auto-scroll-more" aria-label="向下滚动查看更多" @click="scrollMore"><svg width="16" height="18" viewBox="0 0 20 24" fill="none" stroke="currentColor" stroke-width="1.6" aria-hidden="true"><path d="m5 6 5 5 5-5 M5 13l5 5 5-5" /></svg>向下滚动查看更多</button>
        <button v-if="filteredModels.length > catalogLimit" type="button" class="auto-catalog-toggle" :aria-expanded="catalogExpanded" aria-controls="auto-model-catalog" @click="toggleCatalog">{{ catalogExpanded ? '回到顶部并收起' : '展开全部 ' + filteredModels.length + ' 个模型' }}</button>
      </div>
          <footer class="auto-save"><div><strong>{{ editingId ? draft?.id : '保存后即可在模型目录发现' }}</strong><p class="muted">修改仅影响新请求，当前请求继续使用原配置。</p></div><div class="actions"><el-button :disabled="changing" @click="cancel">取消编辑</el-button><el-button type="primary" native-type="submit" form="auto-model-form" :loading="changing" :disabled="blocked || (!!editingId && !dirty)">保存模型组</el-button></div></footer>
    </template>
  </el-dialog>
</template>

<style scoped>
.auto-models { display: grid; gap: 18px; min-width: 0; }
.auto-models :is(h2,h3,p) { margin-top: 0; }
.auto-models h2 { font-size: 21px; letter-spacing: -.5px; }
.auto-models h3 { font-size: 15px; margin-bottom: 8px; }
.auto-models code, .auto-editor code { overflow-wrap: anywhere; font-size: 12px; }
.auto-toolbar { display: flex; align-items: center; justify-content: space-between; gap: 12px; flex-wrap: wrap; }
.auto-toolbar p { margin: 0; font-size: 12px; }
.auto-layout { display: grid; gap: 20px; min-width: 0; }
.auto-list, .auto-editor { min-width: 0; margin: 0; }
:global(.auto-model-overlay .el-overlay-dialog) { overflow: hidden; }
/* Tie background locking to modal state so rapid reopen cannot leave a stale library lock. */
:global(html:has(.auto-model-overlay.is-open)), :global(body:has(.auto-model-overlay.is-open)) { overflow: hidden; }
:global(.auto-model-dialog) { max-height: 92dvh; margin-bottom: 0; display: flex; flex-direction: column; overflow: hidden; }
:global(.auto-model-dialog .el-dialog__body) { min-height: 0; overflow-y: auto; overscroll-behavior: contain; padding: 8px 8px 0; scrollbar-width: none; }
:global(.auto-model-dialog .el-dialog__body::-webkit-scrollbar) { display: none; width: 0; height: 0; }
:global(.auto-model-dialog .el-dialog__footer) { padding-top: 0; }
.auto-editor > .section-heading { margin-bottom: 20px; }
.auto-list > .section-heading { margin-bottom: 14px; }
.auto-group { padding: 20px 0; border-top: 1px solid var(--border); }
.auto-group.selected { border-top-color: var(--accent); }
.auto-group-top { display: flex; justify-content: space-between; align-items: center; gap: 10px; margin-bottom: 8px; }
.auto-group-top h3 { margin: 0; overflow-wrap: anywhere; }
.auto-group > p { font-size: 12px; margin: 10px 0; }
.auto-group-route { display: grid; gap: 5px; color: var(--muted); font-size: 11px; line-height: 1.7; overflow-wrap: anywhere; }
.auto-group-route .disabled { opacity: .55; text-decoration: line-through; }
.auto-group-actions { display: flex; flex-wrap: wrap; gap: 4px; margin-top: 15px; }
.auto-group-actions .el-button { margin-left: 0; }
.auto-empty { padding: 34px 8px; text-align: center; }
.auto-empty > svg { color: var(--accent); margin-bottom: 18px; }
.auto-empty p { max-width: 40ch; margin: 12px auto 22px; font-size: 13px; line-height: 1.8; }
.auto-editor:focus { outline: none; }
.auto-editor .count { background: color-mix(in srgb, var(--accent) 10%, var(--surface)); }
.auto-editor :deep(.el-input__wrapper) { background: color-mix(in srgb, var(--surface) 84%, var(--el-bg-color-page)); }
.auto-fields { border: 0; margin: 0; padding: 0; min-width: 0; }
.auto-fields:disabled { opacity: .65; pointer-events: none; }
.auto-base-fields { display: grid; grid-template-columns: 1fr 1.2fr; gap: 14px; }
.auto-hint { font-size: 11px; line-height: 1.7; margin: 8px 0 0; }
.auto-candidate-heading { margin: 24px 0 14px; }
.auto-candidate-heading p { font-size: 12px; margin-bottom: 0; }
.auto-targets { list-style: none; padding: 0; display: grid; gap: 9px; }
.auto-target { display: flex; align-items: flex-start; flex-wrap: wrap; gap: 12px; border: 1px solid var(--border); border-radius: 10px; padding: 14px; min-width: 0; }
.auto-order { color: var(--accent); font-size: 12px; padding-top: 2px; font-variant-numeric: tabular-nums; }
.auto-target-info { display: grid; gap: 7px; min-width: 0; flex: 1; }
.auto-target-info > span { font-size: 11px; overflow-wrap: anywhere; }
.auto-target-controls { display: flex; align-items: center; justify-content: flex-end; flex-wrap: wrap; width: 100%; gap: 8px; }
.auto-target-controls button { font: inherit; color: inherit; background: transparent; border: 1px solid var(--border); width: 32px; min-height: 32px; border-radius: 6px; cursor: pointer; transition: background .18s, border-color .18s; }
.auto-target-controls button.auto-remove { width: auto; padding: 0 9px; font-size: 12px; }
.auto-target-controls button:hover:not(:disabled) { border-color: var(--accent); color: var(--accent); }
.auto-target-controls button:disabled { opacity: .35; cursor: default; }
.auto-target-controls button:focus-visible, .auto-advanced summary:focus-visible { outline: 2px solid var(--accent); outline-offset: 3px; }
.auto-no-targets { font-size: 12px; padding: 18px 0; }
.auto-picker { margin-top: 18px; border: 1px solid var(--border); border-radius: 10px; padding: 14px; }
.auto-picker-filters { display: grid; grid-template-columns: minmax(0, 1fr) 135px; gap: 9px; }
.auto-catalog { margin-top: 10px; }
.auto-catalog-summary { display: flex; align-items: center; justify-content: space-between; gap: 12px; margin-top: 16px; font-size: 12px; color: var(--muted); }
.auto-scroll-guidance { display: flex; align-items: center; justify-content: space-between; gap: 8px; flex-wrap: wrap; }
.auto-scroll-guidance button { display: inline-flex; align-items: center; gap: 6px; padding: 6px 8px; min-height: 34px; border: 0; border-radius: 6px; background: transparent; color: var(--muted); font-size: 12px; cursor: pointer; }
.auto-scroll-guidance button:hover { background: color-mix(in srgb, var(--accent) 6%, transparent); color: var(--accent); }
.auto-scroll-guidance button:focus-visible { outline: 2px solid var(--accent); outline-offset: 2px; }
.auto-scroll-guidance .auto-catalog-toggle { color: var(--accent); margin-left: auto; }
.auto-scroll-more svg { animation: auto-scroll-nudge 1.8s ease-in-out infinite; }
@keyframes auto-scroll-nudge { 0%, 100% { transform: translateY(-2px); } 50% { transform: translateY(2px); } }
@media (prefers-reduced-motion: reduce) { .auto-scroll-more svg { animation: none; } }
.auto-catalog article { display: flex; align-items: center; gap: 10px; padding: 14px 0; border-bottom: 1px solid var(--border); }
.auto-catalog article:last-child { border-bottom: 0; }
.auto-catalog article > div { display: grid; min-width: 0; gap: 5px; flex: 1; }
.auto-catalog strong { font-size: 12px; overflow-wrap: anywhere; }
.auto-catalog small { font-size: 11px; }
.auto-catalog > p { padding: 20px 0 10px; font-size: 12px; line-height: 1.8; }
.auto-advanced { margin-top: 24px; border-top: 1px solid var(--border); padding-top: 18px; }
.auto-advanced summary { cursor: pointer; font-weight: 600; font-size: 13px; padding: 5px 0; }
.auto-advanced summary span { color: var(--muted); font-size: 11px; margin-left: 10px; font-weight: 400; }
.auto-advanced-grid { display: grid; grid-template-columns: 1fr 1fr; gap: 0 18px; margin-top: 20px; }
.auto-advanced-grid .el-input-number { width: 100%; }
.auto-risk { font-size: 12px; color: var(--muted); line-height: 1.8; margin: 10px 0 0; }
.auto-save { text-align: left; border-top: 1px solid var(--border); margin-top: 12px; padding-top: 20px; display: flex; flex-wrap: wrap; align-items: center; justify-content: space-between; gap: 16px; }
.auto-save strong { font-size: 12px; overflow-wrap: anywhere; }
.auto-save p { font-size: 11px; margin: 8px 0 0; line-height: 1.8; }
.auto-models :deep(.el-form-item__label) { font-size: 12px; }
@media (max-width: 600px) { .auto-base-fields, .auto-picker-filters, .auto-advanced-grid { grid-template-columns: minmax(0, 1fr); } .auto-picker-filters .el-select { width: 100%; } .auto-picker { padding: 10px; } .auto-advanced summary span { display: block; margin: 7px 0 0 14px; } .auto-toolbar > .actions { width: 100%; } .auto-toolbar > .actions .el-button { flex: 1; } .auto-save > .actions { width: 100%; } .auto-save > .actions .el-button { flex: 1; } .auto-advanced :deep(.el-checkbox) { height: auto; white-space: normal; } .auto-advanced :deep(.el-checkbox__label) { white-space: normal; line-height: 1.8; } }
</style>
