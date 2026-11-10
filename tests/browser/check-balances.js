async (page) => {
  const accounts = [
    { uid: 'wb-cn', platform: 'workbuddy', nickname: '示例 WorkBuddy 国内', unit: 'credits', remaining: 1158, limit: 1200, used: 42 },
    { uid: 'wb-global', platform: 'workbuddy', nickname: '示例 WorkBuddy 国际', unit: 'credits', remaining: 100, limit: 100, used: 0 },
    { uid: 'trae', platform: 'trae', nickname: '示例 Trae 余额', unit: '积分', remaining: 2799.5476, limit: 3000, used: 200.4524 },
    { uid: 'qoder', platform: 'qoder', nickname: '示例 Qoder 余额', unit: 'Qoder CN Credits', remaining: 600, limit: 600, used: 0 },
    { uid: 'low', platform: 'qoder', nickname: '示例低余额', unit: 'Qoder Global Credits', remaining: 5, limit: 100, used: 95 },
    { uid: 'unknown', platform: 'trae', nickname: '示例总额未知', unit: '积分', remaining: 150, limit: null },
    { uid: 'unlimited', platform: 'workbuddy', nickname: '示例不限额度', unit: 'credits', unlimited: true },
    { uid: 'error', platform: 'qoder', nickname: '示例查询失败', unit: 'Qoder CN Credits', quotaError: 'offline' },
  ];
  let posts = 0;
  page.on('request', req => { if (req.method() === 'POST') posts++; });
  await page.context().route('http://127.0.0.1:18887/api/gateway/status*', route => route.fulfill({ json: { accounts: accounts.map(a => ({ region: 'cn', enabled: true, status: 'ready', models: ['demo'], ...a })), models: [], platforms: [], fetchedAt: Date.now() } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=pool#theme=default');
  const row = name => page.locator('.account-row').filter({ has: page.getByRole('heading', { name: new RegExp('^' + name) }) });
  const trae = row('示例 Trae 余额');
  const progress = trae.getByRole('progressbar', { name: '余额进度', exact: true });
  await progress.waitFor();
  if (await progress.getAttribute('aria-valuenow') !== '93.3') throw Error('Balance must use the real 2799.5476 / 3000 ratio');
  await trae.getByText('2,799.5476', { exact: true }).waitFor();
  const compact = await trae.locator('.balance-progress').evaluate(el => ({ height: el.getBoundingClientRect().height, title: el.title, font: parseFloat(getComputedStyle(el.querySelector('strong')).fontSize), track: el.querySelector('.balance-progress-track').getBoundingClientRect().height }));
  if (compact.height > 25 || compact.font > 14 || compact.track > 5) throw Error('Balance should remain a compact text row with a thin progress bar');
  if (!compact.title.includes('总额度 3,000')) throw Error('Quota details should remain available on hover');
  await page.waitForFunction(() => Number(getComputedStyle([...document.querySelectorAll('.account-row')].find(e => e.textContent.includes('示例 Trae 余额')).querySelector('.balance-progress-fill')).transform.match(/matrix\(([^,]+)/)?.[1]) > .93);
  const flow = () => trae.locator('.balance-progress-fill').evaluate(el => ({ animation: getComputedStyle(el, '::after').animationName, duration: getComputedStyle(el).transitionDuration }));
  if ((await flow()).animation === 'none') throw Error('Credit balance must have flowing animation');
  if (await row('示例总额未知').getByRole('progressbar').getAttribute('aria-valuenow') !== null) throw Error('Unknown total cannot invent a percentage');
  if (!await row('示例总额未知').locator('.balance-progress').getAttribute('title').then(s => s.includes('平台未提供总额度'))) throw Error('Unknown total needs an explanation');
  await row('示例不限额度').getByText('不限额度', { exact: true }).waitFor();
  if (!await row('示例查询失败').locator('.balance-progress').getAttribute('title').then(s => s.includes('额度查询失败'))) throw Error('Failed quota needs an explanation');
  if (!await row('示例低余额').locator('.balance-progress.low').count()) throw Error('Low balance should be visually highlighted');
  await trae.screenshot({ path: 'output/playwright/balance-trae-dark.png' });
  accounts[0].remaining = 800; accounts[0].used = 400;
  await page.getByRole('button', { name: '刷新号池', exact: true }).click();
  await page.waitForFunction(() => document.querySelector('.account-row .balance-progress-track')?.getAttribute('aria-valuenow') === '66.7');
  await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
  await page.setViewportSize({ width: 390, height: 844 });
  if (await page.evaluate(() => document.documentElement.scrollWidth > innerWidth)) throw Error('Mobile balance must not overflow');
  await trae.screenshot({ path: 'output/playwright/balance-trae-klee.png' });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  if ((await flow()).animation !== 'none' || (await flow()).duration !== '0s') throw Error('Reduced motion must stop balance animations');
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.documentElement.dataset.kleeMotion = 'off'; });
  if ((await flow()).animation !== 'none' || (await flow()).duration !== '0s') throw Error('Motion pause must stop balance animations');
  await page.evaluate(() => { document.documentElement.dataset.kleeMotion = 'on'; });
  if (posts) throw Error('Balance rendering must not issue mutation requests');
  return 'PASS: real credit ratios, fill/shine animation, refresh transition, unknown/unlimited/error states, low balance, mobile themes and motion preferences.';
}
