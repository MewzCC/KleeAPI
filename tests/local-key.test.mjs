import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm, readFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createService } from '../klee-api/app/server.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';

for (const platform of ['gateway', 'trae', 'qoder', 'workbuddy']) {
  test(`${platform}: the local console can set a custom key without knowing the current key`, async t => {
    const base = await mkdtemp(join(tmpdir(), 'klee-local-key-'));
    const service = platform === 'gateway' ? await createGateway({ base })
      : await createService({ base, platform, adapter: { normalize: value => value }, protectKey: false, callback: false });
    t.after(async () => { await service.close(); await rm(base, { recursive: true, force: true }); });
    await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
    const port = service.config.ports[platform];
    const send = (body, headers = {}, path = '/api/key/local') => new Promise((resolve, reject) => {
      const req = httpRequest({ host: '127.0.0.1', port: service.server.address().port, path, method: 'POST', headers: {
        Host: `127.0.0.1:${port}`, Origin: 'http://127.0.0.1:18887', 'Sec-Fetch-Site': 'same-site', 'Content-Type': 'application/json', ...headers,
      } }, res => { let text = ''; res.on('data', chunk => text += chunk); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text), headers: res.headers })); });
      req.on('error', reject); req.end(JSON.stringify(body));
    });
    const key = 'klee-first-custom';
    assert.equal((await send({ apiKey: key })).status, 200);
    const dir = { gateway: 'Gateway', trae: 'Trae', qoder: 'Qoder', workbuddy: 'WorkBuddy' }[platform];
    assert.equal((await readFile(join(base, `${dir}-Chat/data/${dir}/api-key.txt`), 'utf8')).trim(), key);
    assert.equal((await send({ apiKey: 'klee-second-custom' }, { Authorization: 'Bearer klee-stale-browser' })).status, 200);
    const recovery = await send({});
    assert.equal(recovery.data.apiKey, 'klee-second-custom');
    assert.equal(recovery.headers['cache-control'], 'no-store');
    for (const headers of [{ Origin: '' }, { Origin: 'https://attacker.example' }, { 'Sec-Fetch-Site': 'cross-site' }, { 'Sec-Fetch-Site': '' }, { 'Content-Type': 'text/plain' }, { Host: 'attacker.example' }]) {
      const result = await send({ apiKey: 'klee-attacker' }, headers);
      assert.ok([400, 403].includes(result.status), 'Reject requests outside the local browser console');
      assert.equal(JSON.stringify(result.data).includes('klee-second-custom'), false);
      assert.ok([400, 403].includes((await send({}, headers)).status), 'Recovery has the same protections as saving');
    }
    for (const body of [{ apiKey: '' }, { apiKey: 'klee-space key' }, { apiKey: null }, [], null]) assert.equal((await send(body)).status, 400);
    assert.equal((await send({})).data.apiKey, 'klee-second-custom');
    assert.equal((await send({ apiKey: 'klee-needs-token' }, {}, '/api/key')).status, 401, 'The public key rotation API still requires its current key');
  });
}
