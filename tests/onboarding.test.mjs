import test from 'node:test';
import assert from 'node:assert/strict';
import { getOnboarding, modelConnection } from '../frontend/src/modules/onboarding.ts';

const account = { uid: 'test', platform: 'trae', region: 'cn', active: true, enabled: true, status: 'ready', remaining: 20, models: [{ id: 'demo' }] };
const model = { id: 'alias', canonicalIds: ['trae/cn/demo'], availableAccounts: 1 };
const initial = { platform: 'gateway', keyPresent: true, accounts: [account], models: [model], selected: '', tested: false, clientConfirmed: false };
const state = changes => getOnboarding({ ...initial, ...changes });

test('account and model steps distinguish missing key, authorization and usable models', () => {
  const missingKey = state({ keyPresent: false });
  assert.deepEqual(missingKey.steps.map(step => step.title), ['设置 API Key', '添加授权账号', '选择模型', '测试消息', '接入客户端']);
  assert.equal(missingKey.keyStep.done, false);
  assert.equal(missingKey.accountStep.disabled, true);
  assert.equal(state({ accountError: 'API Key 无效' }).keyStep.done, false);
  const missingAccount = state({ accounts: [] });
  assert.equal(missingAccount.completed, 1);
  assert.equal(missingAccount.accountStep.action, 'accounts');
  assert.equal(missingAccount.modelStep.disabled, true);
  assert.equal(state({ accounts: [{ ...account, enabled: false }] }).accountStep.done, false);
  assert.equal(state({ accounts: [{ ...account, status: 'expired' }] }).accountStep.done, false);
  const noCredits = state({ accounts: [{ ...account, remaining: 0, status: 'no_credits' }], models: [] });
  assert.equal(noCredits.completed, 2);
  assert.equal(noCredits.modelStep.action, 'pool');
  assert.equal(state().modelStep.done, false);
  assert.equal(state({ selected: 'alias' }).modelStep.done, true);
  assert.equal(state({ selected: 'alias', models: [] }).modelStep.done, false);
});

test('a complete model test and user confirmation are both required for client completion', () => {
  assert.equal(state({ selected: 'alias', clientConfirmed: true }).completed, 3);
  assert.equal(state({ selected: 'alias', tested: true }).completed, 4);
  assert.equal(state({ selected: 'alias', tested: true, clientConfirmed: true }).completed, 5);
  assert.equal(state({ selected: 'alias', tested: true, clientConfirmed: true, accountError: 'offline' }).completed, 1);
});

test('model validation is tied to the eligible gateway candidates or the direct current account', () => {
  const another = { ...account, uid: 'another' };
  const unavailable = { ...account, remaining: 0 };
  assert.equal(modelConnection('gateway', [unavailable], model), '');
  assert.notEqual(modelConnection('gateway', [account], model), modelConnection('gateway', [another], model));
  assert.equal(modelConnection('gateway', [account], { ...model, canonicalIds: ['qoder/cn/demo'] }), '');
  assert.equal(modelConnection('trae', [{ ...account, active: false }, { ...another, status: 'expired' }], { id: 'demo' }), '');
  assert.notEqual(modelConnection('trae', [account], { id: 'demo' }), modelConnection('trae', [another], { id: 'demo' }));
});
