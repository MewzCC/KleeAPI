import { readFileSync, mkdirSync, unlinkSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWrite } from './store.mjs';
import { reportedCredits, creditEstimate } from './credit-estimate.mjs';

const limit = 2000;
const count = value => Number.isSafeInteger(value) && value >= 0 ? value : null;

/** 只提取可展示的计量字段。没有明确上报的积分保持未知。 */
export function usageFields(usage) {
  const inputTokens = count(usage?.prompt_tokens ?? usage?.input_tokens);
  const outputTokens = count(usage?.completion_tokens ?? usage?.output_tokens);
  const estimate = creditEstimate(usage);
  return {
    inputTokens,
    outputTokens,
    totalTokens: count(usage?.total_tokens) ??
      (inputTokens !== null && outputTokens !== null ? count(inputTokens + outputTokens) : null),
    credits: reportedCredits(usage),
    estimatedCredits: estimate?.amount ?? null,
    creditEstimate: estimate,
  };
}

/** 列表仅保存元数据，对话逐条存入本地文件，详情按需读取。 */
export function createUsageLog(file) {
  let records = [];
  let warning = '';
  let writable = !!file;
  const conversations = new Map();
  const contentDir = file ? join(dirname(file), 'usage-content') : null;
  const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
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
    add(record, conversation) {
      if (conversation && validId(record.id)) {
        record = { ...record, hasConversation: true };
        conversations.set(record.id, conversation);
        if (writable) {
          try {
            mkdirSync(contentDir, { recursive: true, mode: 0o700 });
            atomicWrite(join(contentDir, record.id + '.json'), JSON.stringify(conversation));
            conversations.delete(record.id);
          } catch { warning = '部分对话内容暂未能写入本机，重启可能丢失。'; }
        }
      }
      records.unshift(record);
      for (const expired of records.splice(limit)) {
        conversations.delete(expired.id);
        if (contentDir && validId(expired.id)) try { unlinkSync(join(contentDir, expired.id + '.json')); } catch { /* 已缺失的过期文件无需处理。 */ }
      }
      if (!writable) return;
      try {
        atomicWrite(file, JSON.stringify(records));
        if (!conversations.size) warning = '';
      } catch {
        warning = '调用记录暂时无法写入本机，重启可能丢失未保存的记录。';
      }
    },
    snapshot() {
      return { records, limit, warning };
    },
    detail(id) {
      const record = validId(id) && records.find(row => row.id === id);
      if (!record) return null;
      let conversation = conversations.get(id) || null;
      let warning = '';
      if (!conversation && record.hasConversation && contentDir) {
        try { conversation = JSON.parse(readFileSync(join(contentDir, id + '.json'), 'utf8')); }
        catch { warning = '此记录的本地对话文件无法读取，暂不能显示原文。'; }
      }
      return { record, conversation, warning };
    },
  };
}
