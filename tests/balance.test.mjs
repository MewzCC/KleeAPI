import test from 'node:test';
import assert from 'node:assert/strict';
import { balancePercentage } from '../frontend/src/modules/balance.ts';

test('balance progress uses real total quota and keeps decimal accuracy', () => {
  assert.equal(balancePercentage({ remaining: 2799.5476, limit: 3000 }), 93.3);
  assert.equal(balancePercentage({ remaining: 100, limit: 100 }), 100);
  assert.equal(balancePercentage({ remaining: 0, limit: 100 }), 0);
  assert.equal(balancePercentage({ remaining: 0, limit: 0 }), 0);
  assert.equal(balancePercentage({ remaining: 120, limit: 100 }), 100);
});

test('missing, invalid, unlimited or failed quota never invents a percentage', () => {
  for (const account of [{ remaining: 100 }, { remaining: 100, limit: 0 }, { remaining: null, limit: 100 }, { remaining: NaN, limit: 100 }, { remaining: 100, limit: Infinity }, { remaining: 100, limit: -1 }, { unlimited: true, remaining: 100, limit: 100 }, { quotaError: 'offline', remaining: 80, limit: 100 }]) assert.equal(balancePercentage(account), null);
});
