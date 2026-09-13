'use client';
import { useCallback, useEffect, useRef, useState } from 'react';
import type { CodexBrowser } from './browser.js';
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
