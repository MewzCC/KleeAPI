import { computed, onUnmounted, reactive, ref, watch } from 'vue'
import { ElMessage, ElMessageBox } from 'element-plus'
import { post, request } from '../api/client'
import { safe, session, storedKey } from './session'
import type { Account, Catalog, Login, Platform, Snapshot } from '../types'
export async function copy(text: string) { try { await navigator.clipboard.writeText(text); ElMessage.success('已复制。') } catch { ElMessage.error('复制失败，请手动复制。') } }
export async function feedback(task: () => Promise<unknown>) { try { await task() } catch (e) { if (e !== 'cancel' && e !== 'close') ElMessage.error(safe(e)) } }
/** 工作空间保存最近一次成功快照，查询失败仅更新错误；签到读取与领取严格分开。 */
export function useWorkspace(p: Platform) {
  const accounts = ref<Account[]>([]), catalog = ref<Catalog>(), pool = ref<Snapshot>(), quota = ref<Snapshot>(), checkins = ref<Snapshot>()
  const credential = ref(''), login = ref<Login>(), region = ref('cn'), tab = ref(p === 'gateway' ? 'pool' : 'accounts'), auto = ref(false)
  const errors = reactive<Record<string, string>>({}), busy = reactive<Record<string, boolean>>({}), warning = ref('')
  let loginTimer: ReturnType<typeof setTimeout> | undefined, active = true
  async function load(kind: string, task: () => Promise<void>) {
    if (busy[kind]) return
    busy[kind] = true
    try { await task(); errors[kind] = '' } catch (e) { if (e !== 'cancel' && e !== 'close') { errors[kind] = safe(e); ElMessage.error(errors[kind]) } } finally { busy[kind] = false }
  }
  async function refreshPool(force = false) { await load('pool', async () => {
    const data = await request<Snapshot>(p, '/api/gateway/status' + (force ? '?refresh=1' : ''))
    if (!Array.isArray(data.accounts) || !Array.isArray(data.models) || !Array.isArray(data.platforms)) throw new Error('网关快照格式无效。')
    pool.value = data
  }) }
  async function refreshAccounts() { await load('accounts', async () => {
    const data = await request<{ accounts: Account[]; activeUid?: string; warning?: string }>(p, '/api/accounts')
    const old = accounts.value.find(a => a.active)?.uid
    accounts.value = data.accounts.map(a => ({ ...a, active: a.active || a.uid === data.activeUid }))
    if (old !== accounts.value.find(a => a.active)?.uid) catalog.value = undefined
    warning.value = safe(data.warning || '')
    if (p === 'qoder' && (accounts.value.length || tab.value === 'checkin')) void refreshCheckins()
    if (accounts.value.some(a => a.enabled !== false)) void refreshQuota()
  }) }
  async function refreshModels() { await load('models', async () => {
    const uid = accounts.value.find(a => a.active)?.uid
    const data = await request<Catalog>(p, '/v1/models?refresh=1')
    if (uid === accounts.value.find(a => a.active)?.uid) catalog.value = data
  }) }
  async function query(kind: 'quota' | 'checkins', claim?: boolean) {
    if (busy.claim || (claim !== undefined && (busy.checkins || busy.quota))) return
    await load(claim === undefined ? kind : 'claim', async () => {
      const data = claim === undefined
        ? await request<Snapshot>(p, kind === 'quota' ? '/api/monitor' : '/api/checkin')
        : await post<Snapshot>(p, '/api/checkin', { all: claim })
      data.fetchedAt ||= new Date().toISOString()
      if (kind === 'quota') {
        quota.value = data
        accounts.value = accounts.value.map(a => { const row = data.accounts.find(q => q.uid === a.uid); return row && !row.quotaError && Number.isFinite(row.remaining) ? { ...a, credits: row.remaining } : a })
      } else if (claim === undefined) checkins.value = data
      else {
        const previous = checkins.value?.accounts || []
        checkins.value = { ...data, accounts: [...previous.filter(a => !data.accounts.some(b => b.uid === a.uid)), ...data.accounts.map(a => ({ ...previous.find(b => b.uid === a.uid), ...a }))] }
      }
      errors[kind] = ''
    })
    if (claim !== undefined && errors.claim) errors.checkins = errors.claim
  }
  const refreshQuota = () => query('quota'), refreshCheckins = () => query('checkins')
  const claim = (all: boolean) => query('checkins', all)
  const checkinRows = computed(() => accounts.value.map(a => {
    const result = checkins.value?.accounts.find(b => b.uid === a.uid)
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
    if (!active || login.value?.id !== current.id) return
    try {
      const data = await request<{ status: string; message?: string; credential?: unknown }>(p, '/api/login/' + encodeURIComponent(current.id))
      if (!active || login.value?.id !== current.id) return
      if (data.status === 'pending') { if (current.expiresAt && Date.now() > current.expiresAt) throw new Error('登录已超时，请重新发起。'); loginTimer = setTimeout(() => void poll(current), 2000); return }
      login.value = undefined
      if (data.status === 'ready') { if (data.credential) credential.value = JSON.stringify(data.credential, null, 2); await refreshAccounts(); ElMessage.success('登录成功，账号已导入。') }
      else ElMessage.warning(safe(data.message || '登录未完成。'))
    } catch (e) { if (active) { login.value = undefined; ElMessage.error(safe(e)) } }
  }
  async function startLogin() {
    if (login.value || busy.login) return
    const popup = window.open('about:blank', '_blank'); if (popup) popup.opener = null
    await load('login', async () => { try {
      const data = await post<Login>(p, '/api/login', { region: p === 'trae' ? 'cn' : region.value })
      const url = new URL(data.url); if (!['https:', 'http:'].includes(url.protocol)) throw new Error('官方登录地址无效。')
      login.value = { ...data, url: url.href }; if (popup) popup.location.href = url.href
      void poll(login.value)
    } catch (e) { popup?.close(); throw e } })
  }
  async function cancelLogin() { if (!login.value) return; const current = login.value; await load('login', async () => { await request(p, '/api/login/' + encodeURIComponent(current.id), { method: 'DELETE' }); clearTimeout(loginTimer); login.value = undefined; ElMessage.success('本次登录已取消。') }) }
  function refresh() { if (!session.keys[p]) return; if (p === 'gateway') void refreshPool(); else void refreshAccounts() }
  watch(tab, value => {
    if (!session.keys[p]) return
    if (value === 'quota') void refreshQuota()
    if (value === 'checkin') {
      const snapshot = checkins.value
      const recent = p === 'qoder' && snapshot?.fetchedAt && !errors.checkins
        && Date.now() - new Date(snapshot.fetchedAt).getTime() < 30000
        && checkinRows.value.every(a => a.status !== 'unknown')
      if (!recent) void refreshCheckins()
    }
  })
  const timer = setInterval(() => { if (auto.value && !document.hidden && tab.value === 'quota' && session.keys[p]) void refreshQuota() }, 60000)
  const pageShow = () => { const key = storedKey(p); if (key) session.keys[p] = key; refresh() }
  window.addEventListener('pageshow', pageShow)
  onUnmounted(() => { active = false; clearInterval(timer); clearTimeout(loginTimer); window.removeEventListener('pageshow', pageShow) })
  refresh()
  return { accounts, catalog, pool, quota, checkins, checkinRows, credential, login, region, tab, auto, errors, busy, warning, refresh, refreshPool, refreshAccounts, refreshModels, refreshQuota, refreshCheckins, claim, action, importCredential, readFile, download, startLogin, cancelLogin }
}
