import { readFileSync, mkdirSync } from 'node:fs';
import { join, dirname } from 'node:path';
import { atomicWrite } from './store.mjs';
import { ApiError } from './http.mjs';

const platforms = ['gateway', 'workbuddy', 'trae', 'qoder'];
const file = base => join(base, 'Gateway-Chat', 'data', 'Gateway', 'onboarding.json');

/** 各服务按需读取同一本机文件，不缓存其他进程写入的完成状态。 */
export function readOnboarding(base) {
  try {
    const state = JSON.parse(readFileSync(file(base), 'utf8'));
    return state?.completed === true && platforms.includes(state.platform)
      ? { completed: true, platform: state.platform } : { completed: false };
  } catch (error) {
    if (error.code === 'ENOENT' || error instanceof SyntaxError) return { completed: false };
    throw error;
  }
}

export function saveOnboarding(base, platform, body) {
  if (!body || typeof body.completed !== 'boolean') throw new ApiError('completed 必须为布尔值', 400);
  const state = body.completed ? { completed: true, platform } : { completed: false };
  mkdirSync(dirname(file(base)), { recursive: true });
  atomicWrite(file(base), JSON.stringify(state));
  return state;
}
