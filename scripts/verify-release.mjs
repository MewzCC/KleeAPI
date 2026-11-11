import assert from 'node:assert/strict';
import { readFile, writeFile, mkdir, mkdtemp, readdir, access } from 'node:fs/promises';
import { createHash } from 'node:crypto';
import { createServer } from 'node:net';
import { openSync, closeSync, readFileSync } from 'node:fs';
import { spawnSync } from 'node:child_process';
import { join, resolve, basename, dirname } from 'node:path';
import { root } from '../klee-api/app/config.mjs';

// 所有启动数据写入全新解压目录；不会登录账号、调用模型或停止其他目录的服务。
if (process.platform !== 'win32') throw Error('此验证命令需要 Windows。');
const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
const archive = resolve(root, process.argv[2] || `output/releases/KleeAPI-${pkg.version}-windows-x64.zip`);
const checksum = (await readFile(archive + '.sha256', 'utf8')).trim().split(/\s+/)[0];
assert.equal(createHash('sha256').update(await readFile(archive)).digest('hex'), checksum, 'ZIP checksum');
const output = join(root, 'output');
await mkdir(output, { recursive: true });
const extraction = join(await mkdtemp(join(output, 'portable-check-')), '中文 空格');
const windows = process.env.SystemRoot;
assert.ok(windows, 'SystemRoot is required');
const powershell = join(windows, 'System32/WindowsPowerShell/v1.0/powershell.exe');
const env = { ...process.env, PATH: [join(windows, 'System32'), join(windows, 'System32/WindowsPowerShell/v1.0'), windows].join(';') };
function command(script, extraEnv = {}, cwd = output) {
  // Windows 后台子孙进程可能继承输出句柄；文件输出避免等待永不关闭的捕获管道。
  const log = join(dirname(extraction), 'command-output.log'), fd = openSync(log, 'w');
  let result;
  try {
    result = spawnSync(powershell, ['-NoProfile', '-NonInteractive', '-ExecutionPolicy', 'Bypass', '-Command', script], {
      cwd, env: { ...env, ...extraEnv }, windowsHide: true, stdio: ['ignore', fd, fd], timeout: 60000,
    });
  } finally { closeSync(fd); }
  process.stdout.write(readFileSync(log, 'utf8'));
  if (result.error) throw result.error;
  return result.status;
}
assert.equal(command('$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::ExtractToDirectory($env:KLEE_ARCHIVE,$env:KLEE_EXTRACT)', { KLEE_ARCHIVE: archive, KLEE_EXTRACT: extraction }), 0);
const folders = await readdir(extraction);
assert.equal(folders.length, 1, 'ZIP must contain one top-level application folder');
const app = join(extraction, folders[0]);
assert.notEqual(command('& where.exe node 2>$null; exit $LASTEXITCODE', {}, app), 0, 'system Node must be absent from PATH');
const manifest = JSON.parse(await readFile(join(app, 'release.json'), 'utf8'));
for (const path of Object.keys(manifest.files)) assert.doesNotMatch(path, /(?:^|\/)(?:data|credentials|auths|pets)(?:\/|$)|(?:^|\/)(?:manager\.json|api-key\.txt)|\.log$/i);
const probes = [], ports = {};
try {
  for (const platform of ['workbuddy', 'trae', 'qoder', 'gateway']) {
    const probe = createServer();
    probes.push(probe);
    await new Promise((done, reject) => { probe.once('error', reject); probe.listen(0, '127.0.0.1', done); });
    ports[platform] = probe.address().port;
  }
  await writeFile(join(app, 'klee-config.json'), JSON.stringify(Object.fromEntries(Object.entries(ports).map(([name, port]) => [name, { port }]))));
  console.log('Checking port-conflict startup message...');
  const status = command('& $env:KLEE_SCRIPT -NoBrowser; exit $LASTEXITCODE', { KLEE_SCRIPT: join(app, 'Start-Manager.cmd') }, app);
  assert.notEqual(status, 0, 'occupied ports must block startup');
  await assert.rejects(access(join(app, 'runtime/manager.json')), /ENOENT/);
} finally { await Promise.all(probes.map(probe => new Promise(done => probe.close(done)))); }
const start = () => command('& $env:KLEE_SCRIPT -NoBrowser; exit $LASTEXITCODE', { KLEE_SCRIPT: join(app, 'Start-Manager.cmd') }, app);
try {
  assert.equal(start(), 0, 'portable .cmd startup');
  assert.equal(start(), 0, 'repeated startup must reuse the same manager');
  for (const [platform, port] of Object.entries(ports)) {
    const response = await fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(10000) });
    assert.equal(response.status, 200);
    const health = await response.json();
    assert.equal(health.ok, true);
    assert.equal(health.platform, platform);
    const name = { workbuddy: 'WorkBuddy', trae: 'Trae', qoder: 'Qoder', gateway: 'Gateway' }[platform];
    const key = (await readFile(join(app, `${name}-Chat/data/${name}/api-key.txt`), 'utf8')).trim();
    assert.match(key, /^klee-/);
    const path = platform === 'gateway' ? '/api/gateway/usage' : '/api/accounts';
    const anonymous = await fetch(`http://127.0.0.1:${port}${path}`);
    assert.equal(anonymous.status, 401, 'private endpoints require a key');
    await anonymous.body?.cancel();
    const dataResponse = await fetch(`http://127.0.0.1:${port}${path}`, { headers: { Authorization: 'Bearer ' + key } });
    assert.equal(dataResponse.status, 200);
    const data = await dataResponse.json();
    assert.deepEqual(platform === 'gateway' ? data.records : data.accounts, [], 'new installation must contain no history or accounts');
  }
  const page = await fetch(`http://127.0.0.1:${ports.gateway}/admin`);
  assert.equal(page.status, 200);
  assert.match(await page.text(), /\/assets\//);
  let assets = 0;
  for (const path of Object.keys(manifest.files).filter(path => path.startsWith('frontend/dist/assets/'))) {
    const response = await fetch(`http://127.0.0.1:${ports.gateway}/` + path.slice('frontend/dist/'.length));
    assert.equal(response.status, 200, path);
    assert.equal(createHash('sha256').update(Buffer.from(await response.arrayBuffer())).digest('hex'), manifest.files[path], path);
    assets++;
  }
  console.log(`Verified four services, authenticated empty stores and ${assets} static assets without system Node/npm.`);
} finally {
  assert.equal(command('& $env:KLEE_SCRIPT; exit $LASTEXITCODE', { KLEE_SCRIPT: join(app, 'Stop-Manager.cmd') }, app), 0, 'portable .cmd shutdown');
}
await assert.rejects(access(join(app, 'runtime/manager.json')), /ENOENT/);
for (const port of Object.values(ports)) await assert.rejects(fetch(`http://127.0.0.1:${port}/health`, { signal: AbortSignal.timeout(2000) }));
console.log('Verified clean shutdown. Smoke-test directory: ' + app);
console.log('Portable verification passed: ' + basename(archive));
