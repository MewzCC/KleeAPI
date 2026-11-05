/** 本机接口与平台请求共用的受控错误，不携带令牌或完整上游响应。 */
export class ApiError extends Error {
  constructor(message, status = 400, code = 'request_error') { super(message); this.status = status; this.code = code; }
}

/** 请求只发送一次；取消、超时与平台限流直接交给调用方处理。 */
export async function upstreamFetch(url, init = {}) {
  const {timeout = 120000, ...options} = init;
  const controller=new AbortController();const timer=timeout===null?null:setTimeout(()=>controller.abort(),timeout);
  const signals = [controller.signal, options.signal].filter(Boolean);
  try { return await fetch(url, {...options, signal: AbortSignal.any(signals), redirect: 'error'}); }
  catch (error) {
    if (controller.signal.aborted||options.signal?.reason?.name==='TimeoutError')throw new ApiError('上游请求超时',502,'upstream_timeout');
    if (options.signal?.aborted) throw new ApiError('客户端已取消请求', 499, 'request_canceled');
    throw new ApiError(error.name === 'TimeoutError' ? '上游请求超时' : '无法连接平台服务', 502, 'upstream_unavailable');
  }finally{if(timer)clearTimeout(timer);}
}

/** 读取有大小限制的 JSON，拒绝 HTML 错误页和不完整响应。 */
export async function requestJSON(url, options = {}) {
  const init = {...options, headers: {'Content-Type':'application/json', Accept:'application/json', ...options.headers}};
  init.signal=AbortSignal.any([options.signal,AbortSignal.timeout(options.timeout||30000)].filter(Boolean));
  if (init.body !== undefined && typeof init.body !== 'string') init.body = JSON.stringify(init.body);
  const response = await upstreamFetch(url, init);
  if (!response.ok) { await response.body?.cancel(); throw new ApiError('上游返回 HTTP '+response.status, response.status, 'upstream_http_error'); }
  const reader=response.body.getReader(); let size=0; const chunks=[];
  try { for (;;) { const {done,value}=await reader.read(); if(done)break;size+=value.length;if(size>8*1024*1024)throw new ApiError('平台响应过大',502);chunks.push(value); } }
  finally { await reader.cancel().catch(()=>{}); }
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')); }
  catch { throw new ApiError('平台没有返回有效 JSON',502,'invalid_upstream_response'); }
}

export function json(res, status, value) {
  res.writeHead(status,{'Content-Type':'application/json; charset=utf-8','Cache-Control':'no-store'});
  res.end(JSON.stringify(value));
}

/** 只接收有限大小的管理或对话 JSON；解析错误不回显输入中的凭据。 */
export async function readBody(req, limit = 1024*1024) {
  const chunks=[];let size=0;
  for await(const chunk of req){size+=chunk.length;if(size>limit)throw new ApiError('请求内容过大',413,'body_too_large');chunks.push(chunk);}
  try { return JSON.parse(Buffer.concat(chunks).toString('utf8')||'{}'); }
  catch { throw new ApiError('JSON 格式无效',400,'invalid_json'); }
}
