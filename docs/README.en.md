# Codex Component

Embed Codex app-server behind your own UI. TypeScript, no core runtime dependencies, optional React hook, a runnable browser playground, chat streaming, cancellation, model selection, native image generation and experimental voice.

This is an unofficial MIT-licensed project. Requires Node.js 22+ and Codex CLI. The npm package is **not published to the registry**; install a prebuilt GitHub Release or a local tarball.

```bash
npm install -g @openai/codex
codex login
git clone https://github.com/Atsu-Taiyo/codex-component.git
cd codex-component
npm ci
npm run dev
```

Open the token-bearing local URL printed in the terminal. Or add to your application:

```bash
npm install https://github.com/Atsu-Taiyo/codex-component/releases/download/v0.2.0/codex-component-0.2.0.tgz
```

```ts
import { createCodex } from 'codex-component';
const ai = createCodex();
try {
  const result = await ai.chat({ prompt: 'Suggest a hackathon project' });
  console.log(result.text);
} finally { ai.close(); }
```

Entrypoints: core (`codex-component`), Node HTTP (`/server`), browser (`/browser`), optional headless React hook (`/react`), optional server-side OpenAI API media adapter (`/media`).

The native path uses Codex's own authentication and account capabilities. The media adapter requires a separate OpenAI API key and incurs API billing. Codex chat model selection is separate from choosing an image or speech model.

**Verified on macOS with CLI 0.154.0:** chat, model discovery, native PNG generation and voice discovery. Starting direct WebSocket realtime (not WebRTC) with ChatGPT auth returned `realtime conversation requires API key auth`. End-to-end microphone calls and live API media requests are not verified. WebRTC uses ChatGPT authentication and defaults to protocol v3 (quicksilver=v2 header); no separate API key is required for that path. Voice is explicitly experimental; there is no silent billing fallback.

The bundled HTTP handler is a **single-user local bridge**. Public services need their own authentication, per-user runtime/storage isolation and quotas. Its read-only sandbox still permits reading files and may inherit configured MCP/plugin behavior. Browser code never receives Codex credentials or an OpenAI API key.

Read the complete [Japanese README](../README.md), [API reference](api.md), [integration guide](integration.md) and [source/compatibility notes](compatibility.md).
