async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [], requests = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => requests.push({ type: request.resourceType(), method: request.method(), url: new URL(request.url()) }));
  await page.context().route('**/api/accounts', async route => { await new Promise(resolve => setTimeout(resolve, 200)); await route.fallback(); });
  await page.setViewportSize({ width: 1440, height: 900 });
  await page.goto('http://127.0.0.1:17865/admin/qoder');
  await page.evaluate(() => localStorage.removeItem('klee.sidebar.collapsed'));
  for (const theme of ['default', 'klee']) {
    await page.goto('http://127.0.0.1:17865/admin/qoder?tab=accounts#theme=' + theme);
    await page.getByRole('heading', { name: /^Qoder 国内开发/ }).waitFor();
    await page.evaluate(() => { window.__routingDocument = document; window.__qoderWorkspace = document.querySelector('.console-workspace'); });
    await page.getByRole('textbox', { name: '搜索账号' }).fill('国际版');
    requests.length = 0;
    const switchPlatform = async (name, platform) => {
      await page.locator('.platform-switcher').getByRole('link', { name, exact: true }).click();
      await page.waitForURL(url => url.pathname === '/admin/' + platform);
      assert(new URL(page.url()).origin === 'http://127.0.0.1:17865' && !new URL(page.url()).hash, 'Keep navigation on the same origin without credential fragments');
      assert(await page.evaluate(() => window.__routingDocument === document), 'Switching platforms must preserve the document');
      assert(await page.locator('.platform-switcher .current').getAttribute('aria-label') === name, 'Highlight the requested platform');
      assert(await page.getByRole('button', { name: theme === 'klee' ? '可莉主题已开启' : '开启可莉主题', exact: true }).isVisible(), 'Preserve the theme during routing');
    };
    await switchPlatform('Trae', 'trae');
    await page.getByRole('button', { name: '账号管理', exact: true }).click();
    await page.getByRole('heading', { name: /^Trae 主账号/ }).waitFor();
    await page.getByRole('button', { name: '折叠导航栏', exact: true }).click();
    await switchPlatform('WorkBuddy', 'workbuddy');
    await page.getByRole('button', { name: '展开导航栏', exact: true }).waitFor();
    await page.getByRole('button', { name: '账号管理', exact: true }).click();
    await page.getByRole('heading', { name: /^日常开发账号/ }).waitFor();
    await switchPlatform('Qoder', 'qoder');
    assert(await page.evaluate(() => document.querySelector('.console-workspace') === window.__qoderWorkspace), 'Reuse the cached platform view');
    await page.getByRole('button', { name: '账号管理', exact: true }).click();
    assert(await page.getByRole('textbox', { name: '搜索账号' }).inputValue() === '国际版', 'Preserve platform search state');
    await page.getByRole('heading', { name: /^国际版备用账号/ }).waitFor();
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
    await page.goBack();
    await page.waitForURL(url => url.pathname === '/admin/workbuddy');
    await page.goForward();
    await page.waitForURL(url => url.pathname === '/admin/qoder');
    await switchPlatform('统一网关', 'gateway');
    await page.getByRole('button', { name: '调用统计', exact: true }).waitFor();
    await page.locator('.brand').click();
    await page.waitForURL(url => url.pathname === '/admin');
    await page.getByRole('link', { name: '进入工作台', exact: true }).click();
    await page.waitForURL(url => url.pathname === '/admin/gateway');
    assert(await page.evaluate(() => window.__routingDocument === document), 'Portal links must also use client-side routing');
    for (const port of ['17864', '18791', '18887']) assert(requests.some(request => request.url.port === port && request.type === 'fetch'), 'Send API requests to the correct service port: ' + port);
    assert(!requests.some(request => request.type === 'document'), 'No document reloads while navigating');
    assert(!requests.some(request => request.method === 'POST'), 'Navigation must not mutate accounts or claim rewards');
    await page.screenshot({ path: 'output/playwright/routing-' + theme + '.png' });
  }
  assert(!errors.length, 'Browser errors: ' + errors.join('; '));
  await page.reload();
  await page.getByRole('button', { name: '调用统计', exact: true }).waitFor();
  assert(await page.locator('.platform-switcher .current').getAttribute('aria-label') === '统一网关', 'Direct reload must use the route platform, not the hosting service');
  return 'PASS: no document reloads, cached platform state, correct API services, shared sidebar/theme, browser history, portal navigation and direct-route reload.';
}
