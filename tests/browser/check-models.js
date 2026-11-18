async (page) => {
  page.setDefaultTimeout(5000);
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  const models = Array.from({ length: 25 }, (_, i) => ({ id: 'demo/model-' + String(i + 1).padStart(2, '0'), name: 'Demo Model ' + (i + 1), availableAccounts: i === 24 ? 0 : 2, canonicalIds: [i === 23 ? 'canonical-needle' : 'original-' + (i + 1)] }));
  let current = models;
  await page.context().route('**/api/gateway/status*', route => route.fulfill({ json: { accounts: [], platforms: [], models: current, fetchedAt: Date.now() } }));
  await page.context().route('**/v1/models*', route => route.fulfill({ json: { data: current, source: 'account', fetchedAt: Date.now() } }));
  await page.context().route('**/api/accounts', route => route.fulfill({ json: { accounts: [] } }));
  await page.context().addInitScript(() => {
    sessionStorage.setItem('klee.gateway', 'klee-model-filter-test');
    sessionStorage.setItem('klee.qoder', 'klee-model-filter-test');
    Object.defineProperty(navigator, 'clipboard', { configurable: true, value: { writeText: async text => { window.__copiedModel = text; } } });
  });
  const rows = () => page.locator('.model-table .el-table__body-wrapper tbody tr');
  const search = () => page.getByRole('textbox', { name: '搜索模型' });
  const pageNumber = n => page.locator('.model-pagination .el-pager .number').filter({ hasText: new RegExp('^\\s*' + n + '\\s*$') });
  for (const [platform, port] of [['gateway', 18887], ['qoder', 17865]]) {
    current = models;
    await page.setViewportSize({ width: 1440, height: 1000 });
    await page.goto('http://127.0.0.1:' + port + '/admin/' + platform + '?tab=models#theme=default');
    await page.reload();
    await page.locator('.model-table').waitFor({ timeout: 5000 });
    await rows().filter({ hasText: 'demo/model-01' }).waitFor();
    assert(await rows().count() === 10, platform + ': render only the first 10 models');
    await pageNumber(3).click();
    await rows().filter({ hasText: 'demo/model-24' }).waitFor();
    assert(await rows().count() === 4, platform + ': last page contains four available models');
    assert(await rows().filter({ hasText: 'demo/model-25' }).count() === 0, 'Unavailable models are hidden');
    await search().fill('demo/model-25');
    await page.getByText('没有可展示的模型，请刷新目录或检查搜索条件。', { exact: true }).waitFor();
    await search().fill('canonical-needle');
    await page.waitForFunction(() => document.querySelectorAll('.model-table .el-table__body-wrapper tbody tr').length === 1);
    assert((await rows().innerText()).includes('demo/model-24'), 'Canonical ID search must cover every page');
    assert(await pageNumber(1).getAttribute('aria-current') === 'true', 'Search returns to page 1');
    await rows().getByRole('button', { name: '复制 ID', exact: true }).click();
    assert(await page.evaluate(() => window.__copiedModel) === 'demo/model-24', 'Copy preserves the complete ID');
    await rows().getByRole('button', { name: '用于 API 示例 →', exact: true }).click();
    await page.getByRole('heading', { name: 'API 接入指南' }).waitFor();
    assert((await page.locator('pre').first().innerText()).includes('demo/model-24'), 'Selected row carries its ID to API examples');
    await page.getByRole('button', { name: '模型目录', exact: true }).click();
    await search().fill('no-such-model');
    await page.getByText('没有可展示的模型，请刷新目录或检查搜索条件。', { exact: true }).waitFor();
    assert(await rows().count() === 0, 'Empty search renders no model rows');
    await search().fill('');
    await pageNumber(3).click();
    current = models.slice(0, 2);
    await page.getByRole('button', { name: '刷新模型', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.model-table .el-table__body-wrapper tbody tr').length === 2);
    assert(await pageNumber(1).getAttribute('aria-current') === 'true', 'Refresh clamps a page that no longer exists');
    current = models;
    await page.getByRole('button', { name: '刷新模型', exact: true }).click();
    await rows().filter({ hasText: 'demo/model-01' }).waitFor();
    await page.locator('.model-pagination .el-select').click();
    await page.getByRole('option', { name: '20条/页', exact: true }).click();
    await page.waitForFunction(() => document.querySelectorAll('.model-table .el-table__body-wrapper tbody tr').length === 20);
    await page.screenshot({ path: 'output/playwright/models-' + platform + '-desktop.png', fullPage: true });
    await page.setViewportSize({ width: 390, height: 844 });
    for (const theme of ['default', 'klee']) {
      if (theme === 'klee') await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
      await page.waitForFunction(() => document.documentElement.scrollWidth <= innerWidth);
      await page.screenshot({ path: 'output/playwright/models-' + platform + '-mobile-' + theme + '.png', fullPage: true });
    }
  }
  assert(errors.length === 0, 'Browser runtime errors: ' + errors.join('; '));
  return 'PASS: unavailable-model filtering, gateway and platform table pagination, cross-page search, empty state, refresh clamp, page size, copy/example actions, both mobile themes; zero runtime errors.';
}
