import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { createService } from '../klee-api/app/server.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';

test('completion saved on any platform is shared across services and survives restart', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-onboarding-'));
  const services = [];
  t.after(async () => { for (const service of services) await service.close(); await rm(base, { recursive: true, force: true }); });
  const adapter = { normalize: value => value };
  for (const platform of ['workbuddy', 'trae', 'qoder']) services.push(await createService({ base, platform, adapter, callback: false, protectKey: false }));
  services.push(await createGateway({ base, apiKey: 'klee-onboarding-test' }));
  for (const service of services) await new Promise(resolve => service.server.listen(0, '127.0.0.1', resolve));
  const ports = [18791, 17864, 17865, 18887];
  const keys = services.map((service, i) => i === 3 ? 'klee-onboarding-test' : service.store.apiKey);
  const request = (index, path, body, key = keys[index]) => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: services[index].server.address().port, path, method: body === undefined ? 'GET' : 'POST', headers: { Host: '127.0.0.1:' + ports[index], Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', part => { text += part; }); res.on('end', () => resolve({ status: res.statusCode, data: JSON.parse(text) }));
    }); req.on('error', reject); req.end(body === undefined ? undefined : JSON.stringify(body));
  });
  assert.deepEqual((await request(0, '/api/config')).data.onboarding, { completed: false });
  assert.equal((await request(0, '/api/onboarding', { completed: true }, 'wrong')).status, 401);
  for (let index = 0; index < 4; index++) {
    const platform = ['workbuddy', 'trae', 'qoder', 'gateway'][index];
    assert.equal((await request(index, '/api/onboarding', { completed: 'true' })).status, 400);
    assert.equal((await request(index, '/api/onboarding', { completed: true })).status, 200);
    for (let other = 0; other < 4; other++) assert.deepEqual((await request(other, '/api/config')).data.onboarding, { completed: true, platform });
  }
  const restarted = await createService({ base, platform: 'workbuddy', adapter, callback: false, protectKey: false });
  services.push(restarted);
  ports.push(18791);
  await new Promise(resolve => restarted.server.listen(0, '127.0.0.1', resolve));
  assert.deepEqual((await request(4, '/api/config')).data.onboarding, { completed: true, platform: 'gateway' });
  assert.equal((await request(2, '/api/onboarding', { completed: false })).status, 200);
  assert.deepEqual((await request(3, '/api/config')).data.onboarding, { completed: false });
});

