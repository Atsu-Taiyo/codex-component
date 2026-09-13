import path from 'node:path';
import { AppServerTransport, type TransportOptions } from './transport.js';
import { decodeImage } from './images.js';
import { CodexError, type AudioChunk, type ChatInput, type ChatResult, type Image, type Json, type Model, type Notification, type RunOptions, type VoiceOptions, type Voices } from './types.js';
export * from './types.js';
export { AppServerTransport, type TransportOptions } from './transport.js';

export interface CodexOptions extends TransportOptions {
  /** The host controls this, never the browser. Default: process.cwd(). */
  workspace?: string;
  developerInstructions?: string;
  threadConfig?: Record<string, Json>;
  /** Extra trusted roots for native image files. Workspace is always included. */
  imageRoots?: string[];
}
export class Codex {
  readonly transport: AppServerTransport;
  readonly workspace: string;
  private busy = new Set<string>();
  constructor(readonly options: CodexOptions = {}) {
    this.workspace = path.resolve(options.workspace ?? options.cwd ?? process.cwd());
    this.transport = new AppServerTransport({ ...options, cwd: this.workspace });
  }
  readonly models = { list: async (): Promise<Model[]> => {
    const models: Model[] = []; let cursor: string | null = null;
    const seen = new Set<string>();
    do {
      const result: { data: Model[]; nextCursor: string | null } = await this.transport.request('model/list', { cursor, limit: 100 });
      models.push(...result.data); cursor = result.nextCursor;
      if (cursor && seen.has(cursor)) throw new CodexError('Repeated model cursor', 'PROTOCOL_ERROR');
      if (cursor) seen.add(cursor);
    } while (cursor);
    return models;
  } };
  readonly account = {
    read: () => this.transport.request<{ account: { type: string; email?: string; planType?: string } | null; requiresOpenaiAuth: boolean }>('account/read', { refreshToken: false }),
    login: () => this.transport.request<{ type: string; authUrl?: string; loginId?: string }>('account/login/start', { type: 'chatgpt' }),
    cancelLogin: (loginId: string) => this.transport.request('account/login/cancel', { loginId }),
    rateLimits: () => this.transport.request('account/rateLimits/read'),
  };
  readonly threads = {
    create: async (options: { model?: string; ephemeral?: boolean } = {}): Promise<string> => {
      const result = await this.transport.request('thread/start', {
        ...options, cwd: this.workspace, sandbox: 'read-only', approvalPolicy: 'never',
        developerInstructions: this.options.developerInstructions ?? 'You are embedded in a custom app. Answer the user directly. Only use tools necessary to answer. Do not modify files.',
        config: { 'features.image_generation': true, ...this.options.threadConfig },
      });
      return result.thread.id;
    },
    resume: async (threadId: string): Promise<void> => {
      await this.transport.request('thread/resume', { threadId, cwd: this.workspace, sandbox: 'read-only', approvalPolicy: 'never', ...(this.options.developerInstructions ? { developerInstructions: this.options.developerInstructions } : {}) });
    },
  };
  onNotification(listener: (event: Notification) => void) { return this.transport.onNotification(listener); }

  async chat(input: ChatInput, options: RunOptions = {}): Promise<ChatResult> {
    if (!input.prompt?.trim()) throw new CodexError('prompt must not be empty', 'INVALID_INPUT');
    options.signal?.throwIfAborted();
    const threadId = input.threadId ?? await this.threads.create({ model: input.model });
    if (this.busy.has(threadId)) throw new CodexError('A turn is already active on this thread', 'THREAD_BUSY');
    this.busy.add(threadId);
    try {
      if (input.threadId) await this.threads.resume(threadId);
      options.signal?.throwIfAborted();
      options.onEvent?.({ type: 'thread', threadId });
      return await this.run(threadId, input, options);
    } finally { this.busy.delete(threadId); }
  }
  private run(threadId: string, input: ChatInput, options: RunOptions): Promise<ChatResult> {
    return new Promise((resolve, reject) => {
      let turnId: string | undefined, done = false, cancelled: Error | undefined;
      let queue = Promise.resolve();
      const buffered: Notification[] = [];
      const messages = new Map<string, string>();
      const images: Image[] = []; const imageIds = new Set<string>();
      const emit = (event: Parameters<NonNullable<RunOptions['onEvent']>>[0]) => options.onEvent?.(event);
      const finish = (error?: unknown, result?: ChatResult) => {
        if (done) return; done = true;
        clearTimeout(timer); off(); offClose(); options.signal?.removeEventListener('abort', abort);
        if (error) reject(error); else resolve(result!);
      };
      const interrupt = async () => {
        if (turnId) {
          try { await this.transport.request('turn/interrupt', { threadId, turnId }); }
          catch { this.transport.close(); /* cannot safely reuse a process with an uninterruptible turn */ }
        }
      };
      const cancel = (error: Error) => {
        if (done || cancelled) return;
        cancelled = error;
        // Close a process if start acknowledgement has not arrived: its turn id is unknowable.
        if (!turnId) { finish(error); this.transport.close(); }
        else void interrupt().finally(() => finish(error));
      };
      const abort = () => cancel(new CodexError('Run aborted', 'ABORTED'));
      const timer = setTimeout(() => cancel(new CodexError('Turn timed out', 'TURN_TIMEOUT')), options.timeoutMs ?? 180_000);
      const process = async (event: Notification) => {
        if (done || cancelled) return;
        const p = event.params;
        if ((p.turnId ?? p.turn?.id) !== turnId) return;
        if (event.method === 'item/agentMessage/delta') {
          messages.set(p.itemId, (messages.get(p.itemId) ?? '') + p.delta);
          emit({ type: 'delta', text: p.delta, itemId: p.itemId });
        } else if (event.method === 'item/completed' && p.item?.type === 'agentMessage') {
          messages.set(p.item.id, p.item.text);
        } else if (event.method === 'item/completed' && p.item?.type === 'imageGeneration' && !imageIds.has(p.item.id)) {
          imageIds.add(p.item.id);
          const image = await decodeImage(p.item, [this.workspace, ...(this.options.imageRoots ?? [])]);
          if (done || cancelled) return;
          images.push(image); emit({ type: 'image', image });
        } else if (event.method === 'turn/completed') {
          if (p.turn.status === 'failed' || p.turn.error) throw new CodexError(p.turn.error?.message ?? 'Turn failed', 'TURN_FAILED');
          const result: ChatResult = { threadId, turnId: turnId!, text: [...messages.values()].join('\n\n'), images, status: p.turn.status === 'interrupted' ? 'interrupted' : 'completed' };
          emit({ type: 'completed', result }); finish(undefined, result);
        } else if (event.method === 'item/started' || event.method === 'item/completed') {
          emit({ type: 'activity', method: event.method, item: { type: p.item?.type, id: p.item?.id } });
        }
      };
      const enqueue = (event: Notification) => { queue = queue.then(() => process(event)).catch(error => { cancel(error instanceof Error ? error : new Error(String(error))); }); };
      const off = this.transport.onNotification(event => {
        if (event.params.threadId !== threadId || done) return;
        if (!turnId) buffered.push(event); else enqueue(event);
      });
      const offClose = this.transport.onClose(error => finish(error));
      options.signal?.addEventListener('abort', abort, { once: true });
      if (options.signal?.aborted) { abort(); return; }
      void this.transport.request('turn/start', {
        threadId, model: input.model, effort: input.effort, outputSchema: input.outputSchema,
        input: [{ type: 'text', text: input.prompt, text_elements: [] }, ...(input.images ?? []).map(url => ({ type: 'image', url }))],
      }).then(response => {
        turnId = response.turn.id;
        if (done || cancelled) { void interrupt(); return; }
        emit({ type: 'started', threadId, turnId: turnId! });
        for (const event of buffered) enqueue(event);
        buffered.length = 0;
      }).catch(error => {
        if (turnId) cancel(error instanceof Error ? error : new Error(String(error)));
        else { finish(error); if (error instanceof CodexError && error.code === 'RPC_TIMEOUT') this.transport.close(); }
      });
    });
  }
  readonly images = {
    generate: async (input: ChatInput, options: RunOptions = {}): Promise<ChatResult> => {
      const result = await this.chat({ ...input, prompt: `Use the native image generation tool to generate or edit an image for this request. Return the generated image. Do not substitute SVG, code, or an image search.\n\n${input.prompt}` }, { timeoutMs: 600_000, ...options, onEvent: event => { if (event.type !== 'completed') options.onEvent?.(event); } });
      if (!result.images.length) throw new CodexError('Codex returned no native image. Check image generation availability for this account/runtime.', 'IMAGE_UNAVAILABLE');
      options.onEvent?.({ type: 'completed', result });
      return result;
    },
  };
  readonly voice = {
    list: (): Promise<Voices> => { this.requireExperimental(); return this.transport.request('thread/realtime/listVoices'); },
    start: (threadId: string, options: VoiceOptions = {}) => {
      this.requireExperimental();
      return this.transport.request('thread/realtime/start', { ...options, threadId, version: options.version ?? (options.transport?.type === 'webrtc' ? 'v3' : undefined), outputModality: options.outputModality ?? 'audio', transport: options.transport ?? { type: 'websocket' } });
    },
    appendAudio: (threadId: string, audio: AudioChunk) => { this.requireExperimental(); return this.transport.request('thread/realtime/appendAudio', { threadId, audio }); },
    appendText: (threadId: string, text: string) => { this.requireExperimental(); return this.transport.request('thread/realtime/appendText', { threadId, text, role: 'user' }); },
    stop: (threadId: string) => { this.requireExperimental(); return this.transport.request('thread/realtime/stop', { threadId }); },
  };
  private requireExperimental() { if (!this.options.experimental) throw new CodexError('Set experimental: true to use thread realtime', 'EXPERIMENTAL_DISABLED'); }
  close() { this.transport.close(); }
}
export const createCodex = (options: CodexOptions = {}) => new Codex(options);
