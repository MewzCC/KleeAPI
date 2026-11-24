import { readFile, access, mkdir, open, unlink } from 'node:fs/promises';
import { constants } from 'node:fs';
import { createHash, randomUUID } from 'node:crypto';
import { resolve, join, sep, dirname, delimiter } from 'node:path';
import { spawn } from 'node:child_process';
import { root } from '../klee-api/app/config.mjs';

/** 启动检查不读取账号，也不调用上游；配置文件允许用户修改。 */
export async function checkInstallation({ base = root, dev = false, nodeVersion = process.versions.node, platform = process.platform, arch = process.arch } = {}) {
  const [major, minor] = nodeVersion.replace(/^v/, '').split('.').map(Number);
  if (!Number.isInteger(major) || major < 22 || major === 22 && minor < 12) throw Error('需要 Node.js 22.12 或以上版本。便携版请完整解压，使用随包附带的 runtime/node.exe。');
  let release;
  try { release = JSON.parse(await readFile(join(base, 'release.json'), 'utf8')); }
  catch (error) { if (error.code !== 'ENOENT') throw Error('发布清单无法读取，请重新下载并完整解压发布包。'); }
  if (release && (platform !== 'win32' || arch !== 'x64')) throw Error('此便携包仅支持 Windows x64，请在对应系统上运行。');
  if (!dev) {
    try { await access(join(base, 'frontend/dist/index.html'), constants.R_OK); }
    catch { throw Error(release ? '缺少管理页面，请先完整解压 ZIP 到可写文件夹，再双击 Start-Manager.cmd；不要直接在压缩包中运行。' : '缺少 frontend/dist/index.html，请先运行 npm run setup 和 npm run build，或下载已构建的 Windows 便携版。'); }
  }
  if (release) {
    if (release.platform !== 'win32' || release.arch !== 'x64' || !release.files || typeof release.files !== 'object' || Array.isArray(release.files) || !Object.keys(release.files).length) throw Error('发布清单格式无效，请重新下载并完整解压。');
    for (const [path, hash] of Object.entries(release.files)) {
      const file = resolve(base, path);
      if (path.split('/').some(part => !part || part === '.' || part === '..' || /[\x00-\x1f<>:"\\|?*]/.test(part)) || !file.startsWith(resolve(base) + sep) || !/^[a-f0-9]{64}$/.test(hash)) throw Error('发布清单包含无效文件路径或校验值，请重新下载发布包。');
      if (path === 'klee-config.json') continue;
      let bytes;
      try { bytes = await readFile(file); }
      catch { throw Error('发布包文件缺失，请完整解压或重新下载：' + path); }
      if (createHash('sha256').update(bytes).digest('hex') !== hash) throw Error('发布包完整性检查失败，请重新下载并解压：' + path);
    }
  }
  const probe = join(base, 'runtime', '.write-check-' + randomUUID());
  try {
    await mkdir(join(base, 'runtime'), { recursive: true });
    const handle = await open(probe, 'wx');
    await handle.close();
    await unlink(probe);
  } catch { throw Error('当前文件夹无法写入，请把完整目录解压到桌面或自己的用户文件夹后再启动。'); }
}

async function readable(file) {
  try { await access(file, constants.R_OK); return true; }
  catch (error) { if (error.code === 'ENOENT') return false; throw error; }
}

async function runNpm(args, cwd) {
  const directories = [dirname(process.execPath), ...(process.env.PATH || '').split(delimiter).filter(Boolean)];
  const candidates = [process.env.npm_execpath, ...directories.flatMap(dir => [join(dir, 'node_modules/npm/bin/npm-cli.js'), join(dir, '../lib/node_modules/npm/bin/npm-cli.js'), join(dir, '../share/nodejs/npm/bin/npm-cli.js')])].filter(Boolean);
  let cli;
  for (const candidate of candidates) if (await readable(candidate)) { cli = candidate; break; }
  if (!cli) throw Error('未找到 npm；请安装包含 npm 的 Node.js');
  await new Promise((resolve, reject) => {
    const child = spawn(process.execPath, [cli, ...args], { cwd, windowsHide: true, stdio: 'inherit', env: { ...process.env, PATH: dirname(process.execPath) + delimiter + (process.env.PATH || '') } });
    child.once('error', reject);
    child.once('exit', code => code === 0 ? resolve() : reject(Error('npm ' + args.join(' ') + ' 未完成（退出码 ' + code + '）')));
  });
}

/** 源码首次启动自动准备缺少的依赖和页面；便携包仍按发布清单校验。 */
export async function prepareInstallation({ base = root, dev = false, run = runNpm, log = console.log, ...options } = {}) {
  if (await readable(join(base, 'release.json'))) return checkInstallation({ base, dev, ...options });
  await checkInstallation({ base, dev: true, ...options });
  const built = await readable(join(base, 'frontend/dist/index.html'));
  if (!dev && built) return;
  try {
    const dependencies = ['vite/bin/vite.js', 'vue-tsc/bin/vue-tsc.js', 'typescript/lib/tsc.js'];
    const installed = (await Promise.all(dependencies.map(path => readable(join(base, 'frontend/node_modules', path))))).every(Boolean);
    if (!installed) {
      log('首次启动：正在自动安装前端依赖，请等待完成…');
      await run(['ci', '--include=dev'], join(base, 'frontend'));
    }
    if (!dev && !built) {
      log('首次启动：正在自动构建管理页面…');
      await run(['run', 'build'], join(base, 'frontend'));
    }
    await checkInstallation({ base, dev, ...options });
  } catch (error) {
    throw Error('自动安装或构建失败：' + error.message + '。请检查网络、文件夹写入权限和 npm；可安装完整的 Node.js 22.12+ 后重试，或下载已构建的 Windows 便携版：https://github.com/MewzCC/KleeAPI/releases', { cause: error });
  }
}
