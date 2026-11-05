export interface Delta { content?: string; reasoning_content?: string; tool_calls?: unknown[] }
/** 增量解码 UTF-8 与 SSE 帧，只有正常结束的回复可进入聊天上下文。 */
export async function readStream(response: Response, signal: AbortSignal, onDelta: (delta: Delta) => void) {
  if (!response.body) throw new Error('响应没有可读取的流。')
  const reader = response.body.getReader(), decoder = new TextDecoder()
  let buffer = '', terminal = false, ended = false
  const cancel = () => { void reader.cancel().catch(() => {}) }
  signal.addEventListener('abort', cancel, { once: true })
  function frame(raw: string) {
    const data = raw.split('\n').filter(line => line.startsWith('data:')).map(line => line.slice(5).replace(/^ /, '')).join('\n')
    if (!data.trim()) return
    if (data.trim() === '[DONE]') { terminal = ended = true; return }
    const event = JSON.parse(data)
    if (event.error) throw new Error(event.error.message || '模型返回流内错误。')
    const choice = event.choices?.[0]
    if (choice?.finish_reason) terminal = true
    if (choice?.delta) onDelta(choice.delta)
  }
  try {
    while (!ended) {
      signal.throwIfAborted()
      const { value, done } = await reader.read()
      signal.throwIfAborted()
      buffer += done ? decoder.decode() : decoder.decode(value, { stream: true })
      buffer = buffer.replace(/\r\n/g, '\n')
      let boundary: number
      while (!ended && (boundary = buffer.indexOf('\n\n')) >= 0) { const raw = buffer.slice(0, boundary); buffer = buffer.slice(boundary + 2); frame(raw) }
      if (done) { if (!ended && buffer.trim()) frame(buffer); break }
    }
    if (!terminal) throw new Error('响应流意外中断，未收到结束标记。')
  } finally { signal.removeEventListener('abort', cancel); await reader.cancel().catch(() => {}) }
}
