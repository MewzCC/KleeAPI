async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:18887/admin/gateway');
  await page.evaluate(() => localStorage.removeItem('klee.sidebar.collapsed'));
  for (const theme of ['default', 'klee']) {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.goto('http://127.0.0.1:18887/admin/gateway?tab=overview#theme=' + theme);
    const nav = page.getByRole('navigation', { name: '工作空间导航' });
    const sidebar = page.locator('.sidebar');
    await page.getByRole('button', { name: '折叠导航栏', exact: true }).waitFor();
    const expandedMain = await page.locator('.workspace-main').boundingBox();
    await page.getByRole('button', { name: '折叠导航栏', exact: true }).click();
    const expand = page.getByRole('button', { name: '展开导航栏', exact: true });
    assert(await expand.getAttribute('aria-expanded') === 'false', 'Collapsed state must be accessible');
    assert(Math.round((await sidebar.boundingBox()).width) === 76, 'Desktop must collapse to an icon rail');
    assert((await page.locator('.workspace-main').boundingBox()).width > expandedMain.width, 'Main content must use the released space');
    assert(await nav.getByRole('button', { name: '签到中心', exact: true }).getAttribute('title') === '签到中心', 'Collapsed buttons need readable tooltips');
    await nav.getByRole('button', { name: '签到中心', exact: true }).click();
    await page.getByRole('heading', { name: '签到中心', exact: true }).waitFor();
    assert(await nav.getByRole('button', { name: '签到中心', exact: true }).getAttribute('aria-current') === 'page', 'Navigation must still work when collapsed');
    const platformLabels = await sidebar.locator('.platform-switcher a').allTextContents();
    assert(platformLabels.length === 4, 'Keep all platform entries');
    await page.reload();
    await page.getByRole('button', { name: '展开导航栏', exact: true }).waitFor();
    assert(Math.round((await sidebar.boundingBox()).width) === 76, 'Remember collapsed state after reload');
    await page.screenshot({ path: 'output/playwright/sidebar-' + theme + '-collapsed.png' });
    await page.getByRole('button', { name: '展开导航栏', exact: true }).focus();
    await page.keyboard.press('Enter');
    assert(Math.round((await sidebar.boundingBox()).width) === 228, 'Keyboard must expand the sidebar');
    await page.screenshot({ path: 'output/playwright/sidebar-' + theme + '-expanded.png' });
    await page.setViewportSize({ width: 390, height: 844 });
    await page.getByRole('button', { name: '折叠导航栏', exact: true }).click();
    assert(!await nav.isVisible(), 'Mobile collapse must hide the navigation');
    assert(await page.getByRole('button', { name: '展开导航栏', exact: true }).isVisible(), 'Mobile must retain the expand button');
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Collapsed mobile view must not overflow');
    await page.screenshot({ path: 'output/playwright/sidebar-' + theme + '-mobile.png' });
    await page.getByRole('button', { name: '展开导航栏', exact: true }).click();
    assert(await nav.isVisible(), 'Mobile expand must restore navigation');
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Expanded mobile view must not overflow');
  }
  return 'PASS: sidebar toggle, icon navigation, content width, keyboard, persistence, both themes and mobile layouts.';
}
