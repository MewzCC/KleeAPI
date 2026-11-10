# Qoder 协议来源与范围

本适配器为非官方兼容实现。已在本机国际版账号验证活动读取、领取和复查，其他协议能力仍需以平台实际结果为准。设备登录、COSY 签名、请求编码、模型目录、积分池及活动协议参考以下公开源码：

- [magpie-community/plugins：Qoder 协议实现](https://github.com/magpie-community/plugins/blob/d4eeba449383e3f6241369957b6fbcc4123502ba/packages/qoder/index.mjs)：其中 CN 端点及 client_id 引自官方 `@qodercn-ai/qoderclicn` 客户端；COSY 信封和编码沿用 CLIProxyAPI 衍生协议。
- [Zhengyuuuui/qoder2api：设备登录](https://github.com/Zhengyuuuui/qoder2api/blob/8d49aa6e8262ca67b2ffc511292541b1197c6db2/account/oauth.go)：确认轮询 HTTP 404 为待授权状态。

浏览器登录产生随机 PKCE verifier、nonce、machine_id；machine_id 是登录协议字段，不代替原生设备身份。活动和对话的原生设备身份 `Cosy-MachineToken`、`Cosy-MachineType` 只能读取已安装官方客户端的 `runtime-info` 输出；没有原生身份时不拿 machine_id 代替它。模型目录采用参考客户端普通 prepareRequest 的协议字段（其 MachineToken 等于登录 machine_id，MachineType 为 `5`），不表示读取了原生设备身份。本项目不生成、重置或伪造原生设备身份。可用 `QODER_RUNTIME_INFO`（国际版）或 `QODERCN_RUNTIME_INFO`（中国版）指定官方程序绝对路径。程序参数及平台目录遵循上述公开客户端协议，Windows/macOS 的用户 ID 通过标准输入传递。

Windows x64 可执行 `npm run setup:qoder`，从官方 `@qoder-ai/qodercli@1.1.86` npm 包原样提取 `runtime-info.exe` 和 `sgsdk.dll`，同时保留许可证。安装前校验固定 SHA-512，文件仅保存在本机 `runtime/qoder/`，不自动执行 CLI、不复制用户登录信息。查找优先级为显式环境变量、已安装客户端/CLI、本项目安装目录。官方安装说明见 [Qoder CLI 安装](https://docs.qoder.com/cli/installation)。

国际版活动需要原生身份；中国版遵循参考实现，在身份程序不存在时可读取服务端实际提供的活动，但列表为空且身份缺失时报告无法确认资格。活动入口支持服务端返回的 `CLAIM_BENEFIT` 活动，并依据其 `startAt`/`endAt` 窗口领取，不根据本地日期虚构“每日”活动或把未知状态当作签到成功。专属模型积分保留明细，不混入通用 Credits 总额。

对话支持 OpenAI 消息、图片、原生函数调用，以及参考协议中 `<tool_call>` 包装的 JSON 或 function/parameter XML 调用；其它未包装 XML 方言不作工具调用推断。SSE 保留结束后的 usage；取消会取消上游读取器；对话请求不自动重试。

以下 MIT 许可适用于参考及衍生协议代码：

MIT License

Copyright (c) 2026 magpie-community contributors

Copyright (c) 2025-2005.9 Luis Pater
Copyright (c) 2025.9-present Router-For.ME

Permission is hereby granted, free of charge, to any person obtaining a copy
of this software and associated documentation files (the "Software"), to deal
in the Software without restriction, including without limitation the rights
to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
copies of the Software, and to permit persons to whom the Software is
furnished to do so, subject to the following conditions:

The above copyright notice and this permission notice shall be included in all
copies or substantial portions of the Software.

THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
SOFTWARE.
