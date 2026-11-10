import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm } from 'node:fs/promises';
import { join } from 'node:path';
import { tmpdir } from 'node:os';
import { findRuntimeInfo } from '../klee-api/Klee-qoder-web/runtime-info.mjs';
const cfg = { app: 'Qoder', prefix: 'QODER_', dir: '.qoder', linux: 'Qoder' };

test('finds the locally installed official helper when the desktop client is absent', async t => {
  const home = await mkdtemp(join(tmpdir(), 'klee-runtime-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const runtimeDir = join(home, 'project-runtime');
  await mkdir(runtimeDir);
  const file = join(runtimeDir, 'runtime-info.exe');
  await writeFile(file, 'test fixture');
  assert.equal(await findRuntimeInfo(cfg, { platform: 'win32', arch: 'x64', home, env: {}, runtimeDir }), file);
});

test('an explicit runtime override is authoritative and never silently replaced', async t => {
  const home = await mkdtemp(join(tmpdir(), 'klee-runtime-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const file = join(home, 'runtime-info.exe');
  await writeFile(file, 'fixture');
  assert.equal(await findRuntimeInfo(cfg, { platform: 'win32', home, env: { QODER_RUNTIME_INFO: file } }), file);
  assert.equal(await findRuntimeInfo(cfg, { platform: 'win32', home, env: { QODER_RUNTIME_INFO: join(home, 'missing.exe') }, runtimeDir: home }), undefined);
  await assert.rejects(findRuntimeInfo(cfg, { platform: 'win32', home, env: { QODER_RUNTIME_INFO: 'relative.exe' } }), /绝对路径/);
});

test('recognizes official Windows CLI cache bundles without executing candidates', async t => {
  const home = await mkdtemp(join(tmpdir(), 'klee-runtime-'));
  t.after(() => rm(home, { recursive: true, force: true }));
  const dir = join(home, '.qoder', '.bin', 'umid-win32-x64-official');
  await mkdir(dir, { recursive: true });
  const file = join(dir, 'runtime-info.exe');
  await writeFile(file, 'fixture');
  assert.equal(await findRuntimeInfo(cfg, { platform: 'win32', arch: 'x64', home, env: {} }), file);
});
