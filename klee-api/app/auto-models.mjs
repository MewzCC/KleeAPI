import { closeSync, constants, fstatSync, lstatSync, mkdirSync, openSync, readSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { ApiError } from './http.mjs';
import { atomicWrite } from './store.mjs';

const maxFileSize = 1024 * 1024;
const defaults = { enabled: true, attemptTimeoutMs: 30000, totalTimeoutMs: 120000, maxAttempts: 20, cooldownMs: 30000, retryOnTimeout: true };
const groupFields = new Set(['id', 'name', 'targets', ...Object.keys(defaults)]);
const targetFields = new Set(['model', 'enabled']);
const ranges = { attemptTimeoutMs: [1000, 120000], totalTimeoutMs: [1000, 300000], maxAttempts: [1, 60], cooldownMs: [1000, 300000] };
const invalid = () => new ApiError('自动模型组配置无效', 400, 'invalid_auto_model');
const unavailable = () => new ApiError('自动模型组配置无法读取或写入，请检查本地配置文件', 503, 'auto_models_unavailable');

function objectFields(value, allowed) {
  if (!value || typeof value !== 'object' || Array.isArray(value) ||
    ![Object.prototype, null].includes(Object.getPrototypeOf(value)) ||
    Object.keys(value).some(key => !allowed.has(key))) throw invalid();
}

function normalizeGroup(input) {
  objectFields(input, groupFields);
  const group = { ...defaults, ...input };
  if (typeof group.id !== 'string' || !/^auto\/[a-zA-Z0-9][a-zA-Z0-9._-]{0,63}$/.test(group.id)) throw invalid();
  if (typeof group.name !== 'string' || !group.name.trim() || group.name.trim().length > 80) throw invalid();
  group.name = group.name.trim();
  if (typeof group.enabled !== 'boolean' || typeof group.retryOnTimeout !== 'boolean') throw invalid();
  for (const [key, [min, max]] of Object.entries(ranges)) {
    if (!Number.isInteger(group[key]) || group[key] < min || group[key] > max) throw invalid();
  }
  if (group.attemptTimeoutMs > group.totalTimeoutMs || !Array.isArray(group.targets) || group.targets.length > 20) throw invalid();
  const models = new Set();
  group.targets = group.targets.map(target => {
    objectFields(target, targetFields);
    const { model, enabled = true } = target;
    if (typeof model !== 'string' || model.length > 1024 || /[\s\p{Cc}]/u.test(model) ||
      !/^(workbuddy|trae|qoder)\/[^/]+\/[^/]+(?:\/[^/]+)*$/.test(model) || typeof enabled !== 'boolean' || models.has(model)) throw invalid();
    models.add(model);
    return { model, enabled };
  });
  if (group.enabled && !group.targets.some(target => target.enabled)) throw invalid();
  return group;
}

/** Refuse links before opening or writing, including an existing linked parent. */
function checkPath(file) {
  for (let path = file; ; path = dirname(path)) {
    try { if (lstatSync(path).isSymbolicLink()) throw unavailable(); }
    catch (error) { if (error.code !== 'ENOENT') throw error; }
    if (dirname(path) === path) break;
  }
}

function readConfig(file) {
  let fd;
  try {
    fd = openSync(file, constants.O_RDONLY | (constants.O_NOFOLLOW || 0));
    const stat = fstatSync(fd);
    if (!stat.isFile() || stat.size > maxFileSize) throw invalid();
    const buffer = Buffer.alloc(maxFileSize + 1);
    let size = 0, read;
    while (size < buffer.length && (read = readSync(fd, buffer, size, buffer.length - size, null)) > 0) size += read;
    if (size > maxFileSize) throw invalid();
    const config = JSON.parse(buffer.toString('utf8', 0, size));
    objectFields(config, new Set(['version', 'groups']));
    if (config.version !== 1 || !Array.isArray(config.groups) || config.groups.length > 50) throw invalid();
    const groups = config.groups.map(normalizeGroup);
    if (new Set(groups.map(group => group.id)).size !== groups.length) throw invalid();
    return groups;
  } finally { if (fd !== undefined) closeSync(fd); }
}

/** Local config only; undefined selects an isolated in-memory store. */
export function createAutoModelStore(file) {
  const path = file === undefined ? undefined : resolve(file);
  let groups = [], warning = null;
  if (path) {
    try { checkPath(path); groups = readConfig(path); }
    catch (error) { if (error.code !== 'ENOENT') warning = unavailable().message; }
  }
  const snapshot = () => structuredClone({ groups, warning });
  function writable() { if (warning) throw unavailable(); }
  function persist(next) {
    const contents = JSON.stringify({ version: 1, groups: next });
    if (Buffer.byteLength(contents) > maxFileSize) throw invalid();
    if (path) {
      try {
        checkPath(path);
        mkdirSync(dirname(path), { recursive: true });
        checkPath(path);
        atomicWrite(path, contents);
      } catch { throw unavailable(); }
    }
    groups = next;
    return snapshot();
  }
  function indexOf(id) {
    const index = groups.findIndex(group => group.id === id);
    if (index < 0) throw new ApiError('自动模型组不存在', 404, 'auto_model_not_found');
    return index;
  }
  return {
    snapshot,
    get(id) { return structuredClone(groups.find(group => group.id === id)); },
    create(input) {
      writable();
      const group = normalizeGroup(input);
      if (groups.some(existing => existing.id === group.id)) throw new ApiError('自动模型组已存在', 409, 'auto_model_exists');
      if (groups.length >= 50) throw invalid();
      return persist([...groups, group]);
    },
    update(id, input) {
      writable();
      const index = indexOf(id);
      objectFields(input, groupFields);
      if (Object.hasOwn(input, 'id') && input.id !== id) throw invalid();
      const group = normalizeGroup({ ...groups[index], ...input });
      const next = [...groups];
      next[index] = group;
      return persist(next);
    },
    remove(id) {
      writable();
      const index = indexOf(id);
      return persist(groups.filter((_, position) => position !== index));
    },
  };
}
