# Unity: ゲームから各プレイヤーのCodexを使う

Unity Package Managerから導入し、C#の `ChatAsync` / `GenerateImageAsync` / `ModelsAsync` を呼べます。各プレイヤーは自分のPCでCodexにログインし、ローカル接続用プロセスを起動します。ゲームにAPIキーを埋め込む必要はありません。Web版は `.jslib` を同梱しており、独自Webテンプレートへの追記は不要です。

対応範囲はチャット・モデル選択・画像入出力・キャンセルです。Unity Web版は実験的な音声APIにも対応します。Sitesの公開ページからの接続にはブラウザのローカルネットワーク許可などが必要で、実機確認は未完了です。以下に導入手順・API例・制約をまとめています。

Unity Package Manager package: **com.atsutaiyo.codex-component**. Includes a C# client, a self-contained Web `.jslib` transport, and an importable chat example. No npm bundling or custom Web template is needed for the game.

```text
Unity Web game on Sites → player's browser → local companion → Codex app-server
Unity Editor / desktop → local companion → Codex app-server
```

Each player installs and signs into Codex on their own PC. Hosting the game alone does not install or start the companion. ChatGPT login can be used; a separate OpenAI API key is not required for native Codex operations. Account access and usage limits still apply.

## Install

In Unity: Window → Package Manager → + → Install package from Git URL:

```text
https://github.com/Atsu-Taiyo/codex-component.git?path=/unity/com.atsutaiyo.codex-component#unity-v0.2.0
```

Requires Git and Unity 2022.3 or later (Editor compilation verified on Unity 6000.4.9f1; see verification below). Import **Chat example** from the package's Samples tab if desired.

## Start the companion on each player's PC

Follow [local companion installation](local-companion.md), then:

```sh
codex login
codex-component connect --origin https://YOUR-GAME-SITE
```

Replace the origin with the exact published game origin, including a non-default port if present. Use the browser's actual game-frame origin for embedded games. The CLI prints a temporary pairing token and local base URL. Let the player paste these into the game's connection UI. The token is not an OpenAI API key. Do not embed it in a build, scene, source file, URL, analytics, or persistent browser storage. Restarting the companion revokes it.

For Editor testing, start the companion with the eventual game origin; Editor requests do not carry a browser Origin header. For localhost Web testing, allow that exact localhost origin. See `codex-component connect --help` for CLI options.

## C# API

Attach `CodexClient` to an active GameObject. Call its methods on Unity's main thread. Configure it using values entered by the player at runtime:

```csharp
using CodexComponent;

client.Configure(tokenFromInput); // default http://127.0.0.1:8787/api/ai
var status = await client.StatusAsync();
var models = await client.ModelsAsync();
var reply = await client.ChatAsync(new ChatInput {
    prompt = "村の案内人として、短く挨拶して",
    model = models[0].model // optional: omit to use Codex's default
}, e => {
    if (e.type == "delta") AppendDialogue(e.text);
});

// Reuse reply.threadId to continue this conversation.
var next = await client.ChatAsync(new ChatInput {
    prompt = "次はどこへ行けばいい？", threadId = reply.threadId
});
```

`AppendDialogue` is your game's UI method. Catch exceptions around awaited calls; cancellation throws `OperationCanceledException`. `CancelAll()` cancels this client's pending requests, closing their HTTP streams so the companion can interrupt Codex. Disabling/destroying the client cancels pending work. Use one client per independently cancellable conversation. Reconfigure after companion restart and discard old thread IDs.

| Method | Result |
|---|---|
| `Configure(token, baseUrl?)` | Accepts only localhost/127.0.0.1; refuses remote token destinations |
| `StatusAsync()` | `loggedIn`, `experimental` |
| `ModelsAsync()` | Model IDs, model names, display names |
| `ChatAsync(input, onEvent?)` | Text, thread/turn IDs, status, images |
| `GenerateImageAsync(input, onEvent?)` | Same result; fails if no generated image |
| `CancelAll()` | Cancels all requests belonging to this client |

`ChatInput` supports `prompt`, `threadId`, `model`, `effort`, and `images` (PNG/JPEG/WebP data URLs). Supported models and reasoning efforts depend on the local account and Codex version.

```csharp
var result = await client.GenerateImageAsync(new ChatInput {
    prompt = "Generate a small pixel-art potion bottle image"
});
var texture = result.images[0].ToTexture();
// Assign texture to your UI/material; Destroy(texture) when no longer needed.
```

`ToTexture()` supports PNG/JPEG. WebP data remains available as `dataUrl` but requires your own decoder. Image generation may take minutes: use it for loading screens, customization or asynchronous content creation.

## Web / Sites settings

- Install Unity Web Build Support and build your game for Web. Include the generated build files when publishing to Sites; this kit does not publish the game.
- Web uses browser fetch through the included `.jslib`, with incremental UTF-8/NDJSON events. Editor/desktop currently buffers the response and delivers events when the request finishes.
- HTTPS pages accessing loopback can require browser local-network permission. CSP `connect-src`, iframe permission delegation, CORS, and browser policy must all permit the connection. CORS alone does not guarantee it works. Embedded Sites environments may block it; test the published page in the target browsers.
- Native Editor/desktop HTTP connections may require Player Settings → Allow downloads over HTTP. Enable for the appropriate build scope, or configure a trusted HTTPS companion. Browser policy governs Web requests separately.
- No request follows HTTP redirects. Keep the companion bound to loopback and allow only trusted game origins. This bridge can spend the player's Codex usage and run agent work according to its configuration.
- Mobile players and PCs without Codex/companion running cannot use this local connection architecture.

## Voice

Unity Web版では `StartVoiceAsync()` / `StopVoiceAsync()` でマイク音声を送受信できます。ChatGPT認証のローカル接続を使い、ゲームへOpenAI APIキーを埋め込む必要はありません。Codex側のRealtimeは実験的機能です。通常のチャットモデルが音声にも対応するとは限らないため、最初は `model` と `voice` を省略してください。

```csharp
// Configure(token) first. Subscribe once, e.g. in Start().
client.VoiceEvent += json => UnityEngine.Debug.Log(json);

// Call directly from a button handler (do not auto-start on scene load).
var session = await client.StartVoiceAsync(new VoiceOptions {
    prompt = "あなたはゲームの村人です。日本語で短く会話してください。"
});
// Optional: pass session.threadId next time to reuse the same conversation.
await client.StopVoiceAsync(); // wire this to a separate Stop button
```

The example above shows two separate button actions; don't immediately stop after start in your real handler. Import **Voice example** from Package Manager Samples for separate `BeginVoice` and `EndVoice` handlers. `VoiceSupported` indicates a Web build, not microphone permission/account availability. Catch exceptions and display their messages to the player.

- Start creates a conversation automatically unless `VoiceOptions.threadId` is supplied. Options also accept `model`, `voice`, and `prompt`.
- The start task completes after SDP negotiation, **not after audible speech**. Observe `VoiceEvent` raw JSON for `ready`, `connection-state`, transcript/provider events and `playback-blocked`.
- A browser audio control appears outside the Unity canvas for output. If autoplay is blocked, the player can press Play there. Audio is browser-managed, not routed into a Unity AudioSource/mixer or spatial audio.
- Stop, `CancelAll()`, component disable and destruction release the microphone, peer connection and playback. Explicit stop awaits the remote stop request; cleanup on destruction is best-effort. A failed remote stop does not keep the local microphone open.
- Each CodexClient supports one voice session. Stop and await completion before starting another. Do not run a chat turn on the same thread while voice is active.
- Editor/native desktop calls to StartVoiceAsync throw PlatformNotSupportedException; use a Unity Web build for microphone testing.
- HTTPS (or localhost), microphone permission, WebRTC network access and the local connection permissions described above are required. An embedded game may need the host to delegate `microphone` and local-network access permissions. The package cannot override host/browser restrictions.

**Validation:** mocked WebRTC tests cover SDP success, microphone rejection, failed negotiation, stopping during a permission prompt, blocked playback, failed connections and duplicate starts. Editor and voice sample compilation pass on Unity 6000.4.9f1. The Web-specific C# branch also compiles using the installed Unity compiler (this is not a WebGL linker/build test). Actual microphone → Codex → audible reply and Sites-hosted execution have not yet been verified; this is an experimental integration, not a confirmed end-to-end voice release.


## Verification and limitations

The Node suite tests fragmented Japanese UTF-8 streams, completion requirements, error events, remote destination rejection, redirect policy and cancellation isolation. Unity validation compiles the runtime and example and checks local URL configuration in an isolated Editor project. WebGL build/linking and a published Sites → local companion round trip have not been validated: Web Build Support is absent on the validation machine. Unity 2022.3 compatibility is a target, not a tested Editor version.

References: [Unity browser scripting](https://docs.unity3d.com/6000.0/Documentation/Manual/web-interacting-code-example.html), [Unity Web networking](https://docs.unity3d.com/6000.0/Documentation/Manual/webgl-networking.html), [browser local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access).
