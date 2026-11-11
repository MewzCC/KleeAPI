import { readFile, writeFile, mkdir, readdir, lstat, copyFile, mkdtemp, rm } from 'node:fs/promises';
import { existsSync, constants } from 'node:fs';
import { createHash } from 'node:crypto';
import { join, resolve, extname, dirname, sep, basename } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import { root } from '../klee-api/app/config.mjs';
import { downloadRuntimeFiles } from './setup-qoder-runtime.mjs';

// 固定官方版本与校验值；升级时一并核对官方 SHASUMS256.txt 和 LICENSE。
const nodeVersion = '24.22.2';
const nodeURL = `https://nodejs.org/dist/v${nodeVersion}/win-x64/node.exe`;
const nodeHash = '1c331340fa6cac5e4294725959070a143fa0507195a78ad77eed7943f719aac9';
const nodeLicenseURL = `https://raw.githubusercontent.com/nodejs/node/v${nodeVersion}/LICENSE`;
const nodeLicenseHash = '5888dbb9a1d2b18f2c3e6c5f6af1b39de658372b402a0577b002777f14c62ace';
const hash = bytes => createHash('sha256').update(bytes).digest('hex');
const assetTypes = new Set(['.js', '.css', '.svg', '.png', '.jpg', '.jpeg', '.webp', '.ico', '.woff', '.woff2', '.gif', '.avif']);
const licenseSupplements = { '@vue/devtools-api@6.6.4': 'vue-devtools-api-6.6.4.txt', 'lodash-unified@1.0.3': 'lodash-unified-1.0.3.txt' };

export function verifyDownload(bytes, algorithm, expected) {
  if (!expected || createHash(algorithm).update(bytes).digest('hex') !== expected) throw Error('下载文件完整性校验失败，已停止打包。');
  return bytes;
}

async function sourceInfo(base, relative) {
  if (relative.split('/').some(part => !part || part === '..' || part.includes('\\'))) throw Error('发布源路径无效');
  let path = resolve(base), info = await lstat(path);
  if (info.isSymbolicLink()) throw Error('发布源目录不能是链接：' + base);
  for (const part of relative.split('/')) {
    path = join(path, part);
    info = await lstat(path);
    if (info.isSymbolicLink()) throw Error('发布文件不能包含符号链接或目录链接：' + relative);
  }
  return info;
}

async function filesUnder(base, relative) {
  const path = join(base, relative), info = await sourceInfo(base, relative);
  if (info.isFile()) return [relative];
  if (!info.isDirectory()) throw Error('发布文件类型无效：' + relative);
  const result = [];
  for (const name of (await readdir(path)).sort()) result.push(...await filesUnder(base, relative + '/' + name));
  return result;
}

/** 从白名单创建全新目录；绝不复制运行目录、账号、Key 或本机配置。 */
export async function stageRelease({ source, destination, runtimeFiles }) {
  if (existsSync(destination)) throw Error('发布目录已存在，拒绝覆盖：' + destination);
  async function read(path) { await sourceInfo(source, path); return readFile(join(source, path)); }
  const pkg = JSON.parse(await read('package.json'));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) throw Error('package.json 版本号无效');
  const manifest = { name: 'KleeAPI', version: pkg.version, platform: 'win32', arch: 'x64', nodeVersion, files: {} };
  await mkdir(destination, { recursive: true });
  async function put(path, bytes) {
    const target = join(destination, path);
    await mkdir(dirname(target), { recursive: true });
    await writeFile(target, bytes, { flag: 'wx' });
    manifest.files[path] = hash(bytes);
  }
  async function copy(path, target = path) {
    await put(target, await read(path));
  }
  for (const path of ['Start-Manager.cmd', 'Stop-Manager.cmd', 'Start-Manager.ps1', 'Stop-Manager.ps1', 'LICENSE', 'README.md',
    'scripts/manager.mjs', 'scripts/preflight.mjs', 'scripts/setup-qoder-runtime.mjs',
    'docs/TUTORIAL.md', 'docs/API-GUIDE.md', 'docs/NOTICE.md', 'docs/KLEE-THEME.md']) await copy(path);
  for (const directory of ['klee-api/app', 'klee-api/Klee-workbuddy-web', 'klee-api/Klee-trae-web', 'klee-api/Klee-qoder-web']) {
    for (const path of await filesUnder(source, directory)) {
      if (extname(path) === '.mjs' || ['LICENSE', 'NOTICE.md'].includes(basename(path))) await copy(path);
    }
  }
  for (const path of await filesUnder(source, 'frontend/dist')) {
    if (path === 'frontend/dist/index.html' || path === 'frontend/dist/favicon.svg' || path.startsWith('frontend/dist/assets/') && assetTypes.has(extname(path))) await copy(path);
  }
  if (!manifest.files['frontend/dist/index.html']) throw Error('缺少已构建的管理页面，请先构建前端。');
  const requiredRuntime = ['node.exe', 'Node-LICENSE.txt', 'qoder/runtime-info.exe', 'qoder/sgsdk.dll', 'qoder/LICENSE.txt', 'qoder/source.json'];
  for (const path of requiredRuntime) {
    if (!runtimeFiles[path]?.length) throw Error('缺少便携运行时文件：' + path);
    await put('runtime/' + path, runtimeFiles[path]);
  }
  await put('runtime/Node-SOURCE.json', JSON.stringify({ version: nodeVersion, url: nodeURL, sha256: nodeHash, licenseURL: nodeLicenseURL, licenseSHA256: nodeLicenseHash }, null, 2));
  const lock = JSON.parse(await read('frontend/package-lock.json'));
  const dependencies = [];
  for (const [path, entry] of Object.entries(lock.packages)) {
    if (!path.startsWith('node_modules/') || entry.dev) continue;
    if (path.includes('..') || path.includes('\\')) throw Error('前端依赖路径无效');
    const dir = 'frontend/' + path;
    const info = JSON.parse(await read(dir + '/package.json'));
    if (!/^(@[a-z0-9._-]+\/)?[a-z0-9._-]+$/i.test(info.name)) throw Error('前端依赖名称无效');
    const licenses = (await readdir(join(source, dir))).filter(name => /^(licen[cs]e|copying|notice)([._-].*)?$/i.test(name));
    const target = 'licenses/frontend/' + info.name;
    for (const name of licenses) await copy(dir + '/' + name, target + '/' + name);
    if (!licenses.length) {
      const supplement = licenseSupplements[info.name + '@' + info.version];
      if (!supplement || info.license !== 'MIT') throw Error('缺少前端依赖许可证：' + info.name);
      await copy('scripts/release-licenses/' + supplement, target + '/NOTICE.txt');
    }
    dependencies.push({ name: info.name, version: info.version, license: info.license, directory: target });
  }
  await put('licenses/frontend/dependencies.json', JSON.stringify(dependencies, null, 2) + '\n');
  await put('package.json', JSON.stringify({ name: 'klee-api', version: pkg.version, private: true, type: 'module', license: 'MIT',
    scripts: { start: 'node scripts/manager.mjs start', stop: 'node scripts/manager.mjs stop', status: 'node scripts/manager.mjs status' } }, null, 2) + '\n');
  await put('klee-config.json', JSON.stringify({ workbuddy: { port: 18791 }, trae: { port: 17864 }, qoder: { port: 17865 }, gateway: { port: 18887, aliases: {} } }, null, 2) + '\n');
  await put('先看这里.txt', '\uFEFFKleeAPI Windows x64 便携版 ' + pkg.version + '\r\n\r\n'
    + '1. 右键 ZIP → 全部解压，到桌面或自己的用户文件夹。不要在压缩包里直接双击运行。\r\n'
    + '2. 双击 Start-Manager.cmd，启动检查通过后自动打开管理页面。无需安装 Node.js、npm，也无需编译。\r\n'
    + '3. 在页面登录自己的 WorkBuddy、Trae 或 Qoder 账号，然后到 API 接入测试。\r\n'
    + '4. 关闭浏览器不会停止服务。用完请双击 Stop-Manager.cmd。\r\n'
    + '5. 启动失败时先阅读窗口提示，日志位于 runtime\\logs。端口可以在 klee-config.json 修改。\r\n\r\n'
    + '本包仅支持 Windows 10/11 x64，已内置 Node.js LTS、管理页面与 Qoder 官方身份组件。登录与模型调用仍需联网。\r\n'
    + '首次启动会在本机生成全新的 Key，不含发布者账号、聊天记录或任何宠物配置。\r\n'
    + '使用后的整个文件夹会含个人数据，不要重新压缩分享；请分享原始 ZIP。\r\n'
    + '同一电脑同一 Windows 用户更新：先停止服务，将新版解压到新目录，再复制旧目录的四个 *-Chat\\data 文件夹和自己的 klee-config.json；保留旧文件夹备份。不要复制 runtime\\manager.json 或旧程序覆盖新版。\r\n'
    + '换电脑或 Windows 用户时请重新登录。详细教程见 docs\\TUTORIAL.md；组件许可见 docs\\NOTICE.md、licenses 和 runtime 中的 LICENSE。\r\n');
  await writeFile(join(destination, 'release.json'), JSON.stringify(manifest, null, 2) + '\n', { flag: 'wx' });
  return manifest;
}

async function download(url, expected, cache) {
  const file = join(cache, expected);
  if (existsSync(file)) return verifyDownload(await readFile(file), 'sha256', expected);
  const response = await fetch(url, { signal: AbortSignal.timeout(180000), redirect: 'error' });
  if (!response.ok) throw Error(`下载失败（HTTP ${response.status}）：${url}`);
  const bytes = verifyDownload(Buffer.from(await response.arrayBuffer()), 'sha256', expected);
  await writeFile(file, bytes, { flag: 'wx' });
  return bytes;
}

function run(command, args, options = {}) {
  const result = spawnSync(command, args, { cwd: root, windowsHide: true, stdio: 'inherit', ...options });
  if (result.error) throw result.error;
  if (result.status !== 0) throw Error('发布步骤失败：' + basename(command));
}

async function main() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('请在 Windows x64 上制作此便携包。');
  if (process.argv.length > 2) throw Error('用法：npm run release:win');
  const npmCLI = process.env.npm_execpath;
  if (!npmCLI || !existsSync(npmCLI)) throw Error('请通过 npm run release:win 执行打包。');
  const pkg = JSON.parse(await readFile(join(root, 'package.json'), 'utf8'));
  if (!/^\d+\.\d+\.\d+(?:-[a-zA-Z0-9.-]+)?$/.test(pkg.version)) throw Error('package.json 版本号无效');
  const name = `KleeAPI-${pkg.version}-windows-x64`, output = join(root, 'output/releases');
  const archive = join(output, name + '.zip');
  if (existsSync(archive) || existsSync(archive + '.sha256')) throw Error('此版本的发布包已存在，请先另存旧包或修改 package.json 版本号。');
  console.log('[1/5] 安装前端构建依赖并构建页面');
  run(process.execPath, [npmCLI, '--prefix', 'frontend', 'ci']);
  run(process.execPath, [npmCLI, 'run', 'build']);
  const cache = join(root, 'output/release-cache');
  await mkdir(cache, { recursive: true });
  console.log('[2/5] 下载并校验固定版本 Node.js LTS 与 Qoder 官方组件');
  const nodeBytes = await download(nodeURL, nodeHash, cache);
  const licenseBytes = await download(nodeLicenseURL, nodeLicenseHash, cache);
  const qoder = await downloadRuntimeFiles();
  const runtimeFiles = { 'node.exe': nodeBytes, 'Node-LICENSE.txt': licenseBytes, ...Object.fromEntries(Object.entries(qoder).map(([path, bytes]) => ['qoder/' + path, bytes])) };
  await mkdir(output, { recursive: true });
  const staging = await mkdtemp(join(output, '.staging-'));
  try {
    const directory = join(staging, name);
    console.log('[3/5] 组装干净文件与许可证，排除本机账号和运行数据');
    await stageRelease({ source: root, destination: directory, runtimeFiles });
    console.log('[4/5] 使用内置 Node 检查运行环境和发布文件');
    run(join(directory, 'runtime/node.exe'), ['--input-type=module', '-e', "import {checkInstallation} from './scripts/preflight.mjs'; await checkInstallation(); console.log('发布包检查通过');"], { cwd: directory });
    console.log('[5/5] 生成 ZIP 与 SHA-256');
    const temporaryZip = join(staging, name + '.zip');
    run('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', '$ErrorActionPreference="Stop"; Add-Type -AssemblyName System.IO.Compression.FileSystem; [IO.Compression.ZipFile]::CreateFromDirectory($env:KLEE_RELEASE_SOURCE, $env:KLEE_RELEASE_ZIP, [IO.Compression.CompressionLevel]::Optimal, $true)'], {
      env: { ...process.env, KLEE_RELEASE_SOURCE: directory, KLEE_RELEASE_ZIP: temporaryZip },
    });
    const checksum = hash(await readFile(temporaryZip));
    await copyFile(temporaryZip, archive, constants.COPYFILE_EXCL);
    await writeFile(archive + '.sha256', checksum + '  ' + basename(archive) + '\n', { flag: 'wx' });
    console.log('发布包：' + archive);
    console.log('SHA-256：' + checksum);
  } finally {
    // 只清理由本次 mkdtemp 创建、且仍位于 output/releases 内的构建目录。
    if (!resolve(staging).startsWith(resolve(output) + sep + '.staging-')) throw Error('拒绝清理发布目录外的路径');
    await rm(staging, { recursive: true, force: true });
  }
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) main().catch(error => { console.error(error.message); process.exitCode = 1; });
