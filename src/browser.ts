import { CodexError, type ChatEvent, type ChatInput, type ChatResult, type Model, type Voices } from './types.js';
export * from './types.js';
export type BrowserOptions = { baseUrl?: string; token: string; fetch?: typeof fetch };
export function createCodexBrowser(options: BrowserOptions) {
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const base = (options.baseUrl ?? '/api/ai').replace(/\/$/, '');
  const request = async (route: string, body?: unknown, signal?: AbortSignal) => {
    const response = await fetcher(base + route, { method: body === undefined ? 'GET' : 'POST', headers: { Authorization: `Bearer ${options.token}`, ...(body === undefined ? {} : { 'Content-Type': 'application/json' }) }, body: body === undefined ? undefined : JSON.stringify(body), signal });
    if (!response.ok) { const value = await response.json().catch(() => ({})) as any; throw new CodexError(value.error ?? `HTTP ${response.status}`, value.code ?? response.status); }
    return response;
  };
  const run = async (route: string, input: ChatInput, opts: { signal?: AbortSignal; onEvent?: (event: ChatEvent) => void } = {}): Promise<ChatResult> => {
    const response = await request(route, input, opts.signal);
    if (!response.body) throw new CodexError('Response has no stream', 'PROTOCOL_ERROR');
    const reader = response.body.getReader(); const decoder = new TextDecoder(); let buffer = '', result: ChatResult | undefined;
    const consume = (line: string) => {
      if (!line.trim()) return;
      const event = JSON.parse(line);
      if (event.type === 'error') throw new CodexError(event.error, event.code);
      if (event.type === 'completed') result = event.result;
      opts.onEvent?.(event);
    };
    try {
      while (true) {
        const { value, done } = await reader.read();
        buffer += decoder.decode(value, { stream: !done });
        let index: number;
        while ((index = buffer.indexOf('\n')) >= 0) { consume(buffer.slice(0, index)); buffer = buffer.slice(index + 1); }
        if (buffer.length > 32 * 1024 * 1024) throw new CodexError('Stream frame too large', 'PROTOCOL_ERROR');
        if (done) { consume(buffer); break; }
      }
      if (!result) throw new CodexError('Stream ended without completion', 'STREAM_INTERRUPTED');
      return result;
    } finally { await reader.cancel().catch(() => {}); reader.releaseLock(); }
  };
  return {
    models: { list: async (): Promise<Model[]> => (await request('/models')).json() },
    status: async (): Promise<{ loggedIn: boolean; experimental: boolean }> => (await request('/status')).json(),
    threads: { create: async (): Promise<string> => ((await (await request('/threads', {})).json()) as { threadId: string }).threadId },
    chat: (input: ChatInput, opts?: Parameters<typeof run>[2]) => run('/chat', input, opts),
    images: { generate: (input: ChatInput, opts?: Parameters<typeof run>[2]) => run('/images', input, opts) },
    media: {
      speech: async (input: { text: string; model?: string; voice?: string }, signal?: AbortSignal): Promise<Blob> => (await request('/media/speech', input, signal)).blob(),
      transcribe: async (input: { file: Blob; filename?: string; model?: string; language?: string }, signal?: AbortSignal): Promise<{ text: string }> => {
        if (input.file.size > 8 * 1024 * 1024) throw new CodexError('Audio exceeds 8 MiB bridge limit', 'INVALID_INPUT');
        const bytes = new Uint8Array(await input.file.arrayBuffer()); let binary = '';
        for (let i = 0; i < bytes.length; i += 8192) binary += String.fromCharCode(...bytes.subarray(i, i + 8192));
        return (await request('/media/transcribe', { data: btoa(binary), filename: input.filename, model: input.model, language: input.language }, signal)).json();
      },
      images: async (input: { prompt: string; model: string; size?: string; quality?: string }, signal?: AbortSignal): Promise<{ data: { b64_json?: string; url?: string }[] }> => (await request('/media/images', input, signal)).json(),
    },
    voice: {
      list: async (): Promise<Voices> => (await request('/voices')).json(),
      connect: async (input: { threadId: string; sdp: string; model?: string; voice?: string; prompt?: string }, signal?: AbortSignal): Promise<{ sdp: string }> => (await request('/voice/connect', input, signal)).json(),
      stop: async (threadId: string): Promise<void> => { await request('/voice/stop', { threadId }); },
    },
  };
}
export type CodexBrowser = ReturnType<typeof createCodexBrowser>;

/** Call from a user gesture. Mic stays local until WebRTC negotiation. No API keys enter the browser. */
export async function startVoice(client: CodexBrowser, options: {
  threadId: string; audioElement: HTMLAudioElement; model?: string; voice?: string; prompt?: string;
  onEvent?: (event: unknown) => void; signal?: AbortSignal;
}) {
  const pc = new RTCPeerConnection();
  let stream: MediaStream | undefined;
  let stopped = false;
  const stop = async () => {
    if (stopped) return; stopped = true;
    options.signal?.removeEventListener('abort', abort);
    stream?.getTracks().forEach(track => track.stop()); pc.close(); options.audioElement.srcObject = null;
    await client.voice.stop(options.threadId);
  };
  const abort = () => { void stop().catch(() => {}); };
  try {
    options.signal?.throwIfAborted();
    stream = await navigator.mediaDevices.getUserMedia({ audio: true });
    options.signal?.throwIfAborted();
    stream.getTracks().forEach(track => pc.addTrack(track, stream!));
    pc.ontrack = event => { options.audioElement.srcObject = event.streams[0] ?? new MediaStream([event.track]); void options.audioElement.play().catch(() => { options.onEvent?.({ type: 'playback-blocked' }); }); };
    const channel = pc.createDataChannel('oai-events');
    channel.onmessage = event => { try { options.onEvent?.(JSON.parse(event.data)); } catch { options.onEvent?.(event.data); } };
    pc.onconnectionstatechange = () => {
      options.onEvent?.({ type: 'connection-state', state: pc.connectionState });
      if (pc.connectionState === 'failed' || pc.connectionState === 'closed') abort();
    };
    const offer = await pc.createOffer(); await pc.setLocalDescription(offer);
    const answer = await client.voice.connect({ threadId: options.threadId, sdp: offer.sdp!, model: options.model, voice: options.voice, prompt: options.prompt }, options.signal);
    await pc.setRemoteDescription({ type: 'answer', sdp: answer.sdp });
    options.signal?.addEventListener('abort', abort, { once: true });
    if (options.signal?.aborted) abort();
    return { peerConnection: pc, stop };
  } catch (error) { await stop().catch(() => {}); throw error; }
}

/** Local companion connection: never send the pairing token to a remote host. */
export function createLocalCodexBrowser(options: { token: string; baseUrl?: string }) {
  const baseUrl = options.baseUrl ?? 'http://127.0.0.1:8787/api/ai';
  const url = new URL(baseUrl);
  if (!['127.0.0.1', 'localhost'].includes(url.hostname) || !['http:', 'https:'].includes(url.protocol) || url.username || url.password || url.search || url.hash) {
    throw new CodexError('Local connection URL must point to localhost or 127.0.0.1 without credentials, query or fragment', 'INVALID_INPUT');
  }
  return createCodexBrowser({ token: options.token, baseUrl: url.href });
}
