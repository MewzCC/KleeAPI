async (page) => {
  page.setDefaultTimeout(7000);
  const assert = (condition, message) => { if (!condition) throw Error(message) };
  const errors = [], mutations = [];
  page.on('pageerror', error => errors.push(error.message));
  let settings = { mode: 'stats', retentionDays: 0 };
  let rejectDelete = true;
  let records = ['first', 'second'].map(id => ({
    id, startedAt: Date.now(), model: id + '-private', upstreamModel: 'demo', platform: 'trae',
    region: 'cn', account: '模拟账号', status: 'success', httpStatus: 200, errorCode: null,
    durationMs: 10, stream: false, attempts: 1, inputTokens: 1, outputTokens: 1, totalTokens: 2,
    credits: null, hasConversation: true,
  }));
  const conversation = { request: [{ role: 'user', content: '测试问题' }], response: [], complete: true, truncated: false };
  await page.route('**/api/gateway/usage**', route => {
    const request = route.request(), method = request.method(), path = new URL(request.url()).pathname;
    if (method === 'PATCH') {
      mutations.push(method);
      assert(path.endsWith('/settings'), 'Save settings at the authenticated settings endpoint');
      settings = request.postDataJSON();
    } else if (method === 'DELETE') {
      mutations.push(method + ' ' + path);
      if (rejectDelete && path.endsWith('/first')) return route.fulfill({ status: 500, json: { error: { message: '删除失败，请重试。' } } });
      records = path.endsWith('/usage') ? [] : records.filter(record => !path.endsWith('/' + record.id));
    } else if (!path.endsWith('/usage')) {
      return route.fulfill({ json: { record: records.find(record => path.endsWith('/' + record.id)), conversation, warning: '' } });
    }
    return route.fulfill({ json: { records, settings, storedConversations: records.length, limit: 2000, warning: '' } });
  });
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage');
  const privacy = page.getByRole('region', { name: '记录与隐私' });
  await privacy.getByText('只记统计', { exact: true }).waitFor({ timeout: 5000 });
  await privacy.getByText('保存原文', { exact: true }).click();
  assert(await privacy.getByRole('radio', { name: '保存原文', exact: true }).isChecked(), 'Select the visible original-text control');
  await privacy.getByRole('combobox', { name: '保留期限' }).press('ArrowDown');
  await page.getByRole('option', { name: '7 天', exact: true }).click();
  await privacy.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '取消', exact: true }).click();
  assert(!mutations.length, 'Canceling a shorter retention must not change settings');
  await privacy.getByRole('button', { name: '保存设置' }).click();
  await page.getByRole('button', { name: '确认保存', exact: true }).click();
  await page.getByText('记录设置已保存。', { exact: true }).waitFor();
  assert(settings.mode === 'content' && settings.retentionDays === 7, 'Both settings must be saved');
  const firstRow = page.getByRole('row').filter({ hasText: 'first-private' });
  await firstRow.getByRole('button', { name: '详情', exact: true }).click();
  const detail = page.getByRole('dialog', { name: '调用详情' });
  await detail.getByText('测试问题', { exact: true }).waitFor();
  await detail.getByRole('button', { name: '删除此条记录' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await page.getByText('删除失败，请重试。', { exact: true }).waitFor();
  assert(await firstRow.count() === 1, 'Failed deletion must keep the record');
  rejectDelete = false;
  await detail.getByRole('button', { name: '删除此条记录' }).click();
  await page.getByRole('button', { name: '确认删除', exact: true }).click();
  await detail.waitFor({ state: 'hidden' });
  await firstRow.waitFor({ state: 'hidden' });
  await page.setViewportSize({ width: 390, height: 844 });
  assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'Privacy panel must fit mobile screens');
  await privacy.getByRole('button', { name: '清空全部记录' }).click();
  await page.getByRole('button', { name: '确认清空', exact: true }).click();
  await page.getByText('暂无调用记录。通过统一网关发起调用后可在这里查看。', { exact: true }).waitFor();
  assert(records.length === 0 && settings.mode === 'content', 'Clearing records must keep the selected settings');
  assert(!errors.length, errors.join('; '));
  return 'PASS: storage settings, retention confirmation, delete failure and retry, clear all and mobile layout';
}
