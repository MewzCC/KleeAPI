async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [], rotations = [];
  let failSave = false;
  page.on('pageerror', error => errors.push(error.message));
  await page.context().route('**/api/key', async route => {
    rotations.push({ url: route.request().url(), body: route.request().postDataJSON(), authorization: await route.request().headerValue('authorization') });
    await route.fulfill({ status: failSave ? 500 : 200, json: failSave ? { error: { message: '模拟保存失败' } } : { ok: true } });
  });
  await page.context().addInitScript(() => {
    for (const p of ['gateway', 'workbuddy', 'trae', 'qoder']) localStorage.removeItem('klee.' + p);
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedKey = text; } } });
  });
  for (const [platform, port] of [['gateway', 18887], ['qoder', 17865]]) {
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('http://127.0.0.1:' + port + '/admin/' + platform + '?tab=overview#theme=default');
    await page.reload();
    const panel = page.locator('.endpoint-panel');
    const input = panel.getByRole('textbox', { name: 'API Key', exact: true });
    await input.waitFor({ timeout: 5000 });
    assert(await input.getAttribute('type') === 'text', 'Overview shows the full key without masking');
    assert(await input.inputValue() === 'klee-offline-demo', 'Show the currently saved key');
    const initialCount = rotations.length;
    await input.fill('invalid-key');
    await panel.getByRole('button', { name: '保存并连接', exact: true }).click();
    await page.getByText('API Key 须以 klee- 开头，长度 8–256 个可见 ASCII 字符，不含空白。', { exact: true }).waitFor();
    assert(rotations.length === initialCount, 'Invalid keys must not make a request');
    const next = 'klee-overview-' + platform + '-saved';
    await input.fill(next);
    assert(await page.evaluate(p => sessionStorage.getItem('klee.' + p), platform) === 'klee-offline-demo', 'Unsaved edits must not replace the active key');
    await panel.getByRole('button', { name: '复制已保存 Key', exact: true }).click();
    assert(await page.evaluate(() => window.__copiedKey) === 'klee-offline-demo', 'Copy uses the saved key, not the draft');
    await panel.getByText('在此浏览器记住', { exact: true }).click();
    assert(await panel.getByRole('checkbox', { name: '在此浏览器记住', exact: true }).isChecked(), 'Enable browser persistence');
    await panel.getByRole('button', { name: '保存并连接', exact: true }).click();
    await page.waitForFunction(([p, key]) => sessionStorage.getItem('klee.' + p) === key && localStorage.getItem('klee.' + p) === key, [platform, next]);
    assert(rotations.at(-1).body.apiKey === next && rotations.at(-1).authorization === 'Bearer klee-offline-demo', 'Use the existing key to authorize rotation');
    await panel.getByRole('button', { name: '复制已保存 Key', exact: true }).click();
    assert(await page.evaluate(() => window.__copiedKey) === next, 'Copy reflects the newly saved key');
    failSave = true;
    await input.fill('klee-unsaved-failure');
    await panel.getByRole('button', { name: '保存并连接', exact: true }).click();
    await page.getByText('模拟保存失败', { exact: true }).waitFor();
    assert(await page.evaluate(p => sessionStorage.getItem('klee.' + p), platform) === next, 'Failed save must preserve the active key');
    failSave = false;
    await page.getByRole('navigation', { name: '工作空间导航' }).getByRole('button', { name: '连接设置', exact: true }).click();
    const settings = page.locator('.key-panel input[aria-label="API Key"]');
    await settings.waitFor();
    assert(await settings.inputValue() === next, 'Settings reflects the key saved from overview');
    assert(await settings.getAttribute('type') === 'password', 'Preserve the settings password toggle');
    await page.getByRole('navigation', { name: '工作空间导航' }).getByRole('button', { name: '工作台', exact: true }).click();
    await input.waitFor();
    assert(await input.inputValue() === next, 'Reopening overview discards the failed draft');
    await panel.getByText('在此浏览器记住', { exact: true }).click();
    await panel.getByRole('button', { name: '保存并连接', exact: true }).click();
    await page.waitForFunction(p => !localStorage.getItem('klee.' + p), platform);
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['default', 'klee']) {
      if (theme === 'klee') await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      await panel.screenshot({ path: 'output/playwright/overview-key-' + platform + '-' + theme + '.png' });
    }
  }
  assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
  return 'PASS: full key display, draft/active isolation, validation, authorized save, failed-save preservation, settings synchronization, copy, browser persistence, both mobile themes; zero runtime errors.';
}
