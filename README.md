# KleeAPI

独立的 Vue 3 + TypeScript + Vite + Element Plus 管理界面，配合 Node.js 本地 API 与统一网关。账号数据按 WorkBuddy、Trae、Qoder 隔离保存。本目录不包含原项目的 Git 历史、账号、Key 或日志。

`feat/klee-adventure-theme` 分支提供可选的可莉主题：默认保留原深色界面，右上角「开启可莉主题」切换全站粉色手账、二创毛绒玩偶与动态贴纸。选择会在浏览器保存，并通过平台入口延续到各工作空间；关闭即恢复原样。右下角旅行便笺可暂停装饰动效，全站无声且遵循系统减少动态效果设置。使用与素材说明见 [主题说明](docs/KLEE-THEME.md) 和 [NOTICE](docs/NOTICE.md)。

首次从源码运行需要 Node.js 22.12 及以上和 npm。在项目根目录执行：

```powershell
npm run setup
npm run build
npm start
```

`npm start` 前台运行，服务就绪后自动打开管理页；按 Ctrl+C 或另开终端执行 `npm stop` 关闭本项目全部服务。自动打开时，新项目生成的 Key 通过 URL fragment 传递，页面立即移除 fragment。复制管理地址时不带 Key；手动打开页面可在设置中填写各平台 Key。

Windows 可双击 `Start-Manager.cmd` 在后台启动，双击 `Stop-Manager.cmd` 停止。已有 `runtime/node.exe` 时优先使用便携 Node，否则使用 PATH 中的 Node；Git 源码不包含此二进制，需要安装 Node 或自行放入便携 Node（保留其许可证）。编译后的 `frontend/dist` 也不入 Git，便携分发时须保留该目录。PowerShell 启动选项：

```powershell
.\Start-Manager.ps1 -NoBrowser
.\Start-Manager.ps1 -Dev
```

常用命令：

| 命令 | 用途 |
| --- | --- |
| `npm run setup` | 按 frontend/package-lock.json 安装前端依赖 |
| `npm run typecheck` | TypeScript 与 Vue 类型检查 |
| `npm run build` | 类型检查并构建前端 |
| `npm start -- --no-browser` | 前台启动，不打开浏览器 |
| `npm run dev` | 启动后端与 Vite 热更新界面（15173） |
| `npm run status` | 查看本项目管理器状态与子进程 |
| `npm stop` | 通过本项目鉴权控制端口关闭服务 |

默认管理页为 http://127.0.0.1:18887/admin。`klee-config.json` 配置网关 18887、WorkBuddy 18791、Trae 17864、Qoder 17865。所有管理接口仅监听本机。启动前检查配置的 API 端口；端口占用时会停止本次启动。Trae 官方登录回调使用 18080，此端口被旧版占用时仅禁用新项目的 Trae 官方网页登录，其他 API 和账号导入仍可用。需要新项目网页登录时，请先手动关闭占用回调端口的旧版 Trae。管理器不会关闭占用端口的其他进程。开发端口 15173 固定，不能与服务端口重复。

运行日志在 `runtime/logs/`；管理器状态在 `runtime/manager.json`，其中含本机关闭令牌，请勿分享。启动失败会清理本次已启动的服务。若强制结束管理器或断电导致状态遗留，先确认对应进程已经退出再删除状态文件；不要直接删除运行中的状态文件。正常停止使用 Stop 脚本或 `npm stop`。

目录：

- `frontend/`：Vue 源码、前端依赖和构建输出。
- `klee-api/app/`：API、账号存储、平台适配和网关。
- `scripts/`：无第三方依赖的 Node 进程管理器。
- `runtime/`：便携运行时、许可及本次运行状态。
- `WorkBuddy-Chat/`、`Trae-Chat/`、`Qoder-Chat/`、`Gateway-Chat/`：各自新建的数据目录（不提交）。
- `docs/`：迁移计划、接口说明和第三方许可。

首次真实启动会在新目录初始化账号存储与 Key。Windows 密钥使用当前用户 DPAPI 保护，移动到其他电脑或用户后请重新登录或导入账号。不要把私有数据提交到 Git。项目接口仍受各平台账号权限、模型可用性与上游限制约束；具体接口见 [API 指南](docs/API-GUIDE.md)，第三方声明见 [NOTICE](docs/NOTICE.md)。
