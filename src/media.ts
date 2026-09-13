import { CodexError } from './types.js';
export interface MediaOptions {
  /** Server only. Separate API billing; never send this key to a UI. */
  apiKey: string;
  fetch?: typeof fetch;
  timeoutMs?: number;
}
/** Optional, explicit OpenAI API adapter. It never reuses Codex/ChatGPT login tokens. */
export function createOpenAIMedia(options: MediaOptions) {
  if (!options.apiKey) throw new CodexError('OPENAI_API_KEY is required for the media adapter', 'API_KEY_REQUIRED');
  const fetcher = options.fetch ?? globalThis.fetch.bind(globalThis);
  const call = async (route: string, body: Record<string, unknown> | FormData, signal?: AbortSignal) => {
    const multipart = body instanceof FormData;
    const response = await fetcher(`https://api.openai.com/v1/${route}`, {
      method: 'POST', headers: { Authorization: `Bearer ${options.apiKey}`, ...(multipart ? {} : { 'Content-Type': 'application/json' }) },
      body: multipart ? body : JSON.stringify(body),
      signal: AbortSignal.any([AbortSignal.timeout(options.timeoutMs ?? 180_000), ...(signal ? [signal] : [])]),
    });
    if (!response.ok) {
      const error = await response.json().catch(() => ({})) as any;
      throw new CodexError(error.error?.message ?? `OpenAI HTTP ${response.status}`, error.error?.code ?? response.status);
    }
    return response;
  };
  return {
    speech: async (input: { text: string; model?: string; voice?: string }, signal?: AbortSignal): Promise<ArrayBuffer> => {
      return (await call('audio/speech', { model: input.model ?? 'gpt-4o-mini-tts', voice: input.voice ?? 'coral', input: input.text, response_format: 'mp3' }, signal)).arrayBuffer();
    },
    transcribe: async (input: { file: Blob; filename?: string; model?: string; language?: string }, signal?: AbortSignal): Promise<{ text: string }> => {
      const form = new FormData(); form.set('file', input.file, input.filename ?? 'audio.webm');
      form.set('model', input.model ?? 'gpt-transcribe'); if (input.language) form.set('language', input.language);
      return (await call('audio/transcriptions', form, signal)).json();
    },
    images: async (input: { prompt: string; model: string; size?: string; quality?: string }, signal?: AbortSignal): Promise<{ data: { b64_json?: string; url?: string }[] }> => {
      return (await call('images/generations', { ...input, n: 1 }, signal)).json();
    },
  };
}
export type OpenAIMedia = ReturnType<typeof createOpenAIMedia>;
