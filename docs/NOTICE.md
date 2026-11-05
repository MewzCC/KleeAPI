# 技术参考与运行时许可

KleeAPI 当前实现围绕平台现有接口重新编写，后端、平台适配器与共享管理页独立组织，未依赖旧仓库模块。

兼容方法参考：

- WorkBuddy：[Ianzhyh/workbuddy-to-dsh](https://github.com/Ianzhyh/workbuddy-to-dsh)，包括登录、模型、计费接口及桌面凭据格式。
- Trae：[connectedGraph/trae2api-web](https://github.com/connectedGraph/trae2api-web)，包括账号回调、SOLO 请求及事件格式。
- Qoder：设备授权、COSY 编码、额度与活动兼容协议来源及许可见 [Qoder 适配说明](../klee-api/Klee-qoder-web/NOTICE.md)。

平台参考实现的 MIT 许可和来源说明保留在对应适配器目录。本项目为独立 Vue 改造版，Git 从新的初始提交开始，不包含旧仓库历史。
便携运行时 Node.js 的许可证位于项目根目录下的 `runtime/Node-LICENSE.txt`。

前端使用 Vue、Vite、TypeScript 和 Element Plus；依赖版本固定在 frontend/package-lock.json，对应许可证保留在各 npm 包中。
