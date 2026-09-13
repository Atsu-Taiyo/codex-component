# codex-component

**あなたのUIに、Codexを組み込む。** ハッカソン向けの小さなTypeScriptライブラリです。

Codex app-serverの起動、JSON-RPC、会話の継続、ストリーミング、途中停止をまとめて扱えます。チャット・モデル選択・画像生成に加え、実験的な音声会話と、任意のOpenAI API音声アダプターを提供します。UIは自由に作れます。

[English quick start](docs/README.en.md) · [APIリファレンス](docs/api.md) · [組み込みガイド](docs/integration.md) · [公式資料・検証結果](docs/compatibility.md)

> 非公式・MITライセンスのプロジェクトです。OpenAI製品ではありません。Node.js 22以上が必要です。npmレジストリには未公開のため、下記のGitHubインストールまたはローカルパッケージを使ってください。

## 最短で試す

```bash
# Codex CLIが未導入の場合
npm install -g @openai/codex
codex login

# デモを起動
git clone https://github.com/Atsu-Taiyo/codex-component.git
cd codex-component
npm ci
npm run dev
```

ターミナルに出る **トークン付きのURL** を開きます。通常は `http://127.0.0.1:8787/#token=...` です。

モデル・推論量を選び、「送信」または「画像を生成」を押してください。参考画像も添付できます。停止ボタンは実際にCodexのターンを中断します。

音声ファイルの文字起こし・読み上げを使う場合は、サーバーの環境変数 `OPENAI_API_KEY` を設定して起動してください。`.env.example` は設定項目の見本です。`.env` を自動ロードする場合は `npm run build` 後に `node --env-file=.env examples/web/server.mjs` で起動できます。

## できることと認証

| 機能 | 簡単なAPI | 認証・条件 |
| --- | --- | --- |
| チャット・ストリーミング | `ai.chat()` | Codexのログイン |
| 会話継続・停止・JSON出力 | `threadId`, `signal`, `outputSchema` | Codexのログイン |
| モデル・推論量選択 | `ai.models.list()` | 実行中のCodexから取得 |
| 画像入力 | `images: [dataUrl]` | 選択モデルの画像入力対応 |
| Codexネイティブ画像生成・編集 | `ai.images.generate()` | Codex側の機能・アカウントの利用可否に依存 |
| 音声候補一覧 | `ai.voice.list()` | `experimental: true` |
| Codex音声会話 | `ai.voice.start()` / `startVoice()` | 実験的。検証したCLIではAPIキー認証が必要 |
| 音声ファイル→文字 | `media.transcribe()` | 別途OpenAI APIキー・API課金 |
| 文字→音声 | `media.speech()` | 別途OpenAI APIキー・API課金 |
| 画像モデルを直接選んで生成 | `media.images()` | 別途OpenAI APIキー・API課金 |

**Codexのチャットモデルと画像・音声モデルは別です。** `ai.models.list()` はCodexモデルの一覧です。ネイティブ画像生成の `model` は指示を解釈するCodexモデルを選びます。画像モデルそのものを指定したい場合は `media.images({ model: ... })` を使います。

**実機検証（2026-09-13 / macOS / Codex CLI 0.154.0）:** チャット・モデル一覧・ネイティブ画像生成・音声候補一覧は成功。ChatGPTログインでのRealtime開始は `realtime conversation requires API key auth` になりました。音声候補が取得できても音声会話の利用を保証しません。マイクからの実通話とAPIキーを使うメディア生成は未検証です。

## 既存プロジェクトに追加

```bash
npm install github:Atsu-Taiyo/codex-component
```

Git依存のインストール時にTypeScriptをビルドするため、初回は通常のnpmパッケージより時間がかかります。再現性が必要ならGitタグまたはコミットを固定してください。npmのスクリプト実行ポリシーでGit依存のビルドが止まる場合は、cloneして `npm ci` / `npm pack` を実行し、生成済みtarballをインストールしてください。

ローカルで試すなら、このリポジトリで `npm pack` を実行し、利用先で `npm install /path/to/codex-component-0.1.0.tgz` を使えます。

### Node.jsから直接呼ぶ

```ts
import { createCodex } from 'codex-component';

const ai = createCodex({ workspace: process.cwd() });
try {
  const models = await ai.models.list();
  const model = models.find(m => m.isDefault)?.model;

  const first = await ai.chat({ prompt: 'ハッカソンのアイデアを3つ教えて', model }, {
    onEvent(event) {
      if (event.type === 'delta') process.stdout.write(event.text);
    },
  });
  const followup = await ai.chat({
    threadId: first.threadId,
    prompt: '2つ目の画面構成を考えて',
  });
  console.log(followup.text);
} finally {
  ai.close(); // 子プロセスと待機中リクエストを解放
}
```

サーバーでは `createCodex()` をプロセス・ユーザーごとに保持して再利用し、リクエストごとに起動し直さないでください。同じ会話への同時送信は `THREAD_BUSY`、異なる会話は並行実行できます。

### 自分のWeb UIに接続する

サーバー（`server.mjs`）:

```js
import { createServer } from 'node:http';
import { randomBytes } from 'node:crypto';
import { createCodex } from 'codex-component';
import { createCodexHandler } from 'codex-component/server';

const ai = createCodex({ workspace: process.cwd() });
const token = randomBytes(32).toString('hex');
const handler = createCodexHandler({
  codex: ai,
  token,
  allowedOrigins: ['http://localhost:5173'],
});
const server = createServer(handler);
server.listen(8787, '127.0.0.1');
console.log('Local UI token:', token); // 自分のローカルUIに渡す。公開しない
process.on('SIGINT', () => { ai.close(); server.closeAllConnections(); server.close(); });
```

ブラウザ（Viteなど。`localToken` は上のローカルトークンをUI入力等で受け取った値）:

```ts
import { createCodexBrowser } from 'codex-component/browser';

const ai = createCodexBrowser({
  baseUrl: 'http://127.0.0.1:8787/api/ai',
  token: localToken,
});
const result = await ai.chat({ prompt: 'こんにちは' }, {
  onEvent: event => {
    if (event.type === 'delta') console.log(event.text);
  },
});
```

このトークンはローカルブリッジ用です。OpenAI APIキーやCodexのログイントークンとは異なります。実装済みデモは [examples/web](examples/web) をそのまま実行できます。

### Reactで使う

```tsx
'use client';
import { useMemo } from 'react';
import { createCodexBrowser } from 'codex-component/browser';
import { useCodexChat } from 'codex-component/react';

export function MyAssistant({ token }: { token: string }) {
  const client = useMemo(() => createCodexBrowser({ token }), [token]);
  const { text, images, isRunning, error, send, stop } = useCodexChat(client);
  return <div>
    <button disabled={isRunning} onClick={() => void send({ prompt: 'アイデアを提案して' })}>
      相談する
    </button>
    <button disabled={!isRunning} onClick={stop}>停止</button>
    <p style={{ whiteSpace: 'pre-wrap' }}>{text}</p>
    {images.map(image => <img key={image.itemId} src={image.dataUrl} alt="AI生成画像" />)}
    {error && <p role="alert">{error.message}</p>}
  </div>;
}
```

この例は同一オリジンの `/api/ai` へのプロキシを前提にしています。別ポートの場合は `baseUrl` を設定してください。フックは会話IDを保持しますが、画面に表示するのは直近の回答です。履歴の表示・保存はアプリ側で実装します。Reactは任意依存で、Node/Vanilla JSの利用には不要です。

## 画像生成・画像編集

```ts
const generated = await ai.images.generate({
  prompt: '白背景に赤いりんごのイラストを1枚',
});
// <img src={generated.images[0].dataUrl} />

const edited = await ai.images.generate({
  threadId: generated.threadId,
  prompt: 'このりんごを緑色に変えて',
  images: [generated.images[0].dataUrl],
});
```

Codexが生成ツールを呼んだときの `imageGeneration` イベントから取得します。モデルの文章に含まれるファイルパスは画像として扱いません。生成できなかった場合は `IMAGE_UNAVAILABLE` になります。PNG/JPEG/WebPに対応し、ネイティブ画像は1枚20MiBまでです。ネイティブ出力のファイル読み取りは設定済みの許可ルートに限定します。

## 音声とOpenAI APIメディア

```ts
// サーバー側だけで作成
import { createOpenAIMedia } from 'codex-component/media';

const media = createOpenAIMedia({ apiKey: process.env.OPENAI_API_KEY! });
const mp3 = await media.speech({ text: 'こんにちは。何を作りましょうか？' });
const transcript = await media.transcribe({ file: audioBlob, filename: 'recording.webm' });
const picture = await media.images({
  model: 'gpt-image-2.5-flare',
  prompt: '白背景の赤いりんご',
});
```

`createCodexHandler({ codex: ai, token, media, allowedOrigins })` に渡せば、ブラウザからも `client.media.speech()` / `.transcribe()` / `.images()` を呼べます。APIキーはサーバーに残ります。

```ts
// ブラウザ: 録音Blob → 文字起こし → Codex回答 → 読み上げ
const { text } = await client.media.transcribe({ file: recordingBlob, filename: 'recording.webm' });
const answer = await client.chat({ prompt: text });
const audio = await client.media.speech({ text: answer.text });
const url = URL.createObjectURL(audio);
const player = new Audio(url);
player.onended = () => URL.revokeObjectURL(url);
await player.play(); // 再生制限がある場合はUIの再生ボタンから実行
```

読み上げはAI生成音声であることをユーザーに表示してください。モデルの利用可否・価格は各APIアカウントに依存します。APIアダプターがCodexログインを勝手にAPIキーへ変換したり、エラー時に別の課金経路へ切り替えたりすることはありません。

### 実験的な音声会話

```ts
// サーバー: createCodex({ experimental: true }) を使う
// ブラウザ: マイク権限を求めるので、ボタンのクリックから実行する
import { startVoice } from 'codex-component/browser';
const threadId = await client.threads.create();
const session = await startVoice(client, {
  threadId,
  audioElement: document.querySelector('audio')!,
  onEvent: console.log,
});
// 終了時はマイク・WebRTC・Codex音声セッションを解放
await session.stop();
```

音声会話用のCodex認証と、`media` アダプターの `OPENAI_API_KEY` は独立です。環境変数を設定するだけで、ChatGPT認証中のCodexがAPI認証へ切り替わるとは限りません。分離したCodexホームでのAPI認証と、実験的APIの注意点は [組み込みガイド](docs/integration.md#音声の認証とライフサイクル) を確認してください。

## 構成

```text
あなたの UI (React / Vanilla JS / Electron renderer)
    │ ブラウザクライアント / 自分のIPC
    ▼
Node.js ホスト ── createCodexHandler (HTTP・NDJSON、任意)
    ├── createCodex ── stdio JSON-RPC ── codex app-server
    └── createOpenAIMedia ── OpenAI API（任意・別課金）
```

- `codex-component`: Node.jsクライアント。子プロセス管理とチャット・画像・音声API。
- `codex-component/server`: Node HTTPハンドラー。ストリームと中断を接続。
- `codex-component/browser`: ブラウザクライアントとWebRTCヘルパー。
- `codex-component/react`: レイアウトを押し付けないReactフック。
- `codex-component/media`: 任意のサーバー用OpenAI APIアダプター。

ai-math-editorの「ホスト側のCodexを独自UIで包む」構成を参考に、エディター固有処理を持ち込まず新しく実装しています。既存エディターのファイルは変更しません。

## ハッカソンでの使い分け

個人のPCで動かすデモなら `npm run dev` からUIを変更するのが最短です。既存WebアプリならHTTPハンドラーを常駐Nodeプロセスに追加し、フロントから呼びます。Electronならmainプロセスでクライアントを保持してIPCでラップします。

公開Webサービスにする場合、同梱HTTPハンドラーは**1ユーザー・1トークンのローカルブリッジ**です。アプリの認証、利用者別Codexプロセス・保存領域、利用上限、実行環境の分離をホスト側に追加してください。単一の開発者アカウントと共有トークンを不特定多数に公開する構成ではありません。サーバーレス/EdgeだけではローカルのCodex子プロセスを維持できないため、常駐Nodeホストを使用します。

既定の `read-only` は「ツールなし」ではありません。Codexはファイルを読め、既存の設定・MCP・プラグインが使われる可能性があります。機密データのない専用workspace/Codex homeとOS側の分離を用途に合わせて使ってください。

## トラブルシューティング

| 症状 | 対応 |
| --- | --- |
| `SPAWN_FAILED` / `ENOENT` | `codex --version` を確認。`CODEX_BIN` または `bin` に実行ファイルの絶対パスを設定 |
| 未ログイン | 同じCodexホームで `codex login` を実行し、再起動 |
| `401` | 起動ログのトークン付きURLを使う。サーバー再起動で自動トークンは変わる |
| `Origin denied` | `allowedOrigins` をUIの正確なorigin（ポートを含む）に合わせる |
| `IMAGE_UNAVAILABLE` | Codexの画像生成可否を確認。画像モデル指定は `media.images` を使用 |
| `realtime conversation requires API key auth` | 現CLIのRealtime認証制約。API認証の分離ホーム、またはAPI音声アダプターを利用 |
| `API_KEY_REQUIRED` | サーバー側にmediaアダプターを設定。キーをフロントへ入れない |
| `THREAD_BUSY` | 同じ会話の完了/停止を待つ。独立処理には別会話を使用 |
| `TURN_TIMEOUT` / `CLOSED` | タイムアウトを調整。`CLOSED` 後はクライアントを作り直す |
| 会話IDが再起動後に拒否される | デモHTTPの所有IDはメモリ保持。永続化はホストの利用者別マッピングを実装 |
| Windowsで起動できない | `bin` にネイティブ `codex.exe` を指定。`.cmd` 経由のshell実行はしない |

## 開発・検証

```bash
npm ci
npm test                 # 実課金なし。偽プロセスとHTTP境界のテスト
npm run typecheck
npm pack --dry-run
npm run smoke            # 実Codexのモデル・ログイン状態・音声候補を取得
CODEX_LIVE_CHAT=1 npm run smoke  # 実際のチャットを1回実行。利用枠を消費
```

[互換性ノート](docs/compatibility.md)に公式資料、検証した範囲、将来のCLI更新で再確認する項目をまとめています。詳細な接続実装は [APIリファレンス](docs/api.md) を参照してください。

## ライセンス

MIT。Codex自体の配布・利用条件はCodexの公式資料を参照してください。
