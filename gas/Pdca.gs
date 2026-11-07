/***** TD留学 隔週PDCAの数字集め（Pdca） *****
 *
 * スプシ「TDEN 生徒管理」の Apps Script に、Code.gs・Ops.gs とは別のファイルとして置く。
 * 第1・第3土曜の朝に、前回の集計の次の日〜昨日（今回）と、その直前の同じ日数（比較）の数字を
 * シート「PDCA集計」に1期間1行で書く。個人情報は書かない（Claude の定期タスクがこのシートだけを読む）。
 *
 * 集める数字
 *  - GA4（ストリーム「TOMODACHI留学LP」）… チャネル別セッション・generate_lead の件数
 *  - 生徒_JP … 申込日時が期間内で、経由が LP（予備経路を含む）の件数。activo は数えない
 *  - 広告費 … 自動では取らない。広告を再開したら、その行に手で入れる（空欄＝未入力）
 *
 * 初回（手順は gas/README.md）
 *  - 左の「サービス ＋」から「Google Analytics Data API」を追加（ID は AnalyticsData のまま）
 *  - プロジェクトの設定 → スクリプト プロパティに GA4_PROPERTY_ID（GA4のプロパティID・数字）を追加
 *  - pdcaRunNow を1回実行して権限を許可 → PDCA集計 に2行出ればOK → pdcaInstallTrigger を実行
 *
 * 注意
 *  - 関数・定数は pdca／PDCA で始める（Code.gs・Ops.gs と名前がぶつからないように）
 */

const PDCA = {
  SHEET: 'PDCA集計',
  STREAM: 'TOMODACHI留学LP',
  TZ: 'Asia/Tokyo',
  // まだ1行も無い時の「今回」の始まり（前回の手作業の確認 9/29〜10/24 の次の日）
  FIRST_START: 20261025,
  HEAD: ['集計日', '区分', '開始', '終了', '日数', 'セッション', '広告以外セッション', '1日あたり全体', '1日あたり広告以外',
    'generate_lead', '申込_JP_LP', '広告費', 'チャネル内訳'],
};

// 広告のチャネル（GA4の「セッションのデフォルト チャネル グループ」）
const PDCA_PAID = ['Paid Search', 'Paid Social', 'Paid Video', 'Paid Shopping', 'Paid Other', 'Display', 'Cross-network'];


/** トリガーから（毎週土曜の朝）。1〜7日・15〜21日の土曜だけ動く */
function pdcaAuto() {
  const day = Number(Utilities.formatDate(new Date(), PDCA.TZ, 'd'));
  if ((day >= 1 && day <= 7) || (day >= 15 && day <= 21)) pdcaCollect_();
}

/** エディタから手で動かす時（日付に関係なく集計する。同じ終了日の行があれば書き直す） */
function pdcaRunNow() {
  pdcaCollect_();
}

/** 毎週土曜 7時のトリガーを入れる（pdcaAuto の中で第1・第3土曜だけに絞る） */
function pdcaInstallTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'pdcaAuto')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('pdcaAuto').timeBased().onWeekDay(ScriptApp.WeekDay.SATURDAY).atHour(7).inTimezone(PDCA.TZ).create();
}


function pdcaCollect_() {
  const propertyId = PropertiesService.getScriptProperties().getProperty('GA4_PROPERTY_ID');
  if (!propertyId) throw new Error('スクリプト プロパティ GA4_PROPERTY_ID がありません');

  const sheet = pdcaSheet_();
  const end = pdcaAddDays_(pdcaToday_(), -1);
  const start = pdcaStart_(sheet, end);
  const days = pdcaDiff_(start, end) + 1;
  const prevEnd = pdcaAddDays_(start, -1);
  const prevStart = pdcaAddDays_(prevEnd, -(days - 1));

  const ranges = [{ name: 'now', start, end }, { name: 'prev', start: prevStart, end: prevEnd }];
  const sessions = pdcaSessions_(propertyId, ranges);
  const leads = pdcaLeads_(propertyId, ranges);
  const apps = pdcaApplications_(ranges);

  const today = Utilities.formatDate(new Date(), PDCA.TZ, 'yyyy/MM/dd');
  const rows = [['prev', '比較'], ['now', '今回']].map(([key, label]) => {
    const r = ranges.find(x => x.name === key);
    const ch = sessions[key] || {};
    const total = Object.keys(ch).reduce((s, c) => s + ch[c], 0);
    const organic = Object.keys(ch).filter(c => PDCA_PAID.indexOf(c) === -1).reduce((s, c) => s + ch[c], 0);
    const breakdown = Object.keys(ch).sort((a, b) => ch[b] - ch[a]).map(c => c + ' ' + ch[c]).join(' / ');
    return [today, label, pdcaText_(r.start), pdcaText_(r.end), days, total, organic,
      Math.round(total / days * 10) / 10, Math.round(organic / days * 10) / 10,
      leads[key] || 0, apps[key] || 0, '', breakdown];
  });

  // 同じ期間をもう一度集計した時は、前の2行を書き直す（手で入れた広告費は残す）
  const values = sheet.getDataRange().getDisplayValues();
  const endText = pdcaText_(end);
  const old = values.findIndex((v, i) => i > 1 && v[1] === '今回' && v[3] === endText);
  if (old > 1) {
    rows[0][11] = values[old - 1][11];
    rows[1][11] = values[old][11];
    sheet.getRange(old, 1, 2, PDCA.HEAD.length).setValues(rows);
  } else {
    sheet.getRange(sheet.getLastRow() + 1, 1, 2, PDCA.HEAD.length).setValues(rows);
  }
}

/** 今回の始まり：最後の「今回」行の終了日の次の日（同じ日にもう一度集計した時は、その行の開始日） */
function pdcaStart_(sheet, end) {
  const values = sheet.getDataRange().getDisplayValues().slice(1).filter(v => v[1] === '今回');
  const same = values.find(v => pdcaKey_(v[3]) === end);
  if (same) return pdcaKey_(same[2]);
  const last = values.map(v => pdcaKey_(v[3])).filter(k => k && k < end).sort().pop();
  return last ? pdcaAddDays_(last, 1) : PDCA.FIRST_START;
}

function pdcaSheet_() {
  const ss = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID);
  let sheet = ss.getSheetByName(PDCA.SHEET);
  if (!sheet) {
    sheet = ss.insertSheet(PDCA.SHEET);
    // 日付は文字のまま置く（読む側が日付の形を気にしなくてよいように）
    sheet.getRange('A:D').setNumberFormat('@');
    sheet.getRange(1, 1, 1, PDCA.HEAD.length).setValues([PDCA.HEAD]).setFontWeight('bold');
    sheet.setFrozenRows(1);
  }
  return sheet;
}


/* ======================= GA4 ======================= */

function pdcaGa4_(propertyId, ranges, request) {
  request.dateRanges = ranges.map(r => ({ name: r.name, startDate: pdcaIso_(r.start), endDate: pdcaIso_(r.end) }));
  return AnalyticsData.Properties.runReport(request, 'properties/' + propertyId);
}

const pdcaStreamFilter_ = () => ({ filter: { fieldName: 'streamName', stringFilter: { matchType: 'EXACT', value: PDCA.STREAM } } });

/** { now: { 'Direct': 120, ... }, prev: {...} } */
function pdcaSessions_(propertyId, ranges) {
  const res = pdcaGa4_(propertyId, ranges, {
    dimensions: [{ name: 'sessionDefaultChannelGroup' }],
    metrics: [{ name: 'sessions' }],
    dimensionFilter: pdcaStreamFilter_(),
  });
  const out = {};
  pdcaRows_(res).forEach(({ dims, range, value }) => {
    out[range] = out[range] || {};
    out[range][dims.sessionDefaultChannelGroup] = value;
  });
  return out;
}

/** { now: 3, prev: 1 } */
function pdcaLeads_(propertyId, ranges) {
  const res = pdcaGa4_(propertyId, ranges, {
    dimensions: [{ name: 'eventName' }],
    metrics: [{ name: 'eventCount' }],
    dimensionFilter: { andGroup: { expressions: [
      pdcaStreamFilter_(),
      { filter: { fieldName: 'eventName', stringFilter: { matchType: 'EXACT', value: 'generate_lead' } } },
    ] } },
  });
  const out = {};
  pdcaRows_(res).forEach(({ range, value }) => { out[range] = (out[range] || 0) + value; });
  return out;
}

/** 期間が2つの時、GA4は列 dateRange（now／prev）を足して返す */
function pdcaRows_(res) {
  const heads = (res.dimensionHeaders || []).map(h => h.name);
  return (res.rows || []).map(row => {
    const dims = {};
    heads.forEach((h, i) => { dims[h] = row.dimensionValues[i].value; });
    return { dims, range: dims.dateRange, value: Number(row.metricValues[0].value) || 0 };
  });
}


/* ======================= 申込（生徒_JP） ======================= */

/** { now: 1, prev: 0 }。経由が LP で始まる行（LP・LP(予備経路)）だけ数える。名前などは読まない */
function pdcaApplications_(ranges) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(CONFIG.SHEET_JP);
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0].map(h => String(h).trim());
  const cDate = head.indexOf('申込日時'), cSource = head.indexOf('経由');
  if (cDate === -1 || cSource === -1) throw new Error('生徒_JP に「申込日時」か「経由」の列がありません');
  const n = sheet.getLastRow() - 1;
  if (n < 1) return {};
  const dates = sheet.getRange(2, cDate + 1, n, 1).getDisplayValues();
  const sources = sheet.getRange(2, cSource + 1, n, 1).getDisplayValues();
  const out = {};
  dates.forEach((d, i) => {
    if (!/^LP/i.test(String(sources[i][0]).trim())) return;
    const k = pdcaKey_(d[0]);
    ranges.forEach(r => { if (k >= r.start && k <= r.end) out[r.name] = (out[r.name] || 0) + 1; });
  });
  return out;
}


/* ======================= 日付（20261107 のような数で扱う） ======================= */

function pdcaToday_() {
  return Number(Utilities.formatDate(new Date(), PDCA.TZ, 'yyyyMMdd'));
}

/** "2026/11/07 10:00:00"・"2026-11-07" → 20261107。日付でなければ 0 */
function pdcaKey_(v) {
  const m = String(v == null ? '' : v).trim().match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

function pdcaDate_(k) {
  return new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100));
}

function pdcaAddDays_(k, n) {
  const d = pdcaDate_(k);
  d.setUTCDate(d.getUTCDate() + n);
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

function pdcaDiff_(a, b) {
  return Math.round((pdcaDate_(b) - pdcaDate_(a)) / 86400000);
}

const pdcaIso_ = k => Utilities.formatDate(pdcaDate_(k), 'UTC', 'yyyy-MM-dd');
const pdcaText_ = k => Utilities.formatDate(pdcaDate_(k), 'UTC', 'yyyy/MM/dd');
