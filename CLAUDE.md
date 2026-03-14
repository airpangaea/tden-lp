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
**実際のフィールド数: 47（2026年3月時点）**

#### 基本情報
| フィールド名 | Field ID | 型 | フォーム使用 | 備考 |
|---|---|---|---|---|
| Name | fldiatR2syOAnGeC1 | singleLineText | YES | PK |
| Display Name | fldvBcqTbX2jjHxi8 | singleLineText | | |
| Email | fldwEBlgkxM3TMQeo | email | YES | |
| Phone | fldvaJlyLqANY3IYw | phoneNumber | YES | |
| School Name | fldHofD6n1pignZRl | singleLineText | YES | |
| Gender | fldkgBWAY5URfwVlO | singleSelect | YES | |
| School Year | fldxVi5K2gNiVyWf6 | singleSelect | YES | |
| Country | fld0o4qUSxBA4hkJa | singleSelect | | Japan 自動設定 |

#### 英語レベル・コース
| フィールド名 | Field ID | 型 | フォーム使用 | 備考 |
|---|---|---|---|---|
| English Level | fldteul63pEfP2j9i | singleSelect | YES | |
| Course | fldxssl6Idkzbl1cP | singleSelect | | |
| 希望コース・プラン | fldrgi5NUhq2JdXne | singleSelect | | **編集制限** |
| Comments | flddosiHxBy3F59nM | multilineText | YES | 希望コースも合流 |

#### ステータス・日程
| フィールド名 | Field ID | 型 | フォーム使用 | 備考 |
|---|---|---|---|---|
| Status | fld7kF0rL8NBwqVL9 | singleSelect | YES(自動) | Applied |
| Source | fldq5F1H26trbiiea | singleSelect | YES(自動) | Form |
| Application Date | fld7taraUhhzZTNbL | date | | **編集制限** |
| Start Date | fldjD2Ry1jWu3jrhh | date | | |

#### タイムスロット
| フィールド名 | Field ID | 型 | 備考 |
|---|---|---|---|
| Assigned Timeslot | fldLu3mmJOSGCb7KO | link→Timeslots | |
| Preference 1 | fldgmc11RN7VPgmSc | link→Timeslots | |
| Preference 2 | fld3qeqTnCCFEXvPj | link→Timeslots | |
| Preference 3 | fld78aj1QTbcX4msr | link→Timeslots | |
| Timeslots | fldB3cJ8B7ntH23lU | singleLineText | |
| Timeslots 2 | fldL77tcR0uIZ3zTj | singleLineText | |
| Timeslots 3 | fldPLLwsEB4dWaNGC | link→Timeslots | |
| Timeslots 4 | fldl9QShKF5NDRTaL | link→Timeslots | |

#### 決済
| フィールド名 | Field ID | 型 | 備考 |
|---|---|---|---|
| Payment URL | fldLTpIr7yxaaNg3e | url | |
| Payment Link ID | fld1UqxRenA8eoF8t | singleLineText | |
| Payment Amount | fldQhfDdJXtCAKK6c | number | |
| Currency | fld62u3fJQ5XTIvNi | singleLineText | |
| Payment Date | fldTpIowto3l6bYbW | date | |
| Payment Confirmed | fldm1WMxMPHBfZb7v | checkbox | |
| Payment Error | fldSIOrR6nLWVrptO | multilineText | |
| Link Created Date | fldeLag1Pyo1eRGDc | date | |
| Invoice Link | fldAFMjfpovoWGyzk | url | |
| Payment Link Sent | fldI9DDqxWYr6Lsgi | checkbox | |

#### コミュニケーション・メール
| フィールド名 | Field ID | 型 | 備考 |
|---|---|---|---|
| Zoom Link | fldewj7ZXmwfo4A6c | url | |
| Welcome Email Subject | fldBgM9Q0ZHvl9GBn | multilineText | メール下書き |
| Welcome Email | fld5VJtXrGwOL4xbq | multilineText | メール下書き |
| Welcome Email Sent | fldpzcMLMGzbMoq9Q | checkbox | |
| Grouping Results Email Subject | flduUv6KeCLWs69Pg | multilineText | メール下書き |
| Grouping Results Email | fldDIxmNMXF8nVgaZ | multilineText | メール下書き |
| Payment Confirmation Email Subject | fld0J5osoAKJ95OQ9 | multilineText | メール下書き |
| Payment Confirmation Email | fldDKdWLzuvsCbFNg | multilineText | メール下書き |
| Last Reminder Date | flduJw2USrHXozHdW | date | |
| Last Reminder Subject | fldZR0atkHazMh9gQ | singleLineText | |
| Last Reminder Body | fld5DnYOcacTF12t6 | multilineText | |

#### システム
| フィールド名 | Field ID | 型 |
|---|---|---|
| Created By | fld5cMJBwzCOJgp8u | createdBy |

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
