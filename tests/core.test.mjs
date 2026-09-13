import { fileURLToPath } from 'node:url';
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createCodex } from '../dist/index.js';
import { decodeImage } from '../dist/images.js';
import { mkdtemp, writeFile, symlink, rm } from 'node:fs/promises';
import { tmpdir } from 'node:os';
import path from 'node:path';
const fixture = fileURLToPath(new URL('./fixtures/app-server.mjs', import.meta.url));
const create = t => { const ai = createCodex({ bin: process.execPath, args: [fixture], experimental: true }); t.after(() => ai.close()); return ai; };
test('handshake and cursor pagination, concurrent initialization', async t => {
  const ai = create(t); const [models, account] = await Promise.all([ai.models.list(), ai.account.read()]);
  assert.deepEqual(models.map(m => m.id), ['first','second']); assert.equal(account.account.type, 'chatgpt');
});
test('buffers early events, isolates turn/thread, final text is not duplicated', async t => {
  const ai = create(t); const events = [];
  const result = await ai.chat({ prompt: 'hello' }, { onEvent: e => events.push(e) });
  assert.equal(result.text, 'こんにちは'); assert.equal(events.filter(e => e.type === 'delta').map(e => e.text).join(''), 'こんにちは');
  assert.equal(events.at(-1).type, 'completed');
});
test('independent threads run concurrently', async t => {
  const ai = create(t); const results = await Promise.all([ai.chat({ prompt: 'a' }), ai.chat({ prompt: 'b' })]);
  assert.notEqual(results[0].threadId, results[1].threadId); assert.ok(results.every(r => r.text === 'こんにちは'));
});
test('duplicate thread turns are rejected and abort interrupts the original', async t => {
  const ai = create(t), threadId = await ai.threads.create(), controller = new AbortController();
  let started; const ready = new Promise(resolve => { started = resolve; });
  const run = ai.chat({ threadId, prompt: 'slow' }, { signal: controller.signal, onEvent: e => { if(e.type === 'started') started(); } });
  const rejected = assert.rejects(run, e => e.code === 'ABORTED');
  await ready;
  await assert.rejects(ai.chat({ threadId, prompt: 'other' }), e => e.code === 'THREAD_BUSY');
  controller.abort(); await rejected;
  assert.equal((await ai.chat({ threadId, prompt: 'again' })).text, 'こんにちは');
});
test('timeout interrupts acknowledged turns; unknown start closes transport', async t => {
  const ai = create(t); await assert.rejects(ai.chat({ prompt: 'slow' }, { timeoutMs: 100 }), e => e.code === 'TURN_TIMEOUT');
  const other = create(t); await assert.rejects(other.chat({ prompt: 'nostart' }, { timeoutMs: 50 }));
  await assert.rejects(other.models.list(), e => e.code === 'CLOSED');
});
test('errors and process death reject active turns promptly', async t => {
  const ai = create(t); await assert.rejects(ai.chat({ prompt: 'fail' }), /fixture failure/);
  await assert.rejects(ai.chat({ prompt: 'crash' }), e => e.code === 'PROCESS_EXIT');
});
test('native images are drained before completion; absent image fails explicitly', async t => {
  const ai = create(t), result = await ai.images.generate({ prompt: 'apple' });
  assert.equal(result.images.length, 1); assert.match(result.images[0].dataUrl, /^data:image\/png;base64,/);
  await assert.rejects(ai.images.generate({ prompt: 'noimage' }), e => e.code === 'IMAGE_UNAVAILABLE');
});
test('native image path boundary rejects symlinks escaping allowed roots', async () => {
  const dir = await mkdtemp(path.join(tmpdir(), 'codex-image-test-'));
  try {
    await writeFile(path.join(dir, 'outside.png'), 'not png');
    const { mkdir } = await import('node:fs/promises'); await mkdir(path.join(dir, 'allowed'));
    await symlink(path.join(dir, 'outside.png'), path.join(dir, 'allowed', 'image.png'));
    await assert.rejects(decodeImage({ status: 'completed', savedPath: path.join(dir, 'allowed', 'image.png') }, [path.join(dir, 'allowed')]), e => e.code === 'IMAGE_PATH_DENIED');
    await assert.rejects(decodeImage({ status: 'completed', result: 'PHN2Zz4=' }, []), e => e.code === 'INVALID_IMAGE');
  } finally { await rm(dir, { recursive: true, force: true }); }
});
test('voice wrapper is opt-in and sends schema-compatible requests', async t => {
  const ai = create(t); assert.equal((await ai.voice.list()).voices.defaultV2, 'marin');
  const disabled = createCodex(); t.after(() => disabled.close()); assert.throws(() => disabled.voice.list(), e => e.code === 'EXPERIMENTAL_DISABLED');
  await ai.voice.appendAudio('t', { data: 'AAA=', sampleRate: 24000, numChannels: 1, samplesPerChannel: 1, itemId: null });
});
test('spawn failure is actionable', async () => {
  const ai = createCodex({ bin: '/does-not-exist/codex' });
  await assert.rejects(ai.models.list(), e => e.code === 'SPAWN_FAILED'); ai.close();
});

test('native command approval defaults to decline', async t => {
  const ai = create(t); assert.equal((await ai.chat({ prompt: 'approval' })).text, 'decline');
});
test('callback failure interrupts the turn instead of leaking native work', async t => {
  const ai = create(t); await assert.rejects(ai.chat({ prompt: 'slow' }, { onEvent: e => { if(e.type === 'started') throw new Error('callback failure'); } }), /callback failure/);
  assert.equal((await ai.chat({ prompt: 'hello' })).text, 'こんにちは');
});
