async (page) => {
  page.setDefaultTimeout(8000);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.addInitScript(() => Object.defineProperty(navigator, 'clipboard', { configurable: true, value: {
    writeText: async () => { if (window.__denySetupCopy) throw new Error('clipboard denied'); },
  } }));
  const model = 'trae/cn/demo-onboarding';
  let accounts = [], models = [], keyRejected = true, validReply = false, heldReply, requestHeld;
  await page.route('**/api/gateway/status**', route => keyRejected
    ? route.fulfill({ status: 401, json: { error: { message: 'API Key 无效' } } })
    : route.fulfill({ json: { accounts, models, platforms: [], fetchedAt: Date.now() } }));
  await page.route('**/api/key', route => {
    assert(route.request().method() === 'POST', 'Save the Key before connecting a platform account');
    keyRejected = false;
    return route.fulfill({ json: { ok: true } });
  });
  await page.route('**/v1/chat/completions', async route => {
    assert(route.request().postDataJSON().model === model, 'Test the confirmed model');
    if (requestHeld) {
      await new Promise(resolve => { heldReply = resolve; requestHeld() });
      requestHeld = undefined;
      try { await route.fulfill({ contentType: 'text/event-stream', body: 'data: [DONE]\n\n' }) } catch { /* Client canceled before the reply. */ }
      return;
    }
    if (!validReply) return route.fulfill({ status: 502, json: { error: { message: '模拟测试失败' } } });
    return route.fulfill({ contentType: 'text/event-stream', body: 'data: {"choices":[{"delta":{"content":"模拟回复"},"finish_reason":"stop"}]}\n\ndata: [DONE]\n\n' });
  });
  await page.goto('http://127.0.0.1:18887/admin/gateway');
  const progress = page.getByRole('region', { name: '首次接入' });
  const compact = page.getByRole('region', { name: '首次接入进度' });
  const count = steps => progress.getByText(`已完成 ${steps} / 5 步`, { exact: true }).waitFor();
  const overview = () => page.getByRole('navigation', { name: '工作空间导航' }).getByRole('button', { name: '工作台', exact: true }).click();
  const refresh = () => page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await progress.getByText('API Key 无效，请在连接设置中重新保存。', { exact: true }).waitFor();
  await count(0);
  assert(await progress.getByRole('button', { name: '打开模型目录' }).isDisabled(), 'Model selection requires an authorized account');
  assert(await progress.getByRole('button', { name: '添加授权账号' }).isDisabled(), 'Account authorization requires an API Key');
  await progress.getByRole('button', { name: '设置 API Key', exact: true }).click();
  await compact.getByText('已完成 0 / 5 步', { exact: true }).waitFor();
  await page.getByRole('button', { name: '保存并连接' }).click();
  await count(1);
  await progress.getByRole('link', { name: '管理 Trae 账号' }).waitFor();
  assert(await progress.getByRole('button', { name: '打开模型目录' }).isDisabled(), 'A saved key alone must not enable model selection');
  await progress.getByRole('link', { name: '管理 Trae 账号' }).click();
  await page.getByRole('heading', { name: '账号管理', exact: true }).waitFor();
  await compact.getByText('第 2 步 / 共 5 步 · 添加授权账号', { exact: true }).waitFor();
  await compact.getByRole('link', { name: '返回统一网关向导' }).click();
  accounts = [{ uid: 'demo', platform: 'trae', region: 'cn', enabled: true, status: 'no_credits', remaining: 0, models: [{ id: 'demo-onboarding' }] }];
  await refresh();
  await count(2);
  await progress.getByRole('button', { name: '检查号池和额度' }).waitFor();
  accounts = [{ ...accounts[0], status: 'ready', remaining: 25 }];
  models = [{ id: model, availableAccounts: 1, canonicalIds: [model] }];
  await refresh();
  await progress.getByRole('button', { name: '打开模型目录' }).click();
  await compact.getByText('已完成 2 / 5 步', { exact: true }).waitFor();
  await compact.getByText('选择模型', { exact: true }).waitFor();
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Progress fits mobile screens');
  await page.setViewportSize({ width: 1440, height: 1000 });
  const copyModel = page.getByRole('row').filter({ hasText: model }).getByRole('button', { name: '复制 ID', exact: true });
  await page.evaluate(() => { window.__denySetupCopy = true });
  await copyModel.click();
  await page.getByText('复制失败，请手动复制。', { exact: true }).waitFor();
  await compact.getByText('已完成 2 / 5 步', { exact: true }).waitFor();
  await page.evaluate(() => { window.__denySetupCopy = false });
  await copyModel.click();
  await count(3);
  await progress.getByRole('button', { name: '打开测试聊天' }).click();
  const chat = page.getByRole('dialog', { name: 'API 测试聊天' });
  await chat.getByRole('button', { name: '发送', exact: true }).click();
  await chat.getByText(/模拟测试失败/).waitFor();
  await page.keyboard.press('Escape');
  await chat.waitFor({ state: 'hidden' });
  await overview();
  await count(3);
  const pending = new Promise(resolve => { requestHeld = resolve });
  await progress.getByRole('button', { name: '打开测试聊天' }).click();
  await chat.getByRole('button', { name: '发送', exact: true }).click();
  await pending;
  await chat.getByRole('button', { name: '停止', exact: true }).click();
  heldReply();
  await chat.getByText(/已停止生成/).waitFor();
  await page.keyboard.press('Escape');
  await chat.waitFor({ state: 'hidden' });
  await overview();
  await count(3);
  validReply = true;
  await progress.getByRole('button', { name: '打开测试聊天' }).click();
  await chat.getByRole('button', { name: '发送', exact: true }).click();
  await chat.getByText('请求已完成。', { exact: true }).waitFor();
  await chat.getByRole('button', { name: '返回向导，继续接入' }).click();
  await chat.waitFor({ state: 'hidden' });
  await count(4);
  await progress.getByRole('button', { name: '查看客户端配置' }).click();
  const client = page.getByRole('region', { name: '客户端配置' });
  await client.getByText('klee-YOUR_API_KEY', { exact: true }).waitFor();
  await client.getByRole('button', { name: '复制客户端配置' }).click();
  await count(4);
  await progress.getByText(/粘贴到客户端/).waitFor();
  await progress.getByRole('button', { name: '我已在客户端收到回复' }).click();
  await count(5);
  accounts = [{ ...accounts[0], uid: 'replacement' }];
  await refresh();
  await count(3);
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Onboarding fits mobile screens');
  assert(!errors.length, errors.join('; '));
  return 'PASS: progress on linked pages, clipboard failure and return, failed and canceled tests, next step after success, client copy and confirmation, mobile layout';
}
