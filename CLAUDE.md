# TDEN-LP プロジェクト

## プロジェクト概要
- **TOMODACHI留学**（中高生向けオンライン英語留学プログラム）のランディングページ
- 運営: AirPangaea
- Cloudflare Pages でホスティング（git push で自動デプロイ、1-2分）
- フォーム送信 → Cloudflare Pages Function → Airtable REST API

## 技術スタック
- HTML/CSS/JS（フレームワークなし、単一ページLP）
- Cloudflare Pages + Pages Functions（サーバーレス）
- Airtable（CRM/DB）— MCP接続あり

## 主要ファイル
- `index.html` — LP本体（フォーム含む）
- `functions/api/apply.js` — フォーム送信処理（Cloudflare Pages Function）
- `thanks.html` — 送信完了ページ

---

## Airtable 接続情報
- **Base**: Tomodachi English (`appi0RtkRf2MPfJ40`)
- **PATスコープ**: `data.records:read`, `data.records:write`, `schema.bases:read`
- **Cloudflare環境変数**: `AIRTABLE_TOKEN`(Secret), `AIRTABLE_BASE_ID`, `AIRTABLE_TABLE_ID`
- **ユーザー**: admin@airpangaea.com (usrJgUvniXZfDStz3)

## Airtable テーブル構成

### Students テーブル (`tblC4YyYOjtVuKMnV`)
| フィールド名 | Field ID | 型 | フォーム使用 | 備考 |
|---|---|---|---|---|
| Name | fldiatR2syOAnGeC1 | singleLineText | YES | PK |
| Display Name | fldvBcqTbX2jjHxi8 | singleLineText | | |
| Country | fld0o4qUSxBA4hkJa | singleSelect | | |
| Gender | fldkgBWAY5URfwVlO | singleSelect | YES | |
| School Year | fldxVi5K2gNiVyWf6 | singleSelect | YES | |
| Email | fldwEBlgkxM3TMQeo | email | YES | |
| Phone | fldvaJlyLqANY3IYw | phoneNumber | YES | |
| School Name | fldHofD6n1pignZRl | singleLineText | YES | |
| English Level | fldteul63pEfP2j9i | singleSelect | YES | |
| Status | fld7kF0rL8NBwqVL9 | singleSelect | YES(自動) | Applied |
| Source | fldq5F1H26trbiiea | singleSelect | YES(自動) | Form |
| Comments | flddosiHxBy3F59nM | multilineText | YES | 希望コースも合流 |
| Course | fldxssl6Idkzbl1cP | singleSelect | | |
| Application Date | fld7taraUhhzZTNbL | date | | **編集制限** |
| 希望コース・プラン | fldrgi5NUhq2JdXne | singleSelect | | **編集制限** |
| Start Date | fldjD2Ry1jWu3jrhh | date | | |
| Assigned Timeslot | fldLu3mmJOSGCb7KO | link→Timeslots | | |
| Preference 1/2/3 | fldgmc11R.../fld3qeq.../fld78aj1... | link→Timeslots | | |
| Zoom Link | fldewj7ZXmwfo4A6c | url | | |
| Payment URL | fldLTpIr7yxaaNg3e | url | | |
| Payment Link ID | fld1UqxRenA8eoF8t | singleLineText | | |
| Payment Amount | fldQhfDdJXtCAKK6c | number | | |
| Payment Date | fldTpIowto3l6bYbW | date | | |
| Payment Confirmed | fldm1WMxMPHBfZb7v | checkbox | | |
| Invoice Link | fldAFMjfpovoWGyzk | url | | |
| Welcome Email Sent | fldpzcMLMGzbMoq9Q | checkbox | | |
| Created By | fld5cMJBwzCOJgp8u | createdBy | | |

### Timeslots テーブル (`tblKMHUl1Jt4kLVPv`)
| フィールド名 | Field ID | 型 |
|---|---|---|
| Slot Name | fldicexOtaJX4O9Mk | singleLineText (PK) |
| Teacher | fldT1dTafEyL3uft1 | singleSelect |
| Date/Time | fld7xRLpbtYHsjP58 | date |
| Status | fldDPsECp1M3zrUz1 | singleSelect |
| Max Students | fldrR6evTPtL9r6uZ | number |
| Zoom Link | fldhcoH4Mche6XT7n | url |
| JP Students | fldmQXQyVK0BR75RH | link→Students |
| IND Students | fldgu64z2VmwhyF6D | link→Students |

### Teachers テーブル (`tblnlNFYdAm784JY3`)
| フィールド名 | Field ID | 型 |
|---|---|---|
| Name | fldaWSJb0C5XNePlH | singleLineText (PK) |
| Email | fldb8kbAAhG93qSOE | email |
| Zoom Link | fldGrzHuBTdmCoEUQ | url |
| Timeslots | fldeAmGD9rskpAU2t | link→Timeslots |

---

## フォーム → Airtable マッピング（apply.js）
- Gender: 男→男性, 女→女性, 回答しない→Prefer not to say
- Grade: 半角数字→全角数字（中学1年生→中学１年生 等）
- English Level: 英検3級相当→英検備３級（または同じレベルの英語力）を保有 等
- 希望コース・プラン: Commentsフィールドに `【希望コース】〇〇` として合流
- `typecast: true` を使用（セレクト値の自動変換）

## 重要な注意事項
- **フィールド編集制限**: Airtableのフィールドレベル編集制限が設定されたフィールドは、PAT/MCP問わずAPI経由で書き込み不可（403 INVALID_PERMISSIONS）。エラーメッセージがテーブルレベルと同一のため判別困難。新フィールド追加時は必ず確認。
- **Field ID必須**: PAT経由のAPI呼び出しはフィールド名ではなくField IDを使用すること
- **テストレコード**: Airtable上に `__TEST_*__`, `__DIAG_*__`, `__FINAL_TEST__` 名のテストレコードが残っている場合は削除すること
