import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync, readdirSync, rmSync, rmdirSync, existsSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createUsageLog } from '../klee-api/app/gateway-usage.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';

const conversation = { request: [{ role: 'user', content: 'private text' }], response: [], complete: true };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'klee-privacy-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, file: join(base, 'usage.json'), content: join(base, 'usage-content') };
}
function logFor(t, file) { const log = createUsageLog(file); t.after(() => log.close()); return log; }

test('new logs keep statistics without retaining supplied conversation text', t => {
  const { file, content } = fixture(t), log = logFor(t, file);
  log.add({ id: 'call', startedAt: Date.now() }, conversation);
  assert.deepEqual(log.snapshot().settings, { mode: 'stats', retentionDays: 0 });
  assert.equal(log.snapshot().storedConversations, 0);
  assert.equal(log.detail('call').conversation, null);
  assert.equal(existsSync(content), false);
  assert.equal(readFileSync(file, 'utf8').includes('private text'), false);
});

test('content opt-in and retention settings survive restart, stats preserves old content', t => {
  const { base, file } = fixture(t), log = logFor(t, file);
  log.updateSettings({ mode: 'content', retentionDays: 30 });
  log.add({ id: 'call', startedAt: Date.now() }, conversation);
  const loaded = logFor(t, file);
  assert.deepEqual(loaded.snapshot().settings, { mode: 'content', retentionDays: 30 });
  assert.equal(loaded.detail('call').conversation.request[0].content, 'private text');
  loaded.updateSettings({ mode: 'stats' });
  assert.equal(loaded.snapshot().storedConversations, 1);
  assert.equal(JSON.parse(readFileSync(join(base, 'usage-settings.json'), 'utf8')).mode, 'stats');
});

test('revoked capture permits cannot store content after changing settings or clearing', t => {
  const log = logFor(t);
  log.updateSettings({ mode: 'content' });
  const oldPermit = log.beginCapture();
  log.updateSettings({ mode: 'stats' });
  log.updateSettings({ mode: 'content' });
  log.add({ id: 'old', startedAt: Date.now() }, conversation, oldPermit);
  const beforeClear = log.beginCapture();
  log.clear();
  log.add({ id: 'cleared', startedAt: Date.now() }, conversation, beforeClear);
  assert.equal(log.snapshot().storedConversations, 0);
  log.add({ id: 'new', startedAt: Date.now() }, conversation, log.beginCapture());
  assert.equal(log.snapshot().storedConversations, 1);
});

test('setting retention removes expired metadata, content and orphan files while preserving other data', t => {
  const { base, file, content } = fixture(t), log = logFor(t, file);
  log.updateSettings({ mode: 'content' });
  log.add({ id: 'old', startedAt: Date.now() - 8 * 86400000 }, conversation);
  log.add({ id: 'new', startedAt: Date.now() }, conversation);
  writeFileSync(join(content, 'orphan.json'), '{}');
  writeFileSync(join(base, 'api-key.txt'), 'keep-key');
  log.updateSettings({ retentionDays: 7 });
  assert.deepEqual(log.snapshot().records.map(row => row.id), ['new']);
  assert.deepEqual(readdirSync(content), ['new.json']);
  assert.equal(readFileSync(join(base, 'api-key.txt'), 'utf8'), 'keep-key');
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')).map(row => row.id), ['new']);
});

test('startup and reads expire content, trim excess records and retain legacy content by default', t => {
  const { base, file, content } = fixture(t);
  mkdirSync(content);
  const rows = Array.from({ length: 2001 }, (_, index) => ({ id: 'call-' + index, startedAt: Date.now(), hasConversation: true }));
  rows[0].startedAt = Date.now() - 10 * 86400000;
  writeFileSync(file, JSON.stringify(rows));
  for (const id of ['call-0', 'call-2000', 'orphan']) writeFileSync(join(content, id + '.json'), JSON.stringify(conversation));
  const legacy = logFor(t, file);
  assert.equal(legacy.detail('call-0').conversation.request[0].content, 'private text');
  assert.equal(existsSync(join(content, 'call-2000.json')), false);
  legacy.close();
  writeFileSync(join(base, 'usage-settings.json'), JSON.stringify({ mode: 'content', retentionDays: 7 }));
  const loaded = logFor(t, file);
  assert.equal(loaded.detail('call-0'), null);
  assert.equal(existsSync(join(content, 'call-0.json')), false);
  loaded.updateSettings({ retentionDays: 0 });
  loaded.add({ id: 'expire-on-read', startedAt: Date.now() - 8 * 86400000 }, conversation);
  writeFileSync(join(base, 'usage-settings.json'), JSON.stringify({ mode: 'content', retentionDays: 7 }));
  assert.equal(loaded.detail('expire-on-read'), null);
});

test('single deletion and clear remove local content and report filesystem failures', t => {
  const { file, content } = fixture(t), log = logFor(t, file);
  log.updateSettings({ mode: 'content' });
  log.add({ id: 'one', startedAt: Date.now() }, conversation);
  log.add({ id: 'two', startedAt: Date.now() }, conversation);
  log.remove('one');
  assert.equal(existsSync(join(content, 'one.json')), false);
  assert.throws(() => log.remove('../usage'), error => error.status === 404);
  assert.throws(() => log.remove('missing'), error => error.status === 404);
  rmSync(join(content, 'two.json'));
  mkdirSync(join(content, 'two.json'));
  assert.throws(() => log.remove('two'), error => error.status === 500);
  assert.throws(() => log.clear(), error => error.status === 500);
  rmdirSync(join(content, 'two.json'));
  assert.equal(log.clear().records.length, 0);
  assert.equal(log.snapshot().storedConversations, 0);
  assert.deepEqual(readdirSync(content), []);
});

test('clearing never follows a linked conversation directory', t => {
  const { base, file, content } = fixture(t);
  const target = join(base, 'other-data');
  mkdirSync(target);
  writeFileSync(join(target, 'keep.json'), 'keep');
  symlinkSync(target, content, process.platform === 'win32' ? 'junction' : 'dir');
  const log = logFor(t, file);
  assert.throws(() => log.clear(), error => error.status === 500);
  assert.equal(readFileSync(join(target, 'keep.json'), 'utf8'), 'keep');
});

test('corrupt or unavailable settings fail closed with a visible warning', t => {
  const { base, file } = fixture(t), log = logFor(t, file);
  log.updateSettings({ mode: 'content' });
  const permit = log.beginCapture();
  writeFileSync(join(base, 'usage-settings.json'), '{broken');
  log.add({ id: 'blocked', startedAt: Date.now() }, conversation, permit);
  assert.equal(log.snapshot().settings.mode, 'stats');
  assert.ok(log.snapshot().warning);
  assert.equal(log.snapshot().storedConversations, 0);
  rmSync(join(base, 'usage-settings.json'));
  mkdirSync(join(base, 'usage-settings.json'));
  const loaded = logFor(t, file);
  assert.equal(loaded.beginCapture(), null);
  assert.ok(loaded.snapshot().warning);
  assert.throws(() => loaded.updateSettings({ mode: 'content' }), error => error.status === 500);
});

async function serverFor(t, bridge) {
  const gateway = await createGateway({ apiKey: 'klee-privacy-test', bridge });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(() => gateway.close());
  const request = (method, path, body, key = 'klee-privacy-test', headers = {}) => new Promise((resolve, reject) => {
    const payload = body === undefined ? undefined : JSON.stringify(body);
    const req = httpRequest({ host: '127.0.0.1', port: gateway.server.address().port, path, method, agent: false,
      headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer ' + key, 'Content-Type': 'application/json',
        ...(payload ? { 'Content-Length': Buffer.byteLength(payload) } : {}), ...headers } }, res => {
      let text = ''; res.on('data', value => { text += value; }); res.on('end', () => resolve({ status: res.statusCode, headers: res.headers, body: text ? JSON.parse(text) : null }));
    }); req.on('error', reject); req.end(payload);
  });
  return request;
}
const pool = platform => Response.json({ accounts: platform === 'trae' ? [{ uid: 'test', region: 'cn', enabled: true, status: 'ready', remaining: 100, models: [{ id: 'demo' }] }] : [] });
const chat = { model: 'trae/cn/demo', messages: [{ role: 'user', content: 'private input' }] };

test('privacy routes authenticate writes, validate settings and delete records', async t => {
  const request = await serverFor(t, async (platform, path) => path.startsWith('/api/pool?') ? pool(platform) : Response.json({ choices: [{ message: { content: 'reply' } }] }));
  for (const [method, path] of [['PATCH', '/api/gateway/usage/settings'], ['DELETE', '/api/gateway/usage'], ['DELETE', '/api/gateway/usage/missing']]) {
    assert.equal((await request(method, path, method === 'PATCH' ? { mode: 'content' } : undefined, 'wrong')).status, 401);
  }
  const preflight = await request('OPTIONS', '/api/gateway/usage/settings', undefined, 'wrong', { Origin: 'http://127.0.0.1:18791', 'Access-Control-Request-Method': 'PATCH' });
  assert.equal(preflight.status, 204);
  assert.equal(preflight.headers['access-control-allow-origin'], 'http://127.0.0.1:18791');
  assert.match(preflight.headers['access-control-allow-methods'], /PATCH.*DELETE/);
  for (const value of [{}, null, [], { mode: 'bad' }, { retentionDays: 1 }, { retentionDays: '7' }, { mode: 'content', extra: true }]) {
    assert.equal((await request('PATCH', '/api/gateway/usage/settings', value)).status, 400);
  }
  assert.equal((await request('POST', '/v1/chat/completions', chat)).status, 200);
  assert.equal((await request('GET', '/api/gateway/usage')).body.storedConversations, 0);
  assert.equal((await request('PATCH', '/api/gateway/usage/settings', { mode: 'content' })).body.settings.mode, 'content');
  await request('POST', '/v1/chat/completions', chat);
  const snapshot = (await request('GET', '/api/gateway/usage')).body;
  assert.equal(snapshot.storedConversations, 1);
  const id = snapshot.records[0].id;
  assert.equal((await request('DELETE', '/api/gateway/usage/' + id)).body.storedConversations, 0);
  assert.equal((await request('GET', '/api/gateway/usage/' + id)).status, 404);
  assert.equal((await request('DELETE', '/api/gateway/usage/missing')).status, 404);
  assert.deepEqual((await request('DELETE', '/api/gateway/usage')).body.records, []);
});

for (const action of ['stats', 'clear']) test(`in-flight gateway content is discarded after ${action}`, async t => {
  let release, reached;
  const started = new Promise(resolve => { reached = resolve; });
  const pending = new Promise(resolve => { release = resolve; });
  const request = await serverFor(t, async (platform, path) => {
    if (path.startsWith('/api/pool?')) return pool(platform);
    reached(); await pending;
    return Response.json({ choices: [{ message: { content: 'late reply' } }] });
  });
  await request('PATCH', '/api/gateway/usage/settings', { mode: 'content' });
  const running = request('POST', '/v1/chat/completions', chat);
  await started;
  if (action === 'stats') {
    await request('PATCH', '/api/gateway/usage/settings', { mode: 'stats' });
    await request('PATCH', '/api/gateway/usage/settings', { mode: 'content' });
  } else await request('DELETE', '/api/gateway/usage');
  release(); await running;
  const snapshot = (await request('GET', '/api/gateway/usage')).body;
  assert.equal(snapshot.storedConversations, 0);
  assert.equal(snapshot.records.length, action === 'clear' ? 0 : 1);
});
