# ブラウザ内でChatGPTにログインする

トークンを利用者にコピーさせず、ログインボタンからローカルCodexへ接続できます。

PC側で接続プロセスを起動します（Codex CLIとNode.jsが必要）:

```sh
codex-component connect --origin https://YOUR-SITE --browser-login
```

ブラウザのボタンから次を実行します:

```ts
import { loginLocalCodex, createLocalCodexBrowser } from 'codex-component/browser';

// ボタンのクリック直後に呼ぶ。先に別の非同期処理を挟まない。
const session = await loginLocalCodex({
  baseUrl: 'http://127.0.0.1:8787/api/ai',
  onStatus: message => showStatus(message),
});
const ai = createLocalCodexBrowser(session);
const reply = await ai.chat({ prompt: 'こんにちは' });
```

未ログイン時はCodex app-serverの `account/login/start` から得た公式ChatGPTログイン画面を開きます。認証完了をローカルプロセスで確認し、ブラウザ用クライアントへ内部の接続情報を渡します。ログイン済みならその状態を再利用します。ゲームにAPIキーや手動トークン入力欄は不要です。

`session` はメモリ上だけで使い、URL・ログ・localStorageへ保存しないでください。ブラウザのポップアップ許可が必要な場合は、表示されたエラーを利用者へ伝え、ボタンを押し直してもらいます。`signal` でログイン待ちを中断できます。サイトやブラウザのローカルネットワーク制限は引き続き適用されます。

Node APIでは `startLocalBridge({ origins: ['https://YOUR-SITE'], browserLogin: true })` を使います。`browserLogin` は明示的な有効化が必要です。指定したOriginは、ログイン開始とログイン済みローカルCodexへの接続を許可するサイトです。信頼する自分のサイトだけを指定してください。

認証用ルートは許可済みOriginからのJSON POSTのみを受け付けます。Originなし・別Origin・GETは拒否します。通常のAIルートは引き続き内部トークンで保護します。UIからトークン操作をなくす変更であり、ローカルAPIを無認証で公開する変更ではありません。

[ことばの宝箱](../examples/treasure-unity/README.md) は、この方式を使うUnityサンプルです。

検証：37件の自動テスト、Unity Webビルド、ログイン済みアカウントでの実画面接続、独立した未ログイン環境での公式ログインURL発行を確認済みです。未ログインから認証画面を最後まで操作する確認は行っていません。既存アカウントを勝手にログアウトする処理はありません。
