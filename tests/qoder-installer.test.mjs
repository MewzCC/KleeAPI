import test from 'node:test';
import assert from 'node:assert/strict';
import { embeddedRuntime, tarEntry } from '../scripts/setup-qoder-runtime.mjs';

const pe = () => {
  const bytes = Buffer.alloc(128);
  bytes.write('MZ'); bytes.writeUInt32LE(64, 60); bytes.write('PE\0\0', 64); bytes.writeUInt16LE(0x8664, 68);
  return bytes;
};
const bundle = (exe, dll) => `var X="${exe.toString('base64')}",Y="${dll.toString('base64')}",E=Buffer.from(X,"base64"),D=Buffer.from(Y,"base64");class Runtime{async extractBinary(){prepare({bridgeBinary:E,dllBinary:D})}selectBinary(A,e){return"win32"===A&&"x64"===e?E:null}}`;

test('installer extracts unchanged official executable bytes and rejects invalid PE data', () => {
  const exe = pe(), dll = pe(); dll[100] = 42;
  const result = embeddedRuntime(bundle(exe, dll));
  assert.deepEqual(result['runtime-info.exe'], exe);
  assert.deepEqual(result['sgsdk.dll'], dll);
  assert.throws(() => embeddedRuntime(bundle(Buffer.from('invalid'), dll)), /格式无效/);
  assert.throws(() => embeddedRuntime('unknown package layout'), /布局已变化/);
});

test('tar reader returns only the requested entry and rejects truncated archives', () => {
  const header = Buffer.alloc(512), data = Buffer.from('official fixture');
  header.write('package/LICENSE'); header.write(data.length.toString(8).padStart(11, '0') + '\0', 124);
  const tar = Buffer.concat([header, data, Buffer.alloc(512 - data.length), Buffer.alloc(512)]);
  assert.deepEqual(tarEntry(tar, 'package/LICENSE'), data);
  assert.throws(() => tarEntry(tar, 'missing'), /缺少/);
  assert.throws(() => tarEntry(tar.subarray(0, 515), 'package/LICENSE'), /结构无效/);
});
