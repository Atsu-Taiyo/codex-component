# 組み込みガイド

## Vite / React / Vue / Svelte

`codex-component/browser` はDOMのUIフレームワークに依存しません。Vite側は通常どおり動かし、常駐Nodeサーバーに `createCodexHandler` を置きます。READMEの別ポート例を使うか、Viteの `/api/ai` プロキシを使います。

```ts
// vite.config.ts
import { defineConfig } from 'vite';
export default defineConfig({
  server: {
    proxy: { '/api/ai': 'http://127.0.0.1:8787' },
  },
});
```

OriginはUIの `http://localhost:5173` などを許可します。`model` はモデル一覧の `model` フィールドを渡し、推論量候補は `supportedReasoningEfforts` を表示してください。画像は `FileReader.readAsDataURL` で入力できます。同梱デモに実装があります。

## Next.js

App Routerのブラウザコンポーネントでは `codex-component/browser` / `react` を使います。最短の構成は、別の常駐Nodeブリッジへリライトする方法です。

```js
// next.config.mjs（ローカル開発例）
export default {
  async rewrites() {
    return [{ source: '/api/ai/:path*', destination: 'http://127.0.0.1:8787/api/ai/:path*' }];
  },
};
```

ブリッジの `allowedOrigins` に `http://localhost:3000` を設定します。トークンはローカルデモでは入力画面等で渡します。公開アプリではサーバーのユーザーセッションと連携させ、ビルド時に共有秘密を全ユーザーへ埋め込まないでください。

`createCodexHandler` はNodeの `IncomingMessage` / `ServerResponse` 用です。App RouterのWeb `Request`へそのまま代入するハンドラーではありません。Vercel Edge等の短命実行環境だけでCodexを維持せず、常駐Nodeホストへ接続します。

## Electron

mainプロセスで `createCodex` を保持し、preloadの `contextBridge` で小さなIPCを公開します。rendererからCLIを直接起動しないでください。

```ts
// main.ts（骨格。実アプリでは送信元WebContentsの検証も追加）
import { app, ipcMain } from 'electron';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { createCodex } from 'codex-component';

await app.whenReady();
const home = path.join(app.getPath('userData'), 'codex-home');
const workspace = path.join(app.getPath('userData'), 'ai-workspace');
await mkdir(home, { recursive: true });
await mkdir(workspace, { recursive: true });
const ai = createCodex({ codexHome: home, workspace });
ipcMain.handle('ai:models', () => ai.models.list());
ipcMain.handle('ai:login', () => ai.account.login());
ipcMain.handle('ai:chat', (_event, prompt: string) => ai.chat({ prompt }));
app.on('before-quit', () => ai.close());
```

ユーザーがログインを押したら `account.login()` のURLを表示/ブラウザで開き、`account/login/completed` を購読して状態を更新します。別ホームなので普段のCLIとは別ログインです。認証ファイルを自動コピーしません。アプリ固有のIPC取消レジストリ、会話IDとユーザーの対応、入力検証、ストリーム通知は製品側で管理してください。

macOSのGUI起動ではPATHがターミナルと異なることがあります。`bin` の絶対パス設定を提供するのが確実です。Windowsはネイティブ `codex.exe` を指定してください。`.cmd` ラッパーのために `shell:true` にする機能は提供していません。

## 音声の認証とライフサイクル

2つの方式があります。

1. **音声ファイル→文字起こし→Codex→読み上げ**: `createOpenAIMedia` と `createCodex` を組み合わせる。CodexのChatGPTログインをそのまま使い、音声だけ別APIキーで処理できます。APIアダプターのキーはサーバー側に置きます。
2. **Codex Realtime / WebRTC**: `experimental:true` とブラウザの `startVoice()` を使う。CodexのChatGPT認証を使用し、別途APIキーを必要としません。対応アカウント・ランタイムの利用可否は別途確認してください。

直接WebSocketの `ai.voice.start(threadId)` は別経路であり、検証したCLIではAPIキーを要求しました。初版ではこの結果を音声全体に一般化していましたが、WebRTCには当てはまりません。

WebRTCは `version: "v3"` を既定として送ります。これによりCodex内部の `OpenAI-Alpha: quicksilver=v2` ヘッダーが選択されます。未指定の古い既定v1では `invalid_quicksilver_alpha_header` が発生します。HTTPの認証ヘッダーをブラウザから偽装する必要はありません。

WebRTCヘルパーはマイクを取得するため、ボタン操作から開始してください。終了・画面遷移で `session.stop()` を呼びます。NodeでPCMを送る場合は音声フレームの形式を利用ランタイムに合わせてください。音声ファイルをbase64化して `appendAudio` へ送るだけでは通常動作しません。

## 保存・分離・権限

`codexHome` を指定しなければ、そのプロセス環境のCodexホームを使います。そこにはユーザー設定・認証・会話履歴があるため、設定済みMCPやプラグインも影響し得ます。ワークスペースやホームを変えるだけで完全な隔離になるわけではありません。

既定のsandboxはread-onlyですが、読取アクセス全般やMCPツールを禁止する境界ではありません。機密のあるホストから切り離した環境や、必要なツールだけを設定した専用ホームを利用できます。ブラウザへ `transport.request` を公開せず、アプリで許可する操作のみをラップしてください。

HTTPブリッジは起動中に発行した会話IDをメモリで管理します。サーバー再起動後に会話を復元する製品では、ユーザー別IDの永続マッピングと履歴UIを用意してください。Node APIは `threadId` を渡すとネイティブ履歴から再開できます。

## 公開と運用

ハッカソンの画面を外部公開しても、ローカルブリッジの共有トークンを公開しないでください。公開用ホストではアプリ認証、利用者ごとのクライアント/ホーム/OS境界、同時実行数、利用量制限、ログの扱いを実装します。Codexの契約やアカウントの利用条件に応じて構成を決めてください。

プロキシのバッファリングを無効にし、画像生成を許すタイムアウトを設定します。停止や接続切断を上流まで伝播させます。本ライブラリの高水位制限は本番のレート制限・ジョブキューの代わりではありません。
