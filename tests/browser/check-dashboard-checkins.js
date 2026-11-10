async (page) => {
  const records = [
    { uid: 'same', platform: 'workbuddy', nickname: '示例国内账号', status: 'already', checkedIn: true },
    { uid: 'global', platform: 'workbuddy', nickname: '示例国际账号', status: 'no_activity', checkedIn: false },
    { uid: 'same', platform: 'trae', nickname: '示例 Trae 账号', status: 'already', checkedIn: true },
    { uid: 'cn', platform: 'qoder', nickname: '示例 Qoder 国内', status: 'already', checkedIn: true },
    { uid: 'global', platform: 'qoder', nickname: '示例 Qoder 国际', status: 'already', checkedIn: true },
  ];
  let reads = 0, posts = 0, fail = false;
  await page.context().route('http://127.0.0.1:18887/api/gateway/status*', route => route.fulfill({ json: { accounts: records.map(a => ({ ...a, enabled: true, remaining: 10, models: ['demo'] })), models: [], platforms: [], fetchedAt: Date.now() } }));
  await page.context().route('http://127.0.0.1:18887/api/checkin', route => {
    if (route.request().method() === 'POST') {
      posts++;
      records[4].status = 'claimed'; records[4].checkedIn = true;
    } else reads++;
    return route.fulfill(fail ? { status: 503, json: { error: { message: '模拟读取失败' } } } : { json: { accounts: records, fetchedAt: Date.now(), platforms: [] } });
  });
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=overview#theme=default');
  await page.getByRole('button', { name: '今日签到：4/5', exact: true }).waitFor();
  if (!reads || posts) throw Error('Overview must query status automatically without claiming');
  await page.getByText('已签到 / 总账号 · 1 个无活动', { exact: true }).waitFor();
  await page.getByRole('button', { name: '签到中心', exact: true }).click();
  records[4].status = 'available'; records[4].checkedIn = false;
  await page.getByRole('button', { name: '刷新状态', exact: true }).click();
  await page.getByRole('heading', { name: '示例 Qoder 国际', exact: true }).locator('..').locator('..').getByText('未签到', { exact: true }).waitFor();
  await page.getByRole('button', { name: '全部账号签到', exact: true }).click();
  await page.getByRole('heading', { name: '示例 Qoder 国际', exact: true }).locator('..').locator('..').getByText('签到成功', { exact: true }).waitFor();
  await page.getByRole('button', { name: '工作台', exact: true }).click();
  await page.getByRole('button', { name: '今日签到：4/5', exact: true }).waitFor();
  if (posts !== 1) throw Error('Only explicit bulk click should submit a claim');
  fail = true;
  await page.getByRole('button', { name: '刷新数据', exact: true }).click();
  await page.getByText(/刷新失败，显示上次结果/).waitFor();
  await page.getByRole('button', { name: '今日签到：4/5', exact: true }).waitFor();
  return 'PASS: automatic 4/5 dashboard, no-activity denominator, same UID isolation, post-claim update and failed-refresh snapshot.';
}
