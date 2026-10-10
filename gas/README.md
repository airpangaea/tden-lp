# TDEN 生徒管理 GAS — 設置・更新手順

`Code.gs` はスプシ「TDEN 生徒管理」にバインドして使う Apps Script です。
このフォルダは `_redirects` でサイトから見えないようにしてあります。

- スプシ: https://docs.google.com/spreadsheets/d/14E9vIHQ46Uew7gFElSsimWIAUnnk8jhXcukGmOKO_eQ/edit
- 役割: LPの申込を受け付けて「生徒_JP／生徒_海外」に書き込む／「クラス一覧」の空き状況をLPに返す／activo と Airtable の通知メールを読み取って書き込む

## 初回の設置（Phase 1）

順番どおりに進めてください。

### 1. 旧GASの定期実行を止める
旧GAS（Japanese Applicants に転記しているプロジェクト）を開き、左の時計アイコン「トリガー」で `checkNewEmails` のトリガーを削除します。
止めないと、同じメールを新旧両方が取り込んで下書きも2通できます。

### 2. Airtable の通知メールに「国」の行を足す
Airtable → Automations →「Admin Notification - New Application」→ メール送信アクションの Message を開き、
1行目「TOMODACHI留学の新規お申込みがありました！」と空行のあと、「■ 名前:」の**上**に次の1行を足します。

```
■ 国: {Country}
```

（`{Country}` は「+」ボタンから Students の Country を選んで差し込む）。保存したら右上の **Update（変更を反映）** を押します。
新しいGASはこの行で「海外の申込」か「LPの予備経路（Japan）」かを振り分けます。

### 3. GASを貼り付ける
1. スプシ「TDEN 生徒管理」を開き、メニュー「拡張機能」→「Apps Script」
2. 最初からある `コード.gs` の中身をすべて消し、`Code.gs` の中身を貼り付けて保存（プロジェクト名は「TDEN 生徒管理」など）
3. 左の歯車「プロジェクトの設定」→ タイムゾーンを「(GMT+09:00) 日本標準時」に

### 4. 合言葉を作る
1. 上部の関数選択で `setApiKey` を選び「実行」
2. 初回は権限の確認が出るので許可（Gmail・スプシ・メール送信・外部からのアクセス）
3. 実行ログに出る `GAS_KEY = xxxxxxxx…` の xxxxxxxx… をコピー（後で Cloudflare に登録）

### 5. 定期実行を入れる
関数選択で `installTrigger` を選び「実行」。以後、5分おきに `processInbox` が動きます。

### 6. ウェブアプリとして公開する
1. 右上「デプロイ」→「新しいデプロイ」→ 歯車で種類「ウェブアプリ」
2. 説明: `v1`／次のユーザーとして実行: **自分**／アクセスできるユーザー: **全員**
3. 「デプロイ」→ 表示される「ウェブアプリのURL」（`https://script.google.com/macros/s/…/exec`）をコピー

「全員」にしても、合言葉（GAS_KEY）が無いリクエストはすべて拒否されます。

### 7. Cloudflare に登録する
Cloudflare → Workers & Pages → TDEN-LP のプロジェクト →「設定」→「変数とシークレット」→ 本番環境に追加:

| 名前 | 種類 | 値 |
|---|---|---|
| `GAS_URL` | テキスト | 6でコピーしたURL |
| `GAS_KEY` | シークレット | 4でコピーしたキー |

Airtable の `AIRTABLE_*` は予備経路で使うので**消さない**でください。

### 8. 動作確認（Claudeに依頼）
ここまで終わったら Claude に伝えてください。LP側をデプロイして、空き状況の表示とテスト申込を確認します。

## コードを更新したとき

Apps Script に新しい `Code.gs` を貼って保存 →「デプロイ」→「デプロイを管理」→ 鉛筆アイコン → バージョン「新バージョン」→「デプロイ」。
こうするとURLは変わりません（「新しいデプロイ」を作るとURLが変わるので、Cloudflare の GAS_URL も直す必要が出ます）。
