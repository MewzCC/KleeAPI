async (page) => {
  const origin = new URL(page.url()).origin;
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  let serviceKey = 'klee-current-fixture', changes = 0, reads = 0, failSave = false;
  await page.context().addInitScript(() => {
    sessionStorage.removeItem('klee.gateway');
    localStorage.removeItem('klee.gateway');
  });
  await page.context().route('**/*', async route => {
    const req = route.request(), url = new URL(req.url());
    if (!['127.0.0.1', 'localhost'].includes(url.hostname)) return route.abort();
    if (!url.pathname.startsWith('/api/') && !url.pathname.startsWith('/v1/')) return route.continue();
    if (url.pathname === '/api/config') return route.fulfill({ json: { platform: 'gateway', ports: { gateway: 18887, workbuddy: 18791, trae: 17864, qoder: 17865 }, onboarding: { completed: true } } });
    if (url.pathname === '/api/key/local') {
      const body = req.postDataJSON();
      if (!Object.hasOwn(body, 'apiKey')) {
        reads++;
        return route.fulfill({ json: { apiKey: serviceKey } });
      }
      if (failSave) return route.fulfill({ status: 500, json: { error: { message: '模拟保存失败' } } });
      serviceKey = body.apiKey;
      changes++;
      return route.fulfill({ json: { ok: true } });
    }
    if (req.headers().authorization !== `Bearer ${serviceKey}`) return route.fulfill({ status: 401, json: { error: { code: 'invalid_api_key' } } });
    return route.fulfill({ json: { accounts: [], models: [], platforms: [], fetchedAt: Date.now() } });
  });
  await page.goto(origin + '/admin/gateway?tab=settings#theme=default');
  const editor = page.locator('.key-panel');
  const input = editor.getByLabel('API Key', { exact: true });
  const fallback = editor.getByRole('button', { name: '一键补填', exact: true });
  const save = editor.getByRole('button', { name: '保存并连接' });
  await input.waitFor();
  assert(await input.inputValue() === '', 'The first visit can start with an empty Key');
  assert(await fallback.count() === 0, 'No fallback button on a normal empty form');
  await input.fill('klee-first-custom');
  await save.click();
  await page.waitForFunction(() => sessionStorage.getItem('klee.gateway') === 'klee-first-custom');
  assert(changes === 1 && reads === 0, 'First custom save never requires filling the current key');
  await input.fill('');
  assert(await fallback.count() === 0, 'Normally clearing the input never reveals fallback');
  await input.fill('klee-next-custom');
  await save.click();
  await page.waitForFunction(() => sessionStorage.getItem('klee.gateway') === 'klee-next-custom');
  failSave = true;
  await input.fill('klee-failed-custom');
  await save.click();
  await editor.getByText('模拟保存失败', { exact: true }).waitFor();
  await fallback.waitFor();
  assert(serviceKey === 'klee-next-custom', 'Failed saves preserve the server key');
  await fallback.click();
  await page.waitForFunction(() => document.querySelector('.key-panel input[aria-label="API Key"]').value === 'klee-next-custom');
  assert(reads === 1 && changes === 2, 'Filling only reads the current key');
  assert(await fallback.count() === 0, 'Fallback disappears after successful recovery');
  failSave = false;
  await input.fill('klee-custom-after-fill');
  await save.click();
  await page.waitForFunction(() => sessionStorage.getItem('klee.gateway') === 'klee-custom-after-fill');
  failSave = true;
  await input.fill('klee-failed-again');
  await save.click();
  await fallback.waitFor();
  await input.fill('');
  await fallback.waitFor({ state: 'hidden' });
  failSave = false;
  await input.fill('klee-custom-without-fill');
  await save.click();
  await page.waitForFunction(() => sessionStorage.getItem('klee.gateway') === 'klee-custom-without-fill');
  assert(reads === 1, 'An error does not force the user through recovery');
  // Expire the browser key while leaving a different current value on the server.
  serviceKey = 'klee-server-rotated-elsewhere';
  await input.fill('klee-custom-after-stale');
  await save.click();
  await page.waitForFunction(() => sessionStorage.getItem('klee.gateway') === 'klee-custom-after-stale');
  assert(serviceKey === 'klee-custom-after-stale' && reads === 1, 'Stale browser keys can still directly customize');
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Key settings fit a narrow screen');
  await page.setViewportSize({ width: 1440, height: 1000 });
  return 'PASS: Empty and stale keys allow direct customization; fallback is optional, appears only on error, and disappears on normal clearing.';
}
