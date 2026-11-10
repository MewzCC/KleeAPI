import { readFileSync } from 'node:fs';
import { atomicWrite } from './store.mjs';

const limit = 2000;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;
const amount = value => Number.isFinite(value) && value >= 0 ? value : null;

/** 只提取可展示的计量字段。没有明确上报的积分保持未知。 */
export function usageFields(usage) {
  const inputTokens = count(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = count(usage?.completion_tokens ?? usage?.output_tokens);
  return {
    inputTokens,
    outputTokens,
    totalTokens: count(usage?.total_tokens) ??
      (inputTokens !== null && outputTokens !== null ? count(inputTokens + outputTokens) : null),
    credits: amount(usage?.credits_consumed ?? usage?.credits_used ?? usage?.credits),
  };
}

/** 日志只保存最近的调用元数据，写入失败时继续提供本次运行的内存记录。 */
export function createUsageLog(file) {
  let records = [];
  let warning = '';
  let writable = !!file;
  if (file) {
    try {
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(saved) || saved.some(row => !row || typeof row.id !== 'string' || !Number.isFinite(row.startedAt))) {
        throw new Error('Invalid usage log');
      }
      records = saved.slice(0, limit);
    } catch (error) {
      if (error.code !== 'ENOENT') {
        writable = false;
        warning = '历史记录文件无法读取，当前仅显示本次运行的记录。';
      }
    }
  }
  return {
    add(record) {
      records.unshift(record);
      if (records.length > limit) records.length = limit;
      if (!writable) return;
      try {
        atomicWrite(file, JSON.stringify(records));
        warning = '';
      } catch {
        warning = '调用记录暂时无法写入本机，重启可能丢失未保存的记录。';
      }
    },
    snapshot() {
      return { records, limit, warning };
    },
  };
}
