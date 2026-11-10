import test from 'node:test';
import assert from 'node:assert/strict';
import { decodeNativeAuth } from '../klee-api/Klee-trae-web/native-auth.mjs';
const encrypted = 'dGMFEAAABwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwcHBwclUUhMB7xfAHcx4tYf7y/P5tmeaZyC8/BGq9OZCwwtp9Cqi2ylX/3fSSlLxcn8sN8VY2J02LwjN+uPFeHPWH16ycSvwkMy1oyHKWcuKgfGJ1+dil6GJuFdDN0aKws5j9594M5Yw9MmEpiovDxwhPuapF3MTNvr1MD1ftoFsnQcRu97EE52KowJBtuGdG19JBwH7uOryJ2P2XPTwWUlQdXt';

test('reads the official tc05 encrypted active login format', () => {
  const record = decodeNativeAuth(encrypted);
  assert.equal(record?.userId, 'fixture-user');
  assert.equal(record?.account.scope, 'icube.cloudide');
  assert.equal(record?.token, undefined);
});

test('rejects corrupted, unknown and incomplete login records without exposing their content', () => {
  const corrupted = Buffer.from(encrypted, 'base64'); corrupted[90] ^= 1;
  assert.equal(decodeNativeAuth(corrupted.toString('base64')), undefined);
  assert.equal(decodeNativeAuth('unrecognized-secret-format'), undefined);
  assert.equal(decodeNativeAuth({ token: 'do-not-expose' }), undefined);
  assert.equal(decodeNativeAuth(JSON.stringify({ userId: 'fixture-user', account: {} })).userId, 'fixture-user');
});
