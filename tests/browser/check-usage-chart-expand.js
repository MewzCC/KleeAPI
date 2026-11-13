async (page) => {
  page.setDefaultTimeout(5000);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [], writes = [];
  await page.emulateMedia({ reducedMotion: 'reduce' });
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url()); });
  await page.unrouteAll();
  const records = Array.from({ length: 120 }, (_, index) => ({
    id: 'expand-' + index, startedAt: Date.now() - index % 7 * 86400000,
    model: 'workbuddy/cn/long-model-name-for-expanded-chart-' + index % 20,
    upstreamModel: 'demo', platform: 'workbuddy', region: 'cn', account: '模拟账号',
    status: index % 5 ? 'success' : 'failed', httpStatus: 200, errorCode: null,
    durationMs: 1500, stream: false, attempts: 1, inputTokens: 100, outputTokens: 50,
    totalTokens: 150, credits: 1, hasConversation: false,
  }));
  await page.route('**/api/gateway/usage', route => route.fulfill({ json: { records, limit: 2000 } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage#theme=default');
  await page.reload();
  await page.setViewportSize({ width: 1440, height: 1000 });
  const panel = page.locator('.usage-panel');
  await panel.getByRole('button', { name: '放大查看每日趋势', exact: true }).click();
  const trend = page.getByRole('dialog', { name: '每日趋势', exact: true });
  await trend.locator('canvas').waitFor();
  assert((await trend.boundingBox()).width > 1000, 'Expanded view must use available desktop width');
  await trend.getByRole('combobox', { name: '图表类型' }).press('ArrowDown');
  await page.getByRole('option', { name: '折线图', exact: true }).click();
  await trend.getByText('显示数值', { exact: true }).click();
  await trend.getByText('堆叠显示', { exact: true }).click();
  await trend.getByRole('combobox', { name: '放大趋势指标' }).press('ArrowDown');
  await page.getByRole('option', { name: 'Token', exact: true }).click();
  await page.screenshot({ path: 'output/playwright/usage-trend-expanded.png', animations: 'disabled' });
  await trend.getByRole('button', { name: '重置图表样式' }).click();
  assert(!await trend.getByRole('checkbox', { name: '显示数值' }).isChecked(), 'Reset must restore display options');
  await page.keyboard.press('Escape');
  await trend.waitFor({ state: 'hidden' });
  await panel.getByRole('button', { name: '点击放大查看模型调用量', exact: true }).focus();
  await page.keyboard.press('Enter');
  const models = page.getByRole('dialog', { name: '模型调用量', exact: true });
  await models.locator('canvas').waitFor();
  await models.getByRole('combobox', { name: '排名数量' }).press('ArrowDown');
  await page.getByRole('option', { name: '前 20 个', exact: true }).click();
  assert(await models.getByRole('listitem').count() === 20, 'Expanded ranking must expose full model names for all selected rows');
  await models.getByText('显示数值', { exact: true }).click();
  for (const theme of ['default', 'klee']) {
    if (theme === 'klee') {
      await page.keyboard.press('Escape');
      await models.waitFor({ state: 'hidden' });
      await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
      await panel.getByRole('button', { name: '点击放大查看模型调用量', exact: true }).click();
    }
    for (const width of [1440, 390]) {
      await page.setViewportSize({ width, height: 1000 });
      assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Expanded dialog must fit the viewport');
      const canvas = await models.locator('canvas').boundingBox();
      assert(canvas.width >= 680, 'Mobile expanded charts must scroll horizontally rather than squeeze names');
      const bounds = await models.boundingBox();
      assert(bounds.y + bounds.height <= 1000, 'Tall rankings must scroll inside the dialog');
      await page.screenshot({ path: 'output/playwright/usage-models-expanded-' + theme + '-' + width + '.png', animations: 'disabled' });
    }
  }
  await models.getByRole('combobox', { name: '放大调用状态' }).press('ArrowDown');
  await page.getByRole('option', { name: '已取消', exact: true }).click();
  await models.getByText('当前筛选条件下没有记录。', { exact: true }).waitFor();
  assert(!writes.length, 'Chart customization must not change stored records or settings');
  assert(!errors.length, errors.join('; '));
  return 'PASS: chart enlargement, keyboard access, chart styles, rank limits, empty state, two themes and mobile overflow';
}
