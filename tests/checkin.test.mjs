import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { createService } from '../klee-api/app/server.mjs';
import { ApiError } from '../klee-api/app/http.mjs';
import { nextTraeCheckin } from '../klee-api/app/checkin.mjs';
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
  assert.equal((await request({ platform: 'trae', all: true })).status, 200);
  assert.deepEqual(calls.at(-1), ['trae', '/api/checkin/pool', { all: true }]);
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
    syncDevice: async () => ({ reqSource: 1, deviceId: 'local-device' }),
    checkin: async () => ({ enabled: true, checkedIn: confirmed }),
    quota: async () => ({ remaining: 5 }),
    claim: async a => {
      assert.equal(a.accessToken, 'second-token');
      assert.equal(a.deviceId, 'local-device');
      assert.equal(a.reqSource, 1);
      claimed.push(a.uid);
      if (claimed.length > 1) { confirmed = true; return; }
      throw new ApiError('Trae 拒绝本次签到（9074），奖励未确认到账。', 502, 'trae_9074');
    },
  };
  const service = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });
  await service.store.save({ uid: 'first', accessToken: 'fake', enabled: true }, true);
  await service.store.save({ uid: 'second', accessToken: 'second-token', refreshToken: 'refresh', deviceId: 'web-device', reqSource: 2, enabled: true }, false);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const request = body => localRequest(service.server, body, service.store.apiKey, '127.0.0.1:17864');
  assert.equal((await request({ uid: 'second' })).status, 409);
  assert.deepEqual(claimed, []);
  await localRequest(service.server, {}, service.store.apiKey, '127.0.0.1:17864', '/api/accounts/first/device');
  const { data } = await request({ uid: 'second' });
  assert.deepEqual(claimed, ['second']);
  assert.equal(service.store.state.activeUid, 'first');
  assert.equal(data.accounts[0].status, 'failed');
  assert.equal(data.accounts[0].errorCode, 'trae_9074');
  assert.equal(data.accounts[0].checkedIn, false);
  assert.match(data.accounts[0].hint, /稍后刷新签到状态/);
  assert.doesNotMatch(data.accounts[0].hint, /同步本机设备/);
  const retried = await request({ uid: 'second' });
  assert.equal(retried.data.accounts[0].status, 'claimed');
  assert.equal(retried.data.accounts[0].errorCode, undefined);
  assert.equal(retried.data.accounts[0].hint, undefined);
  assert.equal(service.store.get('second').deviceId, 'web-device');
  assert.equal(service.store.get('second').reqSource, 2);
  assert.notEqual(service.store.get('second').desktopBound, true);
  assert.equal((await request({ all: 'yes' })).status, 400);
});

test('Trae desktop batch shares one saved device with web-only accounts and survives reauthorization and restart', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-desktop-checkin-'));
  const claimed = new Map();
  const adapter = {
    normalize: async account => account,
    syncDevice: async () => ({ reqSource: 1, deviceId: 'local-device' }),
    checkin: async account => ({ enabled: true, checkedIn: claimed.has(account.uid), reward: 100 }),
    quota: async account => ({ remaining: claimed.has(account.uid) && account.uid === 'first' ? 100.25 : 0.25 }),
    claim: async account => {
      assert.equal(account.deviceId, 'local-device');
      assert.equal(account.reqSource, 1);
      claimed.set(account.uid, true);
    },
  };
  const service = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });
  for (const uid of ['first', 'second']) await service.store.save({ uid, accessToken: 'fake', refreshToken: 'refresh', deviceId: 'web', reqSource: 2 }, false);
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const request = (body, path) => localRequest(service.server, body, service.store.apiKey, '127.0.0.1:17864', path);
  const batch = () => request({ all: true }, '/api/checkin/desktop');
  assert.equal((await batch()).status, 409);
  assert.equal((await request({ uid: 'first' }, '/api/checkin/desktop')).status, 400);
  assert.equal((await request({}, '/api/accounts/first/device')).data.account.desktopBound, true);
  await request({ json: { uid: 'web', accessToken: 'fake', desktopBound: true } }, '/api/accounts/import');
  assert.equal(service.store.get('web').desktopBound, false);
  const result = await batch();
  assert.equal(result.status, 200);
  assert.deepEqual([...claimed.keys()], ['first', 'second']);
  assert.deepEqual(result.data.accounts.map(a => [a.status, a.balanceBefore, a.balanceAfter, a.message]), [
    ['claimed', 0.25, 100.25, '签到已确认，积分余额增加 100'],
    ['claimed', 0.25, 0.25, '签到已确认，到账金额待核对'],
    ['skipped', undefined, undefined, '缺少刷新令牌'],
  ]);
  assert.equal(service.store.state.activeUid, 'web');
  assert.equal(service.store.get('second').deviceId, 'web');
  assert.notEqual(service.store.get('second').desktopBound, true);
  await request({ json: { uid: 'first', accessToken: 'new-web' } }, '/api/accounts/import');
  assert.equal(service.store.get('first').desktopBound, false);
  assert.deepEqual((await batch()).data.accounts.map(a => [a.uid, a.status]), [['first', 'already'], ['second', 'already'], ['web', 'skipped']]);
  await service.close();
  const restarted = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(() => restarted.close());
  await new Promise(resolve => restarted.server.listen(0, '127.0.0.1', resolve));
  const saved = await localRequest(restarted.server, undefined, restarted.store.apiKey, '127.0.0.1:17864', '/api/accounts');
  assert.ok(saved.data.accounts.every(a => a.checkinDeviceReady));
  const resumed = await localRequest(restarted.server, { uid: 'second' }, restarted.store.apiKey, '127.0.0.1:17864');
  assert.equal(resumed.data.accounts[0].status, 'already');
});

test('Trae pool sweep uses one verified device with each account credential and stops after 9095', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-pool-sweep-'));
  const claims = [], statusReads = [];
  const credited = new Set();
  let deviceUsed = false;
  const adapter = {
    normalize: async account => account,
    syncDevice: async () => ({ reqSource: 1, deviceId: 'local-device' }),
    checkin: async account => {
      statusReads.push(account.uid);
      assert.equal(account.accessToken, account.uid + '-token');
      assert.equal(account.deviceId, 'local-device');
      if (account.uid === 'status-error') throw new ApiError('Trae 状态查询失败', 502);
      return { enabled: !['inactive', 'no-device', 'other-device', 'web-only'].includes(account.uid), checkedIn: account.uid === 'already' || credited.has(account.uid), deviceCheckedIn: deviceUsed, reward: 100 };
    },
    quota: async account => ({ remaining: credited.has(account.uid) ? 100 : 0, limit: 100 }),
    claim: async account => {
      claims.push(account.uid);
      if (account.uid === 'rejected') throw new ApiError('该设备今日已领取', 502, 'trae_9095');
      credited.add(account.uid);
    },
    models: async () => [{ id: 'model' }],
    chat: async () => Response.json({ ok: true }),
  };
  const service = await createService({ platform: 'trae', base, adapter, protectKey: false, callback: false });
  t.after(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });
  for (const uid of ['disabled', 'no-refresh', 'no-device', 'other-device', 'web-only', 'inactive', 'already', 'status-error', 'recover', 'rejected', 'later']) {
    await service.store.save({
      uid, enabled: uid !== 'disabled', accessToken: uid + '-token',
      refreshToken: uid === 'no-refresh' ? '' : uid + '-refresh',
      deviceId: uid === 'no-device' ? '' : uid === 'other-device' ? 'other-device' : 'local-device',
      reqSource: 1, desktopBound: uid !== 'web-only',
    }, false);
  }
  assert.equal((await service.pool.snapshot()).accounts.find(a => a.uid === 'recover').status, 'no_credits');
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  await localRequest(service.server, {}, service.store.apiKey, '127.0.0.1:17864', '/api/accounts/recover/device');
  const batch = body => localRequest(service.server, body, service.store.apiKey, '127.0.0.1:17864', '/api/checkin/pool');
  assert.equal((await batch({ accountId: 'web-only' })).status, 409);
  const { status, data } = await batch({ accountId: 'recover' });
  assert.equal(status, 200);
  assert.equal(data.stopped, true);
  assert.deepEqual(claims, ['recover', 'rejected']);
  assert.deepEqual(statusReads, ['no-device', 'other-device', 'web-only', 'inactive', 'already', 'status-error', 'recover', 'recover', 'rejected', 'rejected']);
  assert.deepEqual(data.accounts.map(a => a.status), ['skipped', 'skipped', 'no_activity', 'no_activity', 'no_activity', 'no_activity', 'already', 'failed', 'claimed', 'failed', 'skipped']);
  assert.equal(data.accounts.find(a => a.uid === 'rejected').errorCode, 'trae_9095');
  assert.equal(data.accounts.at(-1).errorCode, 'trae_device_batch_stopped');
  assert.equal(service.store.get('recover').credits, 100);
  assert.equal(service.store.get('status-error').credits, 0);
  const recovered = (await service.pool.snapshot()).accounts.find(a => a.uid === 'recover');
  assert.equal(recovered.status, 'ready');
  assert.equal(recovered.remaining, 100);
  const completion = await service.pool.chat('recover', { model: 'model' });
  assert.equal(completion.response.ok, true);
  completion.release();
  deviceUsed = true;
  statusReads.length = 0;
  const stoppedByStatus = (await batch({ accountId: 'recover' })).data;
  assert.equal(stoppedByStatus.stopped, true);
  assert.deepEqual(statusReads, ['no-device']);
  const first = stoppedByStatus.accounts.find(a => a.uid === 'no-device');
  assert.equal(first.deviceCheckedIn, true);
  assert.equal(first.checkedIn, false);
  assert.equal(stoppedByStatus.accounts.at(-1).errorCode, 'trae_device_batch_stopped');
  assert.deepEqual(claims, ['recover', 'rejected']);
  const current = await localRequest(service.server, undefined, service.store.apiKey, '127.0.0.1:17864');
  const webStatus = current.data.accounts.find(a => a.uid === 'web-only');
  assert.equal(webStatus.checkinDeviceReady, true);
  assert.equal(webStatus.checkedIn, false);
  assert.equal(webStatus.deviceCheckedIn, true);
  assert.equal(webStatus.status, 'skipped');
  assert.match(webStatus.message, /本机设备今日已领取/);
});

test('Trae check-in schedule is based on Beijing time and advances to the next day after the slot', () => {
  const next = now => new Date(nextTraeCheckin('03:00', Date.parse(now))).toISOString();
  assert.equal(next('2026-11-11T18:59:59Z'), '2026-11-11T19:00:00.000Z');
  assert.equal(next('2026-11-11T19:00:00Z'), '2026-11-12T19:00:00.000Z');
});

test('gateway returns successful platforms within the shared request deadline', async t => {
  const request = await gateway(t, p => p === 'trae' ? new Promise(() => {}) : response([{ uid: p, status: 'claimed' }]), { requestTimeoutMs: 30 });
  const start = Date.now();
  const result = await request({ all: true });
  assert.ok(Date.now() - start < 1000);
  assert.equal(result.data.accounts.length, 2);
  assert.match(result.data.platforms.find(p => p.platform === 'trae').error, /超时/);
});

for (const platform of ['workbuddy', 'trae', 'qoder']) test(`${platform} runs its expected batch concurrency and bounded status reads`, { timeout: 5000 }, async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-concurrent-checkin-'));
  const ids = ['slow', 'fast', 'failed', 'queued', 'already', 'disabled', 'no-activity'];
  let release, started, pending, active = 0, peak = 0, readMode = false;
  let gate = new Promise(resolve => { release = resolve; });
  let arrived = new Promise(resolve => { started = resolve; });
  const claimed = new Set(), calls = [];
  const claimConcurrency = platform === 'trae' ? 1 : 3;
  const enter = async () => { active++; peak = Math.max(peak, active); if (active === (readMode ? 3 : claimConcurrency)) started(); await gate; active--; };
  const adapter = {
    normalize: async account => account,
    syncDevice: async () => ({ reqSource: 1, deviceId: 'same-device' }),
    checkin: async account => {
      if (readMode) await enter();
      return { enabled: account.uid !== 'no-activity', checkedIn: account.uid === 'already' || claimed.has(account.uid) };
    },
    quota: async account => ({ remaining: claimed.has(account.uid) ? 110 : 100 }),
    claim: async account => { calls.push(account.uid); await enter(); if (account.uid === 'failed') throw new ApiError('模拟平台拒绝', 502); claimed.add(account.uid); },
  };
  const service = await createService({ platform, base, adapter, protectKey: false, callback: false });
  t.after(async () => { release(); await pending; await service.close(); await rm(base, { recursive: true, force: true }); });
  for (const uid of ids) await service.store.save({
    uid, accessToken: 'fake', enabled: uid !== 'disabled',
    ...(platform === 'trae' ? { desktopBound: true, reqSource: 1, deviceId: 'same-device', refreshToken: 'fake-refresh' } : {}),
  }, uid === 'slow');
  await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const host = '127.0.0.1:' + ({ workbuddy: 18791, trae: 17864, qoder: 17865 })[platform];
  if (platform === 'trae') await localRequest(service.server, {}, service.store.apiKey, host, '/api/accounts/slow/device');
  const request = body => localRequest(service.server, body, service.store.apiKey, host);
  const waitForWorkers = async () => {
    let timeout;
    try { await Promise.race([arrived, new Promise((_, reject) => { timeout = setTimeout(() => reject(Error('Expected workers must start before the gate is released')), 500); })]); }
    finally { clearTimeout(timeout); }
  };
  pending = request({ all: true });
  await waitForWorkers();
  assert.equal(peak, claimConcurrency);
  assert.equal((await request({ all: true })).status, 409, 'reject repeated batch submissions while workers are running');
  assert.equal((await request({ uid: 'slow' })).status, 409, 'reject a duplicate single claim during the batch');
  release();
  const result = await pending;
  assert.equal(result.status, 200);
  assert.deepEqual(result.data.accounts.map(account => account.uid), ids, 'preserve account order despite concurrent completion');
  assert.deepEqual(result.data.accounts.map(account => account.status), ['claimed', 'claimed', 'failed', 'claimed', 'already', 'skipped', 'no_activity']);
  assert.equal(peak, claimConcurrency, 'never exceed the per-platform concurrency limit');
  assert.deepEqual([...calls].sort(), ['slow', 'fast', 'failed', 'queued'].sort(), 'each eligible account is claimed once');
  assert.equal(service.store.state.activeUid, 'slow');
  for (const uid of ['slow', 'fast', 'queued']) assert.equal(service.store.get(uid).credits, 110, 'concurrent credit writes must all persist');

  readMode = true; active = 0; peak = 0;
  gate = new Promise(resolve => { release = resolve; });
  arrived = new Promise(resolve => { started = resolve; });
  pending = request();
  await waitForWorkers();
  release();
  const status = await pending;
  assert.equal(status.status, 200);
  assert.equal(peak, 3, 'status reads use the same bounded parallelism');
  assert.deepEqual(status.data.accounts.map(account => account.uid), ids);
  assert.equal(calls.length, 4, 'status reads must never claim rewards');
});

test('Trae adapter retains device identity and rejects business code 9074', async t => {
  let message = '当前参与用户太多，请稍后再试';
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.headers['X-Device-Id'], 'existing-device');
    assert.deepEqual(JSON.parse(init.body), { req_source: 2 });
    return Response.json({ code: 9074, message });
  });
  const account = { accessToken: 'fake', deviceId: 'existing-device', reqSource: 2 };
  await assert.rejects(trae.claim(account), e => e.code === 'trae_9074' && e.message.includes(message) && /未确认到账/.test(e.message));
  message = 'upstream-internal-details';
  await assert.rejects(trae.claim(account), e => e.code === 'trae_9074' && !e.message.includes(message) && /未确认到账/.test(e.message));
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
