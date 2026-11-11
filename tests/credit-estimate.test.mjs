import test from 'node:test';
import assert from 'node:assert/strict';
import { createCreditEstimator } from '../klee-api/app/credit-estimate.mjs';
import { usageFields } from '../klee-api/app/gateway-usage.mjs';
import { createPool } from '../klee-api/app/pool.mjs';
import { relayCompletion } from '../klee-api/app/stream.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { request as httpRequest } from 'node:http';

const quota = remaining => ({ remaining, limit: 100, unit: '积分' });

test('balance difference is labeled separately from reported credits with auditable snapshots', async () => {
  const readings = [quota(100), quota(98.7654)];
  const finish = await createCreditEstimator({ readQuota: async () => readings.shift(), unit: '积分' });
  const fields = usageFields(await finish({ total_tokens: 200 }));
  assert.equal(fields.credits, null);
  assert.equal(fields.estimatedCredits, 1.2346);
  assert.equal(fields.creditEstimate.balanceBefore, 100);
  assert.equal(fields.creditEstimate.balanceAfter, 98.7654);
  assert.equal(fields.creditEstimate.unit, '积分');
  assert.equal(fields.totalTokens, 200);
});

test('reported credits including zero take priority and skip the post-call quota read', async () => {
  let reads = 0;
  const finish = await createCreditEstimator({ readQuota: async () => { reads++; return quota(100); }, unit: '积分' });
  const fields = usageFields(await finish({ credits_consumed: 0 }));
  assert.equal(reads, 1);
  assert.equal(fields.credits, 0);
  assert.equal(fields.estimatedCredits, null);
  assert.equal(fields.creditEstimate, null);
});

test('unreliable balance samples never invent a charge; unchanged balances remain explicitly estimated zero', async () => {
  for (const readings of [
    [null, quota(90)], [quota(100), null], [quota(100), quota(101)],
    [quota(100), { ...quota(90), limit: 200 }], [quota(100), { ...quota(90), unit: '美元' }],
    [{ ...quota(100), unlimited: true }, quota(90)], [quota(100), { ...quota(90), remaining: NaN }],
  ]) {
    const finish = await createCreditEstimator({ readQuota: async () => readings.shift(), unit: '积分' });
    assert.equal(usageFields(await finish({})).estimatedCredits, null);
  }
  const finish = await createCreditEstimator({ readQuota: async () => quota(100), unit: '积分' });
  const fields = usageFields(await finish({}));
  assert.equal(fields.credits, null);
  assert.equal(fields.estimatedCredits, 0);
});

test('quota failures, cancellation and timeout do not fail or stall a completion', async () => {
  const unavailable = await createCreditEstimator({ readQuota: async () => { throw Error('offline'); }, unit: '积分' });
  assert.deepEqual(await unavailable({ total_tokens: 3 }), { total_tokens: 3 });
  const timedOut = await createCreditEstimator({ readQuota: () => new Promise(() => {}), timeoutMs: 10, unit: '积分' });
  assert.equal(await timedOut(null), null);
  const controller = new AbortController();
  const pending = createCreditEstimator({ readQuota: () => new Promise(() => {}), signal: controller.signal, unit: '积分' });
  controller.abort();
  assert.equal(await (await pending)(null), null);
});

test('only internally consistent snapshots enter the usage log', () => {
  const usage = { klee_credit_estimate: { amount: 99, balance_before: 100, balance_after: 90, unit: '积分', measured_at: Date.now() } };
  assert.equal(usageFields(usage).estimatedCredits, null);
});

for (const stream of [false, true]) test(`pool ${stream ? 'streaming' : 'JSON'} completion carries an estimate while keeping the account reserved`, async () => {
  let remaining = 100, reads = 0, releaseRead, postStarted;
  const arrived = new Promise(resolve => { postStarted = resolve; });
  const gate = new Promise(resolve => { releaseRead = resolve; });
  const account = { uid: 'test', region: 'cn', enabled: true };
  const adapter = {
    models: async () => [{ id: 'demo' }],
    quota: async () => { if (++reads === 3) { postStarted(); await gate; } return quota(remaining); },
    chat: async () => { remaining = 97.5; return Response.json({ id: 'test', choices: [{ message: { role: 'assistant', content: 'demo' }, finish_reason: 'stop' }], usage: { total_tokens: 10 } }); },
  };
  const pool = createPool({ platform: 'trae', store: { list: () => [account], get: () => account }, adapter, fresh: async account => account });
  const result = await pool.chat('test', { model: 'demo' });
  let output = '';
  const res = { headersSent: false, destroyed: false, writeHead() { this.headersSent = true; }, write(value) { output += value; return true; }, end(value = '') { output += value; } };
  const completion = relayCompletion(result.response, res, { stream, model: 'demo', finalizeUsage: result.finalizeUsage });
  await arrived;
  await assert.rejects(pool.chat('test', { model: 'demo' }), error => error.code === 'account_busy');
  releaseRead();
  await completion;
  result.release();
  const data = stream ? output.split('\n').filter(line => line.startsWith('data: {')).map(line => JSON.parse(line.slice(6))).findLast(frame => frame.usage) : JSON.parse(output);
  assert.equal(usageFields(data.usage).estimatedCredits, 2.5);
  assert.equal(usageFields(data.usage).credits, null);
  assert.equal(reads, 3, 'use fresh before/after samples instead of a cached balance');
});

test('gateway preserves the estimate through relaying and records its source without replacing reported credits', async t => {
  const estimate = { amount: 1.5, balance_before: 100, balance_after: 98.5, unit: '积分', measured_at: Date.now() };
  const gateway = await createGateway({ apiKey: 'klee-estimate-test', bridge: async (platform, path) => {
    if (path.startsWith('/api/pool?') || path === '/api/pool') return Response.json({ accounts: platform === 'trae' ? [{ uid: 'test', nickname: '示例', region: 'cn', enabled: true, status: 'ready', remaining: 100, unit: '积分', models: [{ id: 'demo' }] }] : [] });
    assert.equal(path, '/api/pool/chat/completions');
    return Response.json({ id: 'demo', choices: [{ message: { role: 'assistant', content: 'demo' }, finish_reason: 'stop' }], usage: { total_tokens: 20, klee_credit_estimate: estimate } });
  } });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(() => gateway.close());
  const request = (path, body) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: gateway.server.address().port, path, method: body ? 'POST' : 'GET', headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer klee-estimate-test', 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', part => { text += part; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  const chat = await request('/v1/chat/completions', { model: 'trae/cn/demo', messages: [{ role: 'user', content: 'demo' }] });
  assert.equal(chat.status, 200);
  assert.equal(chat.data.usage.klee_credit_estimate.amount, 1.5);
  const log = await request('/api/gateway/usage');
  assert.equal(log.data.records[0].credits, null);
  assert.equal(log.data.records[0].estimatedCredits, 1.5);
  assert.equal(log.data.records[0].creditEstimate.balanceBefore, 100);
});
