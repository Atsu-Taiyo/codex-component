import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createServer } from 'node:http';
import { createCodex } from '../dist/index.js';
import { createCodexHandler } from '../dist/server.js';
import { createCodexBrowser } from '../dist/browser.js';
const token = 'test-token-is-longer-than-24-characters';
async function setup(t) {
  const ai = createCodex({ bin: process.execPath, args: [fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url))], experimental: true });
  const server = createServer(createCodexHandler({ codex: ai, token, allowedOrigins: ['http://localhost:5173'] }));
  await new Promise(resolve => server.listen(0, '127.0.0.1', resolve));
  t.after(() => { ai.close(); server.closeAllConnections(); server.close(); });
  const baseUrl = `http://127.0.0.1:${server.address().port}/api/ai`;
  return { ai, client: createCodexBrowser({ token, baseUrl }), baseUrl };
}
test('HTTP browser client streams Japanese text/images, resumes owned threads', async t => {
  const { client } = await setup(t); assert.equal((await client.models.list()).length, 2);
  const first = await client.chat({ prompt: 'hello' });
  assert.equal((await client.chat({ prompt: 'again', threadId: first.threadId })).text, 'こんにちは');
  assert.equal((await client.images.generate({ prompt: 'apple' })).images.length, 1);
  await assert.rejects(client.images.generate({ prompt: 'noimage' }), e => e.code === 'IMAGE_UNAVAILABLE');
});
test('auth, origin, request validation and ownership boundary', async t => {
  const { client, baseUrl } = await setup(t);
  assert.equal((await fetch(baseUrl + '/models')).status, 401);
  assert.equal((await fetch(baseUrl + '/models', { headers: { Authorization: `Bearer ${token}`, Origin: 'https://evil.example' } })).status, 403);
  await assert.rejects(client.chat({ prompt: 'hello', threadId: 'foreign' }), e => e.code === 'INVALID_INPUT');
  await assert.rejects(client.chat({ prompt: 'hello', images: ['file:///etc/passwd'] }), e => e.code === 'INVALID_INPUT');
  await assert.rejects(client.chat({ prompt: '' }), e => e.code === 'INVALID_INPUT');
});
test('voice SDP emitted before response is not lost', async t => {
  const { client } = await setup(t); const threadId = await client.threads.create();
  assert.equal((await client.voice.connect({ threadId, sdp: 'offer-sdp' })).sdp, 'answer-sdp');
  await client.voice.stop(threadId);
});
test('browser detects truncated stream and split UTF-8 frames', async () => {
  const client = createCodexBrowser({ token, fetch: async () => new Response('{"type":"delta","text":"x"}\n') });
  await assert.rejects(client.chat({ prompt: 'a' }), e => e.code === 'STREAM_INTERRUPTED');
  const bytes = new TextEncoder().encode(JSON.stringify({ type: 'completed', result: { text: '日本語' } }) + '\n');
  const split = createCodexBrowser({ token, fetch: async () => new Response(new ReadableStream({ start(c) { for (const byte of bytes) c.enqueue(new Uint8Array([byte])); c.close(); } })) });
  assert.equal((await split.chat({ prompt: 'a' })).text, '日本語');
});

test('aborting browser stream interrupts native turn on the server', async t => {
  const { ai, client } = await setup(t);
  const controller = new AbortController();
  let timer;
  const interrupted = new Promise((resolve, reject) => {
    const off = ai.onNotification(e => { if(e.method === 'turn/completed' && e.params.turn.status === 'interrupted') { clearTimeout(timer); off(); resolve(); } });
    timer = setTimeout(() => { off(); reject(new Error('Server did not interrupt disconnected turn')); }, 2000);
  });
  try {
    await assert.rejects(client.chat({ prompt: 'slow' }, { signal: controller.signal, onEvent: e => { if(e.type === 'started') controller.abort(); } }));
    await interrupted;
  } finally { clearTimeout(timer); }
});
