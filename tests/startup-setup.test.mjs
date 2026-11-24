import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, mkdir, writeFile, rm, readFile, copyFile } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join, dirname, delimiter } from 'node:path';
import { spawnSync } from 'node:child_process';
import * as preflight from '../scripts/preflight.mjs';

async function fixture(t) {
  const base = await mkdtemp(join(tmpdir(), 'klee-first-start-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  async function put(path, text = 'fixture') { await mkdir(join(base, path, '..'), { recursive: true }); await writeFile(join(base, path), text); }
  await put('frontend/package.json', '{}');
  await put('frontend/package-lock.json', '{}');
  const calls = [];
  const dependencies = async () => { for (const path of ['vite/bin/vite.js', 'vue-tsc/bin/vue-tsc.js', 'typescript/lib/tsc.js']) await put('frontend/node_modules/' + path); };
  const run = async (args, cwd) => {
    assert.equal(cwd, join(base, 'frontend'));
    calls.push(args);
    if (args[0] === 'ci') await dependencies();
    else await put('frontend/dist/index.html');
  };
  const prepare = options => preflight.prepareInstallation({ base, nodeVersion: '24.15.0', log: () => {}, run, ...options });
  return { base, put, calls, dependencies, prepare };
}

test('a fresh source checkout automatically installs and builds once before startup', async t => {
  const f = await fixture(t);
  await f.prepare();
  assert.deepEqual(f.calls, [['ci', '--include=dev'], ['run', 'build']]);
  await f.prepare();
  assert.equal(f.calls.length, 2, 'Subsequent starts do not reinstall or rebuild');
});

test('an existing dependency installation only needs the missing build', async t => {
  const f = await fixture(t);
  await f.dependencies();
  await f.prepare();
  assert.deepEqual(f.calls, [['run', 'build']]);
});

test('a built source checkout does not need npm or dependencies for normal startup', async t => {
  const f = await fixture(t);
  await f.put('frontend/dist/index.html');
  await f.prepare({ run: () => { throw Error('npm must not run'); } });
  assert.equal(f.calls.length, 0);
});

test('development startup installs missing dependencies without a production build', async t => {
  const f = await fixture(t);
  await f.prepare({ dev: true });
  assert.deepEqual(f.calls, [['ci', '--include=dev']]);
  await f.prepare({ dev: true });
  assert.equal(f.calls.length, 1);
});

test('failed installation stops before build and explains Node/npm or portable fallback', async t => {
  const f = await fixture(t);
  let attempts = 0;
  await assert.rejects(f.prepare({ run: async () => { attempts++; throw Error('fixture npm failure'); } }), /自动.*失败.*Node\.js.*便携版/s);
  assert.equal(attempts, 1);
  await f.prepare();
  assert.deepEqual(f.calls, [['ci', '--include=dev'], ['run', 'build']], 'A later start can retry a failed preparation');
});

test('a broken portable release is never repaired by installing source dependencies', async t => {
  const f = await fixture(t);
  await f.put('release.json', JSON.stringify({ platform: 'win32', arch: 'x64', files: { 'frontend/dist/index.html': '0'.repeat(64) } }));
  await assert.rejects(f.prepare({ platform: 'win32', arch: 'x64' }), /完整解压/);
  assert.equal(f.calls.length, 0);
});

test('failed builds retain installed dependencies and can retry the build on the next start', async t => {
  const f = await fixture(t);
  await f.dependencies();
  await assert.rejects(f.prepare({ run: async () => { throw Error('fixture build failure'); } }), /fixture build failure/);
  await f.prepare();
  assert.deepEqual(f.calls, [['run', 'build']]);
});

test('unsupported Node fails before any dependency installation', async t => {
  const f = await fixture(t);
  await assert.rejects(f.prepare({ nodeVersion: '20.19.0' }), /22\.12/);
  assert.equal(f.calls.length, 0);
});

test('the real npm runner installs and builds a minimal local source fixture without downloads', async t => {
  const f = await fixture(t);
  const pkg = { name: 'startup-fixture', version: '1.0.0', private: true, scripts: { build: 'node build.cjs' } };
  await f.put('frontend/package.json', JSON.stringify(pkg));
  await f.put('frontend/package-lock.json', JSON.stringify({ name: pkg.name, version: pkg.version, lockfileVersion: 3, packages: { '': { name: pkg.name, version: pkg.version } } }));
  await f.put('frontend/.npmrc', 'audit=false\nfund=false\n');
  await f.put('frontend/build.cjs', "const fs=require('node:fs');fs.mkdirSync('dist',{recursive:true});fs.writeFileSync('dist/index.html','fixture build');");
  await preflight.prepareInstallation({ base: f.base, log: () => {} });
  assert.equal(await readFile(join(f.base, 'frontend/dist/index.html'), 'utf8'), 'fixture build');
  await rm(join(f.base, 'frontend/build.cjs'));
  await preflight.prepareInstallation({ base: f.base, log: () => {} });
});

test('Windows launchers reuse system Node and skip an unsupported PATH candidate', { skip: process.platform !== 'win32' }, async t => {
  const f = await fixture(t);
  for (const file of ['Start-Manager.ps1', 'Stop-Manager.ps1', 'scripts/resolve-node.ps1']) {
    await f.put(file);
    await copyFile(new URL('../' + file, import.meta.url), join(f.base, file));
  }
  await f.put('scripts/manager.mjs', 'console.log(JSON.stringify({node:process.execPath,args:process.argv.slice(2)}));');
  await f.put('old-node/node.cmd', '@echo off\r\necho v20.19.0\r\nexit /b 0\r\n');
  const shell = join(process.env.SystemRoot, 'System32/WindowsPowerShell/v1.0/powershell.exe');
  const env = { ...process.env, PATH: [join(f.base, 'old-node'), dirname(process.execPath), process.env.PATH].join(delimiter) };
  for (const [script, expected] of [['Start-Manager.ps1', ['start', '--detach', '--no-browser']], ['Stop-Manager.ps1', ['stop']]]) {
    const args = ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(f.base, script), ...(script.startsWith('Start') ? ['-NoBrowser'] : [])];
    const result = spawnSync(shell, args, { cwd: f.base, env, encoding: 'utf8', windowsHide: true, timeout: 15000 });
    assert.equal(result.status, 0, result.stdout + result.stderr);
    const payload = JSON.parse(result.stdout.split(/\r?\n/).find(line => line.startsWith('{')));
    assert.equal(payload.node.toLowerCase(), process.execPath.toLowerCase());
    assert.deepEqual(payload.args, expected);
  }
  const missing = spawnSync(shell, ['-NoProfile', '-ExecutionPolicy', 'Bypass', '-File', join(f.base, 'Start-Manager.ps1')], { cwd: f.base, env: { ...env, PATH: join(f.base, 'old-node') }, encoding: 'utf8', windowsHide: true, timeout: 15000 });
  assert.equal(missing.status, 1);
  assert.match(missing.stdout, /Node\.js.*npm.*portable ZIP/);
});
