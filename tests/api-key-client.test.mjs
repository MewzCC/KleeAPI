import test from 'node:test';
import assert from 'node:assert/strict';
import { readFile } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { build } from '../frontend/node_modules/esbuild/lib/main.js';

// Bundle the real browser client with in-memory browser storage for offline tests.
const bundle = await build({
  stdin: { contents: await readFile(new URL('../frontend/src/api/client.ts', import.meta.url), 'utf8') + '\nexport { session }', resolveDir: fileURLToPath(new URL('../frontend/src/api/', import.meta.url)), loader: 'ts' },
  bundle: true, write: false, format: 'esm', plugins: [{ name: 'browser-session', setup(build) {
    build.onResolve({ filter: /modules\/session$/ }, () => ({ path: 'session', namespace: 'test' }));
    build.onLoad({ filter: /.*/, namespace: 'test' }, () => ({ contents: `export const session = { keys: {} }; export const baseURL = p => 'http://localhost/' + p; export const saveLocal = (p, key) => { session.keys[p] = key };` }));
  } }],
});
const { saveKey, recoverKey, request, session } = await import('data:text/javascript;base64,' + Buffer.from(bundle.outputFiles[0].text + '\n//# sourceURL=api-key-client.test-bundle.mjs').toString('base64'));

for (const platform of ['gateway', 'trae', 'qoder', 'workbuddy']) {
  for (const previous of ['', 'klee-stale-browser', 'klee-valid-browser']) {
    test(`${platform}: direct custom key save works with browser key ${previous || '(empty)'}`, async t => {
      session.keys[platform] = previous;
      t.mock.method(globalThis, 'fetch', async (url, init) => {
        assert.ok(url.endsWith('/api/key/local'));
        assert.equal(init.method, 'POST');
        assert.equal(init.headers.Authorization, undefined);
        assert.deepEqual(JSON.parse(init.body), { apiKey: 'klee-custom-key' });
        return Response.json({ ok: true });
      });
      await saveKey(platform, 'klee-custom-key', false);
      assert.equal(session.keys[platform], 'klee-custom-key');
    });
  }
}

test('fallback reads the current key without replacing the browser key or changing the server', async t => {
  session.keys.trae = 'klee-saved-browser';
  t.mock.method(globalThis, 'fetch', async (url, init) => {
    assert.ok(url.endsWith('/api/key/local'));
    assert.equal(init.headers.Authorization, undefined);
    assert.deepEqual(JSON.parse(init.body), {});
    return Response.json({ apiKey: 'klee-current-server' });
  });
  assert.equal(await recoverKey('trae'), 'klee-current-server');
  assert.equal(session.keys.trae, 'klee-saved-browser');
});

test('copying a key with surrounding whitespace saves the actual key', async t => {
  delete session.keys.trae;
  t.mock.method(globalThis, 'fetch', async (_url, init) => {
    assert.equal(JSON.parse(init.body).apiKey, 'klee-existing-key');
    return Response.json({ accounts: [] });
  });
  await saveKey('trae', '  klee-existing-key\r\n', false);
  assert.equal(session.keys.trae, 'klee-existing-key');
});

test('an upstream login failure is not reported as a local API key failure', async t => {
  session.keys.trae = 'klee-valid-local';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'trae_1001', message: '登录已失效，请在账号管理中重新登录' } }, { status: 401 }));
  await assert.rejects(request('trae', '/api/accounts/demo/refresh', { method: 'POST' }), /登录已失效/);
});

test('a forbidden origin is not reported as an invalid API key', async t => {
  session.keys.trae = 'klee-valid-local';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'request_error', message: '不允许的跨站请求' } }, { status: 403 }));
  await assert.rejects(request('trae', '/api/accounts'), /不允许的跨站请求/);
});

test('a failed custom key save leaves the saved browser key intact', async t => {
  session.keys.trae = 'klee-stale-browser';
  t.mock.method(globalThis, 'fetch', async () => Response.json({ error: { code: 'save_failed', message: '模拟保存失败' } }, { status: 500 }));
  await assert.rejects(saveKey('trae', 'klee-custom-key', false), /模拟保存失败/);
  assert.equal(session.keys.trae, 'klee-stale-browser');
});
