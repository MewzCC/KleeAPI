import { readFileSync, mkdirSync, unlinkSync, lstatSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { atomicWrite } from './store.mjs';
import { ApiError } from './http.mjs';
import { reportedCredits, creditEstimate } from './credit-estimate.mjs';

const limit = 2000;
const defaults = { mode: 'stats', retentionDays: 0 };
const validId = id => typeof id === 'string' && /^[a-zA-Z0-9_-]{1,80}$/.test(id);
const settingFields = {
  mode: value => value === 'stats' || value === 'content',
  retentionDays: value => [0, 7, 30, 90].includes(value),
};

function validSettings(value, partial = false) {
  if (!value || typeof value !== 'object' || Array.isArray(value)) return false;
  const fields = Object.keys(value);
  return (partial ? fields.length > 0 : fields.length === 2)
    && fields.every(key => Object.hasOwn(settingFields, key) && settingFields[key](value[key]));
}
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
  let historyUnreadable = false;
  let settingsWarning = '';
  let settings = { ...defaults };
  let captureVersion = 0, recordVersion = 0;
  const conversations = new Map();
  const contentDir = file ? join(dirname(file), 'usage-content') : null;
  const settingsFile = file ? join(dirname(file), 'usage-settings.json') : null;

  function applySettings(next) {
    if (settings.mode !== next.mode || settings.retentionDays !== next.retentionDays) captureVersion++;
    settings = next;
  }

  function readSettings() {
    if (!settingsFile) return;
    let next = { ...defaults };
    settingsWarning = '';
    try {
      if (!lstatSync(settingsFile).isFile()) throw Error('Invalid settings file');
      const saved = JSON.parse(readFileSync(settingsFile, 'utf8'));
      if (!validSettings(saved)) throw Error('Invalid settings');
      next = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') settingsWarning = '记录设置无法读取，已暂停保存原文。请重新保存设置。';
    }
    applySettings(next);
  }

  function hasContentDir(create = false) {
    if (!contentDir) return false;
    try {
      if (create) mkdirSync(contentDir, { recursive: true, mode: 0o700 });
      if (!lstatSync(contentDir).isDirectory()) throw Error('Invalid conversation directory');
      return true;
    } catch (error) {
      if (error.code === 'ENOENT' && !create) return false;
      throw error;
    }
  }

  function storedFiles() {
    if (!hasContentDir()) return [];
    return readdirSync(contentDir, { withFileTypes: true })
      .filter(entry => /^([a-zA-Z0-9_-]{1,80}\.json|[a-zA-Z0-9_-]{1,80}\.json\.[a-f0-9]{12}\.tmp)$/.test(entry.name));
  }

  function unlink(filePath) {
    try { unlinkSync(filePath); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  }

  function removeContent(id) {
    if (hasContentDir()) unlink(join(contentDir, id + '.json'));
    conversations.delete(id);
  }

  function retained() {
    const cutoff = settings.retentionDays ? Date.now() - settings.retentionDays * 86400000 : -Infinity;
    return records.filter(row => row.startedAt >= cutoff).slice(0, limit);
  }

  function persist(next, recover = false) {
    if (file && (!historyUnreadable || recover)) atomicWrite(file, JSON.stringify(next));
    records = next;
    if (recover) historyUnreadable = false;
  }

  function clean(next, { scan = false, recover = false } = {}) {
    const kept = new Set(next.map(row => row.id));
    for (const row of records) if (!kept.has(row.id)) removeContent(row.id);
    // A corrupt index cannot tell us which files still belong to a record.
    if (scan && (!historyUnreadable || recover)) {
      const liveFiles = new Set(next.filter(row => row.hasConversation).map(row => row.id + '.json'));
      for (const entry of storedFiles()) if (!liveFiles.has(entry.name)) unlink(join(contentDir, entry.name));
    }
    if (next.length !== records.length || recover) persist(next, recover);
  }

  function prune(scan = false) {
    try { clean(retained(), { scan }); return true; }
    catch { return false; }
  }

  if (file) {
    try {
      if (!lstatSync(file).isFile()) throw Error('Invalid usage log file');
      const saved = JSON.parse(readFileSync(file, 'utf8'));
      if (!Array.isArray(saved) || saved.some(row => !row || !validId(row.id) || !Number.isFinite(row.startedAt))) {
        throw new Error('Invalid usage log');
      }
      records = saved;
    } catch (error) {
      if (error.code !== 'ENOENT') historyUnreadable = true;
    }
  }
  readSettings();
  if (!prune(true)) warning = '部分历史记录未能清理，请检查本机数据目录。';
  const timer = file && setInterval(() => {
    readSettings();
    if (!prune(true)) warning = '部分历史记录未能清理，请检查本机数据目录。';
  }, 60000).unref();

  const log = {
    recordVersion: () => recordVersion,
    beginCapture() {
      readSettings();
      return settings.mode === 'content' && !historyUnreadable ? captureVersion : null;
    },
    add(record, conversation, permit = captureVersion, version = recordVersion) {
      if (version !== recordVersion || !validId(record.id)) return;
      readSettings();
      warning = '';
      const cutoff = settings.retentionDays ? Date.now() - settings.retentionDays * 86400000 : -Infinity;
      if (record.startedAt < cutoff) return;
      if (conversation && settings.mode === 'content' && permit === captureVersion && !historyUnreadable) {
        try {
          if (file) {
            hasContentDir(true);
            atomicWrite(join(contentDir, record.id + '.json'), JSON.stringify(conversation));
          } else conversations.set(record.id, conversation);
          record = { ...record, hasConversation: true };
        } catch { warning = '本次对话原文未能写入本机。'; }
      }
      records.unshift(record);
      const next = retained();
      try {
        if (next.length !== records.length) clean(next);
        else persist(next);
      } catch {
        // Limit memory even if persistence fails. A later sweep retries orphaned files.
        records = next;
        warning = '部分调用记录未能保存或清理，请检查本机数据目录。';
      }
    },
    snapshot() {
      readSettings();
      const cleaned = prune();
      const current = retained();
      let storedConversations = conversations.size;
      let contentWarning = '';
      if (file) {
        try {
          const disk = new Set(storedFiles().filter(entry => entry.isFile()).map(entry => entry.name));
          storedConversations = current.filter(row => row.hasConversation && disk.has(row.id + '.json')).length;
        } catch { contentWarning = '对话文件目录无法读取。'; }
      }
      return { records: current, limit, settings: { ...settings }, storedConversations,
        warning: [settingsWarning, historyUnreadable && '历史记录文件无法读取，当前仅显示本次运行的记录。',
          !cleaned && '部分过期记录未能清理。', contentWarning, warning].filter(Boolean).join(' ') };
    },
    detail(id) {
      readSettings();
      prune();
      const record = validId(id) && retained().find(row => row.id === id);
      if (!record) return null;
      let conversation = conversations.get(id) || null;
      let warning = '';
      if (!conversation && record.hasConversation && contentDir) {
        try {
          const path = join(contentDir, id + '.json');
          if (!hasContentDir() || !lstatSync(path).isFile()) throw Error('Invalid conversation file');
          conversation = JSON.parse(readFileSync(path, 'utf8'));
        }
        catch { warning = '此记录的本地对话文件无法读取，暂不能显示原文。'; }
      }
      return { record, conversation, warning };
    },
    updateSettings(patch) {
      if (!validSettings(patch, true)) throw new ApiError('请选择有效的保存方式和保留期限。', 400, 'invalid_usage_settings');
      readSettings();
      const next = { ...settings, ...patch };
      try { if (settingsFile) atomicWrite(settingsFile, JSON.stringify(next)); }
      catch { throw new ApiError('记录设置无法写入，请检查本机数据目录。', 500, 'usage_settings_write_failed'); }
      applySettings(next);
      if (!prune(true)) throw new ApiError('设置已保存，但部分过期记录未能清理，请检查本机数据目录。', 500, 'usage_cleanup_failed');
      warning = '';
      return log.snapshot();
    },
    remove(id) {
      if (!validId(id) || !records.some(row => row.id === id)) throw new ApiError('调用记录不存在或已过期。', 404, 'usage_not_found');
      try { clean(records.filter(row => row.id !== id)); }
      catch { throw new ApiError('删除调用记录失败，请检查本机数据目录后重试。', 500, 'usage_delete_failed'); }
      warning = '';
      return log.snapshot();
    },
    clear() {
      recordVersion++;
      captureVersion++;
      try { clean([], { scan: true, recover: true }); }
      catch { throw new ApiError('部分记录未能清空，请检查本机数据目录后重试。', 500, 'usage_delete_failed'); }
      warning = '';
      return log.snapshot();
    },
    close() { clearInterval(timer); },
  };
  return log;
}
