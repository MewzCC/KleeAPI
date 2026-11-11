import { computed, onActivated, onDeactivated, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { useRoute, useRouter } from 'vue-router'
import { post, request } from '../api/client'
import { safe, session, storedKey } from './session'
import type { Account, Catalog, Login, Platform, Snapshot } from '../types'
import { mergeCheckins } from './checkin'
export async function copy(text: string) {
  try {
    await navigator.clipboard.writeText(text)
    ElMessage.success('已复制。')
    return true
  } catch {
    ElMessage.error('复制失败，请手动复制。')
    return false
  }
}
export async function feedback(task: () => Promise<unknown>) { try { await task() } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(safe(e)) } }
/** 工作空间保存最近一次成功快照，查询失败仅更新错误；签到读取与领取严格分开。 */
export function useWorkspace(p: Platform) {
  const route = useRoute(), router = useRouter()
  const validTabs = p === 'gateway' ? ['overview', 'pool', 'models', 'usage', 'checkin', 'guide', 'settings'] : ['overview', 'accounts', 'models', 'checkin', 'quota', 'guide', 'settings']
  const initialTab = typeof route.query.tab === 'string' && validTabs.includes(route.query.tab) ? route.query.tab : 'overview'
  const accounts = ref<Account[]>([]), catalog = ref<Catalog>(), pool = ref<Snapshot>(), quota = ref<Snapshot>(), checkins = ref<Snapshot>()
  const credential = ref(''), login = ref<Login>(), region = ref('cn'), tab = ref(initialTab), auto = ref(false)
  const errors = reactive<Record<string, string>>({}), busy = reactive<Record<string, boolean>>({}), warning = ref('')
  let loginTimer: ReturnType<typeof setTimeout> | undefined, active = true, polling = false
  let connectionVersion = 0
  async function load(kind: string, task: () => Promise<void>) {
    if (busy[kind]) return
    const version = connectionVersion
    busy[kind] = true
    try { await task(); if (version === connectionVersion) errors[kind] = '' }
    catch (e) { if (version === connectionVersion && e !== 'cancel' && e !== 'close') { errors[kind] = safe(e); ElMessage.error(errors[kind]) } }
    finally { busy[kind] = false }
  }
  async function refreshPool(force = false) {
    const version = connectionVersion
    await load('pool', async () => {
      const data = await request<Snapshot>(p, '/api/gateway/status' + (force ? '?refresh=1' : ''))
      if (version !== connectionVersion) return
      if (!Array.isArray(data.accounts) || !Array.isArray(data.models) || !Array.isArray(data.platforms)) throw new Error('网关快照格式无效。')
      pool.value = data
    })
    if (version !== connectionVersion && active && session.keys[p]) void refreshPool()
  }
  async function refreshAccounts() {
    const version = connectionVersion
    await load('accounts', async () => {
      const data = await request<{ accounts: Account[]; activeUid?: string; warning?: string }>(p, '/api/accounts')
      if (version !== connectionVersion) return
      const old = accounts.value.find(a => a.active)?.uid
      accounts.value = data.accounts.map(a => ({ ...a, active: a.active || a.uid === data.activeUid }))
      if (old !== accounts.value.find(a => a.active)?.uid) catalog.value = undefined
      warning.value = safe(data.warning || '')
      if (['models', 'guide'].includes(tab.value)) void refreshModels()
      if (p === 'qoder' && (accounts.value.length || tab.value === 'checkin')) void refreshCheckins()
      if (accounts.value.some(a => a.enabled !== false)) void refreshQuota()
    })
    if (version !== connectionVersion && active && session.keys[p]) void refreshAccounts()
  }
  async function refreshModels() {
    const version = connectionVersion
    const uid = accounts.value.find(a => a.active)?.uid
    await load('models', async () => {
      const data = await request<Catalog>(p, '/v1/models?refresh=1')
      if (version === connectionVersion && uid === accounts.value.find(a => a.active)?.uid) catalog.value = data
    })
    const contextChanged = version !== connectionVersion || uid !== accounts.value.find(a => a.active)?.uid
    if (contextChanged && active && session.keys[p] && ['models', 'guide'].includes(tab.value)) void refreshModels()
  }
  async function query(kind: 'quota' | 'checkins', target?: boolean | Account, platform?: Platform) {
    if (busy.claim || (target !== undefined && (busy.checkins || busy.quota))) return
    await load(target === undefined ? kind : 'claim', async () => {
      const key = session.keys[p]
      const body = typeof target === 'object' ? { uid: target.uid, ...(p === 'gateway' ? { platform: target.platform } : {}) } : { all: target, ...(platform ? { platform } : {}) }
      const data = target === undefined
        ? await request<Snapshot>(p, kind === 'quota' ? '/api/monitor' : '/api/checkin')
        : await post<Snapshot>(p, '/api/checkin', body)
      if (key !== session.keys[p]) return
      if (!Array.isArray(data.accounts)) throw new Error('服务返回的账号数据无效。')
      data.fetchedAt ||= new Date().toISOString()
      if (kind === 'quota') {
        quota.value = data
        accounts.value = accounts.value.map(a => { const row = data.accounts.find(q => q.uid === a.uid); return row && !row.quotaError && Number.isFinite(row.remaining) ? { ...a, credits: row.remaining } : a })
      } else if (target === undefined) checkins.value = data
      else {
        checkins.value = mergeCheckins(checkins.value, data, body)
        const failures = data.accounts.filter(a => ['failed', 'pending', 'unknown'].includes(a.status || '')).length + (data.platforms?.filter(x => x.error).length || 0)
        if (failures) ElMessage.warning('本次有未完成或待确认的签到，请查看下方结果。')
        else ElMessage.success('签到处理完成，结果已更新。')
      }
      errors[kind] = ''
    })
    if (target !== undefined && errors.claim) errors.checkins = errors.claim
  }
  const refreshQuota = () => query('quota'), refreshCheckins = () => query('checkins')
  const claim = async (target: boolean | Account, platform?: Platform) => { await query('checkins', target, platform); if (p !== 'gateway') void refreshQuota() }
  const checkinRows = computed(() => (p === 'gateway' ? checkins.value?.accounts || [] : accounts.value).map(a => {
    const result = checkins.value?.accounts.find(b => b.uid === a.uid && b.platform === a.platform)
    const row = { ...a, status: 'unknown', checkedIn: null, ...result }
    if (a.enabled === false) return { ...row, status: 'disabled', checkedIn: null }
    if ((row.endsAt && Date.now() > new Date(row.endsAt).getTime()) || (row.startsAt && Date.now() < new Date(row.startsAt).getTime())) return { ...row, status: 'unknown', checkedIn: null, message: '活动时间已变化，请刷新状态。' }
    return row
  }))
  async function action(account: Account, action: string) { await load('action', async () => {
    const path = '/api/accounts/' + encodeURIComponent(account.uid)
    if (action === 'delete') { await ElMessageBox.confirm('删除此本地账号及其完整凭据？此操作无法撤销。', '删除账号', { type: 'warning', confirmButtonText: '删除', cancelButtonText: '取消' }); await request(p, path, { method: 'DELETE' }) }
    else if (action === 'export') { credential.value = JSON.stringify(await request(p, path + '/export'), null, 2); ElMessage.success('完整凭据已填入编辑区。'); return }
    else if (action === 'refresh') { const data = await post<{ credential?: unknown; warning?: string }>(p, path + '/refresh', {}); if (data.credential) credential.value = JSON.stringify(data.credential, null, 2); if (data.warning) ElMessage.warning(safe(data.warning)) }
    else if (action === 'device') { await post(p, path + '/device', {}); checkins.value = undefined; errors.checkins = ''; errors.claim = '' }
    else await request(p, path, { method: 'PATCH', body: JSON.stringify(action === 'active' ? { active: true } : { enabled: !account.enabled }) })
    await refreshAccounts()
    ElMessage.success('账号已更新。')
  }) }
  async function importCredential(desktop = false) { await load('import', async () => {
    if (!desktop && !credential.value.trim()) throw new Error('请先填写凭据。')
    const text = credential.value.trim()
    const json = desktop ? undefined : /^[\[{]/.test(text) ? JSON.parse(text) : text
    const data = await post<{ credential?: unknown }>(p, desktop ? '/api/accounts/desktop' : '/api/accounts/import', desktop ? {} : { json })
    if (data.credential) credential.value = JSON.stringify(data.credential, null, 2)
    await refreshAccounts(); ElMessage.success('账号已导入。')
  }) }
  async function readFile(event: Event) { const input = event.target as HTMLInputElement; try {
    const file = input.files?.[0]; if (!file) return
    if (file.size > 5 * 1024 * 1024) throw new Error('JSON 文件不能超过 5 MB。')
    const text = await file.text(); JSON.parse(text); credential.value = text
  } catch (e) { ElMessage.error(safe(e)) } finally { input.value = '' } }
  function download() { void feedback(async () => { const text = JSON.stringify(JSON.parse(credential.value), null, 2); const url = URL.createObjectURL(new Blob([text], { type: 'application/json' })); const a = document.createElement('a'); a.href = url; a.download = `klee-${p}-account.json`; a.click(); setTimeout(() => URL.revokeObjectURL(url), 1000) }) }
  async function poll(current: Login) {
    if (!active || login.value?.id !== current.id || polling) return
    polling = true
    try {
      const data = await request<{ status: string; message?: string; account?: Account; credential?: unknown }>(p, '/api/login/' + encodeURIComponent(current.id))
      if (!active || login.value?.id !== current.id) return
      if (data.status === 'pending') { if (current.expiresAt && Date.now() > current.expiresAt) throw new Error('登录已超时，请重新发起。'); loginTimer = setTimeout(() => void poll(current), 2000); return }
      login.value = undefined
      if (data.status === 'ready') {
        if (data.credential) credential.value = JSON.stringify(data.credential, null, 2)
        const existing = data.account && accounts.value.some(a => a.uid === data.account?.uid)
        const label = data.account?.nickname || data.account?.uid
        await refreshAccounts()
        ElMessage.success(label ? safe(`${existing ? '已更新账号授权' : '已连接账号'}「${label}」。`) : '登录成功，账号已导入。')
      }
      else ElMessage.warning(safe(data.message || '登录未完成。'))
    } catch (e) { if (active) { login.value = undefined; ElMessage.error(safe(e)) } } finally { polling = false }
  }
  async function startLogin() {
    if (login.value || busy.login) return
    const popup = p === 'trae' ? null : window.open('about:blank', '_blank'); if (popup) popup.opener = null
    await load('login', async () => { try {
      const data = await post<Login>(p, '/api/login', { region: p === 'trae' ? 'cn' : region.value })
      const url = new URL(data.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('官方登录地址无效。')
      login.value = { ...data, url: url.href }; if (popup) popup.location.href = url.href
      void poll(login.value)
    } catch (e) { popup?.close(); throw e } })
  }
  async function cancelLogin() { if (!login.value) return; const current = login.value; await load('login', async () => { await request(p, '/api/login/' + encodeURIComponent(current.id), { method: 'DELETE' }); clearTimeout(loginTimer); login.value = undefined; ElMessage.success('本次登录已取消。') }) }
  function refresh() { if (!session.keys[p]) return; if (p === 'gateway') void refreshPool(); else void refreshAccounts(); if (['overview', 'checkin'].includes(tab.value)) void refreshCheckins() }
  watch(() => session.keys[p], () => {
    connectionVersion++
    pool.value = undefined
    accounts.value = []
    catalog.value = undefined
    for (const kind of ['pool', 'accounts', 'models']) errors[kind] = ''
    if (active) refresh()
  }, { flush: 'sync' })
  watch(() => [route.params.platform, route.query.tab], ([platform, value]) => { if (platform === p) tab.value = typeof value === 'string' && validTabs.includes(value) ? value : 'overview' })
  watch(tab, value => {
    if (route.params.platform !== p) return
    if (route.query.tab !== value) void router.replace({ query: { ...route.query, tab: value } })
    if (!session.keys[p]) return
    if (['models', 'guide'].includes(value) && p !== 'gateway' && !catalog.value && !busy.accounts) void refreshModels()
    if (value === 'pool') void refreshPool()
    if (value === 'quota') void refreshQuota()
    if (['overview', 'checkin'].includes(value)) {
      const snapshot = checkins.value
      const recent = p === 'qoder' && snapshot?.fetchedAt && !errors.checkins
        && Date.now() - new Date(snapshot.fetchedAt).getTime() < 30000
        && checkinRows.value.every(a => a.status !== 'unknown')
      if (!recent) void refreshCheckins()
    }
  })
  const timer = setInterval(() => { if (active && auto.value && !document.hidden && tab.value === 'quota' && session.keys[p]) void refreshQuota() }, 60000)
  const pageShow = () => { if (!active) return; const key = storedKey(p); if (key) session.keys[p] = key; refresh() }
  window.addEventListener('pageshow', pageShow)
  let visited = false
  onActivated(() => { active = true; if (visited) refresh(); visited = true; if (login.value) void poll(login.value) })
  onDeactivated(() => { active = false; clearTimeout(loginTimer) })
  onUnmounted(() => { active = false; clearInterval(timer); clearTimeout(loginTimer); window.removeEventListener('pageshow', pageShow) })
  refresh()
  return { accounts, catalog, pool, quota, checkins, checkinRows, credential, login, region, tab, auto, errors, busy, warning, refresh, refreshPool, refreshAccounts, refreshModels, refreshQuota, refreshCheckins, claim, action, importCredential, readFile, download, startLogin, cancelLogin }
}
