import test from 'node:test';
import assert from 'node:assert/strict';
import { request as httpRequest } from 'node:http';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { createService } from '../klee-api/app/server.mjs';

const key = 'klee-auto-test';
const completion = content => Response.json({ choices: [{ index: 0, message: { role: 'assistant', content }, finish_reason: 'stop' }], usage: { prompt_tokens: 10, completion_tokens: 5, total_tokens: 15 } });
const message = { messages: [{ role: 'user', content: 'test' }], model: 'auto/test' };
const group = changes => ({ id: 'auto/test', name: '测试自动模型', enabled: true, targets: ['a', 'b', 'c'].map(model => ({ model: 'trae/cn/' + model, enabled: true })), ...changes });
const stream = text => new Response(text, { headers: { 'Content-Type': 'text/event-stream' } });
const event = delta => 'data: ' + JSON.stringify({ choices: [{ index: 0, delta }] }) + '\n\n';

async function setup(t, handler, options = {}) {
  const { poolAccounts, ...gatewayOptions } = options;
  const dispatched = [];
  const service = await createGateway({ apiKey: key, bridge: async (platform, path, init) => {
    if (path.startsWith('/api/pool?')) return Response.json({ accounts: platform === 'trae' ? poolAccounts ?? [{ uid: 'same-account', nickname: '测试账号', region: 'cn', enabled: true, status: 'ready', remaining: 100, models: ['a', 'b', 'c'].map(id => ({ id })) }] : [] });
    const body = JSON.parse(init.body);
    dispatched.push(body.request.model);
    return handler(body.request.model, init, dispatched);
  }, ...gatewayOptions });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  const request = (path, body, method = body ? 'POST' : 'GET', token = key) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: service.server.address().port, path, method, headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', chunk => { text += chunk; });
      res.on('end', () => { let data; try { data = JSON.parse(text); } catch {} resolve({ status: res.statusCode, text, data }); });
    });
    req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  return { service, request, dispatched };
}

test('auto model management is authenticated, appears in catalog and updates without restart', async t => {
  const { request } = await setup(t, () => completion('ok'));
  assert.equal((await request('/api/gateway/auto-models', undefined, 'GET', 'wrong')).status, 401);
  assert.equal((await request('/api/gateway/auto-models', group())).status, 201);
  const listed = (await request('/v1/models')).data.data.find(row => row.id === 'auto/test');
  assert.equal(listed.auto, true);
  assert.equal(listed.canonicalIds.length, 3);
  const path = '/api/gateway/auto-models/' + encodeURIComponent('auto/test');
  assert.equal((await request(path, { enabled: false }, 'PATCH')).status, 200);
  assert.equal((await request('/v1/chat/completions', message)).status, 503);
  assert.equal((await request(path, { enabled: true }, 'PATCH')).status, 200);
  assert.equal((await request('/v1/chat/completions', message)).data.model, 'auto/test');
  assert.equal((await request(path, undefined, 'DELETE')).status, 200);
  assert.equal((await request('/v1/chat/completions', message)).status, 404);
});

test('auto routing tries different models on one account and records failures before success', async t => {
  const { request, dispatched } = await setup(t, model => model === 'c' ? completion('third works') : Response.json({ error: { code: 'upstream_http_error' } }, { status: 503 }));
  await request('/api/gateway/auto-models', group());
  const result = await request('/v1/chat/completions', message);
  assert.equal(result.status, 200);
  assert.equal(result.data.choices[0].message.content, 'third works');
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
  const record = (await request('/api/gateway/usage')).data.records[0];
  assert.equal(record.attempts, 3);
  assert.deepEqual(record.routeAttempts.map(row => row.status), ['failed', 'failed', 'success']);
  assert.equal(record.routeAttempts[0].totalTokens, null);
  assert.equal(record.routeAttempts[2].totalTokens, 15);
  assert.equal(record.upstreamModel, 'c');
  const groups = (await request('/api/gateway/auto-models')).data.groups;
  assert.ok(groups[0].targets[0].cooldownUntil > Date.now());
  assert.ok(groups[0].targets[2].lastSuccessAt);
});

test('invalid HTTP 200 and malformed stream before output fall back, tool responses are valid', async t => {
  const { request, dispatched } = await setup(t, model => model === 'a' ? Response.json({ choices: [] }) : model === 'b' ? stream(event({ role: 'assistant' }) + 'data: {broken\n\n') : Response.json({ choices: [{ index: 0, message: { role: 'assistant', content: null, tool_calls: [{ id: 'call1', type: 'function', function: { name: 'lookup', arguments: '{}' } }] }, finish_reason: 'tool_calls' }] }));
  await request('/api/gateway/auto-models', group());
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.equal(result.status, 200);
  assert.ok(result.text.includes('lookup'));
  assert.ok(result.text.includes('[DONE]'));
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
});

test('empty message objects and role-only finished streams cannot stop automatic fallback', async t => {
  const { request, dispatched } = await setup(t, model => model === 'a'
    ? Response.json({ choices: [{ message: {} }], usage: { total_tokens: 7 } })
    : model === 'b' ? stream(event({ role: 'assistant' }) + 'data: ' + JSON.stringify({ choices: [{ delta: {}, finish_reason: 'stop' }], usage: { total_tokens: 3 } }) + '\n\ndata: [DONE]\n\n')
      : completion('usable'));
  await request('/api/gateway/auto-models', group());
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.equal(result.status, 200);
  assert.ok(result.text.includes('usable'));
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
  const attempts = (await request('/api/gateway/usage')).data.records[0].routeAttempts;
  assert.equal(attempts[0].totalTokens, 7);
  assert.equal(attempts[1].totalTokens, 3);
});

test('stream interruption after content never starts another model', async t => {
  const { request, dispatched } = await setup(t, () => stream(event({ role: 'assistant' }) + event({ content: 'partial' })));
  await request('/api/gateway/auto-models', group());
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.ok(result.text.includes('partial'));
  assert.ok(result.text.includes('upstream_stream_error'));
  assert.deepEqual(dispatched, ['a']);
  assert.equal((await request('/api/gateway/usage')).data.records[0].status, 'failed');
});

test('per-attempt timeout falls back when enabled and does not retry when disabled', async t => {
  const { request, dispatched } = await setup(t, model => model === 'a' ? new Promise(() => {}) : completion('fallback'));
  const settings = group({ attemptTimeoutMs: 1000, totalTimeoutMs: 5000, cooldownMs: 1000 });
  await request('/api/gateway/auto-models', settings);
  assert.equal((await request('/v1/chat/completions', message)).status, 200);
  assert.deepEqual(dispatched, ['a', 'b']);
  await request('/api/gateway/auto-models/auto%2Ftest', { retryOnTimeout: false }, 'PATCH');
  // Use the untouched third candidate to avoid the first attempt's cooldown.
  await request('/api/gateway/auto-models/auto%2Ftest', { targets: [{ model: 'trae/cn/a', enabled: true }] }, 'PATCH');
  const before = dispatched.length;
  const response = await request('/v1/chat/completions', message);
  assert.equal(response.status, 504);
  assert.equal(dispatched.length, before + 1);
});

test('bad request is not retried and exhausted groups report bounded attempts without secrets', async t => {
  let bad = true;
  const { request, dispatched } = await setup(t, () => Response.json({ error: { message: 'SECRET-UPSTREAM', code: 'request_error' } }, { status: bad ? 400 : 503 }));
  await request('/api/gateway/auto-models', group({ maxAttempts: 2 }));
  assert.equal((await request('/v1/chat/completions', message)).status, 400);
  assert.deepEqual(dispatched, ['a']);
  bad = false;
  const result = await request('/v1/chat/completions', message);
  assert.equal(result.status, 503);
  assert.equal(result.data.error.code, 'auto_models_exhausted');
  assert.equal(result.data.error.attempts.length, 2);
  assert.ok(!result.text.includes('SECRET-UPSTREAM'));
});

test('total timeout while all accounts are busy leaves the queue without dispatching', async t => {
  const poolAccounts = [{ uid: 'busy-account', region: 'cn', enabled: true, status: 'ready', remaining: 100, inFlight: 1, models: ['a', 'b', 'c'].map(id => ({ id })) }];
  const { request, dispatched } = await setup(t, () => new Promise(() => {}), { requestTimeoutMs: 100, poolAccounts });
  await request('/api/gateway/auto-models', group());
  assert.equal((await request('/v1/chat/completions', message)).status, 504);
  assert.deepEqual(dispatched, []);
  assert.equal((await request('/api/gateway/usage')).data.records[0].errorCode, 'upstream_timeout');
  assert.equal((await request('/api/gateway/usage')).data.records[0].routeAttempts.length, 0);
});

test('exhausting all candidates reports the full path even below the attempt cap', async t => {
  const { request, dispatched } = await setup(t, () => Response.json({ error: {} }, { status: 503 }));
  await request('/api/gateway/auto-models', group());
  const result = await request('/v1/chat/completions', message);
  assert.equal(result.data.error.code, 'auto_models_exhausted');
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
  assert.equal(result.data.error.attempts.length, 3);
});

test('editing a group changes new requests without changing an in-flight configuration', async t => {
  let entered, release;
  const started = new Promise(resolve => { entered = resolve; });
  const held = new Promise(resolve => { release = resolve; });
  const { request, dispatched } = await setup(t, async model => {
    if (model === 'a') { entered(); await held; return Response.json({ error: {} }, { status: 503 }); }
    return completion(model);
  });
  await request('/api/gateway/auto-models', group());
  const pending = request('/v1/chat/completions', message);
  await started;
  await request('/api/gateway/auto-models/auto%2Ftest', { targets: [{ model: 'trae/cn/c', enabled: true }] }, 'PATCH');
  release();
  assert.equal((await pending).data.choices[0].message.content, 'b');
  assert.equal((await request('/v1/chat/completions', message)).data.choices[0].message.content, 'c');
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
});

test('concurrent automatic requests never use the same account at once', async t => {
  let active = 0, maximum = 0;
  const { request } = await setup(t, async () => {
    maximum = Math.max(maximum, ++active);
    await new Promise(resolve => setTimeout(resolve, 15));
    active--;
    return completion('serialized');
  });
  await request('/api/gateway/auto-models', group());
  const responses = await Promise.all([request('/v1/chat/completions', message), request('/v1/chat/completions', message)]);
  assert.ok(responses.every(response => response.status === 200));
  assert.equal(maximum, 1);
});

test('client disconnect aborts the active attempt without dispatching fallback', async t => {
  let entered, cancelled;
  const started = new Promise(resolve => { entered = resolve; });
  const aborted = new Promise(resolve => { cancelled = resolve; });
  const { service, request, dispatched } = await setup(t, (_, init) => {
    init.signal.addEventListener('abort', cancelled, { once: true });
    entered();
    return new Promise(() => {});
  });
  await request('/api/gateway/auto-models', group());
  const req = httpRequest({ host: '127.0.0.1', port: service.server.address().port, path: '/v1/chat/completions', method: 'POST', headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } });
  req.on('error', () => {});
  req.end(JSON.stringify(message));
  await started;
  req.destroy();
  await aborted;
  assert.deepEqual(dispatched, ['a']);
  const records = (await request('/api/gateway/usage')).data.records;
  assert.equal(records[0].status, 'canceled');
});

for (const [kind, first] of [['content', { content: 'first-part' }], ['reasoning', { reasoning_content: 'thinking' }], ['tools', { tool_calls: [{ index: 0, id: 'call-1', function: { name: 'lookup', arguments: '{}' } }] }]]) test(`a working ${kind} stream can finish after its first-output timeout without switching models`, async t => {
  const { request, dispatched } = await setup(t, () => {
    let timer;
    return new Response(new ReadableStream({
      start(controller) {
        controller.enqueue(new TextEncoder().encode(event(first)));
        timer = setTimeout(() => { controller.enqueue(new TextEncoder().encode(event({ content: 'last-part' }) + 'data: [DONE]\n\n')); controller.close(); }, 1250);
      },
      cancel() { clearTimeout(timer); },
    }), { headers: { 'Content-Type': 'text/event-stream' } });
  });
  await request('/api/gateway/auto-models', group({ attemptTimeoutMs: 1000, totalTimeoutMs: 1100 }));
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.ok(result.text.includes('last-part'), 'An active stream must outlive both routing timers');
  assert.ok(result.text.includes('[DONE]'));
  assert.ok(!result.text.includes('"error"'));
  assert.deepEqual(dispatched, ['a']);
  assert.equal((await request('/api/gateway/usage')).data.records[0].status, 'success');
});

test('rotation visits the next model before exhausting other accounts of the first model', async t => {
  const poolAccounts = ['one', 'two'].map(uid => ({ uid, region: 'cn', enabled: true, status: 'ready', remaining: 100, models: ['a', 'b', 'c'].map(id => ({ id })) }));
  const { request, dispatched } = await setup(t, model => model === 'c' ? completion('third model works') : Response.json({ error: {} }, { status: 503 }), { poolAccounts });
  await request('/api/gateway/auto-models', group({ maxAttempts: 3 }));
  const result = await request('/v1/chat/completions', message);
  assert.equal(result.status, 200);
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
});

test('remaining request time is shared across models so two silent models cannot starve the third', async t => {
  const { request, dispatched } = await setup(t, model => model === 'c' ? completion('last candidate works') : new Promise(() => {}));
  await request('/api/gateway/auto-models', group({ attemptTimeoutMs: 1000, totalTimeoutMs: 1800 }));
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.equal(result.status, 200);
  assert.ok(result.text.includes('last candidate works'));
  assert.deepEqual(dispatched, ['a', 'b', 'c']);
  const attempts = (await request('/api/gateway/usage')).data.records[0].routeAttempts;
  assert.deepEqual(attempts.map(row => row.errorCode), ['auto_attempt_timeout', 'auto_attempt_timeout', null]);
});

test('HTTP headers and role-only frames do not prevent timeout rotation to another model', async t => {
  const { request, dispatched } = await setup(t, model => model === 'a' ? new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(event({ role: 'assistant' }))); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }) : completion('real output'));
  await request('/api/gateway/auto-models', group({ attemptTimeoutMs: 1000, totalTimeoutMs: 5000 }));
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.ok(result.text.includes('real output'));
  assert.ok(result.text.includes('[DONE]'));
  assert.deepEqual(dispatched, ['a', 'b']);
  const attempts = (await request('/api/gateway/usage')).data.records[0].routeAttempts;
  assert.equal(attempts[0].errorCode, 'auto_attempt_timeout');
  assert.equal(attempts[0].firstOutputMs, undefined);
  assert.equal(typeof attempts[1].firstOutputMs, 'number');
});

test('valid Solo output can finish after both gateway and platform timeouts', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-stream-'));
  const modelCalls = [];
  const platformService = await createService({ platform: 'trae', base, callback: false, protectKey: false, poolTimeoutMs: 500, adapter: {
    normalize: data => data,
    models: async () => [{ id: 'a' }],
    quota: async () => ({ remaining: 100 }),
    streamFormat: 'solo',
    async chat(_, body) {
      modelCalls.push(body.model);
      let timer;
      const encoder = new TextEncoder();
      return new Response(new ReadableStream({
        start(controller) {
          controller.enqueue(encoder.encode('event: output\ndata: {"reasoning_content":"started"}\n\n'));
          timer = setTimeout(() => {
            controller.enqueue(encoder.encode('event: output\ndata: {"response":"complete answer"}\n\nevent: done\ndata: {}\n\n'));
            controller.close();
          }, 1000);
        },
        cancel() { clearTimeout(timer); },
      }), { headers: { 'Content-Type': 'text/event-stream' } });
    },
  } });
  t.after(async () => { await platformService.close(); await rm(base, { recursive: true, force: true }); });
  await platformService.store.save({ uid: 'test', accessToken: 'test', region: 'cn' }, true);
  await new Promise(resolve => platformService.server.listen(0, '127.0.0.1', resolve));
  const { request } = await setup(t, null, { requestTimeoutMs: 750, bridge: (platform, path, options) => {
    if (platform !== 'trae') return Response.json({ accounts: [] });
    return new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: platformService.server.address().port, path, method: options.method, signal: options.signal, headers: {
        Host: '127.0.0.1:' + platformService.config.ports.trae, Authorization: 'Bearer ' + platformService.store.apiKey,
      } }, res => resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers })));
      req.on('error', reject);
      req.end(options.body);
    });
  } });
  await request('/api/gateway/auto-models', group());
  const result = await request('/v1/chat/completions', { ...message, stream: true });
  assert.ok(result.text.includes('started'), result.text);
  assert.ok(result.text.includes('complete answer'), result.text);
  assert.ok(result.text.includes('[DONE]'));
  assert.ok(!result.text.includes('"error"'));
  assert.deepEqual(modelCalls, ['a']);
});

test('disconnect after first output still cancels the active model', async t => {
  let resolveCanceled;
  const canceled = new Promise(resolve => { resolveCanceled = resolve; });
  const { service, request, dispatched } = await setup(t, () => new Response(new ReadableStream({
    start(controller) { controller.enqueue(new TextEncoder().encode(event({ content: 'started' }))); },
    cancel() { resolveCanceled(); },
  }), { headers: { 'Content-Type': 'text/event-stream' } }));
  await request('/api/gateway/auto-models', group());
  await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: service.server.address().port, path: '/v1/chat/completions', method: 'POST', headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } }, res => {
      let text = '';
      res.on('data', chunk => {
        text += chunk;
        if (!text.includes('started')) return;
        resolve();
        req.destroy();
      });
    });
    req.on('error', reject);
    req.end(JSON.stringify({ ...message, stream: true }));
  });
  await canceled;
  assert.deepEqual(dispatched, ['a']);
  assert.equal((await request('/api/gateway/usage')).data.records[0].status, 'canceled');
});
