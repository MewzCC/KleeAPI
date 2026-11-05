# API 接入指南

启动 KleeAPI 后，推荐从门户进入「统一网关」，只配置一个 URL 与网关 Key。网关页会根据实际端口生成可复制示例；各平台左侧的「API 指南」仍用于直接调用对应平台。

在指南填写模型 ID、stream 和可选 max_tokens 后，点击「测试聊天」打开悬浮窗；也可在模型目录点击「复制 ID 并用于示例」直接带入模型。窗口显示实际 Base URL、模型与 Key 保存状态，使用已保存 Key；只有点击「发送」才会实际调用模型并可能消耗额度。支持多轮对话、停止和清空，关闭窗口会停止正在进行的请求；对话仅保存在当前页面内存，切换模型或地址会清空上下文。复制接入配置使用占位 Key，需要在客户端替换为自己的 Key；测试窗不执行模型返回的工具调用。

Trae 签到状态与领取请求携带 `req_source`：本项目 SOLO 网页登录默认使用 `2`，导入 IDE 凭据时可显式保存 `reqSource:1`。沿用账号已有的设备标识，不因领取被拒绝而自动更换身份。`9074` 表示平台拒绝本次领取，补齐参数不保证能消除此拒绝；`9095` 表示设备已签到，仍需复查当前账号的 `checked_in`。余额未变化、账号未签到时不会显示领取成功。

## 地址和认证

| 平台 | 默认 Base URL | 完整对话地址 |
| --- | --- | --- |
| 统一网关（推荐） | `http://127.0.0.1:18887/v1` | `http://127.0.0.1:18887/v1/chat/completions` |
| WorkBuddy | `http://127.0.0.1:18791/v1` | `http://127.0.0.1:18791/v1/chat/completions` |
| Trae | `http://127.0.0.1:17864/v1` | `http://127.0.0.1:17864/v1/chat/completions` |
| Qoder | `http://127.0.0.1:17865/v1` | `http://127.0.0.1:17865/v1/chat/completions` |

端口可在 `klee-config.json` 中修改，修改后重新启动；页面指南显示实际配置。同一平台的国内版和国际版使用同一接入地址，通过管理页的当前账号决定调用区域。

客户端选择 **OpenAI / Chat Completions** 类型。要求 Base URL 的客户端填写以 `/v1` 结尾的地址；要求完整请求地址的客户端填写 `/v1/chat/completions`，避免重复拼接路径。服务监听本机回环地址，以上地址供同一台电脑上的客户端使用。

网关使用独立网关 Key，调用客户端无需配置三个平台的 Key。平台直连仍使用对应平台 Key。请求头认证方式一致：

```http
Authorization: Bearer klee-YOUR_API_KEY
Content-Type: application/json
```

Key 在对应平台管理页的原输入框中保存，格式为 `klee-<自定义Key>`，不会追加平台名或其他尾缀；总长 8–256 位 ASCII 字符，不能包含空格。输入框旁的「复制 Key」只复制当前平台已保存的完整密钥。编辑但未保存的值不会用于请求。更换后旧 Key 立即失效。

旧版本中缺少 `klee-` 前缀的 Key，会在下一次成功启动时补齐；已有 `klee` 但缺少连字符时只补上 `-`。加前缀后超过 256 位的旧 Key 会重新生成。请从管理页复制更新后的 Key，并同步更新已接入的客户端。示例中的 `klee-YOUR_API_KEY` 是占位符。

## 获取模型 ID

先在平台账号管理中登录并启用账号，再进入网关刷新号池。网关会读取所有账号实际返回的模型与额度；平台直连则使用当前账号的模型目录。模型发现接口为：

```http
GET /v1/models
Authorization: Bearer klee-YOUR_API_KEY
```

模型目录属于当前账号；切换账号或区域后应重新确认模型。接口可能返回该账号上次成功获取的缓存，响应中的 `source`、`fetchedAt` 和 `warning` 用于判断来源和是否需要刷新。可用 `/v1/models?refresh=1` 显式刷新。

上段缓存字段适用于平台直连。统一网关聚合有可调度账号的模型，返回 `canonicalIds` 和 `availableAccounts`，不依赖当前账号。规范模型名为 `platform/region/upstreamModelId`；原 ID 中包含 `/` 时按完整目录项匹配。裸 ID 只在一个规范模型对应时自动提供。跨平台/区域重名时使用规范模型名，或配置别名：

```json
{
  "gateway": {
    "port": 18887,
    "aliases": {
      "my-model": [
        "qoder/cn/ACTUAL_MODEL_ID",
        "trae/cn/ACTUAL_MODEL_ID"
      ]
    }
  }
}
```

将示例合并到现有 `klee-config.json` 并重启；其中 ID 必须替换为真实目录项，只有确认等价的模型才应绑定为同一别名。`workbuddy/`、`trae/`、`qoder/` 前缀保留给规范 ID，别名不能覆盖这些命名空间。请求中的 `model` 可填写别名 `my-model`，网关会映射为各候选平台的原 ID，其余参数按适配器传递。

网关按账号验证通用余额或明确无限额度；未确认用途的专属资源包不计为所有模型通用的额度。额度未知、零余额、账号失效或停用时跳过。元数据有短期缓存，最终资格仍由平台在派发前再次检查。单账号并发为 1；合格账号全部忙碌时请求进入内存队列，同一账号的等待者先来先服务，不阻塞其他模型的空闲账号。账号完成响应或失败后会唤醒等待者，并重新核对资格；其他调用方占用的账号每秒检查本机快照。最多允许 128 个等待请求，排队与生成共享五分钟请求上限；客户端断开或取消时立即退出队列并取消尚在进行的上游请求。队列不持久化，网关停止时未完成的请求会结束。

只对明确未开始生成的可重试拒绝切换账号，最多尝试三个不同账号；若本机快照与实际调用发生竞争、平台明确返回账号忙碌且允许重试，则该账号冷却一秒后重新排队，不消耗这三个尝试名额。超时、断流及不确定错误不重试，也不会改成另一模型。客户端自身的超时若短于网关上限，会先取消排队或生成。

## 对话参数

```json
{
  "model": "MODEL_ID_FROM_CATALOG",
  "messages": [
    { "role": "user", "content": "Hello" }
  ],
  "stream": false,
  "max_tokens": 512
}
```

| 参数 | 类型 | 说明 |
| --- | --- | --- |
| `model` | string，必填 | 当前账号模型目录中的非空模型 ID。 |
| `messages` | array，必填 | 非空消息数组，每条消息包含 `role` 和相应 `content`；多轮对话按顺序提交历史消息。 |
| `stream` | boolean，可选 | `true` 返回 SSE；不传或 `false` 返回完整 JSON。 |
| `max_tokens` | integer，可选 | 请求输出上限，实际限制由平台和模型决定。 |
| `max_completion_tokens` | integer，可选 | Qoder 优先采用此值，其次采用 `max_tokens`；其他平台按上游能力处理。 |
| `reasoning_effort` | string，可选 | Qoder 支持映射；`none` 在支持思考开关的模型上请求关闭思考，是否生效取决于模型配置。 |
| `tools` / `tool_choice` | array / string 或 object，可选 | 工具调用能力取决于平台和模型；客户端负责执行工具并回传结果。 |
| `temperature` / `top_p` | number，可选 | WorkBuddy、Trae 随请求转交上游；Qoder 当前未映射这两个字段，不能用于控制 Qoder 采样。 |

扩展字段是否生效以对应适配器和上游模型为准。Qoder 图片消息要求模型具备视觉能力，图片通过 `data:` URL 内联。

## Windows PowerShell 示例

以下代码只展示接入方式；替换 Key 和模型 ID 后由你手动执行。

```powershell
$apiBase = 'http://127.0.0.1:18887/v1'
$apiKey = 'klee-YOUR_API_KEY'
$headers = @{ Authorization = "Bearer $apiKey" }

Invoke-RestMethod -Method Get -Uri "$apiBase/models" -Headers $headers

$payload = @{
    model = 'MODEL_ID_FROM_CATALOG'
    messages = @(@{ role = 'user'; content = 'Hello' })
    stream = $false
    max_tokens = 512
} | ConvertTo-Json -Depth 10

Invoke-RestMethod -Method Post -Uri "$apiBase/chat/completions" `
    -Headers $headers -ContentType 'application/json' -Body $payload
```

## curl 示例（Bash / WSL）

```bash
curl 'http://127.0.0.1:18887/v1/chat/completions' \
  -H 'Authorization: Bearer klee-YOUR_API_KEY' \
  -H 'Content-Type: application/json' \
  --data-raw '{"model":"MODEL_ID_FROM_CATALOG","messages":[{"role":"user","content":"Hello"}],"stream":false}'
```

将 `stream` 改为 `true`，并给 curl 增加 `-N`，即可按事件接收流式响应。响应类型为 `text/event-stream`，正常完成以 `data: [DONE]` 结束；客户端需要检查数据帧中的 `error` 对象。

## 接入排查

- 无法连接：确认服务已启动、端口与指南一致。
- `invalid_api_key`：使用对应平台已经保存的 Key，检查 `klee` 前缀和是否误用旧 Key。
- 缺少账号或账号不可用：在管理页登录、启用并选择账号；上游授权过期时续期或重新登录。
- 模型不可用：重新刷新当前账号的模型目录，并复制完整模型 ID。
- 缺少参数或 JSON 无效：检查 `model`、非空 `messages`、字段类型及 JSON 格式。
- 上游额度、认证、限流或活动错误：根据返回信息检查官方账号。平台直连不会自动重试或换号。
- 账号忙碌时网关自动排队。429 且错误码为 `queue_full` 表示等待队列已满；平台明确拒绝或限流仍可能返回其状态码。504 表示包含排队在内的请求已超时；503 表示没有可确认合格的账号；404 表示模型未知或裸 ID 存在歧义。查看网关页的平台错误和账号资格说明，必要时刷新号池。网关只按上面的严格条件换号，平台直连不自动换号。
