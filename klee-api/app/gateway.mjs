import { serveFrontend } from "./web.mjs";
import { createServer } from "node:http";
import { readFileSync, existsSync, mkdirSync } from "node:fs";
import { join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { randomBytes, randomUUID, timingSafeEqual } from "node:crypto";
import { loadConfig, root } from "./config.mjs";
import { atomicWrite } from "./store.mjs";
import { ApiError, json, readBody, upstreamFetch } from "./http.mjs";
import { mergeCompletionUsage, parseEvents } from "./stream.mjs";
import { createUsageLog, usageFields } from "./gateway-usage.mjs";
import { captureConversation } from "./conversation.mjs";
import { checkinTarget } from "./checkin.mjs";

const platforms = { workbuddy: "WorkBuddy", trae: "Trae", qoder: "Qoder" };
const keyPattern = /^klee-[\x21-\x7e]{3,251}$/;
const reservedModel = /^(workbuddy|trae|qoder)\//;
const eligible = (a) =>
  a.enabled === true &&
  a.status === "ready" &&
  !a.quotaError &&
  !a.modelsError &&
  (a.unlimited === true || (Number.isFinite(a.remaining) && a.remaining > 0));
const accountId = (a) => JSON.stringify([a.platform, a.uid]);
const abortError = (signal) =>
  signal?.reason instanceof ApiError
    ? signal.reason
    : new ApiError("Request canceled", 499, "request_canceled");

/** 注入的桥接也受取消约束，不能因忽略 signal 而无限占用请求槽位。 */
async function abortable(task, signal) {
  if (!signal) return task;
  if (signal.aborted) throw abortError(signal);
  let abort;
  try {
    return await Promise.race([
      task,
      new Promise((_, reject) => {
        abort = () => reject(abortError(signal));
        signal.addEventListener("abort", abort, { once: true });
      }),
    ]);
  } finally {
    signal.removeEventListener("abort", abort);
  }
}

/** 有限读取平台 JSON；平台错误正文不会进入管理页或对话错误消息。 */
async function responseJSON(response, signal) {
  if (!response.body)
    throw new ApiError(
      "Platform returned an empty response",
      502,
      "invalid_platform_response",
    );
  const reader = response.body.getReader(),
    chunks = [];
  let size = 0;
  const abort = () => {
    reader.cancel().catch(() => {});
  };
  signal?.addEventListener("abort", abort, { once: true });
  try {
    for (;;) {
      if (signal?.aborted) throw abortError(signal);
      const { done, value } = await reader.read();
      if (signal?.aborted) throw abortError(signal);
      if (done) break;
      size += value.length;
      if (size > 8 * 1024 * 1024)
        throw new ApiError(
          "Platform response is too large",
          502,
          "invalid_platform_response",
        );
      chunks.push(value);
    }
  } finally {
    signal?.removeEventListener("abort", abort);
    await reader.cancel().catch(() => {});
  }
  try {
    return JSON.parse(Buffer.concat(chunks).toString("utf8"));
  } catch {
    throw new ApiError(
      "Platform returned invalid JSON",
      502,
      "invalid_platform_response",
    );
  }
}

/** 客户端断开时结束背压等待，由外层取消平台请求并释放账号槽位。 */
async function write(res, value, signal) {
  if (signal?.aborted) throw abortError(signal);
  if (res.destroyed)
    throw new ApiError("Request canceled", 499, "request_canceled");
  if (res.write(value)) return;
  await new Promise((resolve, reject) => {
    const cleanup = () => {
      res.off("drain", drain);
      res.off("close", close);
      signal?.removeEventListener("abort", close);
    };
    const drain = () => {
      cleanup();
      resolve();
    };
    const close = () => {
      cleanup();
      reject(abortError(signal));
    };
    res.once("drain", drain);
    res.once("close", close);
    signal?.addEventListener("abort", close, { once: true });
  });
}

/** 只改写 OpenAI 帧的 model；保留 choices、工具调用、usage 和结束标志。 */
async function relay(response, res, request, signal, observe) {
  if (
    !(response.headers.get("content-type") || "").includes("text/event-stream")
  ) {
    const data = await responseJSON(response, signal);
    if (!data || data.error || !Array.isArray(data.choices))
      throw new ApiError(
        "Platform returned an invalid completion",
        502,
        "invalid_platform_response",
      );
    observe(data);
    data.model = request.model;
    if (request.stream !== true) return json(res, 200, data);
    res.writeHead(200, {
      "Content-Type": "text/event-stream; charset=utf-8",
      "Cache-Control": "no-cache",
      "X-Accel-Buffering": "no",
    });
    await write(
      res,
      "data: " +
        JSON.stringify({
          ...data,
          object: "chat.completion.chunk",
          choices: data.choices.map((c) => ({
            ...c,
            delta: c.message,
            message: undefined,
          })),
        }) +
        "\n\n",
      signal,
    );
    res.end("data: [DONE]\n\n");
    return;
  }
  if (request.stream !== true) {
    await response.body?.cancel();
    throw new ApiError(
      "Platform returned an unexpected stream",
      502,
      "invalid_platform_response",
    );
  }
  let done = false;
  for await (const event of parseEvents(response.body, { signal })) {
    if (signal?.aborted) throw abortError(signal);
    if (event.data === "[DONE]") {
      done = true;
      if (!res.headersSent)
        res.writeHead(200, {
          "Content-Type": "text/event-stream; charset=utf-8",
          "Cache-Control": "no-cache",
        });
      await write(res, "data: [DONE]\n\n", signal);
      break;
    }
    let data;
    try {
      data = JSON.parse(event.data);
    } catch {
      throw new ApiError(
        "Platform stream is invalid",
        502,
        "upstream_stream_error",
      );
    }
    if (
      !data ||
      typeof data !== "object" ||
      event.event === "error" ||
      data.error
    )
      throw new ApiError(
        "Platform stream failed",
        502,
        "upstream_stream_error",
      );
    observe(data);
    data.model = request.model;
    if (!res.headersSent)
      res.writeHead(200, {
        "Content-Type": "text/event-stream; charset=utf-8",
        "Cache-Control": "no-cache",
        "X-Accel-Buffering": "no",
      });
    await write(res, "data: " + JSON.stringify(data) + "\n\n", signal);
  }
  if (!done)
    throw new ApiError(
      "Platform stream ended before completion",
      502,
      "upstream_stream_error",
    );
  res.end();
}

/** 聚合平台进程的只读快照并按 UID 调用；不加载账号存储、不修改选中账号。
 * bridge 与 apiKey 仅供离线验证注入，生产环境固定读取平台 Key 并访问配置中的回环地址。
 */
export async function createGateway({
  base = root,
  bridge,
  apiKey,
  requestTimeoutMs = 300000,
  maxQueueSize = 128,
} = {}) {
  if (!Number.isFinite(requestTimeoutMs) || requestTimeoutMs <= 0)
    throw new ApiError("Invalid request timeout", 500, "invalid_config");
  if (!Number.isInteger(maxQueueSize) || maxQueueSize < 1)
    throw new ApiError("Invalid queue capacity", 500, "invalid_config");
  const config = loadConfig(base),
    port = config.ports.gateway;
  const keyFile = join(base, "Gateway-Chat", "data", "Gateway", "api-key.txt");
  const memoryKey = apiKey !== undefined;
  if (!memoryKey) {
    mkdirSync(join(base, "Gateway-Chat", "data", "Gateway"), {
      recursive: true,
      mode: 0o700,
    });
    if (!existsSync(keyFile))
      atomicWrite(keyFile, "klee-" + randomBytes(20).toString("hex") + "\n");
    apiKey = readFileSync(keyFile, "utf8").trim();
  }
  if (!keyPattern.test(apiKey))
    throw new ApiError(
      "Invalid gateway API key format",
      500,
      "invalid_api_key_format",
    );
  const usageLog = createUsageLog(memoryKey ? undefined : join(base, "Gateway-Chat", "data", "Gateway", "usage.json"));
  const logLabel = (value) => String(value ?? "")
    .replace(/klee-[^\s]+/gi, "[Key 已隐藏]")
    .replace(/[\x00-\x1f\x7f]/g, " ")
    .slice(0, 240);
  const token = (req) =>
    /^Bearer /i.test(req.headers.authorization || "")
      ? req.headers.authorization.slice(7)
      : "";
  const authorized = (value) => {
    const a = Buffer.from(value),
      b = Buffer.from(apiKey);
    return a.length === b.length && timingSafeEqual(a, b);
  };
  const origins = new Set(
    Object.values(config.ports).flatMap((p) => [
      "http://127.0.0.1:" + p,
      "http://localhost:" + p,
    ]),
  );
  if (process.env.KLEE_DEV_ORIGIN === "http://127.0.0.1:15173")
    origins.add(process.env.KLEE_DEV_ORIGIN);
  const snapshots = new Map(),
    busy = new Map(),
    turns = new Map(),
    cooldowns = new Map();
  let sequence = 0;
  let checking = false;
  const controllers = new Set();
  const queue = [];
  let draining = false,
    drainAgain = false,
    queueTimer = null;

  async function call(platform, path, init = {}) {
    if (init.signal?.aborted) throw abortError(init.signal);
    if (bridge)
      return abortable(
        Promise.resolve().then(() => bridge(platform, path, init)),
        init.signal,
      );
    let key;
    try {
      key = readFileSync(
        join(
          base,
          platforms[platform] + "-Chat",
          "data",
          platforms[platform],
          "api-key.txt",
        ),
        "utf8",
      ).trim();
    } catch {
      throw new ApiError(
        "Platform API key is unavailable",
        503,
        "platform_key_unavailable",
      );
    }
    if (!keyPattern.test(key))
      throw new ApiError(
        "Platform API key is invalid",
        503,
        "platform_key_unavailable",
      );
    return upstreamFetch("http://127.0.0.1:" + config.ports[platform] + path, {
      ...init,
      timeout: 120000,
      headers: {
        "Content-Type": "application/json",
        Authorization: "Bearer " + key,
      },
    });
  }

  async function checkins(target) {
    const selected = target?.platform ? [target.platform] : Object.keys(platforms);
    const results = await Promise.all(selected.map(async platform => {
      let failure = '平台连接异常，请检查本地服务后刷新状态';
      const controller = new AbortController();
      controllers.add(controller);
      // 聚合先于前端的 120 秒预算结束，确保其他平台已确认的结果可返回。
      const timer = setTimeout(() => controller.abort(), Math.min(requestTimeoutMs, 110000));
      try {
        const response = await call(platform, '/api/checkin', {
          signal: controller.signal,
          ...(target ? { method: 'POST', body: JSON.stringify(target.uid ? { uid: target.uid } : { all: true }) } : {}),
        });
        if (!response.ok) {
          await response.body?.cancel();
          failure = response.status === 409 ? '该平台正在签到，请等待后刷新状态' : '平台服务未能完成请求，请检查服务和登录状态';
          throw new Error(failure);
        }
        const data = await responseJSON(response, controller.signal);
        if (!Array.isArray(data?.accounts) || data.accounts.some(a => !a || typeof a.uid !== 'string')) throw new Error('平台返回的签到数据无效');
        const fields = ['uid', 'nickname', 'region', 'enabled', 'status', 'checkedIn', 'message', 'reward', 'balanceBefore', 'balanceAfter', 'startsAt', 'endsAt', 'errorCode', 'hint'];
        const accounts = data.accounts.map(a => ({
          ...Object.fromEntries(fields.filter(key => ['string', 'number', 'boolean'].includes(typeof a[key]) || a[key] === null).map(key => [key, a[key]])), platform,
        }));
        return { platform, status: 'ready', accounts };
      } catch (error) {
        return { platform, status: 'failed', error: controller.signal.aborted ? '平台响应超时；领取结果待确认，请刷新状态后核对' : failure, accounts: [] };
      } finally { if (target) snapshots.delete(platform); clearTimeout(timer); controllers.delete(controller); }
    }));
    return { fetchedAt: Date.now(), accounts: results.flatMap(r => r.accounts), platforms: results.map(({ accounts, ...result }) => result) };
  }

  /** 快照按平台独立过期；失败清空旧资格，避免继续使用过期的正余额。 */
  async function snapshot(platform, force) {
    let entry = snapshots.get(platform);
    if (entry?.pending) {
      await entry.pending;
      if (!force) return entry;
    }
    if (!force && entry && Date.now() - entry.at < 15000) return entry;
    if (!entry) {
      entry = { at: 0, accounts: [], error: null };
      snapshots.set(platform, entry);
    }
    entry.pending = (async () => {
      const controller = new AbortController();
      controllers.add(controller);
      const timer = setTimeout(() => controller.abort(), 120000);
      try {
        const response = await call(
          platform,
          "/api/pool?refresh=" + (force ? "1" : "0"),
          { signal: controller.signal },
        );
        if (!response.ok) {
          await response.body?.cancel();
          throw new ApiError(
            response.status === 401
              ? "Platform API key was rejected"
              : "Platform service returned HTTP " + response.status,
            503,
            "platform_unavailable",
          );
        }
        const data = await responseJSON(response, controller.signal);
        if (!Array.isArray(data?.accounts))
          throw new ApiError(
            "Platform pool response is invalid",
            502,
            "invalid_platform_response",
          );
        entry.accounts = data.accounts
          .filter(
            (a) =>
              a && typeof a.uid === "string" && typeof a.region === "string",
          )
          .map((a) => ({
            platform,
            uid: a.uid,
            nickname: typeof a.nickname === "string" ? a.nickname : "",
            region: a.region,
            enabled: a.enabled === true,
            inFlight: a.inFlight === 1 ? 1 : 0,
            status: typeof a.status === "string" ? a.status : "unknown",
            remaining: Number.isFinite(a.remaining) ? a.remaining : null,
            limit: Number.isFinite(a.limit) && a.limit >= 0 ? a.limit : null,
            used: Number.isFinite(a.used) && a.used >= 0 ? a.used : null,
            unlimited: a.unlimited === true,
            unit: typeof a.unit === "string" ? a.unit : "",
            quotaAt: a.quotaAt ?? null,
            modelsAt: a.modelsAt ?? null,
            quotaError: a.quotaError ? "Quota is unavailable" : null,
            modelsError: a.modelsError ? "Model list is unavailable" : null,
            models: (Array.isArray(a.models) ? a.models : [])
              .filter((m) => m && typeof m.id === "string" && m.id.length > 0)
              .map((m) => ({
                id: m.id,
                ...(typeof m.name === "string" ? { name: m.name } : {}),
              })),
          }));
        entry.error = null;
      } catch (error) {
        entry.accounts = [];
        entry.error =
          error instanceof ApiError &&
          [
            "platform_key_unavailable",
            "platform_unavailable",
            "invalid_platform_response",
          ].includes(error.code)
            ? error.message
            : "Platform service is unavailable";
      } finally {
        clearTimeout(timer);
        controllers.delete(controller);
        entry.at = Date.now();
        entry.pending = null;
      }
    })();
    await entry.pending;
    return entry;
  }

  async function catalog(force = false) {
    const entries = await Promise.all(
      Object.keys(platforms).map(async (platform) => ({
        platform,
        ...(await snapshot(platform, force)),
      })),
    );
    const accounts = entries.flatMap((e) => e.accounts),
      canonical = new Map(),
      bare = new Map();
    for (const account of accounts)
      for (const model of account.models) {
        const id = account.platform + "/" + account.region + "/" + model.id;
        if (!canonical.has(id))
          canonical.set(id, {
            id,
            name: model.name,
            upstream: model.id,
            candidates: [],
          });
        if (
          eligible(account) &&
          !canonical
            .get(id)
            .candidates.some((c) => accountId(c.account) === accountId(account))
        )
          canonical.get(id).candidates.push({ account, upstream: model.id });
        if (!bare.has(model.id)) bare.set(model.id, new Set());
        bare.get(model.id).add(id);
      }
    const logical = new Map(
      [...canonical].map(([id, m]) => [id, { ...m, canonicalIds: [id] }]),
    );
    for (const [id, ids] of bare)
      if (ids.size === 1 && !logical.has(id) && !reservedModel.test(id)) {
        const target = [...ids][0];
        logical.set(id, {
          ...canonical.get(target),
          id,
          canonicalIds: [target],
        });
      }
    for (const [id, targets] of Object.entries(config.gateway.aliases)) {
      // 平台离线也保留其命名空间，避免裸 ID 或配置别名冒充另一个平台的规范 ID。
      if (canonical.has(id) || reservedModel.test(id)) continue;
      const ids = [...new Set(targets)].filter((t) => canonical.has(t));
      if (!ids.length) continue;
      const candidates = ids.flatMap((t) => canonical.get(t).candidates),
        seen = new Set();
      logical.set(id, {
        id,
        canonicalIds: ids,
        candidates: candidates.filter((c) => {
          const key = accountId(c.account);
          if (seen.has(key)) return false;
          seen.add(key);
          return true;
        }),
      });
    }
    const models = [...logical.values()]
      .filter((m) => m.candidates.length)
      .map((m) => ({
        id: m.id,
        object: "model",
        owned_by: "klee",
        ...(m.name ? { name: m.name } : {}),
        canonicalIds: m.canonicalIds,
        availableAccounts: m.candidates.length,
      }));
    return {
      logical,
      models,
      accounts: accounts.map((a) => ({
        ...a,
        inFlight: Math.max(a.inFlight, busy.get(accountId(a)) || 0),
      })),
      platforms: entries.map((e) => ({ platform: e.platform, error: e.error })),
      fetchedAt: Math.min(...entries.map((e) => e.at)),
    };
  }

  /** 移除等待者并撤销取消监听，避免已结束请求占据队列或被再次唤醒。 */
  function removeWaiter(waiter) {
    const index = queue.indexOf(waiter);
    if (index !== -1) queue.splice(index, 1);
    waiter.signal.removeEventListener("abort", waiter.abort);
    if (!queue.length && queueTimer) {
      clearTimeout(queueTimer);
      queueTimer = null;
    }
  }

  /**
   * 按入队顺序分配当前空闲账号；独立模型不被无可用槽位的队首阻塞。
   * 槽位在唤醒请求前同步占用，重新读取快照后才判断模型、额度和账号资格。
   */
  async function drainQueue() {
    if (draining) {
      drainAgain = true;
      return;
    }
    draining = true;
    try {
      do {
        drainAgain = false;
        if (!queue.length) break;
        let data;
        try {
          data = await catalog();
        } catch (error) {
          for (const waiter of [...queue]) {
            removeWaiter(waiter);
            waiter.reject(error);
          }
          break;
        }
        for (const waiter of [...queue]) {
          if (waiter.signal.aborted) {
            removeWaiter(waiter);
            waiter.reject(abortError(waiter.signal));
            continue;
          }
          const model = data.logical.get(waiter.model);
          let error;
          if (!model)
            error = new ApiError(
              "Model is unknown or ambiguous; use its canonical ID",
              404,
              "model_not_found",
            );
          else if (!model.candidates.length)
            error = new ApiError(
              "No eligible account is available for this model",
              503,
              "no_available_account",
            );
          const remaining =
            model?.candidates.filter(
              (c) => !waiter.tried.has(accountId(c.account)),
            ) || [];
          if (!error && !remaining.length)
            error =
              waiter.lastError ||
              new ApiError(
                "No eligible account is available",
                503,
                "no_available_account",
              );
          if (error) {
            removeWaiter(waiter);
            waiter.reject(error);
            continue;
          }
          const candidate = remaining
            .filter(
              (c) =>
                !c.account.inFlight &&
                !busy.get(accountId(c.account)) &&
                (cooldowns.get(accountId(c.account)) || 0) <= Date.now(),
            )
            .sort(
              (a, b) =>
                (turns.get(accountId(a.account)) || 0) -
                (turns.get(accountId(b.account)) || 0),
            )[0];
          if (!candidate) continue;
          const id = accountId(candidate.account);
          cooldowns.delete(id);
          busy.set(id, 1);
          turns.set(id, ++sequence);
          removeWaiter(waiter);
          waiter.resolve(candidate);
        }
      } while (drainAgain);
    } finally {
      draining = false;
      if (queue.length && !queueTimer)
        queueTimer = setTimeout(() => {
          queueTimer = null;
          // 其他调用方也可能占用平台账号；只重读本机快照，不强制刷新平台额度或模型。
          for (const entry of snapshots.values())
            if (
              entry.accounts.some((a) => a.inFlight && !busy.get(accountId(a)))
            )
              entry.at = 0;
          void drainQueue();
        }, 1000);
    }
  }

  /** 等待计入原请求超时；取消后立即出队，队列达到容量上限时明确拒绝新增等待。 */
  function reserve(model, tried, signal, lastError) {
    if (signal.aborted) return Promise.reject(abortError(signal));
    if (queue.length >= maxQueueSize)
      return Promise.reject(
        new ApiError("Gateway request queue is full", 429, "queue_full"),
      );
    return new Promise((resolve, reject) => {
      const waiter = {
        model,
        tried,
        signal,
        lastError,
        resolve,
        reject,
        abort: null,
      };
      waiter.abort = () => {
        removeWaiter(waiter);
        reject(abortError(signal));
      };
      signal.addEventListener("abort", waiter.abort, { once: true });
      queue.push(waiter);
      void drainQueue();
    });
  }

  /** 槽位持续占用到响应结束；只有平台明确确认未生成的拒绝才允许换号。 */
  async function chat(req, res, request) {
    const conversation = captureConversation(request.messages);
    const record = {
      id: randomUUID(),
      startedAt: Date.now(),
      model: logLabel(request.model),
      upstreamModel: null,
      platform: null,
      region: null,
      account: null,
      stream: request.stream === true,
      attempts: 0,
      status: "success",
      httpStatus: 200,
      errorCode: null,
    };
    const started = performance.now();
    let usage = null;
    const controller = new AbortController();
    controllers.add(controller);
    const timer = setTimeout(
      () =>
        controller.abort(
          new ApiError(
            "Platform completion timed out",
            504,
            "upstream_timeout",
          ),
        ),
      requestTimeoutMs,
    );
    const abort = () => controller.abort();
    const close = () => {
      if (!res.writableEnded) abort();
    };
    req.on("aborted", abort);
    res.on("close", close);
    try {
      const tried = new Set();
      let lastError;
      for (let attempt = 0; attempt < 3; attempt++) {
        const candidate = await reserve(
            request.model,
            tried,
            controller.signal,
            lastError,
          ),
          id = accountId(candidate.account);
        tried.add(id);
        try {
          if (controller.signal.aborted) throw abortError(controller.signal);
          record.platform = candidate.account.platform;
          record.region = logLabel(candidate.account.region);
          record.account = logLabel(candidate.account.nickname || candidate.account.uid);
          record.upstreamModel = logLabel(candidate.upstream);
          record.attempts++;
          const response = await call(
            candidate.account.platform,
            "/api/pool/chat/completions",
            {
              method: "POST",
              body: JSON.stringify({
                uid: candidate.account.uid,
                request: { ...request, model: candidate.upstream },
              }),
              signal: controller.signal,
            },
          );
          if (!response.ok) {
            const data = await responseJSON(response, controller.signal).catch(
                () => null,
              ),
              code = [
                "account_busy",
                "no_available_account",
                "upstream_rate_limited",
              ].includes(data?.error?.code)
                ? data.error.code
                : "platform_chat_error";
            if (controller.signal.aborted) throw abortError(controller.signal);
            lastError = new ApiError(
              "Platform rejected the completion (HTTP " + response.status + ")",
              response.status >= 400 && response.status <= 599
                ? response.status
                : 502,
              code,
            );
            // 平台明确因账号竞争拒绝且尚未生成时重新排队；短暂冷却避免快照竞争导致紧密重试。
            if (
              response.status === 429 &&
              code === "account_busy" &&
              data?.error?.retryable === true
            ) {
              cooldowns.set(id, Date.now() + 1000);
              tried.delete(id);
              attempt--;
              continue;
            }
            if (data?.error?.retryable === true && !controller.signal.aborted)
              continue;
            throw lastError;
          }
          await relay(response, res, request, controller.signal, (data) => {
            usage = mergeCompletionUsage(usage, data);
            conversation.observe(data);
          });
          return;
        } finally {
          busy.delete(id);
          const entry = snapshots.get(candidate.account.platform);
          if (entry) entry.at = 0;
          void drainQueue();
        }
      }
      throw (
        lastError ||
        new ApiError(
          "No eligible account is available",
          503,
          "no_available_account",
        )
      );
    } catch (error) {
      const failure = controller.signal.aborted ? abortError(controller.signal) : error;
      record.httpStatus = failure instanceof ApiError ? failure.status : 502;
      record.errorCode = failure instanceof ApiError ? logLabel(failure.code) : "gateway_error";
      record.status = record.httpStatus === 499 ? "canceled" : "failed";
      throw failure;
    } finally {
      clearTimeout(timer);
      req.off("aborted", abort);
      res.off("close", close);
      controllers.delete(controller);
      controller.abort();
      usageLog.add({ ...record, durationMs: Math.round(performance.now() - started), ...usageFields(usage) }, conversation.snapshot(record.status === 'success'));
    }
  }

  const server = createServer(async (req, res) => {
    res.setHeader("X-Content-Type-Options", "nosniff");
    res.setHeader("Referrer-Policy", "no-referrer");
    try {
      if (
        !["127.0.0.1:" + port, "localhost:" + port].includes(req.headers.host)
      )
        throw new ApiError("Invalid loopback Host", 400, "invalid_host");
      if (req.headers.origin) {
        if (!origins.has(req.headers.origin))
          throw new ApiError("Origin is not allowed", 403, "invalid_origin");
        res.setHeader("Access-Control-Allow-Origin", req.headers.origin);
        res.setHeader("Vary", "Origin");
      }
      if (req.method === "OPTIONS") {
        res.writeHead(204, {
          "Access-Control-Allow-Methods": "GET,POST,OPTIONS",
          "Access-Control-Allow-Headers": "Authorization,Content-Type",
          "Access-Control-Max-Age": "300",
        });
        res.end();
        return;
      }
      const url = new URL(req.url, "http://127.0.0.1:" + port),
        path = url.pathname;
      if (req.method === "GET" && path === "/") {
        res.writeHead(302, { Location: "/admin" });
        res.end();
        return;
      }
      if (
        req.method === "GET" &&
        /^\/admin\/(workbuddy|trae|qoder)$/.test(path)
      ) {
        const p = path.split("/")[2];
        res.writeHead(302, {
          Location: "http://127.0.0.1:" + config.ports[p] + path,
        });
        res.end();
        return;
      }
      if (
        req.method === "GET" &&
        /^\/admin\/(workbuddy|trae|qoder)(?:\/.*)?$/.test(path)
      ) {
        const target = path.split("/")[2];
        res.writeHead(302, {
          Location: "http://127.0.0.1:" + config.ports[target] + path,
          "Cache-Control": "no-store",
        });
        res.end();
        return;
      }
      if (serveFrontend(req, res, path, base)) return;
      if (req.method === "GET" && path === "/health")
        return json(res, 200, {
          ok: true,
          name: "KleeAPI",
          platform: "gateway",
        });
      if (req.method === "GET" && path === "/api/config")
        return json(res, 200, {
          name: "KleeAPI",
          platform: "gateway",
          ports: config.ports,
        });
      if (!authorized(token(req)))
        throw new ApiError("Invalid API key", 401, "invalid_api_key");
      if (req.method === 'GET' && path === '/api/checkin') return json(res, 200, await checkins());
      if (req.method === 'POST' && path === '/api/checkin') {
        if (checking) throw new ApiError('签到正在进行，请等待本次结果', 409, 'checkin_in_progress');
        checking = true;
        try { const target = checkinTarget(await readBody(req, 4096), true); return json(res, 200, await checkins(target)); }
        finally { checking = false; }
      }
      if (req.method === "GET" && path === "/api/gateway/usage")
        return json(res, 200, usageLog.snapshot());
      const usageDetail = path.match(/^\/api\/gateway\/usage\/([a-zA-Z0-9_-]{1,80})$/);
      if (req.method === 'GET' && usageDetail) {
        const detail = usageLog.detail(usageDetail[1]);
        if (!detail) throw new ApiError('调用记录不存在或已过期', 404, 'usage_not_found');
        return json(res, 200, detail);
      }
      if (req.method === "POST" && path === "/api/key") {
        const body = await readBody(req, 4096);
        if (!keyPattern.test(body.apiKey) || typeof body.apiKey !== "string")
          throw new ApiError(
            "Key must be klee- followed by 3–251 visible ASCII characters",
            400,
            "invalid_api_key_format",
          );
        if (!authorized(token(req)))
          throw new ApiError("Invalid API key", 401, "invalid_api_key");
        if (!memoryKey) atomicWrite(keyFile, body.apiKey + "\n");
        apiKey = body.apiKey;
        return json(res, 200, { ok: true });
      }
      if (
        req.method === "GET" &&
        (path === "/api/gateway/status" || path === "/v1/models")
      ) {
        const data = await catalog(url.searchParams.get("refresh") === "1");
        return json(
          res,
          200,
          path === "/v1/models"
            ? { object: "list", data: data.models }
            : {
                fetchedAt: data.fetchedAt,
                accounts: data.accounts,
                platforms: data.platforms,
                models: data.models,
              },
        );
      }
      if (req.method === "POST" && path === "/v1/chat/completions") {
        const body = await readBody(req, 8 * 1024 * 1024);
        if (
          !body ||
          Array.isArray(body) ||
          typeof body.model !== "string" ||
          !body.model.trim() ||
          !Array.isArray(body.messages) ||
          !body.messages.length ||
          !body.messages.every(
            (m) =>
              m &&
              typeof m === "object" &&
              !Array.isArray(m) &&
              typeof m.role === "string",
          ) ||
          (body.stream !== undefined && typeof body.stream !== "boolean")
        )
          throw new ApiError(
            "A model and nonempty valid messages array are required; stream must be boolean",
            400,
            "invalid_request",
          );
        return await chat(req, res, body);
      }
      throw new ApiError("Endpoint not found", 404, "not_found");
    } catch (error) {
      const message =
          error instanceof ApiError ? error.message : "Gateway request failed",
        code = error instanceof ApiError ? error.code : "gateway_error";
      if (!res.headersSent && !res.destroyed)
        json(res, error instanceof ApiError ? error.status : 502, {
          error: { message, code, retryable: false },
        });
      else if (!res.destroyed)
        res.end(
          "data: " +
            JSON.stringify({
              error: {
                message: "Platform stream failed",
                code: "upstream_stream_error",
                retryable: false,
              },
            }) +
            "\n\n",
        );
    }
  });
  server.requestTimeout = 120000;
  server.headersTimeout = 15000;
  return {
    server,
    config,
    listen() {
      return new Promise((resolve, reject) => {
        server.once("error", reject);
        server.listen(port, "127.0.0.1", () => {
          server.off("error", reject);
          resolve();
        });
      });
    },
    async close() {
      for (const controller of controllers) controller.abort();
      if (server.listening)
        await new Promise((resolve) => {
          server.closeAllConnections();
          server.close(resolve);
        });
    },
  };
}

if (
  process.argv[1] &&
  fileURLToPath(import.meta.url) === resolve(process.argv[1])
) {
  try {
    const gateway = await createGateway();
    await gateway.listen();
    console.log(
      "KleeAPI gateway ready: http://127.0.0.1:" +
        gateway.config.ports.gateway +
        "/admin",
    );
    for (const signal of ["SIGINT", "SIGTERM"])
      process.once(signal, async () => {
        await gateway.close();
        process.exit(0);
      });
  } catch {
    console.error(
      "Gateway startup failed. Check ports, configuration and the gateway key file.",
    );
    process.exitCode = 1;
  }
}
