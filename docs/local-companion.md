# Sites → 各ユーザー自身のPCのCodex

UIはSitesで公開し、AI処理はアクセスした人自身のPCで実行します。サイト運営者のCodexアカウントを共有する構成ではありません。

```text
ユーザーAのブラウザ（SitesのUI） → Aの127.0.0.1 → AのCodexログイン
ユーザーBのブラウザ（同じSites） → Bの127.0.0.1 → BのCodexログイン
```

## 利用者の準備

Node.js 22以上とCodex CLIを入れ、そのPCで `codex login` を済ませます。本パッケージをインストールしたプロジェクトで次を実行します。

```bash
npx --no-install codex-component connect --origin https://YOUR-ACTUAL-SITE
```

`https://YOUR-ACTUAL-SITE` は実際に表示されるSitesページのURLに置き換えてください。リポジトリをcloneして試す場合:

```bash
npm ci
npm run connect -- --origin https://YOUR-ACTUAL-SITE
```

ターミナルに出る接続URLとトークンを、サイトの接続フォームに入力します。ターミナルを開いたまま使い、終了時はCtrl+C。起動ごとにトークンが変わります。

デモの8787番ポートが既に使われている場合は `--port 8788` を指定し、表示されたURLをフォームに入れてください。CLIはポート競合時に明示的に終了します。

オプション: `--origin`（複数指定可）、`--port`、`--workspace`、`--codex-bin`、`--codex-home`。`--help`で一覧を表示できます。

## Sites側のReact UI

```tsx
'use client';
import { useState } from 'react';
import { LocalCodexConnect, useCodexChat } from 'codex-component/react';
import type { CodexBrowser } from 'codex-component/browser';

export default function App() {
  const [client, setClient] = useState<CodexBrowser | null>(null);
  return client ? <Chat client={client} /> : <LocalCodexConnect onConnected={setClient} />;
}
function Chat({ client }: { client: CodexBrowser }) {
  const { text, send, isRunning, stop, error } = useCodexChat(client);
  return <div>
    <button disabled={isRunning} onClick={() => void send({ prompt: 'こんにちは' })}>送信</button>
    <button disabled={!isRunning} onClick={stop}>停止</button>
    <p>{text}</p>
    {error && <p role="alert">{error.message}</p>}
  </div>;
}
```

フォームはトークンをメモリだけに保持します。再読み込み後は再入力します。画面やコードに全利用者共通のトークンを埋め込まないでください。

独自の接続画面の場合:

```ts
import { createLocalCodexBrowser } from 'codex-component/browser';
const ai = createLocalCodexBrowser({
  baseUrl: 'http://127.0.0.1:8787/api/ai',
  token: userEnteredToken,
});
const status = await ai.status();
```

このヘルパーはlocalhost以外の接続先を拒否し、接続トークンをリモートホストへ誤送信するのを防ぎます。Sitesのサーバー側からlocalhostへfetchせず、**利用者のブラウザ側**で呼び出します。

## ブラウザとSites側の条件

HTTPSのサイトからlocalhostへのアクセスは、ブラウザのローカルネットワーク権限・サイトのCSP/Permissions-Policy・埋め込みiframeの制約に依存します。すべてのブラウザで接続できるという保証はありません。

- ブラウザがローカルネットワーク接続を求めたら、接続する本人が用途を確認して許可します。
- 実際のページoriginをCLIの `--origin` に指定します。ワイルドカードは使えません。
- CSPで `connect-src` が制限される場合は、実際のlocalhost接続先を許可する必要があります。
- 埋め込み表示で権限委譲が制限される場合は、公開ページをトップレベルで開いて検証します。それでもプラットフォームの制限がある場合は接続できません。
- 旧Private Network Accessプリフライトには許可origin限定で応答します。これが現行ブラウザの権限許可やCSPを上書きすることはありません。

参考: [MDN Local network access](https://developer.mozilla.org/en-US/docs/Web/Security/Defenses/Local_network_access)

**現時点:** loopback待受、origin/token/Host検証、プリフライトをローカルテスト済みです。実際のSites URLからの接続は未検証です。対象Sites URL確定後に、ログイン確認・チャット・停止・必要に応じ音声を確認します。

## 認証・保存・終了

Codexのログイン情報はPCに残ります。ただしプロンプトや必要な文脈はCodexからモデルサービスに送信されるため、オフラインAIではありません。

許可したサイトのJavaScriptは、入力した接続トークンでCodexを呼べます。信頼する自分のサイトだけを許可してください。Sitesの公開設定とローカル接続の許可は別物です。各利用者のPCのCodex設定・MCP等も適用されるため、既定のread-onlyだけで完全な隔離になるわけではありません。

Ctrl+Cでローカルサーバーを停止し、トークンを失効させます。ブラウザタブを閉じるだけでは常駐プロセスは止まりません。各PCで起動が必要なので、スマートフォンだけでアクセスしてもPCのlocalhostには接続できません。
