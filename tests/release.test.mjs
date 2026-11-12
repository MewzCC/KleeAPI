import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, readFile, readdir, rm, symlink } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createHash } from 'node:crypto';
import { stageRelease, verifyDownload } from '../scripts/build-release.mjs';
import { checkInstallation } from '../scripts/preflight.mjs';

async function fixture(t) {
  const root = await mkdtemp(join(tmpdir(), 'klee-release-'));
  t.after(() => rm(root, { recursive: true, force: true }));
  const source = join(root, '源码 source'), destination = join(root, '便携包 portable');
  async function put(path, content = 'fixture') {
    await mkdir(join(source, path, '..'), { recursive: true });
    await writeFile(join(source, path), content);
  }
  for (const file of ['Start-Manager.cmd', 'Stop-Manager.cmd', 'Start-Manager.ps1', 'Stop-Manager.ps1',
    'LICENSE', 'README.md', 'signin.sh', 'scripts/manager.mjs', 'scripts/preflight.mjs', 'scripts/setup-qoder-runtime.mjs',
    'klee-api/app/server.mjs', 'klee-api/app/gateway.mjs', 'klee-api/app/config.mjs',
    'klee-api/Klee-workbuddy-web/provider.mjs', 'klee-api/Klee-workbuddy-web/LICENSE',
    'klee-api/Klee-trae-web/provider.mjs', 'klee-api/Klee-trae-web/LICENSE',
    'klee-api/Klee-qoder-web/provider.mjs', 'klee-api/Klee-qoder-web/NOTICE.md',
    'docs/TUTORIAL.md', 'docs/API-GUIDE.md', 'docs/NOTICE.md', 'docs/KLEE-THEME.md']) await put(file);
  await put('package.json', JSON.stringify({ name: 'klee-api', version: '1.0.0', type: 'module' }));
  await put('frontend/dist/index.html', '<script type="module" src="/assets/app.js"></script>');
  await put('frontend/dist/assets/app.js', 'console.log("fixture")');
  await put('frontend/package-lock.json', JSON.stringify({ packages: {
    '': {}, 'node_modules/vue': { version: '3.5.22', license: 'MIT' },
    'node_modules/vite': { version: '7.1.9', dev: true },
  } }));
  await put('frontend/node_modules/vue/package.json', JSON.stringify({ name: 'vue', version: '3.5.22', license: 'MIT' }));
  await put('frontend/node_modules/vue/LICENSE', 'Vue fixture license');
  const runtimeFiles = {
    'node.exe': Buffer.from('portable-node'), 'Node-LICENSE.txt': Buffer.from('Node license'),
    'qoder/runtime-info.exe': Buffer.from('official-exe'), 'qoder/sgsdk.dll': Buffer.from('official-dll'),
    'qoder/LICENSE.txt': Buffer.from('Qoder license'), 'qoder/source.json': Buffer.from('{}'),
  };
  return { source, destination, put, runtimeFiles };
}

test('portable release stages only application files, keeps licenses and generates fresh defaults', async t => {
  const f = await fixture(t);
  const privateFiles = ['Gateway-Chat/data/Gateway/api-key.txt', 'Qoder-Chat/data/Qoder/accounts.json',
    'runtime/manager.json', 'runtime/logs/manager.log', 'runtime/qoder/PS/device.dat',
    'klee-api/app/.env', 'klee-api/app/credentials.json', 'frontend/dist/assets/app.js.map',
    'frontend/dist/.env', 'docs/diagnostics/private.md', 'pets/description.json'];
  for (const path of privateFiles) await f.put(path, 'DO_NOT_DISTRIBUTE');
  await f.put('klee-config.json', JSON.stringify({ gateway: { port: 19000, aliases: { private: ['model'] } } }));
  const manifest = await stageRelease(f);
  assert.equal(manifest.version, '1.0.0');
  assert.equal(manifest.platform, 'win32');
  assert.equal(manifest.arch, 'x64');
  for (const path of privateFiles) assert.equal(manifest.files[path], undefined, path);
  assert.ok(manifest.files['klee-api/app/server.mjs']);
  assert.ok(manifest.files['frontend/dist/assets/app.js']);
  assert.ok(manifest.files['runtime/qoder/runtime-info.exe']);
  assert.equal(await readFile(join(f.destination, 'licenses/frontend/vue/LICENSE'), 'utf8'), 'Vue fixture license');
  assert.equal(manifest.files['licenses/frontend/vite/LICENSE'], undefined);
  assert.equal(JSON.parse(await readFile(join(f.destination, 'klee-config.json'), 'utf8')).gateway.port, 18887);
  assert.equal(JSON.parse(await readFile(join(f.destination, 'package.json'), 'utf8')).version, '1.0.0');
  for (const [path, hash] of Object.entries(manifest.files)) {
    const data = await readFile(join(f.destination, path));
    assert.equal(createHash('sha256').update(data).digest('hex'), hash, path);
    assert.equal(data.includes('DO_NOT_DISTRIBUTE'), false, path);
  }
  const entries = await readdir(f.destination);
  assert.equal(entries.includes('Gateway-Chat'), false);
  await assert.rejects(stageRelease(f), /已存在/);
});

test('release rejects linked application folders instead of copying outside files', async t => {
  const f = await fixture(t);
  const outside = join(f.source, '..', 'outside');
  await mkdir(outside);
  await writeFile(join(outside, 'secret.mjs'), 'DO_NOT_DISTRIBUTE');
  await symlink(outside, join(f.source, 'klee-api/app/linked'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageRelease(f), /链接/);
});

test('release refuses a linked ancestor directory even when the leaf file is regular', async t => {
  const f = await fixture(t);
  const outside = join(f.source, '..', 'external-docs');
  await mkdir(outside);
  await writeFile(join(outside, 'TUTORIAL.md'), 'DO_NOT_DISTRIBUTE');
  await rm(join(f.source, 'docs'), { recursive: true });
  await symlink(outside, join(f.source, 'docs'), process.platform === 'win32' ? 'junction' : 'dir');
  await assert.rejects(stageRelease(f), /链接/);
});

test('version-specific license supplements cover packages missing an npm license file', async t => {
  const f = await fixture(t);
  await f.put('frontend/package-lock.json', JSON.stringify({ packages: { '': {}, 'node_modules/lodash-unified': { version: '1.0.3' } } }));
  await f.put('frontend/node_modules/lodash-unified/package.json', JSON.stringify({ name: 'lodash-unified', version: '1.0.3', license: 'MIT', author: 'Jack Works' }));
  await f.put('scripts/release-licenses/lodash-unified-1.0.3.txt', 'MIT attribution fixture');
  const manifest = await stageRelease(f);
  assert.ok(manifest.files['licenses/frontend/lodash-unified/NOTICE.txt']);
  assert.equal(await readFile(join(f.destination, 'licenses/frontend/lodash-unified/NOTICE.txt'), 'utf8'), 'MIT attribution fixture');
});

test('download validation refuses mismatched or incomplete binaries', () => {
  const bytes = Buffer.from('official download');
  const hash = createHash('sha256').update(bytes).digest('hex');
  assert.deepEqual(verifyDownload(bytes, 'sha256', hash), bytes);
  assert.throws(() => verifyDownload(Buffer.from('modified'), 'sha256', hash), /完整性/);
  assert.throws(() => verifyDownload(bytes, 'sha256', ''), /完整性/);
});

test('startup checks portable integrity, supported runtime and architecture, leaving mutable configuration alone', async t => {
  const f = await fixture(t);
  await stageRelease(f);
  const options = { base: f.destination, nodeVersion: '24.22.2', platform: 'win32', arch: 'x64' };
  await checkInstallation(options);
  await writeFile(join(f.destination, 'klee-config.json'), '{"gateway":{"port":19000}}');
  await checkInstallation(options);
  await assert.rejects(checkInstallation({ ...options, nodeVersion: '22.11.0' }), /22\.12/);
  await assert.rejects(checkInstallation({ ...options, platform: 'linux' }), /Windows x64/);
  await assert.rejects(checkInstallation({ ...options, arch: 'arm64' }), /Windows x64/);
  await writeFile(join(f.destination, 'frontend/dist/assets/app.js'), 'damaged');
  await assert.rejects(checkInstallation(options), /完整性.*frontend\/dist\/assets\/app\.js/);
});

test('startup explains incomplete extraction and rejects release manifest paths outside the installation', async t => {
  const f = await fixture(t);
  await stageRelease(f);
  const options = { base: f.destination, nodeVersion: '24.22.2', platform: 'win32', arch: 'x64' };
  await rm(join(f.destination, 'frontend/dist/index.html'));
  await assert.rejects(checkInstallation(options), /完整解压/);
  await writeFile(join(f.destination, 'frontend/dist/index.html'), 'fixture');
  await writeFile(join(f.destination, 'release.json'), JSON.stringify({ platform: 'win32', arch: 'x64', files: { '../outside': '0'.repeat(64) } }));
  await assert.rejects(checkInstallation(options), /发布清单/);
});
