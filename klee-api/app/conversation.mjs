const textLimit = 16384;
const messageLimit = 64;

/** 有界采集文本，不保存图片/音频内联数据，也不改变发往平台的消息。 */
export function captureConversation(messages) {
  let truncated = false, requestLeft = textLimit, responseLeft = textLimit;
  function take(value, response = false) {
    if (typeof value !== 'string') return '';
    const remaining = response ? responseLeft : requestLeft;
    let text = value.slice(0, remaining);
    if (/[\uD800-\uDBFF]$/.test(text)) text = text.slice(0, -1);
    if (text.length < value.length) truncated = true;
    if (response) responseLeft -= text.length; else requestLeft -= text.length;
    return text;
  }
  function content(value, response = false) {
    if (typeof value === 'string') return take(value, response);
    if (!Array.isArray(value)) return '';
    let result = '';
    for (const part of value.slice(0, messageLimit)) {
      result += take(part?.type === 'text' ? part.text : '[非文本内容未保存]', response);
    }
    if (value.length > messageLimit) truncated = true;
    return result;
  }
  function toolText(tools, response = false) {
    if (!Array.isArray(tools)) return '';
    let text = '';
    for (const tool of tools.slice(0, messageLimit)) {
      text += take('\n[工具调用] ' + (tool?.function?.name || '') + '\n' + (typeof tool?.function?.arguments === 'string' ? tool.function.arguments : ''), response);
    }
    if (tools.length > messageLimit) truncated = true;
    return text;
  }
  const source = messages.length > messageLimit ? messages.slice(-messageLimit) : messages;
  if (source !== messages) truncated = true;
  // 优先保留最近的用户消息，同时仍按实际请求顺序展示。
  const request = [...source].reverse().map(message => ({ role: String(message.role).slice(0, 32), name: typeof message.name === 'string' ? message.name.slice(0, 128) : undefined, content: content(message.content) + toolText(message.tool_calls) })).reverse();
  const choices = new Map();
  return {
    observe(data) {
      for (const choice of Array.isArray(data.choices) ? data.choices.slice(0, 8) : []) {
        const index = Number.isSafeInteger(choice.index) && choice.index >= 0 ? choice.index : 0;
        if (!choices.has(index)) {
          if (choices.size >= 8) { truncated = true; continue; }
          choices.set(index, { role: 'assistant', index, content: '', reasoning: '', tools: new Map() });
        }
        const row = choices.get(index), message = choice.message || choice.delta;
        if (!message) continue;
        row.content += content(message.content ?? message.refusal, true);
        row.reasoning += take(message.reasoning_content, true);
        for (const [offset, tool] of (Array.isArray(message.tool_calls) ? message.tool_calls : []).slice(0, 32).entries()) {
          const toolIndex = Number.isSafeInteger(tool.index) && tool.index >= 0 ? tool.index : offset;
          if (!row.tools.has(toolIndex)) {
            if (row.tools.size >= 32) { truncated = true; continue; }
            row.tools.set(toolIndex, { name: '', arguments: '' });
          }
          const entry = row.tools.get(toolIndex);
          entry.name += take(tool.function?.name, true);
          entry.arguments += take(tool.function?.arguments, true);
        }
        if (message.tool_calls?.length > 32) truncated = true;
      }
      if (data.choices?.length > 8) truncated = true;
    },
    snapshot(complete) {
      return { request, response: [...choices.values()].sort((a, b) => a.index - b.index).map(({ tools, ...row }) => ({ ...row, tools: [...tools.values()] })), truncated, complete };
    },
  };
}
