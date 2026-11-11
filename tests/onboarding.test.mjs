import test from 'node:test';
import assert from 'node:assert/strict';
import { getOnboarding, modelConnection } from '../frontend/src/modules/onboarding.ts';

const account = { uid: 'test', platform: 'trae', region: 'cn', active: true, enabled: true, status: 'ready', remaining: 20, models: [{ id: 'demo' }] };
const model = { id: 'alias', canonicalIds: ['trae/cn/demo'], availableAccounts: 1 };
const initial = { platform: 'gateway', keyPresent: true, accounts: [account], models: [model], selected: '', tested: false, clientConfirmed: false };
const state = changes => getOnboarding({ ...initial, ...changes });

test('account and model steps distinguish missing key, authorization and usable models', () => {
  assert.equal(state({ keyPresent: false }).steps[0].action, 'settings');
  assert.equal(state({ accounts: [] }).steps[0].action, 'accounts');
  assert.equal(state({ accounts: [{ ...account, enabled: false }] }).steps[0].done, false);
  assert.equal(state({ accounts: [{ ...account, status: 'expired' }] }).steps[0].done, false);
  const noCredits = state({ accounts: [{ ...account, remaining: 0, status: 'no_credits' }], models: [] });
  assert.equal(noCredits.steps[0].done, true);
  assert.equal(noCredits.steps[1].action, 'pool');
  assert.equal(state().steps[1].done, false);
  assert.equal(state({ selected: 'alias' }).steps[1].done, true);
  assert.equal(state({ selected: 'alias', models: [] }).steps[1].done, false);
});

test('a complete model test and user confirmation are both required for client completion', () => {
  assert.equal(state({ selected: 'alias', clientConfirmed: true }).completed, 2);
  assert.equal(state({ selected: 'alias', tested: true }).completed, 3);
  assert.equal(state({ selected: 'alias', tested: true, clientConfirmed: true }).completed, 4);
  assert.equal(state({ selected: 'alias', tested: true, clientConfirmed: true, accountError: 'offline' }).completed, 0);
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
