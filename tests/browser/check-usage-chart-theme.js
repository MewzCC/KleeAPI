async (page) => {
  const assert = (condition, message) => { if (!condition) throw Error(message); };
  const errors = [];
  page.on('pageerror', error => errors.push(error.message));
  await page.emulateMedia({ reducedMotion: 'reduce' });
  await page.unrouteAll();
  const records = Array.from({ length: 60 }, (_, index) => ({
    id: 'chart-' + index, startedAt: Date.now() - (index % 14) * 86400000,
    model: ['Claude-Sonnet-4', 'GPT-5', 'Qoder-Auto', 'workbuddy/cn/deepseek-v3.2-long-name', 'Gemini-3-Pro'][index % 5],
    upstreamModel: 'demo', platform: ['trae', 'workbuddy', 'qoder'][index % 3],
    region: 'cn', account: '模拟开发账号', status: index % 9 ? 'success' : index % 2 ? 'failed' : 'canceled',
    httpStatus: index % 9 ? 200 : 502, errorCode: null, durationMs: 1200 + index * 137,
    stream: true, attempts: 1, inputTokens: 1200, outputTokens: 800, totalTokens: 2000,
    credits: index % 3 ? 0.75 : null, hasConversation: false,
  }));
  await page.route('**/api/gateway/usage', route => route.fulfill({ json: {
    records, limit: 2000, settings: { mode: 'stats', retentionDays: 30 }, storedConversations: 0,
  } }));
  await page.goto('http://127.0.0.1:18887/admin/gateway?tab=usage#theme=default');
  await page.reload();
  const panel = page.locator('.usage-panel');
  await page.setViewportSize({ width: 1440, height: 1000 });
  await panel.locator('canvas').first().waitFor();
  await page.waitForTimeout(400);

  /** 读取画布主导色、纸张像素与亮度，用于证明配色确实随主题切换。 */
  const tone = scope => scope.evaluate(root => [...root.querySelectorAll('.usage-chart canvas')].map(canvas => {
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    const buckets = new Map();
    let ink = 0, paper = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      ink++;
      if (data[i] > 244 && data[i + 1] > 240 && data[i + 2] > 235) paper++;
      const key = [data[i] >> 4, data[i + 1] >> 4, data[i + 2] >> 4].join('-');
      buckets.set(key, (buckets.get(key) ?? 0) + 1);
    }
    const [key] = [...buckets].sort((a, b) => b[1] - a[1])[0];
    const [r, g, b] = key.split('-').map(Number).map(value => value * 16 + 8);
    return { ink, paper, dominant: [r, g, b], luminance: Math.round(.299 * r + .587 * g + .114 * b) };
  }));
  const distance = (a, b) => Math.round(Math.hypot(a[0] - b[0], a[1] - b[1], a[2] - b[2]));

  const darkTone = await tone(panel);
  assert(darkTone.length === 2 && darkTone.every(item => item.ink > 8000), 'Charts must draw content in the default theme');
  assert(darkTone.every(item => item.paper < 200), 'Default charts must not paint the Klee paper fill, got ' + JSON.stringify(darkTone));

  await page.getByRole('button', { name: '开启可莉主题', exact: true }).click();
  await page.waitForTimeout(700);
  const kleeTone = await tone(panel);
  assert(kleeTone.every(item => item.ink > 8000), 'Charts must keep drawing content in the Klee theme');
  const shifts = kleeTone.map((item, index) => distance(item.dominant, darkTone[index].dominant));
  assert(shifts.every(value => value > 60), 'Klee charts must repaint with the hand-journal palette, got ' + JSON.stringify(shifts));
  assert(kleeTone[0].luminance < darkTone[0].luminance - 40, 'Klee trend bars must be deeper than the mint default bars, got ' + JSON.stringify([darkTone[0], kleeTone[0]]));
  assert(kleeTone[1].dominant[0] > kleeTone[1].dominant[2] + 20, 'Klee ranking bars must turn warm, got ' + JSON.stringify(kleeTone[1].dominant));
  assert(kleeTone.some(item => item.paper > 1000), 'Klee bars must be separated by the paper color, got ' + JSON.stringify(kleeTone));

  // 卡片样式跟随可莉主题：纸张圆角、虚线分隔与四叶草标题。
  const card = await panel.evaluate(element => {
    const node = element.querySelector('.usage-chart-panel');
    const title = node.querySelector('h3');
    const before = getComputedStyle(title, '::before');
    return {
      radius: getComputedStyle(node).borderRadius,
      headerBorder: getComputedStyle(node.querySelector('.el-card__header')).borderBottomStyle,
      titleColor: getComputedStyle(title).color,
      clover: /clover|data:image\/svg/i.test(before.backgroundImage),
      cloverWidth: before.width,
    };
  });
  assert(card.radius === '18px', 'Klee chart card must be rounded, got ' + card.radius);
  assert(card.headerBorder === 'dashed', 'Klee chart header must use a dashed rule, got ' + card.headerBorder);
  assert(card.titleColor === 'rgb(120, 69, 89)', 'Klee chart title must use the hand-journal ink color, got ' + card.titleColor);
  assert(card.clover && card.cloverWidth === '13px', 'Klee chart title must carry the clover mark, got ' + JSON.stringify(card));

  // 提示框改用纸张底色，而不是默认深色块。
  const box = await panel.locator('.usage-chart').first().boundingBox();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.62);
  await page.waitForTimeout(500);
  const tooltip = await panel.evaluate(element => {
    const canvas = element.querySelector('.usage-chart canvas');
    const { data } = canvas.getContext('2d').getImageData(0, 0, canvas.width, canvas.height);
    let paper = 0, ink = 0;
    for (let i = 0; i < data.length; i += 4) {
      if (data[i + 3] < 200) continue;
      ink++;
      if (data[i] > 244 && data[i + 1] > 240 && data[i + 2] > 235) paper++;
    }
    return { paper, ink };
  });
  assert(tooltip.paper > 500, 'Klee tooltip must paint a paper panel, got ' + JSON.stringify(tooltip));
  await page.mouse.move(5, 5);

  // 放大弹窗：柱状与折线都保持主题配色。
  await panel.getByRole('button', { name: '放大查看每日趋势', exact: true }).click();
  const trend = page.getByRole('dialog', { name: '每日趋势', exact: true });
  await trend.locator('canvas').waitFor();
  await page.waitForTimeout(500);
  const barTone = await tone(trend);
  assert(barTone[0].ink > 20000, 'Expanded trend chart must draw content');
  assert(barTone[0].dominant[0] > barTone[0].dominant[2] || barTone[0].paper > 500, 'Expanded bars must stay on the paper palette, got ' + JSON.stringify(barTone));
  const dialogStyle = await trend.evaluate(dialog => ({
    radius: getComputedStyle(dialog.querySelector('.el-dialog')).borderRadius,
    title: getComputedStyle(dialog.querySelector('.el-dialog__title')).color,
  }));
  assert(dialogStyle.radius === '20px', 'Klee chart dialog must be rounded, got ' + dialogStyle.radius);
  assert(dialogStyle.title === 'rgb(120, 69, 89)', 'Klee chart dialog title must use the ink color, got ' + dialogStyle.title);

  await trend.getByRole('combobox', { name: '图表类型' }).press('ArrowDown');
  await page.getByRole('option', { name: '折线图', exact: true }).click();
  await page.waitForTimeout(600);
  const lineTone = await tone(trend);
  assert(lineTone[0].ink > 1500, 'Expanded line chart must draw content, got ' + JSON.stringify(lineTone[0]));
  assert(lineTone[0].ink < barTone[0].ink, 'Line chart must cover less area than stacked bars, got ' + JSON.stringify([barTone[0].ink, lineTone[0].ink]));
  await page.screenshot({ path: 'output/playwright/usage-chart-klee-expanded-line.png', animations: 'disabled' });
  await trend.getByRole('button', { name: 'Close this dialog' }).click();
  await trend.waitFor({ state: 'hidden' });

  // 窄屏：图表不得溢出视口。
  await page.setViewportSize({ width: 390, height: 900 });
  await page.waitForTimeout(500);
  assert(!await page.evaluate(() => document.documentElement.scrollWidth > innerWidth), 'Klee charts must fit the mobile viewport');
  await page.screenshot({ path: 'output/playwright/usage-chart-klee-mobile.png', animations: 'disabled' });

  assert(!errors.length, errors.join('; '));
  return 'PASS: Klee chart theme (palette swap, paper tooltip, clover card, dialog, mobile fit)';
}
