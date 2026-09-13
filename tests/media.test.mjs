import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createOpenAIMedia } from '../dist/media.js';
test('media uses independent API key and correct endpoint/body formats', async () => {
  const calls = [];
  const media = createOpenAIMedia({ apiKey: 'test-only', fetch: async (url, options) => {
    calls.push({ url, ...options });
    return url.endsWith('/speech') ? new Response(new Uint8Array([1,2,3])) : Response.json({ text: 'hello', data: [] });
  } });
  assert.equal((await media.speech({ text: 'hello' })).byteLength, 3);
  assert.equal(JSON.parse(calls[0].body).response_format, 'mp3');
  await media.transcribe({ file: new Blob(['audio']), filename: 'sample.webm', model: 'custom-transcriber' });
  assert.ok(calls[1].body instanceof FormData); assert.equal(calls[1].body.get('model'), 'custom-transcriber');
  assert.equal(calls[1].headers['Content-Type'], undefined);
  await media.images({ prompt: 'apple', model: 'my-image-model' });
  assert.equal(JSON.parse(calls[2].body).model, 'my-image-model');
  assert.ok(calls.every(c => c.headers.Authorization === 'Bearer test-only'));
});
test('media rejects missing key and surfaces provider error', async () => {
  assert.throws(() => createOpenAIMedia({ apiKey: '' }), e => e.code === 'API_KEY_REQUIRED');
  const media = createOpenAIMedia({ apiKey: 'test', fetch: async () => Response.json({ error: { message: 'rate limited', code: 'rate_limit_exceeded' } }, { status: 429 }) });
  await assert.rejects(media.speech({ text: 'hello' }), e => e.code === 'rate_limit_exceeded');
});
