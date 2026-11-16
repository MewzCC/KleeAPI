import test from 'node:test';
import assert from 'node:assert/strict';
import { usageTrend, usageModels } from '../frontend/src/modules/gateway-usage.ts';

const records = [
  { id: 'a', startedAt: Date.UTC(2026, 10, 10, 4), model: 'Claude-Sonnet-4', upstreamModel: null, platform: 'trae', region: 'cn', account: 'a', status: 'success', httpStatus: 200, errorCode: null, durationMs: 1200, stream: true, attempts: 1, inputTokens: 10, outputTokens: 5, totalTokens: 15, credits: 1 },
  { id: 'b', startedAt: Date.UTC(2026, 10, 10, 5), model: 'GPT-5', upstreamModel: null, platform: 'workbuddy', region: 'cn', account: 'a', status: 'failed', httpStatus: 502, errorCode: null, durationMs: 800, stream: false, attempts: 1, inputTokens: 10, outputTokens: 0, totalTokens: 10, credits: null },
  { id: 'c', startedAt: Date.UTC(2026, 10, 11, 6), model: 'Claude-Sonnet-4', upstreamModel: null, platform: 'trae', region: 'cn', account: 'a', status: 'success', httpStatus: 200, errorCode: null, durationMs: 900, stream: true, attempts: 1, inputTokens: 8, outputTokens: 4, totalTokens: 12, credits: 2 },
];

/** 收集 option 中所有出现的颜色字符串，用于断言主题配色确实切换。 */
function colors(value, found = new Set()) {
  if (typeof value === 'string') { if (/^#[0-9a-f]{6}$/i.test(value)) found.add(value.toLowerCase()); }
  else if (Array.isArray(value)) for (const item of value) colors(item, found);
  else if (value && typeof value === 'object') for (const item of Object.values(value)) colors(item, found);
  return found;
}

test('both themes keep the same chart semantics but swap the palette', () => {
  for (const build of [
    light => usageTrend(records, 'calls', '', light),
    light => usageModels(records, light),
  ]) {
    const dark = build(false), klee = build(true);
    assert.deepEqual(dark.color, ['#a5ddc5', '#e49c97', '#e1bc7b', '#9db4d8']);
    assert.deepEqual(klee.color, ['#4c7d63', '#b3546a', '#c08a3e', '#7a6a94']);
    assert.equal(klee.animation, false, 'Charts must not animate');
    assert.notEqual(dark.textStyle.color, klee.textStyle.color);
    assert.equal(klee.textStyle.color, '#846071', 'Klee chart text must use the theme muted color');
    assert.equal(dark.textStyle.color, '#98a3a3');
    assert.equal(klee.tooltip.backgroundColor, '#fffdfb', 'Klee tooltip must use the paper surface');
    assert.equal(dark.tooltip.backgroundColor, '#181c1d');
    assert.equal(klee.tooltip.renderMode, 'richText');
    // 主题差异必须落在真实颜色上，而不只是文字色。
    const darkColors = colors(dark), kleeColors = colors(klee);
    assert(darkColors.size > 6 && kleeColors.size > 6);
    assert.notDeepEqual([...darkColors].sort(), [...kleeColors].sort(), 'Themes must not share one palette');
    for (const warm of ['#b3546a', '#e4c9d1', '#f0dde2']) assert(kleeColors.has(warm), 'Klee charts must use warm tokens: ' + warm);
    for (const cool of ['#a5ddc5', '#2a3031', '#343c3d']) assert(darkColors.has(cool), 'Default charts must use cool tokens: ' + cool);
    assert(!kleeColors.has('#2a3031') && !kleeColors.has('#343c3d'), 'Klee charts must drop the dark grid colors');
  }
});

test('bars get rounded corners and gradients while line charts stay clean', () => {
  const bar = usageTrend(records, 'calls', '', true, { type: 'bar' });
  const stackedBar = bar.series[0];
  assert.equal(stackedBar.type, 'bar');
  assert.deepEqual(stackedBar.itemStyle.borderRadius, [3, 3, 0, 0], 'Stacked bars use a small top radius');
  assert.equal(stackedBar.itemStyle.borderColor, '#fffdfb', 'Stacked bars are separated by the paper color');
  assert.equal(stackedBar.itemStyle.color.type, 'linear', 'Bars must use a vertical gradient');
  assert.equal(stackedBar.stack, 'calls');

  const unstacked = usageTrend(records, 'calls', '', true, { stacked: false }).series[0];
  assert.deepEqual(unstacked.itemStyle.borderRadius, [6, 6, 0, 0]);
  assert.equal(unstacked.itemStyle.borderWidth, 0);
  assert.equal(unstacked.stack, undefined);

  const line = usageTrend(records, 'calls', '', true, { type: 'line' });
  assert.equal(line.series[0].type, 'line');
  assert.equal(line.series[0].itemStyle, undefined, 'Line charts must not inherit bar styling');
  assert.equal(line.series[0].smooth, true);
  assert.equal(line.series[0].symbol, 'circle');
  assert.equal(line.legend.icon, 'circle');
  assert.equal(bar.legend.icon, 'roundRect');
  assert.equal(line.tooltip.axisPointer.type, 'line');
  assert.equal(bar.tooltip.axisPointer.type, 'shadow');
});

test('ranking chart uses a horizontal gradient and keeps axis labels readable', () => {
  const option = usageModels(records, true, { limit: 2 });
  assert.equal(option.series[0].itemStyle.color.type, 'linear');
  assert.equal(option.series[0].itemStyle.color.x2, 1, 'Ranking bars grow left to right');
  assert.deepEqual(option.series[0].itemStyle.borderRadius, [0, 6, 6, 0]);
  assert.equal(option.yAxis.axisTick.show, false);
  assert.equal(option.xAxis.axisLine.show, false);
  assert.equal(option.xAxis.splitLine.lineStyle.type, 'dashed');
  assert.equal(option.yAxis.data.length, 2);
});

test('show-values labels stay legible on top of both bar and paper backgrounds', () => {
  const klee = usageTrend(records, 'calls', '', true, { showValues: true });
  assert.equal(klee.series[0].label.show, true);
  assert.equal(klee.series[0].label.color, '#fffdfb', 'Labels inside Klee bars use the paper color');
  const dark = usageTrend(records, 'calls', '', false, { showValues: true });
  assert.equal(dark.series[0].label.color, '#101314', 'Labels inside default bars use the dark surface color');
  const line = usageTrend(records, 'calls', '', true, { showValues: true, type: 'line' });
  assert.equal(line.series[0].label.color, '#846071', 'Line labels use the theme text color');
  assert.equal(line.series[0].label.position, 'top');
});

test('trend keeps missing credit days as gaps and the expanded view adds a themed zoom slider', () => {
  const credits = usageTrend(records, 'credits', 'Trae · 国内版', true);
  assert.deepEqual(credits.series[0].data, [1, 2], 'Reported credits are summed per day for the selected group');
  assert.deepEqual(credits.series[1].data, [null, null], 'Days without balance estimates stay missing instead of becoming zero');
  // 没有该地区积分数据时，平台上报与估算两条系列都必须保持缺失，而不是画成 0。
  const empty = usageTrend(records, 'credits', 'Qoder · 国内版', true);
  assert.deepEqual(empty.series[0].data, [null, null]);
  assert.deepEqual(empty.series[1].data, [null, null]);
  assert.equal(usageTrend(records, 'credits', 'Trae · 国内版', true).dataZoom.length, 0);
  const expanded = usageTrend(records, 'credits', 'Trae · 国内版', true, { expanded: true });
  assert.equal(expanded.dataZoom.length, 2);
  assert.equal(expanded.dataZoom[0].borderColor, '#e4c9d1', 'Zoom slider border follows the Klee axis color');
  assert.equal(expanded.dataZoom[0].textStyle.color, '#846071');
  assert.equal(expanded.grid.bottom, 60, 'Expanded charts reserve room for the slider');
});
