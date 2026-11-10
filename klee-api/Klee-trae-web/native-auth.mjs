import { createHash, createDecipheriv, timingSafeEqual } from 'node:crypto';

// 对齐本机 Trae CN 3.4.15 的 byteCrypto.js tc05 格式；此材料属于客户端格式，不是用户密钥。
const material = Buffer.from('4dd4c2e6b83162090e52b3c7a6733ba41cb2462b829ab58a196b39db57177524f49baf7f08e8d68d26a72e37c1a95a2f1f05a51892aef2949732b62a38aadd58', 'hex');
const digest = bytes => createHash('sha512').update(bytes).digest();

/** 仅在内存解码本机登录记录；不写入官方配置、持久化明文或打印凭据。 */
export function decodeNativeAuth(value) {
  try {
    if (typeof value === 'string' && value.length <= 128 * 1024 && !value.trimStart().startsWith('{')) {
      const bytes = Buffer.from(value, 'base64');
      if (bytes.length < 118 || !bytes.subarray(0, 6).equals(Buffer.from('746305100000', 'hex')) || (bytes.length - 38) % 16) return;
      const key = digest(Buffer.concat([digest(bytes.subarray(6, 38)), material]));
      const decipher = createDecipheriv('aes-128-cbc', key.subarray(0, 16), key.subarray(16, 32));
      const plain = Buffer.concat([decipher.update(bytes.subarray(38)), decipher.final()]);
      if (plain.length <= 64 || !timingSafeEqual(plain.subarray(0, 64), digest(plain.subarray(64)))) return;
      value = plain.subarray(64).toString('utf8');
    }
    const record = typeof value === 'string' ? JSON.parse(value) : value;
    return record && typeof record === 'object' && !Array.isArray(record) && record.userId && record.account && typeof record.account === 'object'
      ? { userId: String(record.userId), account: { scope: record.account.scope } } : undefined;
  } catch { return undefined; }
}
