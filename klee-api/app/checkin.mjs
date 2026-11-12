import { ApiError } from './http.mjs';

/** Trae 中国版按北京时间运行，每轮结束后再安排下一轮。 */
export function nextTraeCheckin(at, now = Date.now()) {
  const [hours, minutes] = at.split(':').map(Number);
  const offset = 8 * 3600000;
  const next = new Date(now + offset);
  next.setUTCHours(hours, minutes, 0, 0);
  if (next.getTime() - offset <= now) next.setUTCDate(next.getUTCDate() + 1);
  return next.getTime() - offset;
}

/** 领取目标必须明确；保留旧平台接口的「当前账号」默认行为。 */
export function checkinTarget(body, gateway = false) {
  if (!body || Array.isArray(body) || typeof body !== 'object'
    || (body.all !== undefined && typeof body.all !== 'boolean')
    || (body.uid !== undefined && (typeof body.uid !== 'string' || !body.uid.trim() || body.uid.length > 512))
    || (body.all === true && body.uid !== undefined)
    || (gateway && body.platform !== undefined && !['workbuddy', 'trae', 'qoder'].includes(body.platform))
    || (gateway && body.all !== true && !(body.platform && body.uid))) {
    throw new ApiError('请选择全部账号，或指定平台与账号后签到', 400, 'invalid_checkin_target');
  }
  return body;
}

export function checkinFailure(result, error) {
  result.message = error.message || '签到状态查询失败';
  if (typeof error.code === 'string') result.errorCode = error.code;
  if (error.code === 'trae_9074') result.hint = '请稍后刷新签到状态。若仍显示未签到，再重新尝试领取。';
  else if (error.code === 'trae_9095') result.hint = '此设备今日已签到，请在官方客户端核对当前账号的领取记录；本次未确认到账。';
  else if (error.code === 'trae_1001' || error.code === 'qoder_device_reauth_required') result.hint = '请回到账号管理，使用官方登录重新授权，再刷新签到状态。';
  else if (error.code === 'qoder_runtime_missing') result.hint = '缺少本地官方身份组件。请在项目目录运行 npm run setup:qoder，安装后直接重新尝试；无需修改账号或设备标识。';
}
