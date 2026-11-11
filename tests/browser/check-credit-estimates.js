async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  let posts = 0;
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (request.method() === 'POST') posts++; });
  const base = { startedAt: Date.now(), upstreamModel: 'demo', platform: 'trae', region: 'cn', account: '模拟账号', status: 'success', httpStatus: 200, errorCode: null, durationMs: 2000, stream: true, attempts: 1, inputTokens: 100, outputTokens: 20, totalTokens: 120 };
  const estimated = amount => ({ credits: null, estimatedCredits: amount, creditEstimate: { amount, balanceBefore: 100, balanceAfter: 100 - amount, unit: '积分', measuredAt: Date.now() } });
  const records = [
    { id: 'missing', model: 'unknown-credit', credits: null },
    { id: 'zero', model: 'reported-zero', credits: 0 },
    { id: 'known', model: 'reported-credit', credits: 1.25 },
    { id: 'estimate-zero', model: 'estimated-zero', ...estimated(0) },
    { id: 'estimate', model: 'estimated-credit', ...estimated(2.5) },
    { id: 'priority', model: 'reported-priority', ...estimated(7), credits: 4 },
  ].map(row => ({ ...base, ...row }));
  await page.context().route('**/api/gateway/usage', route => route.fulfill({ json: { records, limit: 2000, warning: '' } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage#theme=default');
  const panel = page.locator('.usage-panel');
  await panel.getByText('覆盖 3 / 6 次调用', { exact: true }).waitFor();
  await panel.getByText('覆盖 2 / 6 次调用', { exact: true }).waitFor();
  assert(await panel.locator('.usage-credits').first().innerText().then(text => text.includes('5.25')), 'Reported sum excludes estimates and keeps explicit zero');
  assert(await panel.locator('.usage-credits').nth(1).innerText().then(text => text.includes('2.5（估算）')), 'Estimated sum is separate and excludes reported-priority rows');
  await panel.getByText('暂无数据', { exact: true }).waitFor();
  await panel.getByText('0（估算）', { exact: true }).waitFor();
  const estimateRow = panel.getByRole('row').filter({ hasText: 'estimated-credit' });
  await estimateRow.getByText('2.5（估算）', { exact: true }).waitFor();
  await estimateRow.getByRole('button', { name: '详情', exact: true }).click();
  await page.getByText('100 → 97.5 积分', { exact: true }).waitFor();
  await page.getByText(/估算为 0 不代表免费/).waitFor();
  await page.screenshot({ path: 'output/playwright/credit-estimate-detail.png', animations: 'disabled' });
  await page.keyboard.press('Escape');
  await page.getByRole('dialog').waitFor({ state: 'hidden' });
  await page.locator('.usage-metric').click();
  await page.getByRole('option', { name: '积分消耗', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/credit-estimate-trend.png', animations: 'disabled' });
  await page.setViewportSize({ width: 390, height: 844 });
  for (const theme of ['default', 'klee']) {
    if (theme === 'klee') await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Estimate UI must not overflow mobile layout');
    await page.screenshot({ path: 'output/playwright/credit-estimate-mobile-' + theme + '.png' });
  }
  assert(posts === 0, 'Viewing estimates cannot issue mutation requests');
  assert(!errors.length, errors.join('; '));
  return 'PASS: separate reported/estimated totals, official priority and zero, unknown historical rows, auditable snapshots, warnings and mobile themes.';
}
