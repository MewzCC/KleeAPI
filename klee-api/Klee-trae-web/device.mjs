import { execFile } from 'node:child_process';
import { readFile, readdir, stat } from 'node:fs/promises';
import { homedir, platform, type, version } from 'node:os';
import { join } from 'node:path';
import { decodeNativeAuth } from './native-auth.mjs';
import { ApiError } from '../app/http.mjs';

let system;
async function localSystem() {
  if (!system) system = (async () => {
    const result = { deviceBrand: '', deviceType: platform() === 'win32' ? 'windows' : platform() === 'darwin' ? 'mac' : platform(), osVersion: version() || type(), versions: {} };
    if (platform() !== 'win32') return result;
    const data = await new Promise(resolve => execFile('powershell.exe', ['-NoProfile', '-NonInteractive', '-Command', "$model=(Get-CimInstance Win32_ComputerSystem).Model; $apps=Get-ItemProperty 'HKCU:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*','HKLM:\\Software\\Microsoft\\Windows\\CurrentVersion\\Uninstall\\*' -ErrorAction SilentlyContinue | Where-Object DisplayName -Match 'Trae' | Select-Object DisplayName,DisplayVersion; @{model=$model;apps=@($apps)} | ConvertTo-Json -Compress"], { windowsHide: true, timeout: 10000, maxBuffer: 65536 }, (error, stdout) => { try { resolve(error ? {} : JSON.parse(stdout)); } catch { resolve({}); } }));
    result.deviceBrand = data.model || '';
    for (const app of data.apps || []) result.versions[/SOLO|Work/i.test(app.DisplayName) ? 2 : 1] = app.DisplayVersion;
    return result;
  })();
  return system;
}

/** 仅复用本机官方客户端已登录同一账号的注册设备，不借用其他账号或生成新设备。 */
export async function registeredDevice(reqSource, uid, appData = process.env.APPDATA || join(homedir(), 'AppData', 'Roaming')) {
  if (!uid) return;
  const profiles = reqSource === 1 ? ['Trae CN'] : ['TRAE SOLO CN', 'TraeWork CN'];
  for (const profile of profiles) {
    const base = join(appData, profile);
    const storage = await readFile(join(base, 'User', 'globalStorage', 'storage.json'), 'utf8').then(JSON.parse).catch(() => ({}));
    if (!storage || typeof storage !== 'object') continue;
    const active = decodeNativeAuth(storage['iCubeAuthInfo://icube.cloudide']);
    // 必须校验当前登录记录，不能用历史设备密钥推断账号。
    if (!active || String(active.userId || '') !== uid || !active.account) continue;
    const logs = (await readdir(join(base, 'logs'), { withFileTypes: true }).catch(() => [])).filter(d => d.isDirectory() && /^\d{8}T\d{6}$/.test(d.name)).sort((a, b) => b.name.localeCompare(a.name));
    for (const dir of logs.slice(0, 3)) {
      const file = join(base, 'logs', dir.name, 'main.log');
      if (!((await stat(file).catch(() => null))?.size <= 8 * 1024 * 1024)) continue;
      const text = await readFile(file, 'utf8').catch(() => '');
      const id = [...text.matchAll(/\[ICDRS\] \(init\) resolve rdid: (\d{6,30})\b/g)].at(-1)?.[1];
      if (id && id !== '0') return id;
    }
  }
}

export async function ugDeviceContext(account) {
  const local = await localSystem();
  const reqSource = account.reqSource ?? 2;
  const native = await registeredDevice(reqSource, account.uid);
  const result = { deviceId: native || account.deviceId, deviceBrand: native ? local.deviceBrand : account.deviceBrand || local.deviceBrand, deviceType: native ? local.deviceType : account.deviceType || local.deviceType, osVersion: native ? local.osVersion : account.osVersion || local.osVersion, appVersion: native ? local.versions[reqSource] : account.appVersion || local.versions[reqSource] };
  for (const key of Object.keys(result)) if (typeof result[key] !== 'string' || !/^[\x20-\x7e]{1,512}$/.test(result[key])) delete result[key];
  return result;
}

/** 仅显式同步操作跨来源查找；使用实际登录客户端的来源，不进行失败后的来源轮询。 */
export async function findRegisteredContext(account, appData) {
  const preferred = account.reqSource ?? 2;
  for (const reqSource of [preferred, preferred === 1 ? 2 : 1]) {
    const deviceId = await registeredDevice(reqSource, account.uid, appData);
    if (deviceId) return { reqSource, deviceId };
  }
}

export async function syncDevice(account) {
  const binding = await findRegisteredContext(account);
  if (!binding) throw new ApiError('未确认此账号的本机官方设备，请在 Trae CN 或 TraeWork 登录同一账号后同步',409,'trae_native_device_unavailable');
  return { ...await ugDeviceContext({ uid: account.uid, ...binding }), ...binding };
}
