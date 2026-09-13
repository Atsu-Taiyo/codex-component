# API reference

All entrypoints are ESM, with TypeScript declarations. Node.js 22+ is required on the server. React 18/19 is optional. No runtime dependencies are required by the core.

## `createCodex(options?)`

Returns one reusable `Codex` instance backed by one lazily spawned process.

| Option | Default | Meaning |
| --- | --- | --- |
| `workspace` | `process.cwd()` | Host-controlled absolute workspace; must exist |
| `bin` | `codex` | Executable path; never executed via a shell |
| `args` | `['app-server', '--listen', 'stdio://']` | Advanced host override, useful for tests |
| `codexHome` | CLI environment/default | Independent home for auth/config/state. No credentials are copied |
| `experimental` | `false` | Opt into experimental protocol fields/methods |
| `requestTimeoutMs` | `30000` | Individual RPC timeout |
| `developerInstructions` | App-oriented instructions | Host instructions for threads |
| `threadConfig` | image generation enabled | Native per-thread Codex configuration overrides; host only |
| `imageRoots` | `[]` | Extra trusted native image roots; workspace is included |
| `onStderr` | none | Optional diagnostics; may contain private context; do not publish logs blindly |
| `onServerRequest` | decline/reject | Advanced async host handler for server requests |

New/resumed chats use read-only sandbox and `approvalPolicy: never`. Unknown server requests receive a JSON-RPC error; known approvals are declined. These are not a substitute for OS/user isolation. `onServerRequest` gets `{id, method, params}` and returns the **result payload**, not a JSON-RPC envelope. It has the request timeout; never build an auto-approve-all UI by passing through arbitrary browser JSON. MCP/dynamic-tool callers must implement the respective native result schema themselves. The minimal HTTP bridge intentionally exposes no arbitrary RPC or approvals endpoint.

### `chat(input, options?) → Promise<ChatResult>`

```ts
type ChatInput = {
  prompt: string;
  threadId?: string;
  model?: string;
  effort?: string;
  images?: string[];
  outputSchema?: Json;
};
type ChatResult = {
  threadId: string;
  turnId: string;
  text: string;
  images: { itemId: string; mimeType: string; dataUrl: string }[];
  status: 'completed' | 'interrupted';
};
```

`model` uses the catalog's **model** field. Pass `supportedReasoningEfforts[].reasoningEffort` as `effort`; available choices depend on the model. No silent model substitution is performed by this wrapper. `outputSchema` is the native JSON output schema; the host remains responsible for parsing and validating the returned text against its business schema.

Options: `signal?: AbortSignal`, `timeoutMs?: number` (default 180000), `onEvent?: (event: ChatEvent) => void`. The turn timer starts after thread setup; individual setup RPCs have their own timeout. Keep callbacks synchronous and fast. Completed agent message events are authoritative; the returned text may include multiple messages, separated by blank lines.

| Event `type` | Payload |
| --- | --- |
| `thread` | `threadId` |
| `started` | `threadId`, `turnId` |
| `delta` | `text`, `itemId` |
| `activity` | `method`, minimal `item` (`id`, `type`) |
| `image` | decoded `image` |
| `completed` | `result` |

Aborting rejects with `ABORTED`; a server-side interruption may return `status: interrupted`. Normal completion waits for queued image reads. Failed turns reject. Events for other threads/turns are ignored. Early events are buffered until turn/start acknowledgement.

Cancellation interrupts the native turn; if acknowledgement never arrived or interrupt fails, the wrapper closes its process because it cannot safely reuse that state. Closing also rejects other active operations on that instance. Create a new client after `CLOSED`/process failure. There is no automatic retry of generations, to avoid duplicate work or billing.

### Other methods

| Method | Result / purpose |
| --- | --- |
| `models.list()` | All picker-visible model pages, flattened |
| `threads.create({model?, ephemeral?})` | Thread ID |
| `threads.resume(threadId)` | Resume persisted thread; `chat` does this automatically |
| `account.read()` | Native account summary, may include email; host only |
| `account.login()` | ChatGPT login info including `authUrl`; host should display/open it |
| `account.cancelLogin(loginId)` | Cancel login flow |
| `account.rateLimits()` | Native rate limit response |
| `images.generate(input, options?)` | Chat result with native images; 600000ms default timeout; rejects if no image |
| `onNotification(listener)` | Raw native events, returns unsubscribe; host only |
| `transport.request(method, params)` | Advanced raw RPC escape hatch, host only |
| `close()` | Synchronous process shutdown initiation; pending operations reject |

There is no automatic login URL opening or logout. `account/login/completed` notifications plus `account.read()` can drive an embedded auth UI. Display identity only to its owner.

## Voice: experimental

`experimental: true` is required. The payload subset follows generated CLI 0.154.0 types; availability is checked by actually starting a session, not inferred from a voice list.

- `voice.list()` returns `{voices:{v1, v2, defaultV1, defaultV2}}`.
- `voice.start(threadId, {model?, voice?, prompt?, version?, outputModality?, transport?})` uses `thread/realtime/start`. Output defaults to `audio`; transport defaults to `{type:'websocket'}` (API-key path). WebRTC defaults to `version:'v3'`, which selects the `OpenAI-Alpha: quicksilver=v2` header and supports Codex ChatGPT authentication. Protocol `v2` is not the same as the quicksilver header's v2.
- `voice.appendAudio(threadId, audio)` accepts `{data, sampleRate, numChannels, samplesPerChannel, itemId}`. `data` is base64 audio bytes. Match the actual runtime's audio encoding; a WebM/MP3 file is **not** a raw audio chunk. Prefer the WebRTC helper to avoid codec/frame handling.
- `voice.appendText(threadId, text)` appends text with role `user`.
- `voice.stop(threadId)` stops the native realtime session.

Subscribe **before** starting. Watch `thread/realtime/started`, `/sdp`, `/outputAudio/delta`, `/error`, `/closed` and transcript notifications. A successful start RPC only means accepted: asynchronous `/error` can still follow. Node hosts own the session lifecycle; always stop sessions in cleanup.

Browser `startVoice(client, {threadId, audioElement, model?, voice?, prompt?, signal?, onEvent?})` handles microphone permission, WebRTC SDP, data-channel events, playback and cleanup. Returns `{peerConnection, stop}`. Call from a user gesture, on localhost or HTTPS. It does not implement a provider-independent voice agent or automatic reconnection. Realtime model names are explicit overrides, separate from the chat catalog. A successful SDP exchange does not prove usable audio. Observe connection state and actual audio in your environment.

## HTTP bridge

`createCodexHandler({codex, token, allowedOrigins?, basePath?, maxBodyBytes?, media?})` is a Node request listener. Default prefix `/api/ai`, JSON input, NDJSON output for turns. All routes except preflight require `Authorization: Bearer <token>`. Token minimum: 24 characters; use cryptographically random values. Browser origins must match exactly.

| Method/path | Body/result |
| --- | --- |
| GET `/status` | `{loggedIn, experimental}`; no email/token |
| GET `/models` | Model array |
| GET `/voices` | Native voice list |
| POST `/threads` | `{}` → `{threadId}` |
| POST `/chat` | `ChatInput` → NDJSON `ChatEvent` records |
| POST `/images` | `ChatInput` → NDJSON, requires image result |
| POST `/voice/connect` | `{threadId,sdp,model?,voice?,prompt?}` → `{sdp}` |
| POST `/voice/stop` | `{threadId}` → `{}` |
| POST `/media/speech` | `{text,model?,voice?}` → MP3 bytes |
| POST `/media/transcribe` | `{data,filename?,model?,language?}` → `{text}`; data is base64 |
| POST `/media/images` | `{prompt,model,size?,quality?}` → native Images API JSON |

Bridge limits: 12MiB total JSON body, 100000-character chat prompt, up to 8 input images as PNG/JPEG/WebP **data URLs**, 8MiB decoded audio for transcription. Node direct image inputs can also use native supported URLs; browser HTTP disallows arbitrary remote/local file input. Slow responses are terminated if queued writes exceed 32MiB.

Errors before headers: JSON `{error, code}` with HTTP 400/401/403/409/502. Errors after streaming starts: NDJSON `{type:'error', error, code}`. A closed stream without `completed` is an error. Do not treat HTTP 200 alone as successful generation.

The handler remembers only threads it created during this process lifetime. This is one-user ownership, **not** multi-tenant authorization. Reusing the handler across users shares all of those threads. Restart loses the allowed-ID set; native persisted threads still exist in Codex. Build authenticated per-user ID mapping for durable web history.

## OpenAI API media

`createOpenAIMedia({apiKey, timeoutMs?, fetch?})` is independent of Codex, server only. Default request timeout: 180000ms. Methods accept an optional final `AbortSignal`.

- `speech({text, model?, voice?})`: MP3 `ArrayBuffer`. Defaults: `gpt-4o-mini-tts`, `coral`.
- `transcribe({file: Blob, filename?, model?, language?})`: JSON transcription. Defaults: `gpt-transcribe`, filename `audio.webm`.
- `images({prompt, model, size?, quality?})`: one image, raw provider JSON. Model is required. This small adapter covers generation; image editing uses native `ai.images.generate()` or a separately implemented Images edit endpoint.

The browser counterparts return MP3 `Blob`, transcription JSON and image JSON respectively. The bridge can be supplied a media adapter without exposing its key. Provider errors are surfaced; this adapter does not auto-retry or change models. `fetch` injection is for tests and controlled server environments.

## React

`useCodexChat(client)` returns `{text, images, isRunning, error, send, stop, reset}`. `send(input, mode?)` defaults to chat; `mode:'image'` invokes native image generation. It returns the result, or `undefined` on failure/overlapping send, with error in hook state. `reset` clears the local conversation only when idle. `stop` aborts an active turn. Unmount aborts active work. Memoize the client and remount the hook when switching authenticated users.
