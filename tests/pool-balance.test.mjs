import test from 'node:test';
import assert from 'node:assert/strict';
import { createPool } from '../klee-api/app/pool.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';
import { request as httpRequest } from 'node:http';

test('platform pool preserves real total and used credit values and clears them after a failed refresh', async () => {
  let fail = false;
  const account = { uid: 'demo', nickname: 'Demo', region: 'cn', enabled: true };
  const store = { list: () => [account], get: () => account };
  const adapter = { quota: async () => { if (fail) throw Error('offline'); return { remaining: 2799.5476, limit: 3000, used: 200.4524, unit: '积分' }; }, models: async () => [{ id: 'demo' }] };
  const pool = createPool({ platform: 'trae', store, adapter, fresh: async a => a });
  const row = (await pool.snapshot()).accounts[0];
  assert.equal(row.limit, 3000);
  assert.equal(row.used, 200.4524);
  fail = true;
  const stale = (await pool.snapshot({ force: true })).accounts[0];
  assert.equal(stale.remaining, null);
  assert.equal(stale.limit, null);
  assert.equal(stale.used, null);
});

test('gateway forwards only finite real credit totals to the balance UI', async t => {
  const gateway = await createGateway({ apiKey: 'klee-balance-test', bridge: async () => Response.json({ accounts: [
    { uid: 'demo', region: 'cn', enabled: true, status: 'ready', remaining: 80, limit: 100, used: 20, accessToken: 'secret-not-for-ui', models: [{ id: 'demo' }] },
    { uid: 'unknown', region: 'global', remaining: 10, limit: -1, used: 'invalid', models: [] },
  ] }) });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(() => gateway.close());
  const snapshot = await new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: gateway.server.address().port, path: '/api/gateway/status', headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer klee-balance-test' } }, res => {
      let body = ''; res.on('data', b => { body += b; }); res.on('end', () => resolve(JSON.parse(body)));
    }); req.on('error', reject); req.end();
  });
  for (const row of snapshot.accounts.filter(a => a.uid === 'demo')) { assert.equal(row.limit, 100); assert.equal(row.used, 20); }
  for (const row of snapshot.accounts.filter(a => a.uid === 'unknown')) { assert.equal(row.limit, null); assert.equal(row.used, null); }
  assert.ok(!JSON.stringify(snapshot).includes('secret-not-for-ui'));
});
