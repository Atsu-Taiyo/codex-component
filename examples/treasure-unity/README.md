# ことばの宝箱

`codex-component` のチャット・画像生成・Unity Web Voiceを使う小さなゲームです。3つのお題に合う宝物を考え、生成された絵を集めたらクリア。

- **チャット**：案内役がお題とアイデアの関連を判定します。
- **画像生成**：合格した宝物をPNGとして生成し、カードに表示します。
- **Voice**：「話す」で案内役にヒントを聞けます。「終了」後に宝物を作ります。
- **練習モード**：Codexを使わずルールを試せます。固定キーワード判定とプログラムで描いた絵を使い、画面に「AI未使用」と表示します。

## このPCで遊ぶ

Webビルド済みの場合、リポジトリのルートで:

```sh
npm ci
codex login
node examples/treasure-unity/serve.mjs --open
```

`Launch.command` のダブルクリックでも起動できます。ブラウザのゲームとローカル接続プロセスをまとめて起動します。既定ポートはゲーム **8792**、Codex接続 **8791**。他のデモを停止する必要はありません。終了はターミナルでCtrl+C。

`--open` は一時トークンをURLのフラグメントで渡し、ページ起動時にURLから消します。保存・ログ送信はしません。手動で開く場合はターミナルのトークンをゲームへ貼り付けて「接続」。画面の接続先も変更できます。

```sh
# Codex未導入でも、練習モードの画面だけ起動する
node examples/treasure-unity/serve.mjs --practice --open
```

## 遊び方

1. 接続するか「まず練習する」を選びます。
2. お題に合う宝物を入力して「この宝物をつくる」。
3. 合格すると宝箱に画像が入ります。3つ集めるとクリア。

練習例：`星のランプ` → `魔法の翼` → `花のプレゼント`。

画像生成には数分かかる場合があります。「停止」で中断でき、失敗しても点数は増えません。生成画像はブラウザのメモリ上に保持し、リセット・終了で破棄します。Codex自体の会話・生成ファイルはローカルワークスペース側に残ることがあります。

音声はUnity **Web版のみ**。ブラウザのマイク許可が必要です。自動再生が止められた場合はゲーム下に表示される音声プレイヤーで再生してください。音声と画像生成は別々のCodexClientを使います。チャット用モデルと音声用モデルは既定値を使い、特定モデル名は固定していません。

## Unityで編集・ビルド

Unity **6000.4.9f1** と **Web Build Support** が必要です。このフォルダをUnityプロジェクトとして開き、`Assets/Treasure.unity` を実行します。UPMのローカル依存で、このリポジトリのUnityパッケージを参照します。プロジェクトフォルダだけを別の場所へ移す場合はPackages/manifest.jsonのパッケージ参照をGit URLに変更してください。

macOSでの再現コマンド（Unityの配置が異なる場合は先頭のパスを変更）:

```sh
/Applications/Unity/Hub/Editor/6000.4.9f1/Unity.app/Contents/MacOS/Unity \
  -batchmode -quit -nographics \
  -projectPath "$PWD/examples/treasure-unity" \
  -executeMethod TreasureBuild.Web -logFile /tmp/treasure-build.log
```

出力は `Build/Web`。ビルド成果物・Library・トークンはGitへ含めません。`TreasureBuild.Setup` はこのサンプルのシーンを再生成します。手動編集したシーンを残す場合は別名で保存してください。

## 構成・検証

- `Assets/TreasureGame.cs`：UI、ゲーム進行、Codex呼び出し。
- `Assets/Editor/TreasureBuild.cs`：シーン作成、Webビルド、ルール検証。
- `serve.mjs`：静的ゲーム配信と各プレイヤーのローカルCodex接続。
- `web/index.html`：Unity読み込み画面と一時接続情報の受け渡し。

検証済み：Unity Webビルド、ブラウザでの練習モード、実Codexによる判定 → 画像生成 → Unityカード表示（星のランプ）。Voiceの実マイク往復とSites公開は未検証です。

ルール検証は `TreasureBuild.Playtest` を `-batchmode`（`-quit`なし）で実行します。Editor上でUIとゲームロジックを初期化し、不正解、3ラウンドの獲得、クリア後の入力、リセットを確認します。これは本番AI応答の検証ではありません。

Sitesへはこのサンプルではデプロイしません。公開サイトと各PCの接続には、既存の [Unityガイド](../../docs/unity.md) にあるOrigin許可・マイク許可・ローカルネットワーク許可が必要です。

## フォント

Noto Sans JPを使用しています。ライセンスは `Assets/Resources/OFL.txt`。ゲームのコードはリポジトリのMITライセンスです。
