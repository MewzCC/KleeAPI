import { createHash, randomBytes, randomUUID } from "node:crypto";
import { readdir, stat } from "node:fs/promises";
import { homedir } from "node:os";
import { join, isAbsolute } from "node:path";
import { execFile } from "node:child_process";
import { requestJSON, upstreamFetch, ApiError } from "../app/http.mjs";
import { encodeBody, cosyHeaders, chatBody, openaiResponse } from "./codec.mjs";

const SITES = {
  cn: {
    web: "https://qoder.cn",
    openapi: "https://openapi.qoder.com.cn",
    api: "https://gateway.qoder.com.cn",
    clientId: "e883ade2-e6e3-4d6d-adf7-f92ceff5fdcb",
    app: "Qoder CN",
    linux: "Qoder-CN",
    prefix: "QODERCN_",
    dir: ".qoder-cn",
    environment: "0",
  },
  global: {
    web: "https://qoder.com",
    openapi: "https://openapi.qoder.sh",
    api: "https://api3.qoder.sh",
    clientId: "732aef47-9cf2-46a2-95fe-4cebb5d0d1fa",
    app: "Qoder",
    linux: "Qoder",
    prefix: "QODER_",
    dir: ".qoder",
    environment: "3",
  },
};
const string = (v) => (typeof v === "string" ? v : "");
const num = (v) =>
  v !== null && v !== undefined && v !== "" && Number.isFinite(Number(v))
    ? Number(v)
    : null;
const when = (v) => {
  const n = num(v);
  return n === null
    ? Date.parse(v) || 0
    : n > 0
      ? n < 1e12
        ? n * 1000
        : n
      : 0;
};
function site(region) {
  if (!Object.hasOwn(SITES, region))
    throw new ApiError("Qoder 区域只能为 cn 或 global");
  return SITES[region];
}
function expiry(data, device = false) {
  return (
    when(data.expire_time || data.expires_at) ||
    (num(data.expires_in) > 0
      ? Date.now() + Number(data.expires_in) * (device ? 1000 : 1)
      : 0)
  );
}

/** 拒绝业务错误信封，错误信息不回显可能含凭据的上游内容。 */
function business(data) {
  if (!data || typeof data !== "object" || Array.isArray(data))
    throw new ApiError("Qoder 响应格式无效", 502);
  if (
    data.error ||
    data.success === false ||
    (data.code !== undefined &&
      ![0, "0", 200, "200", "SUCCESS", "OK"].includes(data.code))
  )
    throw new ApiError(
      "Qoder 业务请求失败，请检查账号授权及活动资格",
      502,
      "upstream_error",
    );
  return data;
}

/** 保留账号原生身份，区域前缀可避免中外站同号互相覆盖。 */
async function normalize(input) {
  if (typeof input === "string") {
    try {
      input = JSON.parse(input);
    } catch {
      throw new ApiError("请导入有效的 Qoder JSON");
    }
  }
  if (!input || typeof input !== "object" || Array.isArray(input))
    throw new ApiError("Qoder 凭据必须为 JSON 对象");
  const raw = {
    ...(input.account || {}),
    ...input,
    ...(input.auth || input.credential || {}),
  };
  const region = raw.region || "cn",
    cfg = site(region);
  const accessToken = string(raw.accessToken || raw.access || raw.token);
  const refreshToken = string(
    raw.refreshToken || raw.refresh || raw.refresh_token,
  );
  const providerUid = String(
    raw.providerUid || raw.user_id || raw.userId || raw.uid || "",
  ).replace(new RegExp(`^${region}:`), "");
  if (!accessToken || /[\r\n]/.test(accessToken + refreshToken))
    throw new ApiError("Qoder accessToken 缺失或无效");
  if (
    !providerUid ||
    /[\r\n]/.test(providerUid) ||
    /^(cn|global):/.test(providerUid)
  )
    throw new ApiError("Qoder 凭据缺少有效用户 ID 或身份区域不匹配");
  for (const [key, want] of [
    ["endpoint", cfg.api],
    ["openapi", cfg.openapi],
  ])
    if (raw[key] && raw[key] !== want)
      throw new ApiError("只接受账号区域对应的 Qoder 官方端点");
  const result = {
    uid: `${region}:${providerUid}`,
    providerUid,
    region,
    nickname: string(raw.nickname || raw.name || raw.user_name) || providerUid,
    email: string(raw.email),
    accessToken,
    refreshToken,
    expiresAt: when(raw.expiresAt || raw.expires),
    machineId: string(raw.machineId || raw.machine_id),
    deviceToken: string(raw.deviceToken || raw.device_token),
    deviceRefreshToken: string(
      raw.deviceRefreshToken || raw.deviceRefresh || raw.device_refresh_token,
    ),
    deviceExpiresAt: when(raw.deviceExpiresAt),
    deviceChat: raw.deviceChat === true,
    endpoint: cfg.api,
  };
  for (const k of ["enabled", "credits", "source"])
    if (raw[k] !== undefined) result[k] = raw[k];
  for (const k of ["machineId", "deviceToken", "deviceRefreshToken"])
    if (/[\r\n]/.test(result[k]) || result[k].length > 16384)
      throw new ApiError("Qoder 设备凭据无效");
  return result;
}

/** 申请独立 PKCE 登录会话，machine_id 是协议登录标识而非原生设备令牌。 */
async function startLogin({ region = "cn" } = {}) {
  const cfg = site(region),
    verifier = randomBytes(64).toString("base64url"),
    nonce = randomUUID(),
    machineId = randomUUID();
  const params = new URLSearchParams({
    challenge: createHash("sha256").update(verifier).digest("base64url"),
    challenge_method: "S256",
    nonce,
    machine_id: machineId,
    client_id: cfg.clientId,
  });
  return {
    url: `${cfg.web}/device/selectAccounts?${params}`,
    region,
    verifier,
    nonce,
    machineId,
    expiresAt: Date.now() + 15 * 60 * 1000,
  };
}

/** 轮询一次授权；只在用户完成浏览器授权后交换 job token 并读取身份。 */
async function pollLogin(pending) {
  if (
    !pending?.nonce ||
    !pending.verifier ||
    !pending.machineId ||
    !pending.expiresAt ||
    Date.now() >= pending.expiresAt
  )
    throw new ApiError("Qoder 登录已过期，请重新登录");
  const cfg = site(pending.region),
    query = new URLSearchParams({
      nonce: pending.nonce,
      verifier: pending.verifier,
      challenge_method: "S256",
    });
  const r = await upstreamFetch(
    `${cfg.openapi}/api/v1/deviceToken/poll?${query}`,
    { timeout: 20000 },
  );
  const data = await r.json().catch(() => null);
  if (r.status === 404) return { status: "pending" };
  if (!r.ok)
    throw new ApiError("Qoder 登录轮询失败 HTTP " + r.status, r.status);
  business(data);
  if (!data.token)
    throw new ApiError("Qoder 登录轮询响应缺少 token，请重新登录", 502);
  const deviceToken = string(data.token);
  const jr = await upstreamFetch(`${cfg.openapi}/api/v1/me/jobToken`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Authorization: `Bearer ${deviceToken}`,
    },
    body: JSON.stringify({ clientId: cfg.clientId }),
    timeout: 20000,
  });
  let token,
    deviceChat = false;
  if (jr.ok) token = business(await jr.json().catch(() => null));
  else if (
    pending.region === "cn" &&
    [400, 403, 404, 405].includes(jr.status)
  ) {
    await jr.body?.cancel();
    token = data;
    deviceChat = true;
  } else {
    await jr.body?.cancel();
    throw new ApiError("Qoder job token 交换失败 HTTP " + jr.status, jr.status);
  }
  if (!token.token) throw new ApiError("Qoder 登录响应缺少 token", 502);
  const user = business(
    await requestJSON(`${cfg.openapi}/api/v1/userinfo`, {
      headers: { Authorization: `Bearer ${deviceToken}` },
      timeout: 20000,
    }),
  );
  return {
    status: "ready",
    account: await normalize({
      region: pending.region,
      providerUid: data.user_id || user.id || user.user_id || user.uid,
      nickname: user.name || data.user_name,
      email: user.email,
      accessToken: token.token,
      refreshToken: token.refresh_token,
      expiresAt: expiry(token, deviceChat),
      machineId: pending.machineId,
      deviceToken,
      deviceRefreshToken: data.refresh_token,
      deviceExpiresAt: expiry(data, true),
      deviceChat,
    }),
  };
}

/** 刷新令牌只发送一次，必须保留轮换后的完整令牌对。 */
async function refresh(account) {
  account = await normalize(account);
  const cfg = site(account.region);
  if (!account.refreshToken && !account.deviceRefreshToken)
    throw new ApiError("Qoder 账号缺少刷新令牌，请重新登录");
  const rotate = async (path, value) => {
    const t = business(
      await requestJSON(`${cfg.openapi}/api/v1/${path}/refresh`, {
        method: "POST",
        body: { refresh_token: value },
        timeout: 20000,
      }),
    );
    if (!(t.token || t.device_token) || !t.refresh_token)
      throw new ApiError("Qoder 刷新返回的令牌对不完整", 502);
    return t;
  };
  if (account.deviceChat) {
    const t = await rotate(
        "deviceToken",
        account.refreshToken || account.deviceRefreshToken,
      ),
      access = t.token || t.device_token;
    return {
      ...(await normalize({
        ...account,
        accessToken: access,
        refreshToken: t.refresh_token,
        expiresAt: expiry(t, true),
        deviceToken: access,
        deviceRefreshToken: t.refresh_token,
        deviceExpiresAt: expiry(t, true),
      })),
      refreshWarning: "",
    };
  }
  const due = (t) => !t || t <= Date.now() + 5 * 60 * 1000;
  const needsDevice =
    !!account.deviceRefreshToken &&
    (due(account.deviceExpiresAt) || !account.refreshToken);
  // 手动刷新仍可轮换 job token；设备单独到期时不重复消耗有效 job refresh token。
  const needsJob =
    !!account.refreshToken && (due(account.expiresAt) || !needsDevice);
  let changed = false,
    failed;
  if (needsJob) {
    const t = await rotate("jobToken", account.refreshToken);
    account = {
      ...account,
      accessToken: t.token,
      refreshToken: t.refresh_token,
      expiresAt: expiry(t),
    };
    changed = true;
  }
  if (needsDevice) {
    try {
      const t = await rotate("deviceToken", account.deviceRefreshToken);
      account = {
        ...account,
        deviceToken: t.token || t.device_token,
        deviceRefreshToken: t.refresh_token,
        deviceExpiresAt: expiry(t, true),
      };
      changed = true;
    } catch (error) {
      failed = error;
    }
  }
  if (failed && !changed) throw failed;
  // job 令牌已轮换时必须返回新凭据供持久化；设备失败由额度/活动请求明确呈现。
  return {
    ...(await normalize(account)),
    refreshWarning: failed
      ? "Qoder 对话令牌已刷新，设备令牌刷新失败；请重新登录以恢复额度与活动"
      : "",
  };
}

/** 模型目录只采用该账号实际启用的项目，不提供虚构静态模型。 */
async function listing(account) {
  const url = site(account.region).api + "/algo/api/v2/model/list?Encode=1";
  const data = business(
    await requestJSON(url, {
      headers: cosyHeaders(url, account),
      timeout: 15000,
    }),
  );
  const result = new Map();
  for (const m of [
    ...(Array.isArray(data.app) ? data.app : []),
    ...(Array.isArray(data.chat) ? data.chat : []),
  ])
    if (
      m?.enable &&
      typeof m.key === "string" &&
      !["auto", "default", ""].includes(m.key) &&
      !result.has(m.key)
    )
      result.set(m.key, m);
  if (!result.size) throw new ApiError("Qoder 未返回该账号的可用模型", 502);
  return [...result.values()];
}
async function models(account) {
  return (await listing(await normalize(account))).map((m) => ({
    id: m.key,
    name: m.display_name || m.key,
    ...(num(m.max_input_tokens) > 0
      ? { context_length: Number(m.max_input_tokens) }
      : {}),
  }));
}

/** 账号页面使用设备 token，不隐式轮换并丢失应持久化的新令牌。 */
function accountHeaders(account, identity = {}) {
  if (!account.deviceToken)
    throw new ApiError(
      "Qoder 缺少 deviceToken，请重新网页登录以读取额度和活动",
    );
  return {
    Accept: "application/json",
    "Content-Type": "application/json",
    Authorization: `Bearer ${account.deviceToken}`,
    "Cosy-ClientType": "10",
    "User-Agent": "Qoder",
    ...identity,
  };
}

/** 合并积分池；缺少余额字段时保留 null，避免把未知额度显示为零。 */
async function quota(account) {
  account = await normalize(account);
  const env = business(
    await requestJSON(site(account.region).openapi + "/sash/api/v2/me/usage", {
      headers: accountHeaders(account),
      timeout: 20000,
    }),
  );
  const data = env.qoderUsage,
    packages = [],
    general = [];
  if (data && typeof data === "object") {
    const pools = [
      ["套餐积分", data.userQuota ?? data.user_quota, true],
      ["附加积分", data.addOnQuota ?? data.add_on_quota, true],
      ["组织积分", data.orgResourcePackage ?? data.org_resource_package, true],
      ...(Array.isArray(
        data.dedicatedResourcePackages ?? data.dedicated_resource_packages,
      )
        ? (
            data.dedicatedResourcePackages ?? data.dedicated_resource_packages
          ).map((p) => ["专属积分", p, false])
        : []),
    ];
    for (const [name, p, counted] of pools) {
      if (!p || typeof p !== "object") continue;
      const limit = num(p.total ?? p.cap),
        reportedUsed = num(p.used),
        reportedRemaining = num(p.remaining);
      const remaining =
        reportedRemaining ??
        (limit !== null && reportedUsed !== null
          ? Math.max(0, limit - reportedUsed)
          : null);
      const used =
        reportedUsed ??
        (limit !== null && remaining !== null
          ? Math.max(0, limit - remaining)
          : null);
      const entry = {
        name: string(p.name) || name,
        unit: string(p.unit) || "credits",
        limit,
        remaining,
        used,
        expiresAt:
          p.expiresAt ||
          p.expires_at ||
          data.expiresAt ||
          data.expires_at ||
          null,
      };
      packages.push(entry);
      if (counted) general.push(entry);
    }
  } else if (env.displayMode !== "enterprise")
    throw new ApiError("Qoder 额度响应缺少 qoderUsage", 502);
  // 专属模型积分不属于通用余额；单位不兼容时只展示明细，不强行折算 Credits。
  const sum = (key) =>
    general.length &&
    general.every((p) => p[key] !== null && /^credits?$/i.test(p.unit))
      ? general.reduce((n, p) => n + p[key], 0)
      : null;
  return {
    unit: account.region === "cn" ? "Qoder CN Credits" : "Qoder Global Credits",
    remaining: sum("remaining"),
    limit: sum("limit"),
    used: sum("used"),
    packages,
    unlimited: false,
  };
}

/** 查找官方已安装的原生身份程序，不下载、不生成或重置设备身份。 */
async function nativeIdentity(account, { required = false } = {}) {
  const cfg = site(account.region),
    name = process.platform === "win32" ? "runtime-info.exe" : "runtime-info";
  const paths = [],
    override = process.env[cfg.prefix + "RUNTIME_INFO"];
  if (override) {
    if (!isAbsolute(override))
      throw new ApiError(
        `${cfg.prefix}RUNTIME_INFO 必须是官方 runtime-info 的绝对路径`,
      );
    paths.push(override);
  }
  if (!override) {
    if (process.platform === "win32")
      for (const base of [
        join(
          process.env.LOCALAPPDATA || join(homedir(), "AppData", "Local"),
          "Programs",
        ),
        process.env.ProgramFiles,
        process.env.ProgramW6432,
      ].filter(Boolean))
        paths.push(join(base, cfg.app, "resources", "umid", name));
    else if (process.platform === "darwin")
      for (const base of ["/Applications", join(homedir(), "Applications")])
        paths.push(
          join(base, cfg.app + ".app", "Contents", "Resources", "umid", name),
        );
    else paths.push(join("/opt", cfg.linux, "resources", "umid", name));
  }
  const config =
    process.env[cfg.prefix + "CONFIG_DIR"] ||
    join(
      process.env[cfg.prefix + "CLI_HOME"] || homedir(),
      process.env[cfg.prefix + "CONFIG_DIR_NAME"] || cfg.dir,
    );
  const cache = join(config, ".bin");
  for (const d of override
    ? []
    : await readdir(cache, { withFileTypes: true }).catch(() => [])) {
    if (
      process.platform === "win32" &&
      d.isDirectory() &&
      d.name.startsWith(`umid-win32-${process.arch}-`)
    )
      paths.push(join(cache, d.name, name));
    else if (
      process.platform !== "win32" &&
      d.isFile() &&
      d.name.startsWith(`runtime-info-${process.platform}-${process.arch}-`) &&
      !d.name.endsWith(".tmp")
    )
      paths.push(join(cache, d.name));
  }
  let file;
  for (const path of paths)
    if ((await stat(path).catch(() => null))?.isFile()) {
      file = path;
      break;
    }
  if (!file) {
    if (!required) return {};
    throw new ApiError(
      `未找到 ${cfg.app} 原生设备身份程序；请安装并登录 ${cfg.app} 桌面端或 CLI，或设置 ${cfg.prefix}RUNTIME_INFO 指向其官方 runtime-info 程序`,
    );
  }
  const output = await new Promise((resolve, reject) => {
    const child = execFile(
      file,
      process.platform === "linux"
        ? [cfg.environment]
        : [cfg.environment, "--account-stdin"],
      { timeout: 20000, windowsHide: true, maxBuffer: 1024 * 1024 },
      (error, stdout) =>
        error
          ? reject(
              new ApiError(
                "Qoder 原生设备身份读取失败，请更新或重启官方客户端",
              ),
            )
          : resolve(stdout),
    );
    child.stdin?.on("error", () => {});
    child.stdin?.end(
      process.platform === "linux"
        ? undefined
        : JSON.stringify({ account: account.providerUid }) + "\n",
    );
  });
  let identity;
  try {
    identity = JSON.parse(output.trim().split(/\r?\n/)[0]);
  } catch {
    throw new ApiError("Qoder 原生设备身份响应无效");
  }
  const headers = {};
  for (const [header, field] of [
    ["Cosy-MachineToken", "machineToken"],
    ["Cosy-MachineType", "machineType"],
  ]) {
    const v = identity?.[field];
    if (
      typeof v !== "string" ||
      !v.trim() ||
      v.length > 4096 ||
      !/^[\x20-\x7e]+$/.test(v)
    )
      throw new ApiError("Qoder 原生设备身份字段无效");
    headers[header] = v.trim();
  }
  return headers;
}

/** 读取上游实际活动，活动窗口完全依据服务端时间范围判断。 */
async function campaigns(account) {
  const identity = await nativeIdentity(account, {
    required: account.region === "global",
  });
  const data = business(
    await requestJSON(
      site(account.region).openapi + "/sash/api/v1/me/campaigns",
      { headers: accountHeaders(account, identity), timeout: 20000 },
    ),
  );
  if (!Array.isArray(data.campaigns))
    throw new ApiError("Qoder 活动响应缺少 campaigns", 502);
  return {
    identity,
    list: data.campaigns.filter((c) => c?.actionType === "CLAIM_BENEFIT"),
  };
}
const active = (c) =>
  (!when(c.startAt) || when(c.startAt) <= Date.now()) &&
  (!when(c.endAt) || Date.now() < when(c.endAt));
function verifyWindow(c, expected) {
  if (
    c &&
    expected &&
    ((expected.startsAt && when(c.startAt) !== when(expected.startsAt)) ||
      (expected.endsAt && when(c.endAt) !== when(expected.endsAt)))
  )
    throw new ApiError("Qoder 活动窗口已改变，请重新查询活动");
}
function campaignStatus(c) {
  return {
    enabled:
      !!c && ["CLAIMABLE", "CLAIMED"].includes(c.claimStatus) && active(c),
    checkedIn: c?.claimStatus === "CLAIMED" && active(c),
    reward: num(c?.benefit?.amount),
    campaignId: c?.campaignId || null,
    startsAt: when(c?.startAt) || null,
    endsAt: when(c?.endAt) || null,
  };
}
async function checkin(account, preferred) {
  account = await normalize(account);
  const { list, identity } = await campaigns(account);
  const c = preferred?.campaignId
    ? list.find((c) => c.campaignId === preferred.campaignId)
    : list.find((c) => active(c) && c.claimStatus === "CLAIMABLE") ||
      list.find((c) => active(c) && c.claimStatus === "CLAIMED") ||
      list.find(active);
  verifyWindow(c, preferred);
  if (!c && !identity["Cosy-MachineToken"])
    throw new ApiError(
      `无法确认 Qoder 活动资格：未读取到原生设备身份，请安装并登录 ${site(account.region).app} 或设置 ${site(account.region).prefix}RUNTIME_INFO`,
    );
  return campaignStatus(c);
}

/** 领取此前展示的同一活动；只有上游明确确认 CLAIMED 才报告成功。 */
async function claim(account, before) {
  account = await normalize(account);
  const { identity, list } = await campaigns(account);
  const c = before?.campaignId
    ? list.find((c) => c.campaignId === before.campaignId)
    : list.find((c) => active(c) && c.claimStatus === "CLAIMABLE");
  verifyWindow(c, before);
  if (!c || !active(c))
    throw new ApiError("Qoder 活动已结束或当前设备没有可领取活动");
  if (c.claimStatus === "CLAIMED") return campaignStatus(c);
  if (c.claimStatus !== "CLAIMABLE")
    throw new ApiError("Qoder 当前活动不可领取");
  const data = business(
    await requestJSON(
      `${site(account.region).openapi}/sash/api/v1/me/campaigns/${encodeURIComponent(c.campaignId)}/claim`,
      {
        method: "POST",
        headers: accountHeaders(account, identity),
        body: {},
        timeout: 20000,
      },
    ),
  );
  if ((data.status ?? data.data?.status) !== "CLAIMED")
    throw new ApiError("Qoder 未确认签到成功，请检查活动资格", 502);
  return {
    ...campaignStatus({ ...c, claimStatus: "CLAIMED" }),
    reward: num(
      data.benefit?.amount ?? data.data?.benefit?.amount ?? c.benefit?.amount,
    ),
  };
}

/** 发出一次已签名的模型请求，返回供网关统一处理的 OpenAI SSE。 */
async function chat(account, body, { signal } = {}) {
  account = await normalize(account);
  if (typeof body?.model !== "string" || !body.model)
    throw new ApiError("model 必须为有效模型标识");
  const model = (await listing(account)).find((m) => m.key === body.model);
  if (!model) throw new ApiError("当前 Qoder 账号未启用所选模型");
  const identity = await nativeIdentity(account);
  const wire = encodeBody(JSON.stringify(chatBody(body, model)));
  const url =
    site(account.region).api +
    "/algo/api/v2/service/pro/sse/agent_chat_generation?FetchKeys=llm_model_result&AgentId=agent_common&Encode=1";
  const response = await upstreamFetch(url, {
    method: "POST",
    headers: cosyHeaders(url, account, wire, model, identity),
    body: wire,
    signal,
    timeout: 120000,
  });
  if (!response.ok) {
    await response.body?.cancel();
    throw new ApiError(
      "Qoder 对话请求失败 HTTP " + response.status,
      response.status,
    );
  }
  return openaiResponse(response, body.model, signal, body.tools || []);
}

export default {
  normalize,
  startLogin,
  pollLogin,
  refresh,
  models,
  quota,
  checkin,
  claim,
  chat,
  streamFormat: "openai",
};
