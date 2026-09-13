/** A deliberately small public surface; raw protocol events remain available. */
export type Json = null | boolean | number | string | Json[] | { [key: string]: Json };
export type Notification = { method: string; params: Record<string, any> };
export type ServerRequest = Notification & { id: number | string };
export type Model = {
  id: string; model: string; displayName: string; description: string; isDefault: boolean;
  defaultReasoningEffort: string;
  supportedReasoningEfforts: { reasoningEffort: string; description: string }[];
  inputModalities?: string[];
};
export type Image = { itemId: string; mimeType: string; dataUrl: string };
export type ChatInput = {
  prompt: string;
  threadId?: string;
  model?: string;
  effort?: string;
  images?: string[];
  outputSchema?: Json;
};
export type ChatEvent =
  | { type: 'thread'; threadId: string }
  | { type: 'started'; threadId: string; turnId: string }
  | { type: 'delta'; text: string; itemId: string }
  | { type: 'image'; image: Image }
  | { type: 'activity'; method: string; item?: Record<string, any> }
  | { type: 'completed'; result: ChatResult };
export type ChatResult = { threadId: string; turnId: string; text: string; images: Image[]; status: 'completed' | 'interrupted' };
export type RunOptions = { signal?: AbortSignal; timeoutMs?: number; onEvent?: (event: ChatEvent) => void };
export type AudioChunk = { data: string; sampleRate: number; numChannels: number; samplesPerChannel: number | null; itemId: string | null };
export type VoiceOptions = {
  model?: string; voice?: string; prompt?: string; version?: 'v1' | 'v2' | 'v3';
  outputModality?: 'audio' | 'text';
  transport?: { type: 'websocket' } | { type: 'webrtc'; sdp: string };
};
export type Voices = { voices: { v1: string[]; v2: string[]; defaultV1: string; defaultV2: string } };
export class CodexError extends Error {
  constructor(message: string, public code: string | number = 'CODEX_ERROR') { super(message); this.name = 'CodexError'; }
}
