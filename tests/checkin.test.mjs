import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { createService } from '../klee-api/app/server.mjs';
import { ApiError } from '../klee-api/app/http.mjs';

function localRequest(server, body, key, host) {
  return new Promise((resolve, reject) => {
    const req = httpRequest({ hostname: '127.0.0.1', port: server.address().port, path: '/api/checkin', method: body === undefined ? 'GET' : 'POST', headers: { Host: host, Authorization: `Bearer ${key}`, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', part => { text += part; });
      res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    });
    req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
}

async function gateway(t, bridge) {
  const service = await createGateway({ apiKey: 'klee-test-only', bridge });
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
  const adapter = {
    normalize: async a => a,
    checkin: async () => ({ enabled: true, checkedIn: false }),
    quota: async () => ({ remaining: 5 }),
    claim: async a => { claimed.push(a.uid); throw new ApiError('Trae 拒绝本次签到（9074），奖励未确认到账。', 502, 'trae_9074'); },
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
  assert.equal((await request({ all: 'yes' })).status, 400);
});
