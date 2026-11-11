import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtemp, readFile, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { request as httpRequest } from 'node:http';
import { captureConversation } from '../klee-api/app/conversation.mjs';
import { createUsageLog } from '../klee-api/app/gateway-usage.mjs';
import { createGateway } from '../klee-api/app/gateway.mjs';

test('captures ordered messages and streamed text, reasoning and tool arguments without mutating input', () => {
  const messages = [{ role: 'system', content: '规则' }, { role: 'user', content: [{ type: 'text', text: '问题' }, { type: 'image_url', image_url: { url: 'data:image/png;base64,private-image' } }] }];
  const original = structuredClone(messages);
  const capture = captureConversation(messages);
  capture.observe({ choices: [{ index: 0, delta: { content: '你', reasoning_content: '分析', tool_calls: [{ index: 0, function: { name: 'lookup', arguments: '{"id":' } }] } }] });
  capture.observe({ choices: [{ index: 0, delta: { content: '好', tool_calls: [{ index: 0, function: { arguments: '1}' } }] } }] });
  const value = capture.snapshot(true);
  assert.deepEqual(messages, original);
  assert.equal(value.request[0].content, '规则');
  assert.match(value.request[1].content, /问题.*非文本内容未保存/);
  assert.equal(JSON.stringify(value).includes('private-image'), false);
  assert.equal(value.response[0].content, '你好');
  assert.equal(value.response[0].reasoning, '分析');
  assert.deepEqual(value.response[0].tools, [{ name: 'lookup', arguments: '{"id":1}' }]);
  assert.equal(value.complete, true);
});

test('bounds long requests and replies, prioritizes recent input and marks incomplete responses', () => {
  const capture = captureConversation([{ role: 'system', content: '旧'.repeat(30000) }, { role: 'user', content: '最新问题' }]);
  capture.observe({ choices: [{ message: { content: '答'.repeat(30000) } }] });
  const value = capture.snapshot(false);
  assert.equal(value.request.at(-1).content, '最新问题');
  assert.ok(value.request.reduce((sum, message) => sum + message.content.length, 0) <= 16384);
  assert.ok(value.response[0].content.length <= 16384);
  assert.equal(value.truncated, true);
  assert.equal(value.complete, false);
});

test('conversation files persist locally, list metadata stays small and legacy records remain readable', async t => {
  const base = await mkdtemp(join(tmpdir(), 'klee-conversation-'));
  t.after(() => rm(base, { recursive: true, force: true }));
  const file = join(base, 'usage.json');
  const log = createUsageLog(file);
  t.after(() => log.close());
  log.updateSettings({ mode: 'content' });
  const conversation = captureConversation([{ role: 'user', content: 'private-prompt' }]).snapshot(false);
  log.add({ id: 'new-call', startedAt: Date.now() }, conversation);
  log.add({ id: 'old-call', startedAt: Date.now() });
  assert.equal(JSON.stringify(log.snapshot()).includes('private-prompt'), false);
  assert.equal((await readFile(file, 'utf8')).includes('private-prompt'), false);
  const loaded = createUsageLog(file);
  t.after(() => loaded.close());
  assert.equal(loaded.detail('new-call').conversation.request[0].content, 'private-prompt');
  assert.equal(loaded.detail('old-call').conversation, null);
  assert.equal(loaded.detail('../usage'), null);
  const memory = createUsageLog();
  for (let index = 0; index <= 2000; index++) memory.add({ id: 'call-' + index, startedAt: Date.now() }, conversation);
  assert.equal(memory.detail('call-0'), null);
  assert.equal(memory.snapshot().records.length, 2000);
});

for (const stream of [false, true]) test(`gateway ${stream ? 'SSE' : 'JSON'} logs dialog text and protects the on-demand details endpoint`, async t => {
  const gateway = await createGateway({ apiKey: 'klee-dialog-test', bridge: async (platform, path) => {
    if (path.startsWith('/api/pool?')) return Response.json({ accounts: platform === 'trae' ? [{ uid: 'test', region: 'cn', enabled: true, status: 'ready', remaining: 100, models: [{ id: 'demo' }] }] : [] });
    const choice = { index: 0, message: { role: 'assistant', content: '模拟回复' }, finish_reason: 'stop' };
    if (!stream) return Response.json({ choices: [choice] });
    return new Response('data: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '模拟' } }] }) + '\n\ndata: ' + JSON.stringify({ choices: [{ index: 0, delta: { content: '回复' }, finish_reason: 'stop' }] }) + '\n\ndata: [DONE]\n\n', { headers: { 'Content-Type': 'text/event-stream' } });
  } });
  await new Promise(resolve => gateway.server.listen(0, '127.0.0.1', resolve));
  t.after(() => gateway.close());
  const request = (path, body, key = 'klee-dialog-test', method = body ? 'POST' : 'GET') => new Promise((resolve, reject) => {
    const req = httpRequest({ host: '127.0.0.1', port: gateway.server.address().port, path, method, headers: { Host: '127.0.0.1:18887', Authorization: 'Bearer ' + key, 'Content-Type': 'application/json' } }, res => {
      let text = ''; res.on('data', part => { text += part; }); res.on('end', () => resolve({ status: res.statusCode, text }));
    }); req.on('error', reject); req.end(body ? JSON.stringify(body) : undefined);
  });
  assert.equal((await request('/api/gateway/usage/settings', { mode: 'content' }, undefined, 'PATCH')).status, 200);
  assert.equal((await request('/v1/chat/completions', { model: 'trae/cn/demo', stream, messages: [{ role: 'user', content: '模拟问题' }] })).status, 200);
  const list = JSON.parse((await request('/api/gateway/usage')).text);
  assert.equal(list.records[0].hasConversation, true);
  assert.equal(JSON.stringify(list).includes('模拟问题'), false);
  const path = '/api/gateway/usage/' + list.records[0].id;
  assert.equal((await request(path, undefined, 'wrong-key')).status, 401);
  const detail = JSON.parse((await request(path)).text);
  assert.equal(detail.conversation.request[0].content, '模拟问题');
  assert.equal(detail.conversation.response[0].content, '模拟回复');
  assert.equal(detail.conversation.complete, true);
  assert.equal((await request('/api/gateway/usage/missing')).status, 404);
});
