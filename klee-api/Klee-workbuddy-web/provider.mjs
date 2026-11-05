import {requestJSON, upstreamFetch, ApiError} from '../app/http.mjs';
import { createHash, createDecipheriv } from 'node:crypto';
import { readFile, stat, access } from 'node:fs/promises';
import { join, isAbsolute } from 'node:path';
import { homedir } from 'node:os';
import { execFile } from 'node:child_process';
import { promisify } from 'node:util';

const runFile = promisify(execFile);
const ENDPOINTS = new Set(['https://copilot.tencent.com', 'https://www.workbuddy.ai', 'https://www.codebuddy.ai']);
const DOMAINS = new Set(['copilot.tencent.com', 'www.workbuddy.cn', 'workbuddy.cn', 'www.codebuddy.cn', 'codebuddy.cn', 'www.workbuddy.ai', 'workbuddy.ai', 'www.workbuddy.cc', 'workbuddy.cc', 'www.codebuddy.ai', 'codebuddy.ai']);

function regionConfig(region = 'cn') {
  if (!['cn', 'global'].includes(region)) throw new ApiError('区域只能为 cn 或 global');
  return region === 'cn'
    ? { region, login: 'https://www.workbuddy.cn', origin: 'https://www.codebuddy.cn', endpoint: 'https://copilot.tencent.com', domain: 'www.codebuddy.cn', version: '5.5.6' }
    : { region, login: 'https://www.workbuddy.ai', origin: 'https://www.workbuddy.ai', endpoint: 'https://www.workbuddy.ai', domain: 'www.workbuddy.ai', version: '5.5.2' };
}

function jwt(token) {
  try { return JSON.parse(Buffer.from(token.split('.')[1], 'base64url').toString()); }
  catch { return {}; }
}

function millis(value) {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : 0;
}

function text(value) { return typeof value === 'string' ? value : ''; }

/** 检查业务信封；HTTP 200 不等于业务成功。 */
function unpack(envelope) {
  if (!envelope || typeof envelope !== 'object' || envelope.code === undefined) throw new ApiError('WorkBuddy 返回了无效业务响应', 502, 'upstream_error');
  if (Number(envelope.code) !== 0) throw new ApiError(text(envelope.msg) || text(envelope.message) || `WorkBuddy 业务错误 ${envelope.code}`, 502, String(envelope.code));
  const result = envelope.data ?? {};
  if (result && typeof result === 'object' && result.code !== undefined) return unpack(result);
  if (result?.Response?.Error) throw new ApiError(result.Response.Error.Message || 'WorkBuddy 计费失败', 502, String(result.Response.Error.Code || 'upstream_error'));
  return result;
}

function headers(account, token = account.accessToken) {
  const cfg = regionConfig(account.region);
  return {
    Accept: 'application/json', 'Content-Type': 'application/json', 'X-Requested-With': 'XMLHttpRequest',
    // 固定协议元数据沿用网关已使用的版本形状，不表示本服务是官方客户端。
    'User-Agent': 'CLI/2.63.2 CodeBuddy/2.63.2',
    Origin: cfg.origin, Referer: `${cfg.origin}/`,
    ...(token ? { Authorization: `Bearer ${token}` } : {}),
    ...(account.uid ? { 'X-User-Id': account.uid } : {}),
    ...(account.domain ? { 'X-Domain': account.domain } : {}),
    ...(account.enterpriseId ? { 'X-Enterprise-Id': account.enterpriseId } : {}),
  };
}

function billingBase(account) {
  if (account.domain.endsWith('codebuddy.ai')) return 'https://www.codebuddy.ai';
  if (account.region === 'global') return 'https://www.workbuddy.ai';
  return account.domain.endsWith('workbuddy.cn') ? 'https://www.workbuddy.cn' : 'https://www.codebuddy.cn';
}

async function billing(account, path, body = {}) {
  return unpack(await requestJSON(`${billingBase(account)}${path}`, { method: 'POST', headers: headers(account), body, timeout: 15000 }));
}

/** 从桌面客户端自己的只读密钥接口读取字段密钥，不修改客户端文件。 */
async function fieldKey(keyId) {
  const local = process.env.LOCALAPPDATA || join(homedir(), 'AppData', 'Local');
  const candidates = [process.env.WORKBUDDY_APP_EXECUTABLE];
  if (process.platform === 'win32') {
    for (const root of [join(local, 'Programs'), process.env.ProgramFiles, process.env['ProgramFiles(x86)']].filter(Boolean)) {
      for (const dir of ['WorkBuddy', 'WorkBuddy AI', 'WorkBuddyAI', 'CodeBuddy']) {
        for (const exe of ['WorkBuddy.exe', 'WorkBuddyAI.exe', 'CodeBuddy.exe']) candidates.push(join(root, dir, exe));
      }
    }
  } else if (process.platform === 'darwin') {
    for (const root of ['/Applications', join(homedir(), 'Applications')]) {
      for (const name of ['WorkBuddy', 'WorkBuddy AI', 'WorkBuddyAI']) candidates.push(join(root, `${name}.app`, 'Contents', 'MacOS', name));
    }
  } else candidates.push('/opt/WorkBuddy/workbuddy');
  for (const exe of [...new Set(candidates.filter(p => p && isAbsolute(p)))]) {
    try {
      await access(exe);
      const script = "process.stdout.write(process._linkedBinding('electron_browser_workbuddy_storage').loggerGet())";
      const { stdout } = await runFile(exe, ['-e', script], { env: { ...process.env, ELECTRON_RUN_AS_NODE: '1' }, windowsHide: true, timeout: 20000, maxBuffer: 1048576 });
      const secret = JSON.parse(stdout).atRestSecretKey;
      if (typeof secret !== 'string' || !secret) continue;
      const key = createHash('sha256').update(secret).digest();
      if (createHash('sha256').update(key).digest('hex').slice(0, 16) === keyId) return key;
    } catch { /* 跳过不存在或与该登录文件不匹配的客户端。 */ }
  }
  throw new ApiError('无法解密桌面登录信息；请设置 WORKBUDDY_APP_EXECUTABLE 指向写入该文件的客户端，或使用网页登录');
}

async function openField(value) {
  if (typeof value === 'string') return value;
  if (value == null) return '';
  if (value.$wbEncrypted !== 1 || typeof value.envelope !== 'string') throw new ApiError('无法识别 WorkBuddy 令牌格式');
  try {
    const e = JSON.parse(Buffer.from(value.envelope, 'base64').toString());
    const key = await fieldKey(e.keyId);
    const framed = s => { const b = Buffer.from(s); const n = Buffer.alloc(4); n.writeUInt32BE(b.length); return Buffer.concat([n, b]); };
    const suite = Buffer.alloc(4); suite.writeUInt32BE(e.suite);
    const aad = Buffer.concat([Buffer.from('WB-AAD\0'), Buffer.from([1]), framed('WBEV1'), framed('sym-v1'), suite, framed(e.keyId), Buffer.from([2, 0, 0])]);
    const decipher = createDecipheriv('aes-256-gcm', key, Buffer.from(e.nonce, 'base64'));
    decipher.setAAD(aad);
    decipher.setAuthTag(Buffer.from(e.authTag, 'base64'));
    return Buffer.concat([decipher.update(Buffer.from(e.ciphertext, 'base64')), decipher.final()]).toString();
  } catch (error) {
    if (error instanceof ApiError) throw error;
    throw new ApiError('WorkBuddy 加密令牌无效或客户端密钥不匹配');
  }
}

/** 统一 JSON 导入和旧凭据格式；已有身份信息时不访问网络。 */
async function normalize(input) {
  if (typeof input === 'string') {
    try { input = JSON.parse(input); } catch { throw new ApiError('请导入有效的 WorkBuddy JSON'); }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError('WorkBuddy 凭据必须为 JSON 对象');
  const auth = input.auth ?? input.credential ?? input;
  if (!auth || typeof auth !== 'object' || Array.isArray(auth)) throw new ApiError('WorkBuddy auth 必须为 JSON 对象');
  const raw = { ...(input.account || {}), ...input, ...auth };
  const accessToken = await openField(raw.accessToken ?? raw.access);
  const refreshToken = await openField(raw.refreshToken ?? raw.refresh);
  if (!accessToken || /[\r\n]/.test(accessToken + refreshToken)) throw new ApiError('缺少或无效的 accessToken');
  const claims = jwt(accessToken);
  let domain = text(raw.domain) || text(claims.iss);
  if (domain) {
    let parsed;
    try { parsed = new URL(domain.includes('://') ? domain : `https://${domain}`); } catch { throw new ApiError('WorkBuddy 登录域名无效'); }
    if (parsed.protocol !== 'https:' || parsed.username || parsed.password || parsed.port || !DOMAINS.has(parsed.hostname)) throw new ApiError('只接受 WorkBuddy 官方登录域名');
    domain = parsed.hostname;
  }
  const region = raw.region === 'intl' ? 'global' : raw.region || (domain.endsWith('.ai') || domain.endsWith('.cc') || /\.ai\/?$/.test(text(raw.endpoint)) ? 'global' : 'cn');
  const cfg = regionConfig(region);
  const endpoint = text(raw.endpoint) || (domain.endsWith('codebuddy.ai') ? 'https://www.codebuddy.ai' : cfg.endpoint);
  if (!ENDPOINTS.has(endpoint)) throw new ApiError('只接受 WorkBuddy 官方端点');
  const uid = String(raw.uid || raw.userId || claims.sub || '');
  if (!uid) throw new ApiError('凭据缺少 uid，且令牌中无法解析身份');
  return {
    uid, nickname: text(raw.nickname) || text(claims.name) || uid, region, accessToken, refreshToken,
    expiresAt: millis(raw.expiresAtMs || raw.expiresAt || claims.exp), domain: domain || cfg.domain, endpoint,
    enterpriseId: text(raw.enterpriseId) || text(claims.enterprise_id),
    machineId: text(raw.machineId), deviceId: text(raw.deviceId),
  };
}

/** 刷新并保留完整轮换令牌，由调用方持久化新凭据。 */
async function refresh(account) {
  account = await normalize(account);
  if (!account.refreshToken) throw new ApiError('该账号没有 refreshToken');
  const data = unpack(await requestJSON(`${account.endpoint}/v2/plugin/auth/token/refresh`, {
    method: 'POST', timeout: 15000, body: {},
    headers: { ...headers(account, ''), 'X-Refresh-Token': account.refreshToken, 'X-Auth-Refresh-Source': account.region === 'cn' ? 'workbuddy' : 'plugin', 'X-CodeBuddy-Request': '1' },
  }));
  const token = data.data ?? data;
  if (!token.accessToken) throw new ApiError('WorkBuddy 刷新响应缺少 accessToken', 502);
  return normalize({ ...account, accessToken: token.accessToken, refreshToken: token.refreshToken || account.refreshToken, expiresAt: millis(jwt(token.accessToken).exp) || (Date.now() + (Number(token.expiresIn) || 3600) * 1000) });
}

/** 合并两个官方模型目录，任一目录可提供区域适用的模型。 */
async function models(account) {
  account = await normalize(account);
  const merged = new Map();
  let error;
  for (const path of ['/v3/config', '/v2/enterprises/personal/models']) {
    try {
      const catalogHeaders = headers(account);
      if (account.region === 'global') catalogHeaders['User-Agent'] = `WorkBuddyAI/${regionConfig(account.region).version}`;
      const data = unpack(await requestJSON(`${account.endpoint}${path}`, { headers: catalogHeaders, timeout: 15000 }));
      const list = data.models ?? data.data?.models ?? data.Data?.models;
      if (!Array.isArray(list)) throw new ApiError('WorkBuddy 模型目录缺少 models', 502);
      for (const model of list) {
        if (typeof model.id !== 'string' || !model.id || merged.has(model.id)) continue;
        const lengths = model.contextWindow?.supportedLengths;
        const context = Number(model.contextWindow?.maxTokens ?? model.contextWindow?.max ?? model.context ?? model.contextLength ?? (Array.isArray(lengths) ? Math.max(...lengths) : 0));
        merged.set(model.id, { id: model.id, name: text(model.name) || text(model.displayName) || model.id, ...(context > 0 ? { context_length: context } : {}) });
      }
    } catch (e) { error = e; }
  }
  if (!merged.size) throw error || new ApiError('WorkBuddy 未返回可用模型', 502);
  return [...merged.values()];
}

function amount(value, label) {
  if (value == null || value === '' || !Number.isFinite(Number(value))) throw new ApiError(`WorkBuddy 额度响应缺少 ${label}`, 502);
  return Number(value);
}

/** 返回个人套餐或企业额度；缺失计费字段时明确报错，避免假余额。 */
async function quota(account) {
  account = await normalize(account);
  if (account.enterpriseId) {
    const data = await billing(account, '/v2/billing/meter/get-enterprise-user-usage');
    const usage = data.Response?.Data ?? data;
    const limit = amount(usage.limitNum, 'limitNum');
    const unlimited = limit < 0;
    const used = unlimited && usage.credit == null ? null : amount(usage.credit, 'credit');
    const remaining = unlimited ? null : Math.max(0, limit - used);
    return { remaining, limit: unlimited ? null : limit, used, unlimited, unit: 'credits', packages: unlimited ? [] : [{ name: '企业/教育月度额度', remaining, limit, used, expiresAt: usage.cycleEndTime || null }] };
  }
  const date = d => d.toISOString().replace('T', ' ').slice(0, 19);
  const data = await billing(account, '/v2/billing/meter/get-user-resource', { PageNumber: 1, PageSize: 100, ProductCode: 'p_tcaca', Status: [0, 3], PackageEndTimeRangeBegin: date(new Date()), PackageEndTimeRangeEnd: date(new Date(Date.now() + 3185136e6)) });
  const list = data.Response?.Data?.Accounts;
  if (!Array.isArray(list)) throw new ApiError('WorkBuddy 额度响应缺少 Accounts', 502);
  const packages = list.map(item => {
    const monthly = Number(item.CapacityType) === 4;
    const limit = amount(monthly ? item.CycleCapacitySize : item.CapacitySize, '套餐总额');
    const remaining = Math.max(0, amount(monthly ? item.CycleCapacityRemain : item.CapacityRemain, '套餐余额'));
    return { name: text(item.PackageName) || '积分套餐', remaining, limit, used: Math.max(0, limit - remaining), expiresAt: item.ExpiredTime || item.CycleEndTime || null };
  });
  return { remaining: packages.reduce((sum, p) => sum + p.remaining, 0), limit: packages.reduce((sum, p) => sum + p.limit, 0), used: packages.reduce((sum, p) => sum + p.used, 0), unlimited: false, packages, unit: 'credits' };
}

/** 查询今日签到状态，不领取奖励。 */
async function checkin(account) {
  const data = await billing(await normalize(account), '/v2/billing/meter/checkin-activity-status');
  if(typeof data.today_checked_in!=='boolean'||typeof data.active!=='boolean')throw new ApiError('WorkBuddy 签到状态字段缺失',502);
  const reward=data.daily_credit;
  return { checkedIn: data.today_checked_in, enabled: data.active, reward: reward!==null&&reward!==undefined&&reward!==''&&Number.isFinite(Number(reward))?Number(reward):null };
}

/** 显式领取签到奖励；所有非零业务码交由界面呈现。 */
async function claim(account) {
  const data = await billing(await normalize(account), '/v2/billing/meter/daily-checkin');
  return { checkedIn: true, reward: Number(data.credit) || 0 };
}

/**
 * 将消息适配为 WorkBuddy 上游协议。
 * 上游仅接受流式请求；转发层仍按客户端原选项返回流或完整 JSON。
 */
async function chat(account, body, { signal } = {}) {
  account = await normalize(account);
  if (typeof body?.model !== 'string' || !/^[\x20-\x7e]{1,200}$/.test(body.model)) throw new ApiError('model 必须是有效的模型标识');
  if (Array.isArray(body.messages) && body.messages.length) {
    const messages = body.messages.map(message => ['developer', 'Developer'].includes(message?.role) ? { ...message, role: 'system' } : message);
    // 网关要求第一条为 system；不改写客户端的原始消息对象。
    if (!['system', 'System'].includes(messages[0]?.role)) messages.unshift({ role: 'system', content: 'You are a helpful assistant.' });
    body = { ...body, messages };
  }
  // 网关按这些固定字段选择产品协议；没有生成设备指纹或轮换身份。
  const version = regionConfig(account.region).version;
  const metadata = {
    'X-IDE-Type': 'WorkBuddy', 'X-IDE-Name': 'WorkBuddy', 'X-IDE-Version': version, 'X-Product-Version': version,
    'User-Agent': account.region === 'global' ? `WorkBuddy/${version} WorkBuddy AI/${version}` : `WorkBuddy/${version} WorkBuddy/${version}`,
  };
  const response = await upstreamFetch(`${account.endpoint}/v2/chat/completions`, {
    method: 'POST', headers: { ...headers(account), ...metadata, Accept: 'text/event-stream', 'X-Model-ID': body.model, 'X-Agent-Intent': 'craft', 'X-Product': 'SaaS' }, body: JSON.stringify({ ...body, stream: true }), signal,
  });
  if (response.headers.get('content-type')?.includes('application/json')) {
    const result = await response.clone().json().catch(() => null);
    if (result?.code !== undefined) unpack(result);
    if (result?.error) throw new ApiError(text(result.error.message) || 'WorkBuddy 对话失败', 502, String(result.error.code || 'upstream_error'));
  }
  return response;
}

/** 申请设备登录状态，授权链接只允许官方 HTTPS 地址。 */
async function startLogin({ region = 'cn' } = {}) {
  const cfg = regionConfig(region);
  const data = unpack(await requestJSON(`${cfg.login}/v2/plugin/auth/state?platform=workbuddy`, { method: 'POST', headers: headers({ region }), body: {}, timeout: 30000 }));
  let url;
  try { url = new URL(data.authUrl); } catch { throw new ApiError('WorkBuddy 返回无效授权链接', 502); }
  if (!data.state || url.protocol !== 'https:' || url.username || url.password || url.port || !DOMAINS.has(url.hostname)) throw new ApiError('WorkBuddy 返回非官方授权链接', 502);
  return { url: url.href, state: String(data.state), region, expiresAt: Date.now() + 10 * 60 * 1000 };
}

/** 轮询一次设备登录，仅完成授权后读取账号身份。 */
async function pollLogin(pending) {
  if (!pending?.state || !pending.expiresAt || Date.now() >= pending.expiresAt) throw new ApiError('登录状态已过期，请重新登录');
  const cfg = regionConfig(pending.region);
  const query = `?state=${encodeURIComponent(pending.state)}`;
  const response = await requestJSON(`${cfg.login}/v2/plugin/auth/token${query}`, { headers: headers({ region: cfg.region }), timeout: 30000 });
  if (Number(response?.code) === 11217) return { status: 'pending' };
  const token = unpack(response);
  if (!token.accessToken) throw new ApiError('WorkBuddy 登录响应缺少 accessToken', 502);
  const identity = unpack(await requestJSON(`${cfg.login}/v2/plugin/login/account${query}`, { headers: headers({ region: cfg.region, accessToken: token.accessToken }), timeout: 30000 }));
  return { status: 'ready', account: await normalize({ ...token, uid: identity.uid, nickname: identity.nickname, enterpriseId: identity.enterpriseId, region: cfg.region, domain: token.domain || cfg.domain, expiresAt: millis(jwt(token.accessToken).exp) || Date.now() + (Number(token.expiresIn) || 3600) * 1000 }) };
}

/** 只读当前用户最新活动登录文件，排除历史账号快照。 */
async function desktop() {
  const home = homedir();
  const dirs = [join(process.env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'CodeBuddyExtension', 'Data', 'Public', 'auth'), join(home, 'Library', 'Application Support', 'CodeBuddyExtension', 'Data', 'Public', 'auth'), join(process.env.XDG_DATA_HOME || join(home, '.local', 'share'), 'CodeBuddyExtension', 'Data', 'Public', 'auth')];
  const candidates = [];
  for (const dir of dirs) for (const name of ['workbuddy-desktop.info', 'workbuddy-desktop-ai.info']) {
    const file = join(dir, name);
    try { const info = await stat(file); if (info.isFile()) candidates.push({ file, modified: info.mtimeMs }); } catch { /* 当前平台未安装此版本。 */ }
  }
  candidates.sort((a, b) => b.modified - a.modified);
  if (!candidates.length) throw new ApiError('未发现当前用户的 WorkBuddy 桌面登录，请先登录客户端');
  return normalize(JSON.parse(await readFile(candidates[0].file, 'utf8')));
}

export default { normalize, refresh, models, quota, checkin, claim, chat, startLogin, pollLogin, desktop, streamFormat: 'openai' };
