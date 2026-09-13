'use client';
import { createElement, useCallback, useEffect, useRef, useState } from 'react';
import { createLocalCodexBrowser, type CodexBrowser } from './browser.js';
import type { ChatInput, ChatResult, Image } from './types.js';

/** Headless hook: your components own layout and history persistence. */
export function useCodexChat(client: CodexBrowser) {
  const [text, setText] = useState('');
  const [images, setImages] = useState<Image[]>([]);
  const [isRunning, setRunning] = useState(false);
  const [error, setError] = useState<Error | null>(null);
  const thread = useRef<string | undefined>(undefined);
  const active = useRef<AbortController | null>(null);
  useEffect(() => () => { active.current?.abort(); }, []);
  const send = useCallback(async (input: ChatInput, mode: 'chat' | 'image' = 'chat'): Promise<ChatResult | undefined> => {
    if (active.current) return;
    const controller = new AbortController(); active.current = controller;
    setRunning(true); setText(''); setImages([]); setError(null);
    try {
      const run = mode === 'image' ? client.images.generate : client.chat;
      const result = await run({ ...input, threadId: input.threadId ?? thread.current }, { signal: controller.signal, onEvent: event => {
        if (event.type === 'thread') thread.current = event.threadId;
        if (event.type === 'delta') setText(current => current + event.text);
        if (event.type === 'image') setImages(current => [...current, event.image]);
      } });
      setText(result.text); setImages(result.images); return result;
    } catch (cause) { if (!controller.signal.aborted) setError(cause instanceof Error ? cause : new Error(String(cause))); return undefined; }
    finally { active.current = null; setRunning(false); }
  }, [client]);
  return { text, images, isRunning, error, send, stop: () => active.current?.abort(), reset: () => { if (!active.current) { thread.current = undefined; setText(''); setImages([]); setError(null); } } };
}

/** Ready-to-use local pairing form. Keeps the token in memory only. */
export function LocalCodexConnect({ onConnected }: { onConnected: (client: CodexBrowser) => void }) {
  const [baseUrl, setBaseUrl] = useState('http://127.0.0.1:8787/api/ai');
  const [token, setToken] = useState('');
  const [message, setMessage] = useState('PCで接続コマンドを起動し、表示されたトークンを入力してください。');
  const [busy, setBusy] = useState(false);
  const mounted = useRef(true);
  const running = useRef(false);
  useEffect(() => { mounted.current = true; return () => { mounted.current = false; }; }, []);
  return createElement('form', {
    onSubmit: async (event: { preventDefault(): void }) => {
      event.preventDefault();
      if (running.current) return;
      running.current = true; setBusy(true);
      try {
        const client = createLocalCodexBrowser({ baseUrl, token });
        const status = await client.status();
        if (!status.loggedIn) throw new Error('PCで codex login を実行してください。');
        if (mounted.current) { setToken(''); setMessage('自分のPCのCodexに接続しました。'); onConnected(client); }
      } catch (error) {
        if (mounted.current) setMessage(error instanceof Error ? error.message : String(error));
      } finally { running.current = false; if (mounted.current) setBusy(false); }
    },
  },
  createElement('label', null, '接続URL', createElement('input', { value: baseUrl, type: 'url', required: true, disabled: busy, onChange: (e: { target: { value: string } }) => setBaseUrl(e.target.value) })),
  createElement('label', null, '接続トークン', createElement('input', { value: token, type: 'password', autoComplete: 'off', required: true, disabled: busy, onChange: (e: { target: { value: string } }) => setToken(e.target.value) })),
  createElement('button', { type: 'submit', disabled: busy }, busy ? '接続中…' : '自分のCodexに接続'),
  createElement('p', { role: 'status' }, message));
}
