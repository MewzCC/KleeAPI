import { ApiError, json, readBody } from './http.mjs';

/** 本机控制台可以管理本地 Key；严格校验来源，避免外部网页读取或重设密钥。 */
export async function localKey(req, res, origins, getKey, replaceKey) {
  if (!['127.0.0.1', '::1', '::ffff:127.0.0.1'].includes(req.socket.remoteAddress)
    || !origins.has(req.headers.origin)
    || !['same-origin', 'same-site'].includes(req.headers['sec-fetch-site'])
    || !/^application\/json(?:\s*;|$)/i.test(req.headers['content-type'] || '')) {
    throw new ApiError('请从本机 KleeAPI 控制台管理密钥', 403, 'local_console_required');
  }
  const body = await readBody(req, 4096);
  if (!body || typeof body !== 'object' || Array.isArray(body)) throw new ApiError('密钥设置必须为 JSON 对象', 400, 'invalid_json');
  if (!Object.hasOwn(body, 'apiKey')) return json(res, 200, { apiKey: getKey() });
  if (typeof body.apiKey !== 'string' || !/^klee-[\x21-\x7e]{3,251}$/.test(body.apiKey)) throw new ApiError('API Key 须以 klee- 开头，长度 8–256 个可见 ASCII 字符，不含空白。', 400, 'invalid_api_key_format');
  replaceKey(body.apiKey);
  return json(res, 200, { ok: true });
}
