import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { createService } from '../klee-api/app/server.mjs';
import { ApiError } from '../klee-api/app/http.mjs';
import trae from '../klee-api/Klee-trae-web/provider.mjs';

function localRequest(server, body, key, host, path = '/api/checkin') {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path, method: body === undefined ? 'GET' : 'POST', headers: { Host: host, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function gateway(t, bridge, options = {}) {
  const service = await createGateway({ apiKey: 'klee-test-only', bridge, ...options });
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  t.after(() => service.close());
  return (body, key = 'klee-test-only') => localRequest(service.server, body, key, '127.0.0.1:18887');
}
const response = accounts => Response.json({ accounts });

test('gateway checks all platforms independently and strips credentials', async t => {
  const request = await gateway(t, (p, path) => {
    assert.equal(path, '/api/checkin');
    if (p === 'trae') throw Error('secret upstream details');
    return response([{ uid: 'same', status: 'available', accessToken: 'secret', nickname: p }]);
  });
  assert.equal((await request(undefined, 'wrong')).status, 401);
  const { status, data } = await request();
  assert.equal(status, 200);
  assert.deepEqual(data.accounts.map(a => a.platform), ['workbuddy', 'qoder']);
  assert.equal(data.platforms.find(p => p.platform === 'trae').status, 'failed');
  assert.equal(JSON.stringify(data).includes('secret'), false);
});

test('gateway claims the requested platform and UID without switching active account', async t => {
  const calls = [];
  const request = await gateway(t, (p, path, init) => {
    calls.push([p, path, JSON.parse(init.body)]);
    return response([{ uid: 'same', status: 'claimed', checkedIn: true }]);
  });
  assert.equal((await request({ platform: 'qoder', uid: 'same' })).status, 200);
  assert.deepEqual(calls, [['qoder', '/api/checkin', { uid: 'same' }]]);
  for (const body of [{}, { all: 'true' }, { platform: 'evil', all: true }, { uid: 'same' }, { all: true, uid: 'same' }, null, []])
    assert.equal((await request(body)).status, 400);
});

test('gateway blocks overlapping claims and keeps partial failures', async t => {
  let release;
  const gate = new Promise(resolve => { release = resolve; });
  const request = await gateway(t, async p => {
    await gate;
    return p === 'trae' ? new Response('', { status: 503 }) : response([{ uid: p, status: 'claimed' }]);
  });
  const first = request({ all: true });
  await new Promise(resolve => setTimeout(resolve, 40));
  assert.equal((await request({ all: true })).status, 409);
  release();
  const { data } = await first;
  assert.equal(data.accounts.length, 2);
  assert.equal(data.platforms.filter(p => p.status === 'failed').length, 1);
});

test('platform targeted checkin preserves selected account and exposes actionable Trae rejection', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-checkin-'));
  const claimed = [];
  let confirmed = false;
  const adapter = {
    normalize: async a => a,
    checkin: async () => ({ enabled: true, checkedIn: confirmed }),
    quota: async () => ({ remaining: 5 }),
    claim: async a => { claimed.push(a.uid); if (claimed.length > 1) { confirmed = true; return; } throw new ApiError('Trae 拒绝本次签到（9074），奖励未确认到账。', 502, 'trae_9074'); },
  };
  const service = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });
  await service.store.save({ uid: 'first', accessToken: 'fake', enabled: true }, true);
  await service.store.save({ uid: 'second', accessToken: 'fake', enabled: true }, false);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const request = body => localRequest(service.server, body, service.store.apiKey, '127.0.0.1:17864');
  const { data } = await request({ uid: 'second' });
  assert.deepEqual(claimed, ['second']);
  assert.equal(service.store.state.activeUid, 'first');
  assert.equal(data.accounts[0].status, 'failed');
  assert.equal(data.accounts[0].errorCode, 'trae_9074');
  assert.equal(data.accounts[0].checkedIn, false);
  assert.ok(data.accounts[0].hint.includes('官方客户端'));
  const retried = await request({ uid: 'second' });
  assert.equal(retried.data.accounts[0].status, 'claimed');
  assert.equal(retried.data.accounts[0].errorCode, undefined);
  assert.equal(retried.data.accounts[0].hint, undefined);
  assert.equal((await request({ all: 'yes' })).status, 400);
});

test('gateway returns successful platforms within the shared request deadline', async t => {
  const request = await gateway(t, p => p === 'trae' ? new Promise(() => {}) : response([{ uid: p, status: 'claimed' }]), { requestTimeoutMs: 30 });
  const start = Date.now();
  const result = await request({ all: true });
  assert.ok(Date.now() - start < 1000);
  assert.equal(result.data.accounts.length, 2);
  assert.match(result.data.platforms.find(p => p.platform === 'trae').error, /超时/);
});

for (const platform of ['workbuddy', 'trae', 'qoder']) test(`${platform} runs bounded concurrent account checkins and status reads`, { timeout: 5000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-concurrent-checkin-'));
  const ids = ['slow', 'fast', 'failed', 'queued', 'already', 'disabled', 'no-activity'];
  let release, started, pending, active = 0, peak = 0, readMode = false;
  let gate = new Promise(resolve => { release = resolve; });
  let arrived = new Promise(resolve => { started = resolve; });
  const claimed = new Set(), calls = [];
  const enter = async () => { active++; peak = Math.max(peak, active); if (active === 3) started(); await gate; active--; };
  const adapter = {
    normalize: async account => account,
    checkin: async account => {
      if (readMode) await enter();
      return { enabled: account.uid !== 'no-activity', checkedIn: account.uid === 'already' || claimed.has(account.uid) };
    },
    quota: async account => ({ remaining: claimed.has(account.uid) ? 110 : 100 }),
    claim: async account => { calls.push(account.uid); await enter(); if (account.uid === 'failed') throw new ApiError('模拟平台拒绝', 502); claimed.add(account.uid); },
  };
  const service = await createService({ platform, base, adapter, protectKey: false, callback: false });
  t.after(async () => { release(); await pending; await service.close(); await rm(base, { recursive: true, force: true }); });
  for (const uid of ids) await service.store.save({ uid, accessToken: 'fake', enabled: uid !== 'disabled' }, uid === 'slow');
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const host = '127.0.0.1:' + ({ workbuddy: 18791, trae: 17864, qoder: 17865 })[platform];
  const request = body => localRequest(service.server, body, service.store.apiKey, host);
  const waitForThree = async () => {
    let timeout;
    try { await Promise.race([arrived, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Three accounts must start before the slow account is released')), 500); })]); }
    finally { clearTimeout(timeout); }
  };
  pending = request({ all: true });
  await waitForThree();
  assert.equal(peak, 3);
  assert.equal((await request({ all: true })).status, 409, 'reject repeated batch submissions while workers are running');
  assert.equal((await request({ uid: 'slow' })).status, 409, 'reject a duplicate single claim during the batch');
  release();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.accounts.map(account => account.uid), ids, 'preserve account order despite concurrent completion');
  assert.deepEqual(result.data.accounts.map(account => account.status), ['claimed', 'claimed', 'failed', 'claimed', 'already', 'skipped', 'no_activity']);
  assert.equal(peak, 3, 'never exceed the per-platform concurrency limit');
  assert.deepEqual([...calls].sort(), ['slow', 'fast', 'failed', 'queued'].sort(), 'each eligible account is claimed once');
  assert.equal(service.store.state.activeUid, 'slow');
  for (const uid of ['slow', 'fast', 'queued']) assert.equal(service.store.get(uid).credits, 110, 'concurrent credit writes must all persist');

  readMode = true; active = 0; peak = 0;
  gate = new Promise(resolve => { release = resolve; });
  arrived = new Promise(resolve => { started = resolve; });
  pending = request();
  await waitForThree();
  release();
  const status = await pending;
  assert.equal(status.status, 200);
  assert.equal(peak, 3, 'status reads use the same bounded parallelism');
  assert.deepEqual(status.data.accounts.map(account => account.uid), ids);
  assert.equal(calls.length, 4, 'status reads must never claim rewards');
});

test('Trae adapter retains device identity and rejects business code 9074', async t => {
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.headers['X-Device-Id'], 'existing-device');
    assert.deepEqual(JSON.parse(init.body), { req_source: 2 });
    return Response.json({ code: 9074 });
  });
  await assert.rejects(trae.claim({ accessToken: 'fake', deviceId: 'existing-device', reqSource: 2 }), e => e.code === 'trae_9074' && /未确认到账/.test(e.message));
});

test('device sync preserves credentials and active account and cannot recreate a deleted account', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-device-sync-'));
  let gate, entered;
  const adapter = { normalize: async a => a, syncDevice: async () => { entered?.(); if (gate) await gate; return { reqSource: 1, deviceId: 'registered-device', accessToken: 'must-not-copy' }; } };
  const service = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });
  await service.store.save({ uid: 'first', accessToken: 'original-first' }, true);
  await service.store.save({ uid: 'target', accessToken: 'original-target', reqSource: 2 }, false);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const request = () => localRequest(service.server, {}, service.store.apiKey, '127.0.0.1:17864', '/api/accounts/target/device');
  const result = await request();
  assert.equal(result.status, 200);
  assert.equal(service.store.state.activeUid, 'first');
  assert.equal(service.store.get('target').accessToken, 'original-target');
  assert.equal(service.store.get('target').reqSource, 1);
  assert.equal(JSON.stringify(result.data).includes('original-target'), false);
  let release;
  gate = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { entered = resolve; });
  const pending = request();
  await arrived;
  assert.equal((await localRequest(service.server, { all: true }, service.store.apiKey, '127.0.0.1:17864')).status, 409);
  await service.store.remove('target');
  release();
  assert.equal((await pending).status, 409);
  assert.equal(service.store.state.accounts.some(a => a.uid === 'target'), false);
});

test('an in-flight token refresh cannot roll back a newly synced device binding', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-device-refresh-'));
  let release, started;
  const gate = new Promise(resolve => { release = resolve; });
  const arrived = new Promise(resolve => { started = resolve; });
  const adapter = { normalize: async a => a, refresh: async a => { started(); await gate; return { ...a, accessToken: 'new-token' }; }, syncDevice: async () => ({ reqSource: 1, deviceId: 'new-device' }) };
  const service = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(async () => { release(); await service.close(); await rm(base, { recursive: true, force: true }); });
  await service.store.save({ uid: 'target', accessToken: 'old-token', refreshToken: 'fake-refresh', reqSource: 2, deviceId: 'old-device' }, true);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const request = path => localRequest(service.server, {}, service.store.apiKey, '127.0.0.1:17864', '/api/accounts/target/' + path);
  const refresh = request('refresh');
  await arrived;
  assert.equal((await request('device')).status, 200);
  release();
  assert.equal((await refresh).status, 200);
  const current = service.store.get('target');
  assert.equal(current.accessToken, 'new-token');
  assert.equal(current.reqSource, 1);
  assert.equal(current.deviceId, 'new-device');
});
