import { createHash } from 'node:crypto';
import { gunzipSync } from 'node:zlib';
import { mkdir, writeFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { resolve, join } from 'node:path';

const version = '1.1.86';
const integrity = 'u0JS8emhZjOxIx1DGV2LWCdoyNJIOahHjPptedkzsp3DTfAVGC+fxpyWOsIeK3VX1MwgJ4rAiPy+rDowNmZb0g==';
const archiveURL = `https://registry.npmjs.org/@qoder-ai/qodercli/-/qodercli-${version}.tgz`;

export function tarEntry(tar, name) {
  for (let offset = 0; offset + 512 <= tar.length;) {
    const header = tar.subarray(offset, offset + 512);
    const filename = header.subarray(0, 100).toString().replace(/\0.*$/, '');
    if (!filename) break;
    const size = parseInt(header.subarray(124, 136).toString().replace(/\0.*$/, '').trim(), 8);
    if (!Number.isSafeInteger(size) || size < 0 || offset + 512 + size > tar.length) throw Error('Qoder 官方包结构无效');
    if (filename === name) return tar.subarray(offset + 512, offset + 512 + size);
    offset += 512 + Math.ceil(size / 512) * 512;
  }
  throw Error('Qoder 官方包缺少所需文件');
}

/** 原样提取固定版本官方 CLI 内嵌的 Windows 程序与 DLL，不执行 CLI 或生成设备标识。 */
export function embeddedRuntime(source) {
  const selector = source.match(/selectBinary\(\w+,\w+\)\{return[^}]*?"win32"===\w+&&"x64"===\w+\?(\w+):null\}/);
  if (!selector) throw Error('Qoder 官方包的身份组件布局已变化');
  const extractor = source.slice(source.lastIndexOf('async extractBinary(){', selector.index), selector.index);
  const dll = extractor.match(/dllBinary:(\w+)/)?.[1];
  if (!dll) throw Error('Qoder 官方包缺少身份 DLL');
  const binaries = {};
  for (const [name, alias] of [['runtime-info.exe', selector[1]], ['sgsdk.dll', dll]]) {
    const variable = source.match(new RegExp(`\\b${alias}=Buffer\\.from\\((\\w+),"base64"\\)`))?.[1];
    const encoded = variable && source.match(new RegExp(`\\b${variable}="([A-Za-z0-9+/=]+)"`))?.[1];
    const bytes = encoded ? Buffer.from(encoded, 'base64') : Buffer.alloc(0);
    const pe = bytes.length >= 64 ? bytes.readUInt32LE(60) : 0;
    if (bytes.toString('ascii', 0, 2) !== 'MZ' || pe < 64 || pe + 24 > bytes.length || bytes.toString('ascii', pe, pe + 4) !== 'PE\0\0' || bytes.readUInt16LE(pe + 4) !== 0x8664) throw Error('Qoder 官方身份组件格式无效');
    binaries[name] = bytes;
  }
  return binaries;
}

async function install() {
  if (process.platform !== 'win32' || process.arch !== 'x64') throw Error('此安装命令目前仅支持 Windows x64；其他平台请安装官方 Qoder CLI');
  const response = await fetch(archiveURL, { signal: AbortSignal.timeout(120000), redirect: 'error' });
  if (!response.ok) throw Error(`下载 Qoder 官方包失败（HTTP ${response.status}）`);
  const archive = Buffer.from(await response.arrayBuffer());
  if (createHash('sha512').update(archive).digest('base64') !== integrity) throw Error('Qoder 官方包完整性校验失败，已停止安装');
  const tar = gunzipSync(archive, { maxOutputLength: 256 * 1024 * 1024 });
  const binaries = embeddedRuntime(tarEntry(tar, 'package/bundle/qodercli.js').toString('utf8'));
  const dir = fileURLToPath(new URL('../runtime/qoder', import.meta.url));
  await mkdir(dir, { recursive: true });
  for (const [name, bytes] of Object.entries(binaries)) await writeFile(join(dir, name), bytes);
  await writeFile(join(dir, 'LICENSE.txt'), tarEntry(tar, 'package/LICENSE'));
  await writeFile(join(dir, 'source.json'), JSON.stringify({ package: '@qoder-ai/qodercli', version, archiveURL, integrity: 'sha512-' + integrity, files: Object.fromEntries(Object.entries(binaries).map(([name, bytes]) => [name, createHash('sha256').update(bytes).digest('hex')])) }, null, 2));
  console.log(`已安装 Qoder 官方身份组件 ${version}（仅保存在本机 runtime/qoder）`);
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) install().catch(() => { console.error('Qoder 官方身份组件安装失败；请检查网络或通过官方客户端安装，然后重新运行 npm run setup:qoder。'); process.exitCode = 1; });
