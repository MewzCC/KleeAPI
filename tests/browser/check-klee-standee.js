async (page) => {
  page.setDefaultTimeout(5000);
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [], writes = [];
  page.on('pageerror', error => errors.push(error.message));
  page.on('request', request => { if (['POST', 'PATCH', 'DELETE'].includes(request.method())) writes.push(request.url()); });
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=overview#theme=default');
  await page.evaluate(() => localStorage.removeItem('klee.standee.collapsed'));
  await page.reload();
  await page.locator('.workspace-top').waitFor();
  assert(await page.locator('.klee-standee').count() === 0, 'Standee belongs to the Klee theme');
  await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
  assert(await page.locator('.klee-standee').count() === 1, 'Klee theme must show the standee');
  assert(await page.locator('.standee-figure image').evaluate(node => node.getAttribute('href').includes('klee-splash')), 'Use the official Klee character artwork');
  const tap = page.getByRole('button', { name: '戳戳可莉，弹一下', exact: true });
  const bubble = page.locator('.standee-bubble');
  const checkFit = async () => {
    const toy = await page.locator('.klee-standee').boundingBox();
    assert(toy.x >= 0 && toy.y >= 0 && toy.x + toy.width <= page.viewportSize().width && toy.y + toy.height <= page.viewportSize().height, 'Standee must fit the viewport');
    const hint = page.getByRole('button', { name: '向下滚动查看更多内容', exact: true });
    if (await hint.isVisible()) {
      const a = await hint.boundingBox();
      assert(a.x + a.width <= toy.x || a.y + a.height <= toy.y, 'Scroll hint must not overlap the standee');
    }
    assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Standee must not cause horizontal overflow');
  };
  for (const width of [1440, 390]) {
    await page.setViewportSize({ width, height: 900 });
    await checkFit();
    await tap.click();
    await bubble.waitFor({ state: 'visible' });
    const first = await bubble.textContent();
    await tap.focus();
    await page.keyboard.press('Space');
    assert(await bubble.textContent() !== first, 'Keyboard activation must change the message too');
    assert(await page.locator('.standee-action').evaluate(node => getComputedStyle(node).animationName) === 'none', 'Reduced motion must suppress bouncing');
    await tap.evaluate(button => button.blur());
    await page.mouse.move(0, 0);
    await page.screenshot({ path: 'output/playwright/klee-standee-' + width + '.png', animations: 'disabled' });
    if (width === 1440) await page.screenshot({ path: 'output/playwright/klee-official-standee-preview.png', clip: { x: width - 230, y: 550, width: 230, height: 350 }, animations: 'disabled' });
  }
  await page.emulateMedia({ reducedMotion: 'no-preference' });
  await page.evaluate(() => document.documentElement.dataset.kleeMotion = 'on');
  await tap.click();
  assert(await page.locator('.standee-action').evaluate(node => getComputedStyle(node).animationName.includes('standee-bounce')), 'Tap must start the spring bounce');
  await page.waitForTimeout(230);
  const transform = await page.locator('.standee-action').evaluate(node => getComputedStyle(node).transform);
  assert(transform !== 'none' && transform !== 'matrix(1, 0, 0, 1, 0, 0)', 'The figure must actually lift and tilt');
  await tap.click({ clickCount: 3, delay: 60 });
  await bubble.waitFor({ state: 'visible' });
  await page.evaluate(() => document.documentElement.dataset.kleeMotion = 'off');
  await tap.click();
  assert(await page.locator('.standee-action').evaluate(node => getComputedStyle(node).animationName) === 'none', 'Existing motion preference must be respected');
  await page.getByRole('button', { name: '收起可莉立牌', exact: true }).click();
  assert(!await tap.isVisible(), 'Collapse must tuck the standee away');
  await page.reload();
  await page.getByRole('button', { name: '展开可莉立牌', exact: true }).waitFor();
  await page.getByRole('button', { name: '展开可莉立牌', exact: true }).click();
  await tap.waitFor();
  await checkFit();
  await tap.click();
  await bubble.waitFor({ state: 'hidden', timeout: 4000 });
  await page.getByRole('button', { name: '可莉主题已开启', exact: true }).click();
  assert(await page.locator('.klee-standee').count() === 0, 'Theme-off must remove the standee');
  assert(!writes.length, 'Playing must not write to any API');
  assert(!errors.length, errors.join('; '));
  return 'PASS: local standee, click/keyboard bounce, repeat taps, collapse persistence, mobile fit, motion preferences, theme switching';
}
