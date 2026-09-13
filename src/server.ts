import type { OpenAIMedia } from './media.js';
import type { IncomingMessage, ServerResponse } from 'node:http';
import { timingSafeEqual } from 'node:crypto';
import type { Codex } from './index.js';
import { CodexError, type ChatInput, type VoiceOptions } from './types.js';

export interface HandlerOptions {
  codex: Codex;
  media?: OpenAIMedia;
  /** Single-user local bridge secret. Supply a per-user Codex + handler for multi-user hosts. */
  token: string;
  basePath?: string;
  /** Exact browser origins, e.g. http://localhost:5173. Empty allows non-browser clients only. */
  allowedOrigins?: string[];
  maxBodyBytes?: number;
}
export function createCodexHandler(options: HandlerOptions) {
  if (options.token.length < 24) throw new Error('Use a random bearer token of at least 24 characters');
  const base = options.basePath ?? '/api/ai';
  const ownedThreads = new Set<string>();
  const ai = options.codex;
  return async (req: IncomingMessage, res: ServerResponse): Promise<void> => {
    const json = (status: number, value: unknown) => { res.writeHead(status, { 'Content-Type': 'application/json', 'Cache-Control': 'no-store' }); res.end(JSON.stringify(value)); };
    const origin = req.headers.origin;
    const allowed = origin !== undefined && options.allowedOrigins?.includes(origin);
    if (origin && !allowed) { json(403, { error: 'Origin denied' }); return; }
    if (allowed) { res.setHeader('Access-Control-Allow-Origin', origin!); res.setHeader('Vary', 'Origin'); }
    if (req.method === 'OPTIONS') {
      res.writeHead(204, { 'Access-Control-Allow-Methods': 'GET,POST,OPTIONS', 'Access-Control-Allow-Headers': 'Authorization,Content-Type' }); res.end(); return;
    }
    const actual = Buffer.from(req.headers.authorization ?? ''); const expected = Buffer.from(`Bearer ${options.token}`);
    if (actual.length !== expected.length || !timingSafeEqual(actual, expected)) { json(401, { error: 'Unauthorized' }); return; }
    const controller = new AbortController();
    res.once('close', () => { if (!res.writableEnded) controller.abort(); });
    const assertOwned = (id: unknown): string => {
      if (typeof id !== 'string' || !ownedThreads.has(id)) throw new CodexError('Unknown thread for this bridge session', 'INVALID_INPUT'); return id;
    };
    const send = (value: unknown) => {
      if (res.destroyed) return;
      if (res.writableLength > 32 * 1024 * 1024) { controller.abort(); res.destroy(); return; }
      res.write(JSON.stringify(value) + '\n');
    };
    try {
      const url = new URL(req.url ?? '/', 'http://localhost');
      const route = url.pathname.slice(base.length);
      if (!url.pathname.startsWith(base + '/')) { json(404, { error: 'Not found' }); return; }
      if (req.method === 'GET' && route === '/models') { json(200, await ai.models.list()); return; }
      if (req.method === 'GET' && route === '/status') { const account = await ai.account.read(); json(200, { loggedIn: !!account.account, experimental: !!ai.options.experimental }); return; }
      if (req.method === 'GET' && route === '/voices') { json(200, await ai.voice.list()); return; }
      if (req.method !== 'POST') { json(405, { error: 'Method not allowed' }); return; }
      const body = await readBody(req, options.maxBodyBytes ?? 12 * 1024 * 1024);
      if (route.startsWith('/media/')) {
        if (!options.media) throw new CodexError('Configure the server media adapter with OPENAI_API_KEY', 'API_KEY_REQUIRED');
        for (const key of ['model', 'voice', 'language', 'filename', 'size', 'quality']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 256)) throw new CodexError(`Invalid ${key}`, 'INVALID_INPUT');
        if (route === '/media/speech') {
          if (typeof body.text !== 'string' || !body.text.trim() || body.text.length > 10000) throw new CodexError('Invalid speech text', 'INVALID_INPUT');
          const bytes = await options.media.speech({ text: body.text, model: body.model, voice: body.voice }, controller.signal);
          res.writeHead(200, { 'Content-Type': 'audio/mpeg', 'Cache-Control': 'no-store' }); res.end(Buffer.from(bytes)); return;
        }
        if (route === '/media/transcribe') {
          if (typeof body.data !== 'string' || !/^[A-Za-z0-9+/]+={0,2}$/.test(body.data) || body.data.length > 11 * 1024 * 1024) throw new CodexError('Expected base64 audio up to 8 MiB', 'INVALID_INPUT');
          const bytes = Buffer.from(body.data, 'base64');
          if (bytes.length > 8 * 1024 * 1024) throw new CodexError('Audio too large', 'INVALID_INPUT');
          json(200, await options.media.transcribe({ file: new Blob([bytes]), filename: body.filename, model: body.model, language: body.language }, controller.signal)); return;
        }
        if (route === '/media/images') {
          if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 32000 || !body.model) throw new CodexError('prompt and image model are required', 'INVALID_INPUT');
          json(200, await options.media.images({ prompt: body.prompt, model: body.model, size: body.size, quality: body.quality }, controller.signal)); return;
        }
        json(404, { error: 'Not found' }); return;
      }
      if (route === '/threads') { const threadId = await ai.threads.create(); ownedThreads.add(threadId); json(200, { threadId }); return; }
      if (route === '/chat' || route === '/images') {
        const input = parseChatInput(body);
        if (input.threadId) assertOwned(input.threadId);
        res.writeHead(200, { 'Content-Type': 'application/x-ndjson', 'Cache-Control': 'no-store', 'X-Accel-Buffering': 'no' });
        const runOptions = { signal: controller.signal, onEvent: (event: any) => {
          if (event.type === 'thread') ownedThreads.add(event.threadId);
          // Completion is emitted only after the high-level method validates its result.
          if (event.type !== 'completed') send(event);
        } };
        const result = route === '/images' ? await ai.images.generate(input, runOptions) : await ai.chat(input, runOptions);
        send({ type: 'completed', result }); res.end(); return;
      }
      if (route === '/voice/stop') { await ai.voice.stop(assertOwned(body.threadId)); json(200, {}); return; }
      if (route === '/voice/connect') {
        const threadId = assertOwned(body.threadId);
        if (typeof body.sdp !== 'string' || body.sdp.length > 128_000) throw new CodexError('A WebRTC SDP offer is required', 'INVALID_INPUT');
        const voiceOptions: VoiceOptions = { transport: { type: 'webrtc', sdp: body.sdp } };
        for (const key of ['model', 'voice', 'prompt'] as const) if (body[key] !== undefined) {
          if (typeof body[key] !== 'string') throw new CodexError(`Invalid ${key}`, 'INVALID_INPUT'); voiceOptions[key] = body[key];
        }
        const sdp = await new Promise<string>((resolve, reject) => {
          const cleanup = () => { clearTimeout(timer); off(); offClose(); controller.signal.removeEventListener('abort', abort); };
          const fail = (error: Error) => { cleanup(); void ai.voice.stop(threadId).catch(() => {}); reject(error); };
          const abort = () => fail(new CodexError('Connection aborted', 'ABORTED'));
          const timer = setTimeout(() => fail(new CodexError('Realtime negotiation timed out', 'VOICE_TIMEOUT')), 30_000);
          const off = ai.onNotification(event => {
            if (event.params.threadId !== threadId) return;
            if (event.method === 'thread/realtime/sdp') { cleanup(); resolve(event.params.sdp); }
            if (event.method === 'thread/realtime/error' || event.method === 'thread/realtime/closed') fail(new CodexError(event.params.message ?? event.params.reason ?? 'Realtime closed', 'VOICE_FAILED'));
          });
          const offClose = ai.transport.onClose(fail);
          controller.signal.addEventListener('abort', abort, { once: true });
          if (controller.signal.aborted) { abort(); return; }
          void Promise.resolve().then(() => ai.voice.start(threadId, voiceOptions)).catch(fail);
        });
        json(200, { sdp }); return;
      }
      json(404, { error: 'Not found' });
    } catch (error) {
      const code = error instanceof CodexError ? error.code : 'INTERNAL_ERROR';
      const message = error instanceof Error ? error.message : String(error);
      if (!res.headersSent) json(code === 'INVALID_INPUT' ? 400 : code === 'THREAD_BUSY' ? 409 : 502, { error: message, code });
      else if (!res.destroyed) { send({ type: 'error', error: message, code }); res.end(); }
    }
  };
}
async function readBody(req: IncomingMessage, limit: number): Promise<Record<string, any>> {
  if (!req.headers['content-type']?.startsWith('application/json')) throw new CodexError('Content-Type must be application/json', 'INVALID_INPUT');
  const chunks: Buffer[] = []; let size = 0;
  for await (const chunk of req) { size += chunk.length; if (size > limit) throw new CodexError('Request too large', 'INVALID_INPUT'); chunks.push(Buffer.from(chunk)); }
  try { const body = JSON.parse(Buffer.concat(chunks).toString()); if (!body || typeof body !== 'object' || Array.isArray(body)) throw new Error(); return body; }
  catch { throw new CodexError('Expected a JSON object', 'INVALID_INPUT'); }
}
export function parseChatInput(body: Record<string, any>): ChatInput {
  if (typeof body.prompt !== 'string' || !body.prompt.trim() || body.prompt.length > 100_000) throw new CodexError('Invalid prompt', 'INVALID_INPUT');
  for (const key of ['threadId', 'model', 'effort']) if (body[key] !== undefined && (typeof body[key] !== 'string' || body[key].length > 512)) throw new CodexError(`Invalid ${key}`, 'INVALID_INPUT');
  if (body.images !== undefined && (!Array.isArray(body.images) || body.images.length > 8 || body.images.some((url: unknown) => typeof url !== 'string' || !/^data:image\/(png|jpeg|webp);base64,[A-Za-z0-9+/]+=*$/.test(url)))) throw new CodexError('HTTP image inputs must be PNG/JPEG/WebP data URLs (max 8)', 'INVALID_INPUT');
  return { prompt: body.prompt, threadId: body.threadId, model: body.model, effort: body.effort, images: body.images, outputSchema: body.outputSchema };
}
