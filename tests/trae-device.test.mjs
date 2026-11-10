import test from 'node:test';
import assert from 'node:assert/strict';
import trae from '../klee-api/Klee-trae-web/provider.mjs';
import { registeredDevice, findRegisteredContext } from '../klee-api/Klee-trae-web/device.mjs';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

test('Trae checkin sends the official UG device context without replacing the saved identity', async t => {
  const account = { uid: 'test-user', accessToken: 'fake-token', deviceId: 'saved-device', reqSource: 2, deviceBrand: 'Test model', deviceType: 'windows', osVersion: 'Windows 11', appVersion: '0.1.65' };
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(init.headers['X-Device-Id'], 'saved-device');
    assert.equal(init.headers['X-Device-Brand'], 'Test model');
    assert.equal(init.headers['X-Device-Type'], 'windows');
    assert.equal(init.headers['X-Os-Version'], 'Windows 11');
    assert.equal(init.headers['X-App-Version'], '0.1.65');
    assert.deepEqual(JSON.parse(init.body), { req_source: 2 });
    return Response.json({ enable: true, checked_in: false, credits: 100 });
  });
  assert.equal((await trae.checkin(account)).enabled, true);
  assert.equal(account.deviceId, 'saved-device');
});

test('imported official device fields survive normalization', async () => {
  const account = await trae.normalize({ uid: 'test-user', accessToken: 'fake-token', device_id: 'saved-device', req_source: 1, x_device_brand: 'Test model', x_device_type: 'windows', x_os_version: 'Windows 11', x_app_version: '3.4.15' });
  assert.equal(account.deviceBrand, 'Test model');
  assert.equal(account.deviceType, 'windows');
  assert.equal(account.osVersion, 'Windows 11');
  assert.equal(account.appVersion, '3.4.15');
  assert.equal(account.reqSource, 1);
});

test('native identity is read only for the same account and client source', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'klee-trae-device-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profile = join(dir, 'Trae CN');
  await mkdir(join(profile, 'User', 'globalStorage'), { recursive: true });
  await mkdir(join(profile, 'logs', '20261110T120000'), { recursive: true });
  await writeFile(join(profile, 'User', 'globalStorage', 'storage.json'), JSON.stringify({ 'iCubeAuthInfo://icube-dc:same-account': {}, 'iCubeAuthInfo://icube.cloudide': { userId: 'same-account', account: { scope: 'marscode' } } }));
  await writeFile(join(profile, 'logs', '20261110T120000', 'main.log'), '[ICDRS] (init) resolve rdid: 1234567890123456789');
  assert.equal(await registeredDevice(1, 'same-account', dir), '1234567890123456789');
  assert.equal(await registeredDevice(1, 'other-account', dir), undefined);
  assert.equal(await registeredDevice(2, 'same-account', dir), undefined);
});

test('a stale account key or opaque login state cannot authorize a current device binding', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'klee-trae-stale-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profile = join(dir, 'Trae CN');
  await mkdir(join(profile, 'User', 'globalStorage'), { recursive: true });
  await mkdir(join(profile, 'logs', '20261110T120000'), { recursive: true });
  const file = join(profile, 'User', 'globalStorage', 'storage.json');
  await writeFile(join(profile, 'logs', '20261110T120000', 'main.log'), '[ICDRS] (init) resolve rdid: 1234567890123456789');
  await writeFile(file, JSON.stringify({ 'iCubeAuthInfo://icube-dc:prior': null, 'iCubeAuthInfo://icube-dc:current': {}, 'iCubeAuthInfo://icube.cloudide': { userId: 'current', account: {} } }));
  assert.equal(await registeredDevice(1, 'prior', dir), undefined);
  await writeFile(file, JSON.stringify({ 'iCubeAuthInfo://icube-dc:prior': {}, 'iCubeAuthInfo://icube.cloudide': 'opaque-encrypted-record' }));
  assert.equal(await registeredDevice(1, 'prior', dir), undefined);
});

test('explicit device sync uses the actual same-account client source without borrowing another account', async t => {
  const dir = await mkdtemp(join(tmpdir(), 'klee-trae-sync-'));
  t.after(() => rm(dir, { recursive: true, force: true }));
  const profile = join(dir, 'Trae CN');
  await mkdir(join(profile, 'User', 'globalStorage'), { recursive: true });
  await mkdir(join(profile, 'logs', '20261110T120000'), { recursive: true });
  await writeFile(join(profile, 'User', 'globalStorage', 'storage.json'), JSON.stringify({ 'iCubeAuthInfo://icube.cloudide': { userId: 'same-account', account: {} } }));
  await writeFile(join(profile, 'logs', '20261110T120000', 'main.log'), '[ICDRS] (init) resolve rdid: 1234567890123456789');
  assert.deepEqual(await findRegisteredContext({ uid: 'same-account', reqSource: 2 }, dir), { reqSource: 1, deviceId: '1234567890123456789' });
  assert.equal(await findRegisteredContext({ uid: 'different-account', reqSource: 2 }, dir), undefined);
});
