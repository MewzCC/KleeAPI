import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, readFileSync, readdirSync, writeFileSync, rmSync, symlinkSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createAutoModelStore } from '../klee-api/app/auto-models.mjs';

const group = (extra = {}) => ({ id: 'auto/main', name: '  Main models  ', targets: [{ model: 'trae/global/claude' }], ...extra });
const invalid = { status: 400, code: 'invalid_auto_model' };
const unavailable = { status: 503, code: 'auto_models_unavailable' };
function fixture(t) {
  const base = mkdtempSync(join(tmpdir(), 'klee-auto-models-'));
  t.after(() => rmSync(base, { recursive: true, force: true }));
  return { base, file: join(base, 'Gateway', 'auto-models.json') };
}

test('creates normalized defaults and applies partial updates without changing the id', () => {
  const store = createAutoModelStore();
  assert.deepEqual(store.snapshot(), { groups: [], warning: null });
  assert.deepEqual(store.create(group()).groups[0], {
    id: 'auto/main', name: 'Main models', enabled: true,
    targets: [{ model: 'trae/global/claude', enabled: true }],
    attemptTimeoutMs: 30000, totalTimeoutMs: 120000, maxAttempts: 20,
    cooldownMs: 30000, retryOnTimeout: true,
  });
  const updated = store.update('auto/main', { name: ' Renamed ', maxAttempts: 3, id: 'auto/main' });
  assert.equal(updated.groups[0].name, 'Renamed');
  assert.equal(updated.groups[0].maxAttempts, 3);
  assert.equal(updated.groups[0].targets[0].model, 'trae/global/claude');
  assert.throws(() => store.update('auto/main', { id: 'auto/new' }), invalid);
  assert.throws(() => store.create(group()), { status: 409, code: 'auto_model_exists' });
  assert.throws(() => store.update('auto/missing', {}), { status: 404, code: 'auto_model_not_found' });
  assert.throws(() => store.remove('auto/missing'), { status: 404, code: 'auto_model_not_found' });
  assert.deepEqual(store.remove('auto/main'), { groups: [], warning: null });
  assert.equal(store.get('auto/main'), undefined);
});

test('caller input, get and every mutation snapshot cannot alter stored targets', () => {
  const store = createAutoModelStore(), input = group();
  const result = store.create(input);
  input.targets[0].model = 'qoder/global/modified';
  result.groups[0].targets[0].enabled = false;
  store.snapshot().groups.splice(0);
  store.get('auto/main').targets[0].model = 'qoder/global/modified';
  const patch = { targets: [{ model: 'workbuddy/cn/model', enabled: true }] };
  const changed = store.update('auto/main', patch);
  patch.targets[0].model = 'qoder/global/modified';
  changed.groups[0].targets[0].enabled = false;
  assert.deepEqual(store.get('auto/main').targets, [{ model: 'workbuddy/cn/model', enabled: true }]);
});

test('persists versioned config, creates parent directories and survives restart', t => {
  const { file, base } = fixture(t), store = createAutoModelStore(file);
  store.create(group());
  store.update('auto/main', { retryOnTimeout: false, targets: [{ model: 'workbuddy/cn/new', enabled: true }] });
  const disk = JSON.parse(readFileSync(file, 'utf8'));
  assert.equal(disk.version, 1);
  assert.deepEqual(disk.groups, store.snapshot().groups);
  assert.deepEqual(createAutoModelStore(file).snapshot(), store.snapshot());
  assert.deepEqual(readdirSync(join(base, 'Gateway')), ['auto-models.json']);
  store.remove('auto/main');
  assert.deepEqual(createAutoModelStore(file).snapshot().groups, []);
});

test('rejects invalid fields, bounds, aliases, target duplicates and health metadata', () => {
  const inputs = [null, [], {}, group({ id: 'auto/_bad' }), group({ id: 'auto/' + 'a'.repeat(65) }), group({ id: 'auto/main\n' }),
    group({ id: 'bare' }), group({ name: ' ' }), group({ name: 'a'.repeat(81) }),
    group({ enabled: 'true' }), group({ retryOnTimeout: 1 }), group({ targets: [] }),
    group({ targets: [{ model: 'auto/nested' }] }), group({ targets: [{ model: 'bare' }] }),
    group({ targets: [{ model: 'trae/model' }] }), group({ targets: [{ model: 'unknown/global/model' }] }),
    group({ targets: [{ model: 'trae//model' }] }), group({ targets: [{ model: 'trae/global/a b' }] }),
    group({ targets: [{ model: 'trae/global/a\u0000b' }] }), group({ targets: [{ model: 'trae/' + 'a'.repeat(1020) }] }),
    group({ targets: [{ model: 'trae/global/model', enabled: 1 }] }),
    group({ targets: [{ model: 'trae/global/model', enabled: false }] }),
    group({ targets: [{ model: 'trae/global/model' }, { model: 'trae/global/model', enabled: false }] }),
    group({ targets: [{ model: 'trae/global/model', availableAccounts: 5 }] }),
    group({ targets: Array.from({ length: 21 }, (_, i) => ({ model: 'trae/global/' + i })) }),
    group({ attemptTimeoutMs: 999 }), group({ attemptTimeoutMs: 120001 }),
    group({ totalTimeoutMs: 999 }), group({ totalTimeoutMs: 300001 }), group({ totalTimeoutMs: 10000 }),
    group({ maxAttempts: 0 }), group({ maxAttempts: 61 }), group({ maxAttempts: 1.5 }),
    group({ cooldownMs: 999 }), group({ cooldownMs: 300001 }), group({ lastSuccessAt: 123 }),
  ];
  for (const input of inputs) {
    const store = createAutoModelStore();
    assert.throws(() => store.create(input), invalid, JSON.stringify(input));
    assert.deepEqual(store.snapshot().groups, []);
  }
  const store = createAutoModelStore();
  store.create(group());
  for (const input of [{ unknown: true }, { targets: [{ model: 'trae/global/claude', cooldownUntil: 1 }] }, null, []]) {
    assert.throws(() => store.update('auto/main', input), invalid);
  }
});

test('accepts disabled empty groups and valid numeric boundaries, caps groups at fifty', () => {
  const store = createAutoModelStore();
  store.create(group({ enabled: false, targets: [], attemptTimeoutMs: 1000, totalTimeoutMs: 1000, maxAttempts: 1, cooldownMs: 1000 }));
  assert.throws(() => store.update('auto/main', { enabled: true }), invalid);
  store.update('auto/main', { attemptTimeoutMs: 120000, totalTimeoutMs: 300000, maxAttempts: 60, cooldownMs: 300000 });
  for (let i = 1; i < 50; i++) store.create(group({ id: 'auto/group-' + i }));
  assert.throws(() => store.create(group({ id: 'auto/overflow' })), invalid);
  assert.equal(store.snapshot().groups.length, 50);
});

test('corrupt, invalid, oversized and unreadable files warn and cannot be overwritten', t => {
  const { base } = fixture(t);
  const fixtures = ['{broken', JSON.stringify({ version: 2, groups: [] }), JSON.stringify({ version: 1, groups: [group({ maxAttempts: 0 })] }),
    JSON.stringify({ version: 1, groups: [group(), group()] }), JSON.stringify({ version: 1, groups: [], extra: true }), ' '.repeat(1024 * 1024 + 1)];
  fixtures.forEach((contents, i) => {
    const file = join(base, i + '.json');
    writeFileSync(file, contents);
    const store = createAutoModelStore(file);
    assert.ok(store.snapshot().warning);
    assert.deepEqual(store.snapshot().groups, []);
    assert.throws(() => store.create(group()), unavailable);
    assert.throws(() => store.update('auto/main', {}), unavailable);
    assert.throws(() => store.remove('auto/main'), unavailable);
    assert.equal(readFileSync(file, 'utf8'), contents);
  });
  const directory = join(base, 'directory.json');
  mkdirSync(directory);
  const store = createAutoModelStore(directory);
  assert.ok(store.snapshot().warning);
  assert.throws(() => store.create(group()), unavailable);
});

test('failed atomic replacement preserves memory and cleans temporary files', t => {
  const { file } = fixture(t), store = createAutoModelStore(file);
  store.create(group());
  const before = store.snapshot();
  rmSync(file);
  mkdirSync(file);
  writeFileSync(join(file, 'preserve'), 'untouched');
  assert.throws(() => store.update('auto/main', { name: 'Changed' }), unavailable);
  assert.deepEqual(store.snapshot().groups, before.groups);
  assert.equal(readFileSync(join(file, 'preserve'), 'utf8'), 'untouched');
  assert.deepEqual(readdirSync(join(file, '..')), ['auto-models.json']);
});

test('missing parent blocked by an existing regular file fails without changing memory', t => {
  const { base } = fixture(t), blocker = join(base, 'blocker');
  writeFileSync(blocker, 'keep');
  const store = createAutoModelStore(join(blocker, 'auto-models.json'));
  assert.throws(() => store.create(group()), unavailable);
  assert.deepEqual(store.snapshot().groups, []);
  assert.equal(readFileSync(blocker, 'utf8'), 'keep');
});

test('symlinked parent directories are refused without touching their destination', t => {
  const { base } = fixture(t), outside = join(base, 'outside'), link = join(base, 'linked');
  mkdirSync(outside);
  const file = join(outside, 'auto-models.json');
  writeFileSync(file, JSON.stringify({ version: 1, groups: [] }));
  try { symlinkSync(outside, link, process.platform === 'win32' ? 'junction' : 'dir'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('filesystem cannot create symlinks'); throw error; }
  const store = createAutoModelStore(join(link, 'auto-models.json'));
  assert.ok(store.snapshot().warning);
  assert.throws(() => store.create(group()), unavailable);
  assert.deepEqual(JSON.parse(readFileSync(file, 'utf8')), { version: 1, groups: [] });
});

test('a file symlink introduced after startup cannot redirect a configuration write', t => {
  const { base, file } = fixture(t), store = createAutoModelStore(file);
  store.create(group());
  const outside = join(base, 'preserved.json'), before = readFileSync(file, 'utf8');
  writeFileSync(outside, before);
  rmSync(file);
  try { symlinkSync(outside, file, 'file'); }
  catch (error) { if (['EPERM', 'EACCES', 'ENOTSUP'].includes(error.code)) return t.skip('filesystem cannot create file symlinks'); throw error; }
  assert.throws(() => store.update('auto/main', { name: 'Redirected' }), unavailable);
  assert.equal(readFileSync(outside, 'utf8'), before);
  assert.equal(store.get('auto/main').name, 'Main models');
  assert.ok(createAutoModelStore(file).snapshot().warning);
});
