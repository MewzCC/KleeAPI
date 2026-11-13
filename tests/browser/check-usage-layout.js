async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.unrouteAll();
  const records = Array.from({ length: 24 }, (_, index) => ({
    id: 'layout-' + index, startedAt: Date.now() - (index % 7) * 86400000,
    model: ['Claude-Sonnet-4', 'GPT-5', 'Qoder-Auto'][index % 3],
    upstreamModel: 'demo', platform: ['trae', 'workbuddy', 'qoder'][index % 3],
    region: 'cn', account: '模拟开发账号', status: index % 11 ? 'success' : 'failed',
    httpStatus: index % 11 ? 200 : 502, errorCode: null, durationMs: 1200 + index * 137,
    stream: true, attempts: 1, inputTokens: 1200, outputTokens: 800, totalTokens: 2000,
    credits: index % 3 ? 0.75 : null, hasConversation: false,
  }));
  await page.route('**/api/gateway/usage', route => route.fulfill({ json: {
    records, limit: 2000, settings: { mode: 'stats', retentionDays: 30 }, storedConversations: 0,
  } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage#theme=default');
  await page.reload();
  const panel = page.locator('.usage-panel');
  await panel.locator('canvas').first().waitFor();
  for (const theme of ['default', 'klee']) {
    if (theme === 'klee') await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
    for (const width of [1440, 1024, 768, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      const geometry = await panel.evaluate(element => {
        const box = selector => element.querySelector(selector).getBoundingClientRect();
        return {
          overflow: document.documentElement.scrollWidth > innerWidth,
          stats: box('.usage-stats').top,
          charts: box('.usage-charts').top,
          records: box('.usage-records').top,
          privacy: box('.usage-privacy').top,
          columns: getComputedStyle(element.querySelector('.usage-stats')).gridTemplateColumns.split(' ').length,
          padding: getComputedStyle(element.querySelector('.el-card__body')).padding,
          background: getComputedStyle(element).backgroundColor,
        };
      });
      assert(!geometry.overflow, theme + ' must fit ' + width + 'px');
      assert(geometry.stats < geometry.charts && geometry.charts < geometry.records && geometry.records < geometry.privacy, 'Usage data must precede storage settings');
      assert(geometry.columns === (width === 390 ? 2 : 4), 'Metric columns must adapt to the viewport');
      assert(geometry.padding === '0px', 'Outer card must not add nested padding');
      assert(geometry.background === 'rgba(0, 0, 0, 0)', 'Outer card must keep the page background visible');
      if (width === 1440 || width === 390) {
        await page.screenshot({ path: 'output/playwright/usage-layout-' + theme + '-' + width + '.png', fullPage: true, animations: 'disabled' });
      }
      if (theme === 'default' && width === 1440) {
        await page.screenshot({ path: 'output/playwright/usage-preview.png', animations: 'disabled' });
      }
    }
  }
  await page.getByRole('textbox', { name: '搜索模型或账号', exact: true }).fill('no-matching-model');
  await page.getByText('当前筛选条件下没有记录。', { exact: true }).waitFor();
  assert(await panel.locator('.usage-privacy').isVisible(), 'Settings must remain available with no search results');
  await page.getByRole('textbox', { name: '搜索模型或账号', exact: true }).fill('Claude');
  await panel.getByRole('cell', { name: 'Claude-Sonnet-4', exact: true }).first().waitFor();
  assert(await panel.getByRole('cell', { name: 'GPT-5', exact: true }).count() === 0, 'Search must filter model rows');
  assert(!errors.length, errors.join('; '));
  return 'PASS: usage layout in two themes at four widths, data hierarchy, search and empty state';
}
