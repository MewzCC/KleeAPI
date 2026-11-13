async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const base = { platform: 'trae', region: 'cn', account: '模拟账号', durationMs: 1200, inputTokens: null, outputTokens: null, totalTokens: null, credits: null };
  const routeAttempts = ['a', 'b', 'c'].map((model, index) => ({ ...base, model: 'trae/cn/' + model, status: index === 2 ? 'success' : 'failed', httpStatus: index === 2 ? 200 : 503, errorCode: index === 2 ? null : 'platform_chat_error', totalTokens: index === 2 ? 15 : null }));
  await page.route('**/api/gateway/usage', route => route.fulfill({ json: { records: [{ ...base, id: 'auto-history', model: 'auto/coding', upstreamModel: 'c', startedAt: Date.now(), status: 'success', httpStatus: 200, errorCode: null, stream: false, attempts: 3, hasConversation: false, routeAttempts }], limit: 2000 } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage#theme=default');
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.usage-panel').getByRole('button', { name: '详情', exact: true }).click();
  const dialog = page.getByRole('dialog', { name: '调用详情', exact: true });
  const history = dialog.getByRole('region', { name: '模型切换过程', exact: true });
  await history.getByRole('heading', { name: '模型切换过程 · 3 次尝试' }).waitFor();
  assert(await history.getByRole('row').count() === 4, 'Three attempts and one header must be rendered');
  assert(await history.getByText('未知', { exact: true }).count() >= 2, 'Missing attempt consumption must stay unknown');
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 1000 });
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'History must fit the viewport');
    await page.screenshot({ path: 'output/playwright/auto-model-history-' + width + '.png', animations: 'disabled' });
  }
  assert(!errors.length, errors.join('; '));
  return 'PASS: automatic model route history, unknown consumption and mobile layout';
}
