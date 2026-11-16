import assert from 'node:assert/strict';
import { mkdtemp, rm, writeFile } from 'node:fs/promises';
import { request } from 'node:http';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { Readable } from 'node:stream';
import test from 'node:test';
import { loadConfig } from '../klee-api/app/config.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { createService } from '../klee-api/app/server.mjs';

const MiB = 1024 * 1024;
const key = 'klee-size-test';

async function configFixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'klee-chat-size-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  return { base, save: config => writeFile(join(base, 'klee-config.json'), JSON.stringify(config)) };
}

async function listen(service) {
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
}

function send(service, port, token, path, options = {}) {
  const { method, signal, body } = options;
  return new Promise((resolve, reject) => {
    const headers = { Host: '127.0.0.1:' + port, Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' };
    if (body !== undefined) headers['Content-Length'] = Buffer.byteLength(body);
    const req = request({ host: '127.0.0.1', port: service.server.address().port, path, method, signal, headers }, res => {
      resolve(new Response(Readable.toWeb(res), { status: res.statusCode, headers: res.headers }));
    });
    req.on('error', reject);
    req.end(body);
  });
}

test('chat request limit defaults to 32 MiB and rejects invalid configuration', async t => {
  const { base, save } = await configFixture(t);
  assert.equal(loadConfig(base).chatRequestMaxBytes, 32 * MiB);
  await save({ chatRequestMaxMiB: 128 });
  assert.equal(loadConfig(base).chatRequestMaxBytes, 128 * MiB);
  for (const value of [0, 129, 1.5, '32', null]) {
    await save({ chatRequestMaxMiB: value });
    assert.throws(() => loadConfig(base), /chatRequestMaxMiB/);
  }
});

test('a configured chat request over 8 MiB reaches the model through both HTTP layers', async t => {
  const { base, save } = await configFixture(t);
  await save({ chatRequestMaxMiB: 9 });
  let calls = 0;
  const platform = await createService({ base, platform: 'trae', protectKey: false, callback: false, adapter: {
    normalize: data => data,
    models: async () => [{ id: 'demo' }],
    quota: async () => ({ remaining: 100 }),
    chat: async (_, body) => {
      calls++;
      assert.ok(body.messages[0].content.length > 8 * MiB);
      return Response.json({ choices: [{ message: { role: 'assistant', content: 'complete' }, finish_reason: 'stop' }] });
    },
  } });
  t.after(() => platform.close());
  await platform.store.save({ uid: 'test', accessToken: 'test', region: 'cn' }, true);
  await listen(platform);
  const gateway = await createGateway({ base, apiKey: key, bridge: (provider, path, options) => provider === 'trae'
    ? send(platform, platform.config.ports.trae, platform.store.apiKey, path, options)
    : Response.json({ accounts: [] }) });
  t.after(() => gateway.close());
  await listen(gateway);

  function payload(model, bytes) {
    const prefix = '{"model":' + JSON.stringify(model) + ',"messages":[{"role":"user","content":"';
    const suffix = '"}]}';
    return prefix + 'x'.repeat(bytes - prefix.length - suffix.length) + suffix;
  }
  const post = (service, port, token, body) => send(service, port, token, '/v1/chat/completions', { method: 'POST', body });
  const created = await send(gateway, gateway.config.ports.gateway, key, '/api/gateway/auto-models', { method: 'POST', body: JSON.stringify({ id: 'auto/test', name: 'Test', targets: [{ model: 'trae/cn/demo' }] }) });
  assert.equal(created.status, 201);
  await created.json();

  for (const [service, port, token, model] of [[gateway, gateway.config.ports.gateway, key, 'auto/test'], [platform, platform.config.ports.trae, platform.store.apiKey, 'demo']]) {
    const accepted = await post(service, port, token, payload(model, 9 * MiB));
    assert.equal(accepted.status, 200, await accepted.clone().text());
    assert.equal((await accepted.json()).choices[0].message.content, 'complete');
    const rejected = await post(service, port, token, payload(model, 9 * MiB + 1));
    assert.equal(rejected.status, 413);
    assert.equal((await rejected.json()).error.code, 'body_too_large');
  }
  assert.equal(calls, 2);
});
