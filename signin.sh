#!/usr/bin/env sh
set -eu
cd -- "$(dirname -- "$0")"
runtime=node
if [ -x ./runtime/node.exe ]; then
  runtime=./runtime/node.exe
fi
exec "$runtime" --input-type=module - "$@" <<'NODE'
import { readFile } from 'node:fs/promises';
import { loadConfig } from './klee-api/app/config.mjs';

try {
  const [accountId, ...extra] = process.argv.slice(2);
  if (extra.length) throw new Error('用法：bash signin.sh [设备参考账号 ID]');
  const { ports } = loadConfig();
  const key = (await readFile('Trae-Chat/data/Trae/api-key.txt', 'utf8')).trim();
  if (!key) throw new Error('Trae 服务 Key 为空，请先启动 KleeAPI。');
  const response = await fetch('http://127.0.0.1:' + ports.trae + '/api/checkin/pool', {
    method: 'POST',
    headers: { Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' },
    body: JSON.stringify({ accountId }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error?.message || '批跑失败，HTTP ' + response.status);
  if (!Array.isArray(result.accounts)) throw new Error('服务返回的签到结果无效。');
  if (!result.accounts.length) console.log('Trae 号池没有账号。');
  for (const row of result.accounts) {
    const balance = Number.isFinite(row.balanceAfter) ? ' · 余额 ' + row.balanceAfter : '';
    console.log(row.uid + ' · ' + row.message + balance + (row.balanceError ? ' · ' + row.balanceError : ''));
    if (['failed', 'pending', 'unknown'].includes(row.status) || row.balanceError) process.exitCode = 1;
  }
  if (result.stopped) console.log('本机设备今日已领取，批次已停止。');
} catch (error) {
  console.error(error.code === 'ENOENT' || error.cause?.code === 'ECONNREFUSED'
    ? '请先启动当前目录的 KleeAPI Trae 服务。'
    : error.message);
  process.exitCode = 1;
}
NODE
