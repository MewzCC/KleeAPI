async (page) => {
  const platforms = ['workbuddy', 'trae', 'qoder'];
  const ports = { workbuddy: 18791, trae: 17864, qoder: 17865 };
  let remaining = 75, failed = false, posts = 0;
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', req => { if (req.method() === 'POST') posts++; });
  for (const platform of platforms) {
    const summary = { uid: 'balance-demo', nickname: '余额测试', enabled: true, active: true, status: 'ready', region: 'cn', credits: 999 };
    await page.context().route(`http://127.0.0.1:${ports[platform]}/api/accounts`, route => route.fulfill({ json: { accounts: [summary] } }));
    await page.context().route(`http://127.0.0.1:${ports[platform]}/api/monitor`, route => route.fulfill({ json: { accounts: [{ ...summary, remaining: failed ? null : remaining, limit: failed ? null : 100, used: failed ? null : 100 - remaining, unit: 'credits', unlimited: false, quotaError: failed ? 'offline' : null }], fetchedAt: Date.now() } }));
  }
  for (const platform of platforms) {
    remaining = 75; failed = false;
    await page.goto(`http://127.0.0.1:${ports[platform]}/admin/${platform}?tab=accounts#theme=default`);
    const progress = () => page.getByRole('progressbar', { name: '余额进度', exact: true }).first();
    await progress().waitFor({ timeout: 5000 });
    await page.waitForFunction(() => document.querySelector('[aria-label="余额进度"]')?.getAttribute('aria-valuenow') === '75');
    await page.locator('.account-row .balance-progress-value').getByText('75', { exact: true }).waitFor();
    if (!(await page.locator('.account-row .balance-progress').getAttribute('title')).includes('总额度 100')) throw Error(platform + ': total quota was lost');
    remaining = 25;
    await page.getByRole('button', { name: '刷新账号', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="余额进度"]')?.getAttribute('aria-valuenow') === '25');
    await page.getByRole('button', { name: '工作台', exact: true }).click();
    await page.locator('.overview-account .balance-progress-track[aria-valuenow="25"]').waitFor();
    await page.getByRole('button', { name: '额度监控', exact: true }).click();
    await page.locator('.result-card .balance-progress-track[aria-valuenow="25"]').waitFor();
    failed = true;
    await page.getByRole('button', { name: '刷新额度', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.result-card .balance-progress')?.title.includes('额度查询失败'));
    if (await progress().getAttribute('aria-valuenow') !== null) throw Error(platform + ': failed quota kept a percentage');
    await page.getByRole('button', { name: '账号管理', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('.account-row .balance-progress')?.title.includes('额度查询失败'));
    if (await progress().getAttribute('aria-valuenow') !== null) throw Error(platform + ': account list kept stale quota');
    failed = false;
    await page.getByRole('button', { name: '刷新账号', exact: true }).click();
    await page.waitForFunction(() => document.querySelector('[aria-label="余额进度"]')?.getAttribute('aria-valuenow') === '25');
    await page.setViewportSize({ width: 390, height: 844 });
    if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error(platform + ': mobile overflow');
    await page.locator('.account-row').screenshot({ path: `output/playwright/balance-${platform}-accounts.png` });
    await page.setViewportSize({ width: 1440, height: 1000 });
  }
  if (posts) throw Error('Balance display issued a mutation request');
  if (errors.length) throw Error(errors.join('\n'));
  return 'PASS: all three platforms show real balance ratios in accounts, overview and quota, refresh correctly, clear failed quota and fit mobile.';
}
