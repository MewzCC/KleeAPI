import { readdir, stat } from 'node:fs/promises';
import { homedir } from 'node:os';
import { join, isAbsolute } from 'node:path';
import { fileURLToPath } from 'node:url';
import { ApiError } from '../app/http.mjs';

/** 只定位官方程序；显式覆盖路径错误时不退回其他设备身份程序。 */
export async function findRuntimeInfo(cfg, { platform = process.platform, arch = process.arch, env = process.env, home = homedir(), runtimeDir = fileURLToPath(new URL('../../runtime/qoder', import.meta.url)) } = {}) {
  const name = platform === 'win32' ? 'runtime-info.exe' : 'runtime-info';
  const paths = [], override = env[cfg.prefix + 'RUNTIME_INFO'];
  if (override) {
    if (!isAbsolute(override)) throw new ApiError(`${cfg.prefix}RUNTIME_INFO 必须是官方 runtime-info 的绝对路径`);
    paths.push(override);
  } else {
    if (platform === 'win32') {
      for (const base of [join(env.LOCALAPPDATA || join(home, 'AppData', 'Local'), 'Programs'), env.ProgramFiles, env.ProgramW6432].filter(Boolean)) paths.push(join(base, cfg.app, 'resources', 'umid', name));
    } else if (platform === 'darwin') {
      for (const base of ['/Applications', join(home, 'Applications')]) paths.push(join(base, cfg.app + '.app', 'Contents', 'Resources', 'umid', name));
    } else paths.push(join('/opt', cfg.linux, 'resources', 'umid', name));
    const config = env[cfg.prefix + 'CONFIG_DIR'] || join(env[cfg.prefix + 'CLI_HOME'] || home, env[cfg.prefix + 'CONFIG_DIR_NAME'] || cfg.dir);
    const cache = join(config, '.bin');
    for (const d of await readdir(cache, { withFileTypes: true }).catch(() => [])) {
      if (platform === 'win32' && d.isDirectory() && d.name.startsWith(`umid-win32-${arch}-`)) paths.push(join(cache, d.name, name));
      else if (platform !== 'win32' && d.isFile() && d.name.startsWith(`runtime-info-${platform}-${arch}-`) && !d.name.endsWith('.tmp')) paths.push(join(cache, d.name));
    }
    if (platform === 'win32' && arch === 'x64') paths.push(join(runtimeDir, name));
  }
  for (const path of paths) if ((await stat(path).catch(() => null))?.isFile()) return path;
}
