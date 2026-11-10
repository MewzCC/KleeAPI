# 控制台离线浏览器检查

先构建前端并启动本地管理器，再使用独立的 Playwright CLI 浏览器会话。每项检查前重新安装 mock，避免上一项的领取结果影响下一项。所有 API / v1 请求由 mock 响应，外网请求一律取消；不使用真实账号、Key 或真实签到。

```powershell
npx --yes --package @playwright/cli@0.1.24 playwright-cli open http://127.0.0.1:18887/admin
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-platforms.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-native-sync.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-dashboard-checkins.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-balances.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-models.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-scroll-hint.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-overview-key.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-sidebar.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/mock-console.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli run-code --filename=tests/browser/check-routing.js
npx --yes --package @playwright/cli@0.1.24 playwright-cli close
```

检查包含单账号/批量签到、同 UID 跨平台隔离、9074 提示、筛选、模型直达与带入示例、账号搜索/添加入口、额度、设置、平台切换后地址清理、可莉主题跨端口保留、门户、调用统计、窄屏溢出和浏览器异常。截图写入已忽略的 `output/playwright/`，截图使用模拟账号，不代表实际账号或平台状态。

模型目录检查使用 25 条模拟数据，验证网关和单平台的表格分页、跨页搜索、空结果、刷新后页码校正、每页条数、复制 ID、带入示例，以及两种主题的窄屏布局。

路由检查验证四个平台在当前端口内切换，不重新请求页面文档；保留各平台搜索状态、导航折叠和主题设置，接口仍请求各自服务端口，并检查浏览器前进后退、门户入口与直接刷新。
