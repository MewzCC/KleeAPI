import {
  createCipheriv,
  createHash,
  publicEncrypt,
  randomBytes,
  randomUUID,
  constants,
} from "node:crypto";
import { ApiError } from "../app/http.mjs";

const VERSION = "1.1.69";
const RSA_KEY = `-----BEGIN PUBLIC KEY-----
MIGfMA0GCSqGSIb3DQEBAQUAA4GNADCBiQKBgQDA8iMH5c02LilrsERw9t6Pv5Nc
4k6Pz1EaDicBMpdpxKduSZu5OANqUq8er4GM95omAGIOPOh+Nx0spthYA2BqGz+l
6HRkPJ7S236FZz73In/KVuLnwI8JJ2CbuJap8kvheCCZpmAWpb/cPx/3Vr/J6I17
XcW+ML9FoCI6AOvOzwIDAQAB
-----END PUBLIC KEY-----`;
const ALPHABET =
  "_doRTgHZBKcGVjlvpC,@aFSx#DPuNJme&i*MzLOEn)sUrthbf%Y^w.(kIQyXqWA!";

/** 按 Qoder 客户端字母表编码 UTF-8 请求并交换首尾三分段。 */
export function encodeBody(text) {
  const standard =
    "ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/";
  const s = Buffer.from(text)
    .toString("base64")
    .replace(/[A-Za-z0-9+/=]/g, (c) =>
      c === "=" ? "$" : ALPHABET[standard.indexOf(c)],
    );
  const third = Math.floor(s.length / 3);
  return third
    ? s.slice(-third) + s.slice(third, -third) + s.slice(0, third)
    : s;
}

/** 签名只使用当前账号身份；设备原生令牌存在时照原值发送。 */
export function cosyHeaders(url, account, body = "", chatModel, identity = {}) {
  if (!account.machineId)
    throw new ApiError(
      "Qoder 凭据缺少 machineId，请重新网页登录或导入原客户端凭据",
    );
  const key = randomBytes(8).toString("hex");
  const aes = createCipheriv("aes-128-cbc", Buffer.from(key), Buffer.from(key));
  const info = Buffer.concat([
    aes.update(
      JSON.stringify({
        uid: account.providerUid,
        aid: "",
        name: account.nickname,
        email: account.email,
        security_oauth_token: account.accessToken,
      }),
    ),
    aes.final(),
  ]).toString("base64");
  const wrapped = publicEncrypt(
    { key: RSA_KEY, padding: constants.RSA_PKCS1_PADDING },
    Buffer.from(key),
  ).toString("base64");
  const payload = Buffer.from(
    JSON.stringify({
      version: "v1",
      requestId: randomUUID(),
      info,
      cosyVersion: VERSION,
      ideVersion: "",
    }),
  ).toString("base64");
  const timestamp = Math.floor(Date.now() / 1000);
  const path = new URL(url).pathname.replace(/^\/algo/, "");
  const sig = createHash("md5")
    .update(`${payload}\n${wrapped}\n${timestamp}\n${body}\n${path}`)
    .digest("hex");
  const h = {
    Accept: "application/json",
    "Content-Type": "application/json",
    "Accept-Encoding": "identity",
    Authorization: `Bearer COSY.${payload}.${sig}`,
    "Cosy-Key": wrapped,
    "Cosy-Date": String(timestamp),
    "Cosy-Version": VERSION,
    "Login-Version": "v2",
    "Cosy-Business-Product": "app",
    "Cosy-Business-Type": "agent",
    "Cosy-ClientType": "10",
    "Cosy-Data-Policy": "disagree",
    "Cosy-MachineId": account.machineId,
    "Cosy-MachineOS": `${{ x64: "x86_64", arm64: "aarch64" }[process.arch] || process.arch}_${process.platform}`,
    "Cosy-Scene": "app",
    "Cosy-User": account.providerUid,
  };
  if (chatModel)
    Object.assign(h, {
      Accept: "text/event-stream",
      "Cache-Control": "no-cache",
      "X-Model-Key": chatModel.key,
      "X-Model-Source": chatModel.source || "system",
      ...identity,
    });
  else
    Object.assign(h, {
      "Cosy-ClientIp": account.machineId,
      "Cosy-MachineToken": account.machineId,
      "Cosy-MachineType": "5",
    });
  return h;
}

const textOf = (content) =>
  typeof content === "string"
    ? content
    : Array.isArray(content)
      ? content
          .filter((p) => p?.type === "text")
          .map((p) => p.text || "")
          .join("\n")
      : "";

/** 转换消息和工具为上游 agent_chat_generation 请求形状。 */
export function chatBody(body, model) {
  if (!Array.isArray(body.messages) || !body.messages.length)
    throw new ApiError("messages 必须为非空数组");
  const system = [
    "You are a Qoder agent. Use the instructions below and the tools available to you to assist the user.",
    ...body.messages
      .filter((m) => ["system", "developer"].includes(m.role))
      .map((m) => textOf(m.content)),
  ]
    .filter(Boolean)
    .join("\n\n");
  const block = { type: "text", text: system };
  const messages = body.messages
    .filter((m) => !["system", "developer"].includes(m.role))
    .map((m) => {
      if (!["user", "assistant", "tool"].includes(m.role))
        throw new ApiError("Qoder 不支持此消息角色");
      if (m.role === "tool")
        return {
          role: "tool",
          tool_call_id: m.tool_call_id,
          content: textOf(m.content),
        };
      if (m.tool_calls?.length)
        return {
          role: m.role,
          content: textOf(m.content),
          tool_calls: m.tool_calls,
          ...(m.reasoning_content
            ? { reasoning_content: m.reasoning_content }
            : {}),
        };
      const content =
        typeof m.content === "string"
          ? [{ type: "text", text: m.content }]
          : (m.content || []).map((p) => {
              if (p.type === "text") return { type: "text", text: p.text };
              if (p.type === "image_url") {
                if (!model.is_vl)
                  throw new ApiError("所选 Qoder 模型不支持图片");
                const url =
                  typeof p.image_url === "string"
                    ? p.image_url
                    : p.image_url?.url;
                if (typeof url !== "string" || !url)
                  throw new ApiError("Qoder 图片缺少 URL");
                return { type: "image_url", image_url: { url } };
              }
              throw new ApiError("Qoder 不支持此消息内容类型");
            });
      return {
        role: m.role,
        content,
        ...(m.reasoning_content
          ? { reasoning_content: m.reasoning_content }
          : {}),
      };
    });
  const id = randomUUID(),
    task = randomUUID();
  const thinking = model.thinking_config
    ? model.thinking_config.enabled != null && body.reasoning_effort !== "none"
    : !!model.is_reasoning;
  const parameters = {
    enable_thinking: thinking,
    max_tokens: body.max_completion_tokens || body.max_tokens || 32000,
  };
  if (body.reasoning_effort && body.reasoning_effort !== "none")
    parameters.reasoning_effort = body.reasoning_effort;
  const modelConfig = {
    key: model.key,
    display_name: model.display_name || model.key,
    ...(model.outer_provider
      ? { outer_provider: model.outer_provider }
      : { model: "" }),
    format: model.format || "openai",
    is_vl: !!model.is_vl,
    is_reasoning: !!model.is_reasoning && thinking,
    api_key: "",
    url: "",
    source: model.source || "system",
    max_input_tokens: model.max_input_tokens || 200000,
  };
  return {
    request_id: id,
    request_set_id: task,
    chat_record_id: id,
    session_id: randomUUID(),
    parameters,
    business: {
      product: "app",
      version: VERSION,
      type: "agent",
      id: task,
      name: "",
      begin_at: Date.now(),
      stage: "start",
      model_key: model.key,
    },
    agent_id: "agent_common",
    task_id: "common",
    session_type: "app",
    model_config: modelConfig,
    system: [block],
    messages: [{ role: "system", content: [block] }, ...messages],
    ...(body.tool_choice === "none" || !body.tools?.length
      ? {}
      : { tools: body.tools }),
  };
}

/** 解开 SSE 业务信封，保留 usage 尾帧；取消向上传递给网络读取器。 */
export function openaiResponse(response, model, signal, tools = []) {
  const reader = response.body?.getReader();
  if (!reader) throw new ApiError("Qoder 未返回对话流", 502);
  const decoder = new TextDecoder(),
    encoder = new TextEncoder(),
    id = "chatcmpl-" + randomUUID();
  let buffer = "",
    ended = false,
    finished = false,
    finishReason = "",
    usage,
    textPending = "",
    callIndex = 0,
    sawTool = false;
  const native = new Map();
  const chunk = (delta, finish_reason = null) => ({
    id,
    object: "chat.completion.chunk",
    created: Math.floor(Date.now() / 1000),
    model,
    choices: [{ delta, index: 0, finish_reason }],
  });
  // Qoder 模型可把函数调用放在文本的 tool_call 包装中，须完整解析后再交给客户端。
  const textPieces = (text, flush = false) => {
    textPending += text;
    const out = [];
    if (!tools.length) {
      if (textPending) out.push(chunk({ content: textPending }));
      textPending = "";
      return out;
    }
    const open = "<tool_call>",
      close = "</tool_call>";
    for (;;) {
      const at = textPending.indexOf(open);
      if (at < 0) {
        let hold = 0;
        if (!flush)
          for (let n = 1; n < open.length; n++)
            if (textPending.endsWith(open.slice(0, n))) hold = n;
        const text = textPending.slice(0, textPending.length - hold);
        if (text) out.push(chunk({ content: text }));
        textPending = textPending.slice(textPending.length - hold);
        return out;
      }
      if (at > 0) {
        out.push(chunk({ content: textPending.slice(0, at) }));
        textPending = textPending.slice(at);
      }
      const end = textPending.indexOf(close, open.length);
      if (end < 0) {
        if (flush)
          throw new ApiError(
            "Qoder 工具调用流提前结束",
            502,
            "incomplete_tool_call",
          );
        return out;
      }
      const raw = textPending.slice(open.length, end);
      let name, args;
      try {
        const call = JSON.parse(raw);
        name = call.name;
        args = call.arguments;
      } catch {
        const f = /<function=([^>]+)>([\s\S]*?)<\/function>/.exec(raw);
        if (f) {
          name = f[1].trim();
          args = {};
          const schema =
            tools.find((t) => t.function?.name === name)?.function?.parameters
              ?.properties || {};
          for (const p of f[2].matchAll(
            /<parameter=([^>]+)>([\s\S]*?)<\/parameter>/g,
          )) {
            const key = p[1].trim(),
              v = p[2].trim();
            try {
              args[key] = schema[key]?.type === "string" ? v : JSON.parse(v);
            } catch {
              args[key] = v;
            }
          }
        }
      }
      if (
        !tools.some((t) => t.function?.name === name) ||
        !args ||
        typeof args !== "object" ||
        Array.isArray(args)
      )
        throw new ApiError(
          "Qoder 返回无效或未声明的工具调用",
          502,
          "invalid_tool_call",
        );
      out.push(
        chunk({
          tool_calls: [
            {
              index: callIndex++,
              id: "call_" + randomUUID().replaceAll("-", ""),
              type: "function",
              function: { name, arguments: JSON.stringify(args) },
            },
          ],
        }),
      );
      sawTool = true;
      textPending = textPending.slice(end + close.length);
    }
  };
  const abort = () => reader.cancel(signal.reason).catch(() => {});
  signal?.addEventListener("abort", abort, { once: true });
  const stream = new ReadableStream({
    async pull(controller) {
      const emit = (obj) =>
        controller.enqueue(
          encoder.encode(
            `data: ${typeof obj === "string" ? obj : JSON.stringify(obj)}\n\n`,
          ),
        );
      try {
        while (!ended) {
          if (signal?.aborted)
            throw new ApiError("客户端已取消请求", 499, "request_canceled");
          const next = await reader.read();
          buffer += decoder.decode(next.value, { stream: !next.done });
          if (buffer.length > 8 * 1024 * 1024)
            throw new ApiError("Qoder 对话帧过大", 502);
          const lines = buffer.split(/\r?\n/);
          buffer = lines.pop();
          if (next.done && buffer) {
            lines.push(buffer);
            buffer = "";
          }
          let emitted = false;
          for (const line of lines) {
            if (!line.startsWith("data:")) continue;
            const raw = line.slice(5).trim();
            if (raw === "[DONE]") {
              ended = true;
              break;
            }
            let env;
            try {
              env = JSON.parse(raw);
            } catch {
              throw new ApiError("Qoder 对话流包含无效 JSON", 502);
            }
            if (
              env.statusCodeValue != null &&
              Number(env.statusCodeValue) !== 200
            )
              throw new ApiError(
                "Qoder 对话业务错误 " + env.statusCodeValue,
                502,
                "upstream_error",
              );
            if (env.body?.trim() === "[DONE]") {
              ended = true;
              break;
            }
            if (typeof env.body !== "string") continue;
            let chunk;
            try {
              chunk = JSON.parse(env.body.trim());
            } catch {
              throw new ApiError("Qoder 对话流内容无效", 502);
            }
            if (
              chunk.error ||
              (chunk.code != null && !Array.isArray(chunk.choices))
            )
              throw new ApiError(
                "Qoder 拒绝了对话请求，请检查账号、额度和模型",
                502,
                "upstream_error",
              );
            if (chunk.usage) usage = chunk.usage;
            if (Array.isArray(chunk.choices))
              for (const choice of chunk.choices) {
                if (choice.finish_reason) {
                  finished = true;
                  finishReason = choice.finish_reason;
                }
                const delta = { ...(choice.delta || {}) };
                const text = delta.content;
                delete delta.content;
                const calls = delta.tool_calls;
                delete delta.tool_calls;
                if (Object.keys(delta).length) {
                  emit({
                    ...chunk,
                    usage: undefined,
                    id,
                    object: "chat.completion.chunk",
                    model,
                    choices: [{ ...choice, delta, finish_reason: null }],
                  });
                  emitted = true;
                }
                if (typeof text === "string")
                  for (const frame of textPieces(text)) {
                    emit(frame);
                    emitted = true;
                  }
                for (const tc of calls || []) {
                  const key = tc.index ?? 0;
                  let call = native.get(key);
                  if (!call) {
                    call = { id: "", name: "", args: "", index: null };
                    native.set(key, call);
                  }
                  if (tc.id) call.id = tc.id;
                  if (tc.function?.name) call.name += tc.function.name;
                  const args = tc.function?.arguments || "";
                  if (call.index === null) {
                    call.args += args;
                    if (!call.name) continue;
                    if (!tools.some((t) => t.function?.name === call.name))
                      throw new ApiError("Qoder 返回未声明的原生工具调用", 502);
                    call.index = callIndex++;
                    sawTool = true;
                    emit({
                      id,
                      object: "chat.completion.chunk",
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: call.index,
                                id: call.id || "call_" + randomUUID(),
                                type: "function",
                                function: {
                                  name: call.name,
                                  arguments: call.args,
                                },
                              },
                            ],
                          },
                          finish_reason: null,
                        },
                      ],
                    });
                    emitted = true;
                  } else if (args) {
                    emit({
                      id,
                      object: "chat.completion.chunk",
                      model,
                      choices: [
                        {
                          index: 0,
                          delta: {
                            tool_calls: [
                              {
                                index: call.index,
                                function: { arguments: args },
                              },
                            ],
                          },
                          finish_reason: null,
                        },
                      ],
                    });
                    emitted = true;
                  }
                }
              }
          }
          if (ended || next.done) {
            if (!finished)
              throw new ApiError(
                "Qoder 对话流提前结束",
                502,
                "incomplete_stream",
              );
            for (const frame of textPieces("", true)) emit(frame);
            emit(chunk({}, sawTool ? "tool_calls" : finishReason || "stop"));
            if (usage)
              emit({
                id,
                object: "chat.completion.chunk",
                model,
                choices: [],
                usage,
              });
            emit("[DONE]");
            controller.close();
            signal?.removeEventListener("abort", abort);
            await reader.cancel().catch(() => {});
            return;
          }
          if (emitted) return;
        }
      } catch (error) {
        signal?.removeEventListener("abort", abort);
        await reader.cancel().catch(() => {});
        emit({
          error: {
            message: error.message || "Qoder 对话失败",
            type: "upstream_error",
            code: error.code || "upstream_error",
          },
        });
        controller.close();
      }
    },
    async cancel(reason) {
      ended = true;
      signal?.removeEventListener("abort", abort);
      await reader.cancel(reason).catch(() => {});
    },
  });
  return new Response(stream, {
    headers: {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
    },
  });
}
