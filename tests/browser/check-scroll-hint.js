async (page) => {
  const assert = (condition, message) => { if (!condition) throw new Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  for (const theme of ['default', 'klee']) {
    await page.setViewportSize({ width: 1280, height: 600 });
    await page.goto('http://127.0.0.1:18887/admin/gateway?tab=overview#theme=' + theme);
    await page.reload();
    const hint = page.getByRole('button', { name: '向下滚动查看更多内容', exact: true });
    await hint.waitFor({ timeout: 5000 });
    const styles = await page.evaluate(() => ({
      main: getComputedStyle(document.documentElement).scrollbarWidth,
      sidebar: getComputedStyle(document.querySelector('.sidebar'), '::-webkit-scrollbar').width,
      animation: getComputedStyle(document.querySelector('.scroll-hint svg')).animationName,
    }));
    assert(styles.main === 'none', 'Hide the main scrollbar');
    assert(styles.sidebar === '5px', 'Preserve the sidebar scrollbar');
    assert(styles.animation === 'none', 'Reduced motion disables the hint animation');
    if (theme === 'klee') {
      const a = await hint.boundingBox(), b = await page.locator('.klee-companion summary').boundingBox();
      assert(a && b && a.y + a.height <= b.y, 'Hint must sit above the Klee companion');
    }
    await page.screenshot({ path: 'output/playwright/scroll-hint-' + theme + '.png' });
    await hint.click();
    await page.waitForFunction(() => window.scrollY > 0);
    await page.evaluate(() => window.scrollTo({ top: document.documentElement.scrollHeight, behavior: 'instant' }));
    await hint.waitFor({ state: 'hidden' });
    await page.evaluate(() => window.scrollTo({ top: 0, behavior: 'instant' }));
    await hint.waitFor();
    await page.getByRole('navigation', { name: '工作空间导航' }).getByRole('button', { name: '连接设置', exact: true }).click();
    await page.setViewportSize({ width: 1440, height: 1800 });
    await hint.waitFor({ state: 'hidden' });
    await page.evaluate(() => {
      const content = document.createElement('div');
      content.id = 'scroll-hint-resize-fixture';
      content.style.height = '2400px';
      document.querySelector('.page-content').append(content);
    });
    await hint.waitFor();
    await page.locator('#scroll-hint-resize-fixture').evaluate(e => e.remove());
    await hint.waitFor({ state: 'hidden' });
    await page.setViewportSize({ width: 390, height: 600 });
    await hint.waitFor();
    assert(await page.evaluate(() => document.documentElement.scrollWidth <= innerWidth), 'No mobile horizontal overflow');
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => { document.documentElement.dataset.kleeMotion = 'on'; });
  assert(await page.locator('.scroll-hint svg').evaluate(e => getComputedStyle(e).animationName) === 'scroll-hint-down', 'Animate when motion is enabled');
  await page.evaluate(() => { document.documentElement.dataset.kleeMotion = 'off'; });
  assert(await page.locator('.scroll-hint svg').evaluate(e => getComputedStyle(e).animationPlayState) === 'paused', 'Respect the existing pause-motion setting');
  assert(errors.length === 0, 'Browser errors: ' + errors.join('; '));
  return 'PASS: both themes, hidden main scrollbar, preserved sidebar, hint visibility at bottom and after route/resize/content changes, click-to-scroll, mobile layout, reduced/paused animation; zero runtime errors.';
}
