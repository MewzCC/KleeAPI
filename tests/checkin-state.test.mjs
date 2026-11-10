import test from 'node:test';
import assert from 'node:assert/strict';
import { mergeCheckins, summarizeCheckins } from '../frontend/src/modules/checkin.ts';

test('successful retry discards old rejection and campaign outcome while retaining metadata', () => {
  const previous = { accounts: [{ uid: 'same', platform: 'trae', nickname: 'Main', enabled: true, status: 'failed', errorCode: 'trae_9074', hint: 'old hint', endsAt: 1, reward: 100 }] };
  const result = mergeCheckins(previous, { accounts: [{ uid: 'same', platform: 'trae', status: 'claimed', checkedIn: true }] }, { platform: 'trae', uid: 'same' });
  assert.deepEqual(result.accounts, [{ uid: 'same', platform: 'trae', nickname: 'Main', enabled: true, status: 'claimed', checkedIn: true }]);
});

test('bulk results replace selected platform list and remove deleted accounts', () => {
  const previous = { accounts: [{ uid: 'same', platform: 'trae' }, { uid: 'deleted', platform: 'trae' }, { uid: 'same', platform: 'qoder', status: 'already' }] };
  const data = { accounts: [{ uid: 'same', platform: 'trae', status: 'claimed' }], platforms: [{ platform: 'trae', status: 'ready' }] };
  const result = mergeCheckins(previous, data, { all: true, platform: 'trae' });
  assert.equal(result.accounts.length, 2);
  assert.ok(!result.accounts.some(a => a.uid === 'deleted'));
  assert.equal(result.accounts.find(a => a.platform === 'qoder').status, 'already');
});

test('failed targeted request preserves sibling rows and marks only the target unknown', () => {
  const previous = { accounts: [{ uid: 'target', platform: 'trae', status: 'claimed', checkedIn: true, hint: 'stale' }, { uid: 'sibling', platform: 'trae', status: 'already', checkedIn: true }] };
  const result = mergeCheckins(previous, { accounts: [], platforms: [{ platform: 'trae', status: 'failed', error: '服务不可用' }] }, { uid: 'target', platform: 'trae' });
  assert.equal(result.accounts.length, 2);
  assert.equal(result.accounts.find(a => a.uid === 'sibling').status, 'already');
  assert.equal(result.accounts.find(a => a.uid === 'target').status, 'unknown');
  assert.equal(result.accounts.find(a => a.uid === 'target').checkedIn, null);
});

test('single-platform bulk removes omitted rows and keeps no stale success', () => {
  const result = mergeCheckins({ accounts: [{ uid: 'removed' }, { uid: 'current', status: 'failed', errorCode: 'trae_9074' }] }, { accounts: [{ uid: 'current', status: 'claimed' }] }, { all: true });
  assert.deepEqual(result.accounts, [{ uid: 'current', status: 'claimed' }]);
});

test('dashboard shows four signed out of five total accounts including the account with no activity', () => {
  const accounts = [
    { uid: 'shared', platform: 'workbuddy', status: 'already', checkedIn: true },
    { uid: 'global', platform: 'workbuddy', status: 'no_activity', checkedIn: false },
    { uid: 'shared', platform: 'trae', status: 'claimed', checkedIn: true },
    { uid: 'cn', platform: 'qoder', status: 'already', checkedIn: true },
    { uid: 'global', platform: 'qoder', status: 'already', checkedIn: true },
  ];
  assert.deepEqual(summarizeCheckins({ accounts }), { done: 4, total: 5, noActivity: 1, disabled: 0, unknown: 0 });
});

test('dashboard keeps missing and failed platform results unknown without shrinking the known denominator', () => {
  const accounts = [{ uid: 'same', platform: 'workbuddy' }, { uid: 'same', platform: 'trae' }, { uid: 'off', platform: 'qoder', enabled: false }];
  const snapshot = { accounts: [{ uid: 'same', platform: 'workbuddy', status: 'already', checkedIn: true }], platforms: [{ platform: 'trae', error: 'unavailable' }] };
  assert.deepEqual(summarizeCheckins(snapshot, accounts), { done: 1, total: 3, noActivity: 0, disabled: 1, unknown: 1 });
});

test('dashboard excludes deleted accounts and ended campaigns from the signed count', () => {
  const snapshot = { accounts: [{ uid: 'deleted', status: 'already', checkedIn: true }, { uid: 'current', status: 'claimed', checkedIn: true, endsAt: 100 }] };
  assert.deepEqual(summarizeCheckins(snapshot, [{ uid: 'current' }], 200), { done: 0, total: 1, noActivity: 0, disabled: 0, unknown: 1 });
  assert.deepEqual(summarizeCheckins({ accounts: [] }), { done: 0, total: 0, noActivity: 0, disabled: 0, unknown: 0 });
});
