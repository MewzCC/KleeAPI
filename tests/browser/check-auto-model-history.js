async (page) => {
  page.setDefaultTimeout(5000);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  const base = { platform: 'trae', region: 'cn', account: '模拟账号', durationMs: 1200, inputTokens: null, outputTokens: null, totalTokens: null, credits: null };
  const routeAttempts = ['a', 'b', 'c'].map((model, index) => ({ ...base, model: 'trae/cn/' + model, status: index === 2 ? 'success' : 'failed', httpStatus: index === 2 ? 200 : 503, errorCode: index === 2 ? null : 'platform_chat_error', totalTokens: index === 2 ? 15 : null }));
  const model = 'auto/coding';
  const call = { ...base, id: 'auto-history', model, upstreamModel: 'c', startedAt: Date.now(), status: 'success', httpStatus: 200, errorCode: null, stream: false, attempts: 3, hasConversation: false, routeAttempts };
  const historical = { ...call, id: 'old-auto-history', routeAttempts: undefined };
  await page.route('**/api/gateway/usage', route => route.fulfill({ json: { records: [call, historical], limit: 2000 } }));
  await page.route('**/api/gateway/auto-models', route => route.fulfill({ json: { groups: [{ id: model, name: '编程助手', enabled: true, targets: routeAttempts.map(row => ({ model: row.model, enabled: true })) }], models: [], warning: '' } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage#theme=default');
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  await page.locator('.usage-panel').getByRole('button', { name: '详情', exact: true }).first().click();
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
  await page.keyboard.press('Escape');
  await dialog.waitFor({ state: 'hidden' });
  const usage = page.getByRole('dialog', { name: '模型组用量', exact: true });
  const checkBreakdown = async () => {
    await usage.getByText('2 次组请求 · 3 次已记录的模型尝试', { exact: true }).waitFor();
    await usage.getByText('其中 1 次组请求的尝试明细不完整。', { exact: true }).waitFor();
    const rows = usage.getByRole('list', { name: '实际模型用量' }).getByRole('listitem');
    assert(await rows.count() === 3, 'Each tried model must have its own usage row');
    assert(await rows.filter({ hasText: 'trae/cn/a' }).getByText('未上报', { exact: true }).count() === 2, 'Unreported consumption must remain unknown');
    await rows.filter({ hasText: 'trae/cn/c' }).getByText('15', { exact: false }).waitFor();
  };
  await page.getByRole('button', { name: '查看模型组用量', exact: true }).click();
  await checkBreakdown();
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Model usage must fit the mobile viewport');
  await page.keyboard.press('Escape');
  await usage.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 1440, height: 1000 });
  const chart = page.getByRole('img', { name: '按调用次数排名的前八个模型' });
  await chart.scrollIntoViewIfNeeded();
  const position = await chart.locator('canvas').evaluate(canvas => {
    const { width, height } = canvas.getBoundingClientRect();
    const x = Math.floor(width * .65);
    const pixels = canvas.getContext('2d').getImageData(Math.floor(x * canvas.width / width), 0, 1, canvas.height).data;
    for (let i = 0; i < pixels.length; i += 4) {
      if (pixels[i + 3] > 200 && pixels[i + 1] > pixels[i] + 25) return { x, y: (i / 4 + 3) * height / canvas.height };
    }
    throw Error('Could not find the mint model bar');
  });
  await chart.click({ position });
  await checkBreakdown();
  assert(await page.getByRole('dialog', { name: '模型调用量', exact: true }).count() === 0, 'Clicking a model group bar must only open the breakdown');
  await page.keyboard.press('Escape');
  await usage.waitFor({ state: 'hidden' });
  await page.getByRole('button', { name: '自动模型', exact: true }).click();
  await page.getByRole('button', { name: '查看用量', exact: true }).click();
  await checkBreakdown();
  assert(new URL(page.url()).searchParams.get('tab') === 'usage', 'The model card must open the breakdown in usage statistics');
  assert(!errors.length, errors.join('; '));
  return 'PASS: route history, model breakdown, chart drill-down, group card navigation and mobile layout';
}
