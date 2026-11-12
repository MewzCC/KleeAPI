import {randomBytes} from 'node:crypto';
import {requestJSON, upstreamFetch, ApiError} from '../app/http.mjs';
import {ugDeviceContext, localDeviceContext, syncDevice} from './device.mjs';

const AGENT = 'https://trae-api-cn.mchost.guru';
const OAUTH = 'https://api.trae.com.cn';
const UG = 'https://api.trae.cn';
const CLIENT_ID = 'en1oxy7wnw8j9n';
const VERSION = '0.1.52';
const oauthHeaders = {'Content-Type':'application/json', Accept:'application/json', 'User-Agent':`Trae/${VERSION}`};
const text = value => value == null ? '' : String(value);
const milliseconds = value => {
  const n = Number(value);
  return Number.isFinite(n) && n > 0 ? (n < 1e12 ? n * 1000 : n) : 0;
};

/**
 * 校验业务状态；HTTP 200 不能代替平台业务码。
 */
function checked(data, requireCode = false) {
  if (!data || typeof data !== 'object' || Array.isArray(data)) throw new ApiError('Trae 返回了无效数据', 502, 'upstream_error');
  const code = data.code ?? data.Code;
  if ((code != null && Number(code) !== 0) || data.ResponseMetadata?.Error || data.Error) {
    const crowded = '当前参与用户太多，请稍后再试';
    const checkinRejection = data.message === crowded ? crowded : '平台拒绝本次签到';
    const messages = {9074:checkinRejection + '。奖励未确认到账',9095:'此设备今日已签到，当前账号未确认领取；请核对官方签到记录',1001:'登录已失效，请在账号管理中重新登录'};
    throw new ApiError(`Trae 拒绝请求（${text(code ?? 'error')}）：${messages[code] || '请在官方客户端核对'}`, code == 1001 ? 401 : 502, `trae_${code ?? 'error'}`);
  }
  if (requireCode && code == null) throw new ApiError('领取响应缺少业务码，请核对官方签到记录', 502, 'upstream_error');
  return data;
}

/**
 * 导入地址仅用于识别已有官方账号配置，不能把凭证发送到任意主机。
 */
function validateAccountSource(input) {
  if (input.region && String(input.region).toLowerCase() !== 'cn') throw new ApiError('Trae 适配器仅支持中国区');
  if (input.domain && !['trae.cn','trae.com.cn'].includes(input.domain)) throw new ApiError('不支持此 Trae 域名');
  for (const key of ['endpoint','apiHost','api_host']) {
    if (!input[key]) continue;
    let url;
    try { url = new URL(input[key]); } catch { throw new ApiError('Trae API 地址无效'); }
    if (url.origin !== OAUTH || url.username || url.password || url.search || url.hash || url.pathname !== '/') throw new ApiError('不允许此 Trae API 地址');
  }
}

function jsonParameter(raw) {
  if (raw && typeof raw === 'object') return raw;
  for (let i = 0; i < 2 && typeof raw === 'string'; i++) {
    try { return JSON.parse(raw); } catch { /* 回调可能额外编码一次。 */ }
    try { raw = decodeURIComponent(raw); } catch { break; }
  }
  return {};
}

/**
 * 解析回调中的用户资料和双层编码 JSON，不访问回调地址。
 */
function callbackData(input) {
  const user = jsonParameter(input.userInfo);
  const jwt = jsonParameter(input.userJwt);
  return {
    ...input, uid:input.uid ?? user.UserID, nickname:input.nickname ?? user.ScreenName,
    enterpriseId:input.enterpriseId ?? user.TenantID ?? user.EnterpriseID,
    accessToken:input.accessToken ?? jwt.Token,
    refreshToken:input.refreshToken ?? jwt.RefreshToken,
    expiresAt:input.expiresAt ?? jwt.TokenExpireAt,
  };
}

function readInput(input) {
  if (typeof input === 'string') {
    const raw = input.trim();
    if (raw.startsWith('{')) {
      try { input = JSON.parse(raw); } catch { throw new ApiError('账号 JSON 格式无效'); }
    } else {
      try { input = Object.fromEntries(new URL(raw).searchParams); }
      catch { throw new ApiError('请输入账号 JSON 或完整回调链接'); }
    }
  }
  if (!input || typeof input !== 'object' || Array.isArray(input)) throw new ApiError('账号数据无效');
  validateAccountSource(input);
  if (input.auth) validateAccountSource(input.auth);
  const merged = {...input, ...input.account, ...input.auth};
  validateAccountSource(merged);
  return callbackData(merged);
}

function accountFields(input) {
  const reqSource = input.reqSource ?? input.req_source ?? 2;
  if (![1,2].includes(reqSource)) throw new ApiError('Trae reqSource 只能为 1（IDE）或 2（SOLO）');
  return {
    uid:text(input.uid ?? input.UserID), nickname:text(input.nickname ?? input.ScreenName), region:'cn',
    accessToken:text(input.accessToken ?? input.access_token ?? input.Token),
    refreshToken:text(input.refreshToken ?? input.refresh_token ?? input.RefreshToken),
    expiresAt:milliseconds(input.expiresAt ?? input.expires_at ?? input.TokenExpireAt),
    domain:input.domain || 'trae.cn', endpoint:OAUTH,
    enterpriseId:text(input.enterpriseId ?? input.EnterpriseID ?? input.TenantID),
    machineId:text(input.machineId ?? input.machine_id), deviceId:text(input.deviceId ?? input.device_id),
    deviceBrand:text(input.deviceBrand ?? input.x_device_brand), deviceType:text(input.deviceType ?? input.x_device_type),
    osVersion:text(input.osVersion ?? input.x_os_version), appVersion:text(input.appVersion ?? input.x_app_version),
    reqSource,
  };
}

function headers(account, kind = 'solo', stream = false) {
  const h = {...oauthHeaders};
  if (kind === 'oauth') return {...h, 'X-Cloudide-Token':account.accessToken};
  h.Authorization = `Cloud-IDE-JWT ${account.accessToken}`;
  if (account.deviceId) h['X-Device-Id'] = account.deviceId;
  if (kind === 'ug') return {...h, 'X-User-Region':'CN'};
  Object.assign(h, {
    Accept:stream ? 'text/event-stream' : 'application/json',
    'X-Cloudide-Token':account.accessToken, 'X-Ide-Token':account.accessToken,
    'X-App-Id':'6eefa01c-1036-4c7e-9ca5-d891f63bfcd8', 'X-App-Version':'default',
    'X-Ide-Version':VERSION, 'X-Ide-Version-Code':'20260811', 'X-App-Version-Code':'20260811',
    'X-Ide-Version-Type':'stable', 'X-Device-Type':'windows', 'Request-Traffic-Type':'prod',
  });
  if (account.uid) h['X-Uid'] = account.uid;
  if (account.machineId) h['X-Machine-Id'] = account.machineId;
  return h;
}

async function post(host, path, account, body = {}, kind = 'solo') {
  const h = headers(account, kind);
  if (kind === 'ug') {
    const device = ugDeviceContext(account);
    for (const [header, field] of [['X-Device-Id','deviceId'],['X-Device-Brand','deviceBrand'],['X-Device-Type','deviceType'],['X-Os-Version','osVersion'],['X-App-Version','appVersion']]) if (device[field]) h[header] = device[field];
    if (device.appVersion) h['User-Agent'] = `Trae/${device.appVersion}`;
  }
  return checked(await requestJSON(host + path, {method:'POST', headers:h, body}));
}

/**
 * 轮换 refreshToken 后返回新账号，失败时保留调用方原有凭证。
 */
async function refresh(account) {
  validateAccountSource(account);
  if (!account.refreshToken) throw new ApiError('账号缺少 refreshToken，请重新登录', 401);
  const data = checked(await requestJSON(OAUTH + '/cloudide/api/v3/trae/oauth/ExchangeToken', {
    method:'POST', headers:oauthHeaders,
    body:{ClientID:CLIENT_ID, RefreshToken:account.refreshToken, ClientSecret:'-', UserID:''},
  }));
  const result = data.Result;
  if (!result?.Token) throw new ApiError('Trae 刷新失败：响应缺少令牌，请重新登录', 401, 'refresh_failed');
  let expiresAt = milliseconds(result.TokenExpireAt);
  if ((!expiresAt || expiresAt <= Date.now()) && Number(result.TokenExpireDuration) > 0) expiresAt = Date.now() + Number(result.TokenExpireDuration) * 1000;
  return {...account, accessToken:result.Token, refreshToken:result.RefreshToken || account.refreshToken, expiresAt};
}

async function identify(account) {
  const data = await post(OAUTH, '/cloudide/api/v3/trae/GetUserInfo', account, {ReqSource:'IDE', IDEVersion:VERSION}, 'oauth');
  const user = data.Result;
  if (!user?.UserID) throw new ApiError('Trae 未返回用户身份', 502, 'upstream_error');
  return {...account, uid:text(user.UserID), nickname:text(user.ScreenName) || account.nickname, enterpriseId:text(user.EnterpriseID) || account.enterpriseId};
}

/**
 * 已完整保存的账号纯本地导入；缺少凭证或身份时才交换令牌、查询资料。
 */
async function normalize(input) {
  let account = accountFields(readInput(input));
  if (!account.accessToken) account = await refresh(account);
  if (!account.uid) account = await identify(account);
  if (!account.uid || !account.accessToken) throw new ApiError('账号缺少 uid 或 accessToken');
  return account;
}

/**
 * 从 SOLO 配置目录读取模型标识，保留上游提供的上下文大小。
 */
async function models(account) {
  const data = await post(AGENT, '/api/ide/v1/get_detail_param', account, {
    function:'solo_work_lite', config_names:null, need_prompt:false, current_config_info:null,
    poly_prompt:true, mode_type:null, agent_type:null,
  });
  if (!Array.isArray(data.config_info_list)) throw new ApiError('Trae 模型目录缺失', 502);
  const result = data.config_info_list.filter(c => c.config_name).map(c => {
    const item = {id:c.config_name, name:c.display_config?.display_name || c.config_name};
    const size = Number(c.max_input_tokens ?? c.maxInputTokens ?? c.model_detail_list?.[0]?.max_input_tokens ?? c.model_detail_list?.[0]?.maxInputTokens);
    if (Number.isFinite(size) && size > 0) item.context_length = size;
    return item;
  });
  if (!result.length) throw new ApiError('Trae 模型目录为空', 502);
  return result;
}

/**
 * 仅聚合积分权益，保留原始小数；尚无用量记录的积分包按已用零计算。
 */
async function quota(account) {
  const data = await post(UG, '/trae/api/v2/pay/ide_user_ent_usage', account, {}, 'ug');
  if (!Array.isArray(data.user_entitlement_pack_list)) throw new ApiError('Trae 响应缺少权益包列表', 502);
  // 免费订阅等非积分权益也在列表中，不能因它们缺少 credits_limit 而中断整次查询。
  const packages = data.user_entitlement_pack_list.filter(pack => pack?.entitlement_base_info?.quota?.credits_limit !== undefined).map(pack => {
    const info = pack.entitlement_base_info || {};
    const rawLimit = info.quota?.credits_limit;
    const rawUsed = pack.usage?.credits_amount ?? 0;
    if ([rawLimit, rawUsed].some(value => !['number','string'].includes(typeof value) || String(value).trim() === '' || !Number.isFinite(Number(value)))) throw new ApiError('Trae 额度字段不完整', 502);
    const limit = Number(rawLimit), used = Number(rawUsed);
    return {name:text(info.name ?? info.entitlement_name ?? pack.name) || '积分包', limit, used,
      remaining:limit < 0 ? null : Math.max(0, limit - used),
      expiresAt:milliseconds(info.expire_at ?? info.expires_at ?? pack.expire_at) || null};
  });
  const unlimited = packages.some(p => p.limit < 0);
  const limit = packages.filter(p => p.limit >= 0).reduce((sum,p) => sum+p.limit, 0);
  const used = packages.reduce((sum,p) => sum+p.used, 0);
  const remaining = unlimited ? null : packages.reduce((sum,p) => sum+p.remaining, 0);
  return {remaining, limit:unlimited ? null : limit, used, unlimited, packages, unit:'积分'};
}

async function checkin(account) {
  // 官方签到协议区分 IDE(1) 和 SOLO(2)；本项目网页登录使用 SOLO，不更换账号设备身份。
  const reqSource = account.reqSource ?? 2;
  if (![1,2].includes(reqSource)) throw new ApiError('Trae 签到请求来源无效');
  const data = await post(UG, '/trae/api/v2/ug/checkin_credits/status', account, {req_source:reqSource}, 'ug');
  if (typeof data.checked_in !== 'boolean' || typeof data.enable !== 'boolean') throw new ApiError('Trae 签到状态字段缺失', 502);
  return {checkedIn:data.checked_in, enabled:data.enable, reward:data.credits ?? null,
    ...(typeof data.did_checked_in==='boolean'?{deviceCheckedIn:data.did_checked_in}:{})};
}

async function claim(account) {
  const reqSource = account.reqSource ?? 2;
  if (![1,2].includes(reqSource)) throw new ApiError('Trae 签到请求来源无效');
  const data = checked(await post(UG, '/trae/api/v2/ug/checkin_credits/claim', account, {req_source:reqSource}, 'ug'), true);
  return {claimed:true, reward:data.credits ?? null};
}

/**
 * 构造官方登录地址；设备标识仅在发起登录时生成，随后随账号保存。
 */
async function startLogin({region = 'cn', callbackURL = 'http://127.0.0.1:18080/authorize'} = {}) {
  if (region !== 'cn') throw new ApiError('Trae 适配器仅支持中国区');
  const callback = new URL(callbackURL);
  if (callback.origin !== 'http://127.0.0.1:18080' || callback.pathname !== '/authorize' || callback.search || callback.hash || callback.username || callback.password) throw new ApiError('Trae 登录回调必须使用本机 18080 端口');
  const machineId = randomBytes(16).toString('hex'), deviceId = randomBytes(16).toString('hex');
  const deviceContext = await localDeviceContext({reqSource:2, deviceId});
  const state = deviceId.slice(-16);
  const url = new URL('https://www.trae.cn/authorization');
  url.search = new URLSearchParams({
    login_version:'1', auth_from:'solo', login_channel:'native_ide', plugin_version:'2.3.62834',
    auth_type:'local', client_id:CLIENT_ID, redirect:'0', login_trace_id:state, auth_callback_url:callbackURL,
    machine_id:machineId, device_id:deviceId, x_device_id:deviceId, x_machine_id:machineId,
    x_device_brand:deviceContext.deviceBrand || '', x_device_type:deviceContext.deviceType || '', x_os_version:deviceContext.osVersion || '', x_app_version:deviceContext.appVersion || VERSION, x_app_type:'stable',
  }).toString();
  return {url:url.href, state, machineId, deviceId, deviceContext, callbackURL};
}

/**
 * 拒绝无关联或互相矛盾的回调，避免外部请求替换当前登录账号。
 */
function matchesCallback(pending, rawURL) {
  try {
    const url = new URL(rawURL), expected = new URL(pending.callbackURL);
    if (url.origin !== expected.origin || url.pathname !== expected.pathname) return false;
    const q = url.searchParams;
    const trace = q.get('loginTraceID') || q.get('login_trace_id');
    const machine = q.get('machine_id'), device = q.get('device_id');
    if ((trace && trace !== pending.state) || (machine && machine !== pending.machineId) || (device && device !== pending.deviceId)) return false;
    return Boolean((trace && trace === pending.state) || (machine === pending.machineId && device === pending.deviceId && machine && device));
  } catch { return false; }
}

async function completeLogin(pending, rawURL) {
  if (!matchesCallback(pending, rawURL)) throw new ApiError('登录回调与当前登录请求不匹配', 400, 'invalid_callback');
  let account = accountFields(readInput(rawURL));
  account.machineId = pending.machineId;
  account.deviceId = pending.deviceId;
  for (const field of ['deviceBrand','deviceType','osVersion','appVersion']) if (pending.deviceContext?.[field]) account[field] = pending.deviceContext[field];
  if (account.refreshToken) account = await refresh(account);
  if (!account.accessToken) throw new ApiError('登录回调缺少令牌');
  if (!account.uid || !account.nickname) account = await identify(account);
  return account;
}

/**
 * 保留历史内容与工具结果，将 OpenAI 请求转成 SOLO 所需的内容数组。
 */
async function chat(account, body, {signal} = {}) {
  const payload = structuredClone(body);
  payload.model = text(body.model).trim() || 'glm-5.2';
  payload.config_name = payload.model;
  payload.function = 'solo_work_lite';
  payload.stream = true;
  payload.messages = (payload.messages || []).map(message => {
    if (typeof message.content === 'string') message.content = [{type:'text', text:message.content}];
    if (message.role === 'assistant' && Array.isArray(message.tool_calls)) {
      message.tool_calls = message.tool_calls.map(call => {
        if (call.function) {call.function_call = call.function; delete call.function;}
        return call;
      }).filter(call => call.function_call?.name?.trim());
      if (!message.tool_calls.length) delete message.tool_calls;
    }
    return message;
  });
  let choice = payload.tool_choice;
  if (choice && typeof choice === 'object') choice = choice.type === 'function' ? choice.function?.name || choice.name || 'auto' : choice.type;
  if (typeof choice === 'string' && choice.toLowerCase().trim() === 'none') {
    delete payload.tools; delete payload.functions; delete payload.tool_choice;
  } else if (typeof choice === 'string') payload.tool_choice = choice;
  else delete payload.tool_choice;
  if (Array.isArray(payload.tools)) {
    payload.tools = payload.tools.filter(tool => tool?.function).map(tool => {
      if (tool.function.parameters && typeof tool.function.parameters === 'object') tool.function.parameters = JSON.stringify(tool.function.parameters);
      return tool;
    });
    if (!payload.tools.length) delete payload.tools;
  }
  return upstreamFetch(AGENT + '/api/agent/v3/llm_utils_chat', {
    method:'POST', headers:headers(account, 'solo', true), body:JSON.stringify(payload), signal,
  });
}

export default {normalize, refresh, models, quota, checkin, claim, startLogin, syncDevice,
  pollLogin:async () => ({status:'pending'}), matchesCallback, completeLogin, chat, streamFormat:'solo'};
