# 公式資料と互換性

確認日: 2026-09-13。説明ページと実際にインストールされたCLIの生成スキーマを照合して実装しました。将来のすべてのCodexバージョンとの互換性は保証しません。

## 参照資料

- [Codex App Server](https://learn.chatgpt.com/docs/app-server): 起動、stdio JSONL、initialize/initialized、thread/turn、モデル一覧、承認、認証。
- [公式ドキュメントの旧URL](https://developers.openai.com/codex/app-server): 現在は上のページへリダイレクト。
- [音声ファイルの文字起こし](https://developers.openai.com/api/docs/guides/speech-to-text): audio/transcriptionsとmultipart入力。
- [音声合成](https://developers.openai.com/api/docs/guides/text-to-speech): audio/speech、MP3、声の指定、AI音声の明示。
- [画像生成](https://developers.openai.com/api/docs/guides/image-generation): Images APIによる生成、画像モデル指定。

実験的Realtimeの細かい型は説明ページだけでは確定できなかったため、公式CLI 0.154.0から次のコマンドで生成したTypeScript型を確認しました。

```bash
codex --version
codex app-server generate-ts --experimental --out /tmp/codex-protocol
```

確認対象: `ThreadRealtimeStartParams`, `ThreadRealtimeStartTransport`, `ThreadRealtimeAudioChunk`, `ThreadRealtimeAppendTextParams`, `ThreadRealtimeSdpNotification`, `ThreadRealtimeListVoicesResponse`, `ImageGenerationItem`, `ThreadStartParams`, `TurnStartParams`, `Model`。生成ファイル全体は本リポジトリに複製せず、小さな公開型にまとめています。

## 検証結果

| 項目 | 結果 |
| --- | --- |
| TypeScriptビルド | 成功 |
| 偽app-serverを実プロセスとして起動するテスト | ハンドシェイク、早着イベント、同時実行、会話分離、途中停止、タイムアウト、異常終了を検証 |
| HTTP/ブラウザクライアント | NDJSON、分割UTF-8、認証、Origin、会話所有権、画像、SDP早着を検証 |
| メディアAPI | fetchモックでエンドポイント、本文形式、独立したAPIキー、エラーを検証。課金APIへのライブ通信なし |
| CLI 0.154.0 / macOS / Node 22 | モデル一覧とChatGPTログイン状態の取得に成功 |
| デモ画面 | ブラウザUIから送信し「接続テスト成功」を表示。レイアウトを目視確認 |
| 実チャット | `CODEX_COMPONENT_OK` の回答を受信 |
| 実画像生成 | ネイティブ画像生成でPNGを1枚受信。ローカル保存して目視確認 |
| 実音声候補 | v1/v2候補と既定の声を取得 |
| Realtime開始（ChatGPT認証） | `realtime conversation requires API key auth` を受信 |
| Realtime実通話・マイク往復 | 未検証 |
| APIキー使用のSTT/TTS/Images実生成 | 未検証 |
| Windows/Linuxの実Codex | 未検証。CIのプロトコルテストとは別 |

生成画像・認証・ローカル設定はGitに含めません。CIではアカウント不要のテストだけを動かします。実チャットや画像生成は利用枠を使うため、CIに常時組み込んでいません。

## CLI更新時の確認

1. 新しいCLIの `generate-ts --experimental` で必要な型を比較する。
2. `npm test` で内部処理を確認する。
3. `npm run smoke` でモデル・認証・音声候補を確認する。
4. 実チャット、画像、使う場合は音声を各々ライブ確認する。
5. この表に実際の結果とバージョンを記録する。

モデル名を固定の万能一覧にせず、Codexの `model/list` から選んでください。画像生成ツールやRealtimeが利用できるかは、モデル一覧の取得成功だけでは判断できません。
