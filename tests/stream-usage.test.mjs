import test from 'node:test';
import assert from 'node:assert/strict';
import { relayCompletion, mergeCompletionUsage } from '../klee-api/app/stream.mjs';
import { usageFields } from '../klee-api/app/gateway-usage.mjs';

async function soloUsage(events, stream) {
  let output = '';
  const response = new Response(events.map(([event, data]) => `event: ${event}\ndata: ${JSON.stringify(data)}\n\n`).join(''), { headers: { 'Content-Type': 'text/event-stream' } });
  const res = { headersSent: false, destroyed: false, writeHead() { this.headersSent = true; }, write(value) { output += value; return true; }, end(value = '') { output += value; } };
  await relayCompletion(response, res, { model: 'demo', format: 'solo', stream });
  if (!stream) return JSON.parse(output).usage;
  const frames = output.split('\n').filter(line => line.startsWith('data: ') && line !== 'data: [DONE]').map(line => JSON.parse(line.slice(6)));
  return frames.findLast(frame => frame.usage)?.usage;
}

for (const stream of [false, true]) test(`Solo ${stream ? 'SSE' : 'JSON'} retains credits from completion metadata and nested token usage`, async () => {
  const tokens = { prompt_tokens: 100, completion_tokens: 20, total_tokens: 120 };
  const root = await soloUsage([['token_usage', tokens], ['done', { credits_consumed: 1.25 }]], stream);
  assert.deepEqual(usageFields(root), { inputTokens: 100, outputTokens: 20, totalTokens: 120, credits: 1.25, estimatedCredits: null, creditEstimate: null });
  const nested = await soloUsage([['token_usage', { usage: tokens }], ['done', { usage: { credits_used: 0 } }]], stream);
  assert.deepEqual(usageFields(nested), { inputTokens: 100, outputTokens: 20, totalTokens: 120, credits: 0, estimatedCredits: null, creditEstimate: null });
  const explicit = await soloUsage([['billing', { usage: { credits: 2.5 } }], ['done', {}]], stream);
  assert.equal(usageFields(explicit).credits, 2.5);
});

test('missing or invalid credits stay unknown and are never inferred from tokens or currency', async () => {
  const usage = await soloUsage([['token_usage', { total_tokens: 3000 }], ['done', { cost: 0.03, credits_consumed: '12', credits: -1 }]], false);
  assert.equal(usageFields(usage).credits, null);
  assert.equal(usageFields(usage).totalTokens, 3000);
  const merged = mergeCompletionUsage({ credits_consumed: 1.5 }, { usage: { credits: NaN } });
  assert.equal(usageFields(merged).credits, 1.5);
});
