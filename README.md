# Local Study AI

Ollama で動くローカルAIと話すための、学習用デスクトップアプリの雛形です(Electron + TypeScript)。
やり取りはすべてこのPCの中で処理され、料金もトークン上限もありません。

- チャット(回答は少しずつ表示、途中で停止可)
- 教材の読み込み(テキスト / Markdown / PDF など)
- 会話履歴の保存と再開

## 必要なもの

- [Node.js](https://nodejs.org/) 22 以上
- [Ollama](https://ollama.com/) と、モデルを1つ以上

```
ollama pull qwen3.5:4b
```

VRAM 8GB のGPUがあるなら `qwen3.5:9b`、CPUだけで軽く動かしたいなら `phi4-mini` も選べます。

## 起動

```
npm install
npm start
```

`npm install` は初回だけで、Electron本体のダウンロードに少し時間がかかります。
`npm start` は TypeScript をビルドしてからアプリを開きます。コードを直したら、アプリを閉じてもう一度 `npm start` してください。

## 使い方

- 上部の「モデル」で使うモデルを選びます。Ollama を後から起動したときは「再接続」を押します。
- 「教材を追加」で選んだファイルの内容が、その会話の質問に毎回添えられます。
- 「コンテキスト長」は AI が一度に読める量です。教材が長くて入りきらないときは黄色の注意が出ます。
  上げると読める量は増えますが、メモリを多く使います。動作が急に遅くなったら下げるか、小さいモデルに替えてください。
- Enter で送信、Shift+Enter で改行です。

## ファイル構成

```
public/
  index.html        画面の骨組み
  styles.css        見た目
src/
  shared/types.ts   メインと画面で共有する型
  main/             メインプロセス(Node.js側)
    main.ts         ウィンドウ作成と、画面からの依頼の受け口
    preload.ts      画面に公開する機能(window.api)の定義
    ollama.ts       Ollama との通信、プロンプトの組み立て
    materials.ts    教材ファイルをテキストにする
    history.ts      会話履歴の保存
  renderer/
    renderer.ts     画面の動き
```

画面はセキュリティのため Node.js を直接使えない設定にしてあります。
機能を足すときは「`types.ts` の `Api` に追加 → `preload.ts` → `main.ts` に処理 → `renderer.ts` から呼ぶ」の順に進めます。

## データの保存場所

`%APPDATA%\local-study-ai\` に保存されます。

- `conversations\` … 会話1つにつき JSON ファイル1つ(教材のテキストも含む)
- `settings.json` … 接続先、既定のモデル、コンテキスト長

## 外部サーバーに切り替えるとき

`settings.json` の `host` を、Ollama を動かしているサーバーのアドレスに書き換えるだけです。

```json
{ "host": "http://192.168.1.50:11434" }
```

## いまの制限

- 教材は全文をそのままAIに渡す単純な方式です。コンテキスト長に入りきらない分は切り捨てられます。
  長い教材を扱うなら、関連する部分だけを検索して渡す方式(RAG)への拡張が次の一歩です。
- 回答はプレーンテキスト表示です(Markdown や数式の整形はしていません)。
- スキャン画像だけのPDFからは文字を取り出せません。
- 小さいモデルは計算や細かい事実を間違えることがあります。答え合わせは教材で確認してください。
