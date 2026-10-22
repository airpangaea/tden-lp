/***** TD留学 台帳の自動化（Ops） *****
 *
 * スプシ「TDEN 生徒管理」の Apps Script に、Code.gs とは別のファイルとして置く。
 * テスト用のスプシでは、このファイルだけで動く（Code.gs は要らない）。
 *
 * 役割
 *  1. 一覧表 … 生徒_JP・生徒_海外・クラス一覧から、Class Structure に「今月（自動）」「来月（自動）」のタブを作る。
 *               生徒の名前を押すと、生徒_JP／生徒_海外のその行が開く
 *  2. 5分おき … 一覧表を作り直す（中身が変わった時だけ）／最終日を過ぎた生徒を「退会」にする／
 *               支払待ち・在籍で「Wixパスワード」が空なら作る／海外生の「Display name」が空なら名前から作る
 *  3. 月の記録 … 月末に、今月の一覧表を「26Nov（自動）」のようなタブに写し、PDFをDriveの「TD 月の記録」に残す（メニューからいつでも）
 *  4. 見張りメール … 毎週月曜の朝、対応が要るものだけを送る
 *  5. 列の整理 … 生徒シートの列を使う場面ごとに並べ替え、ステータスで行に色を付ける。クラス一覧の「ターム・開始日」を
 *               「ターム」（1〜6）と「ターム開始日」に分ける（1回だけ。Code.gs は列名で読み書きし、ターム・開始日は使っていない）
 *
 * 初回（手順は gas/README.md）
 *  - メニュー「TD台帳」→「列を整理する」→「一覧表を今すぐ作り直す」→ よければ「自動の更新を始める」
 *
 * 注意
 *  - Code.gs と同じプロジェクトに入るので、関数・定数はすべて ops／OPS で始める（名前がぶつからないように）
 *  - メニュー・トリガーから呼ぶ関数は末尾に _ を付けない（_ 付きはメニュー・トリガーから呼べないため）
 */

const OPS = {
  // Class Structure のスプシID。空のあいだは「Class Structure（自動・テスト）」を新しく作って使う（テスト用）
  // Class Structure はスタッフ・講師も見るので、生徒管理へのリンクは付けない
  BOARD_FILE_ID: '',
  // スタッフ用の名簿（クラス別シート。メール・パスワード入り。スタッフだけに共有）。空ならテスト用を新しく作る
  STAFF_FILE_ID: '',
  // 旧名簿（クラス別シートと Japanese Applicants があるスプシ）。本番で取り込む時だけ入れる。空ならテスト用のダミーを読む
  OLD_FILE_ID: '',
  OLD_APPLICANTS_SHEET: 'Japanese Applicants',
  SHEET_JP: '生徒_JP',
  SHEET_INTL: '生徒_海外',
  SHEET_CLASSES: 'クラス一覧',
  TZ: 'Asia/Tokyo',

  CAPACITY: 5,       // 1クラスの定員（日本生・海外生それぞれ）
  DIFF_ALERT: 3,     // 日本生と海外生の差がこれ以上なら、一覧表で赤・見張りメールに出す
  TERM_WEEKS: 12,    // 1ターム＝12回（毎週1回）
  TEACHER_ORDER: [], // 一覧表の講師の並び。空ならクラス一覧に出てくる順

  STATUSES: ['新規', '提案中', '支払待ち', '在籍', '休会', '退会', '見送り', '空き待ち'],
  SEAT_STATUSES: ['支払待ち', '在籍', '休会'], // 一覧表の席に出るステータス

  TAB_THIS: '今月（自動）',
  TAB_NEXT: '来月（自動）',
  LEDGER_TAB_THIS: '一覧表_今月', // 生徒管理スプシの中の、あなた用の一覧表（名前を押すと生徒の行が開く）
  LEDGER_TAB_NEXT: '一覧表_来月',
  RECORD_FOLDER: 'TD 月の記録',
  // 見張りメールの件名の頭。Code.gs の SEARCH_QUERY に一致しない文言にしておくこと
  MAIL_SUBJECT: '【TD週1チェック】',
  MAIL_TO: '', // 空なら、スクリプトを動かしている人（自分）に送る
};

const OPS_COLOR = {
  ongoing: '#e3ecf7', newterm: '#dff2ec', newclass: '#f8ebd3',
  pay: '#fbe7c6', fresh: '#e2f1d5', leave: '#ecedee', none: '#f3f5f5', head: '#dce6f2',
  ink: '#1c2528', muted: '#6b777b', alert: '#b23a3a', white: '#ffffff', line: '#d2d9da',
};

// 生徒シートの行の色（ステータスごと）。在籍がひと目で分かるように
const OPS_STATUS_COLORS = [
  { statuses: ['在籍'], bg: '#e6f4ea' },
  { statuses: ['新規'], bg: '#fff4c2' },
  { statuses: ['提案中', '支払待ち'], bg: '#fde3c4' },
  { statuses: ['空き待ち'], bg: '#e3ecf7' },
  { statuses: ['休会'], bg: '#ece6f5' },
  { statuses: ['退会', '見送り'], font: '#98a2a6' },
];

// 列の整理：使う場面ごとの並び（いつも見る → クラス分け・依頼文に使う → 申込の時だけ見る）
const OPS_LAYOUT = {
  '生徒_JP': {
    order: ['生徒ID', '名前', 'ステータス', 'クラス', '席番号', '開始日', '最終日', 'メモ',
            'Display name', '性別', '学年', '英語レベル', '学校名', 'Email', 'Wixパスワード',
            '申込日時', '経由', '希望コース', '第1希望', '第2希望', '第3希望', 'コメント', '電話', '既存照合'],
    drop: ['国', 'WhatsApp'], // 日本の申込では空か Japan だけ。中身がある時は消さない
  },
  '生徒_海外': {
    order: ['生徒ID', '名前', 'ステータス', 'クラス', '席番号', '開始日', '最終日', '支払い済み〜', 'WhatsApp', 'メモ',
            'Display name', '性別', '学年', '英語レベル', '学校名', 'Email', '国', 'Wixパスワード',
            '申込日時', '経由', '希望コース', '第1希望', '第2希望', '第3希望', 'コメント', '電話', '既存照合'],
    drop: [],
  },
};
const OPS_FOLD_FROM = '申込日時'; // ここから右（申込の時だけ見る列）を畳む
const OPS_RENAME = { '提案クラス': 'クラス' }; // Code.gs はこの列を使っていない
const OPS_DATE_COLS = ['開始日', '最終日', '支払い済み〜'];
const OPS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPS_DAYS = [['Mon', '月曜'], ['Tue', '火曜'], ['Wed', '水曜'], ['Thu', '木曜'], ['Fri', '金曜'], ['Sat', '土曜'], ['Sun', '日曜']];


/* ======================= メニュー ======================= */

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu('TD台帳')
    .addItem('一覧表を今すぐ作り直す', 'opsRefreshNow')
    .addItem('今の一覧表を記録する（タブとPDF）', 'opsRecordNow')
    .addItem('見張りメールを今すぐ送る', 'opsWeeklyNow')
    .addSeparator()
    .addItem('列を整理する（最初に1回）', 'opsSetupColumns')
    .addItem('旧名簿から今の生徒を取り込む（最初に1回）', 'opsImportOld')
    .addItem('自動の更新を始める', 'opsInstallTriggers')
    .addItem('自動の更新を止める', 'opsRemoveTriggers');
  // テスト用のスプシ（OpsTestData.gs を貼ったもの）だけに出る
  if (typeof opsTestFill === 'function') menu.addSeparator().addItem('テスト用のダミーを入れ直す', 'opsTestFill');
  menu.addToUi();
}

function opsRefreshNow() {
  opsRefresh(true);
  const ledger = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(OPS.LEDGER_TAB_THIS);
  opsShowLinks_('一覧表を作り直しました', [
    [SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + ledger.getSheetId(), 'あなた用の一覧表（このスプシの「' + OPS.LEDGER_TAB_THIS + '」）'],
    [opsBoardFile_().getUrl(), 'Class Structure（スタッフ・講師用）'],
    [opsStaffFile_().getUrl(), 'スタッフ用の名簿（クラス別シート）'],
  ]);
}

function opsRecordNow() {
  const rec = opsRecordMonth_(true);
  opsShowLink_('記録しました（タブとPDF）', rec.url, '記録したタブを開く');
}

function opsWeeklyNow() {
  const to = opsSendWatch_(opsWatchItems_(opsData_()));
  SpreadsheetApp.getActiveSpreadsheet().toast(to + ' に送りました', '見張りメール', 5);
}

/** 自動の更新：5分おきに一覧表、毎晩（月末だけ）月の記録、毎週月曜の朝に見張りメール */
function opsInstallTriggers() {
  opsDeleteTriggers_();
  ScriptApp.newTrigger('opsRefresh').timeBased().everyMinutes(5).create();
  ScriptApp.newTrigger('opsDaily').timeBased().atHour(23).everyDays(1).inTimezone(OPS.TZ).create();
  ScriptApp.newTrigger('opsWeekly').timeBased().onWeekDay(ScriptApp.WeekDay.MONDAY).atHour(8).inTimezone(OPS.TZ).create();
  SpreadsheetApp.getActiveSpreadsheet().toast('5分おきの一覧表・月末の記録・月曜の見張りメールを始めました', '自動の更新', 6);
}

function opsRemoveTriggers() {
  opsDeleteTriggers_();
  SpreadsheetApp.getActiveSpreadsheet().toast('自動の更新を止めました（processInbox などほかのトリガーはそのまま）', '自動の更新', 6);
}

/** Ops のトリガーだけを消す（Code.gs の processInbox には触らない） */
function opsDeleteTriggers_() {
  const mine = ['opsRefresh', 'opsDaily', 'opsWeekly'];
  ScriptApp.getProjectTriggers()
    .filter(t => mine.indexOf(t.getHandlerFunction()) !== -1)
    .forEach(t => ScriptApp.deleteTrigger(t));
}

function opsShowLink_(title, url, label) {
  opsShowLinks_(title, [[url, label]]);
}

function opsShowLinks_(title, links) {
  const html = links.map(([url, label]) => '<p style="font-family:sans-serif;font-size:14px;margin:8px 0"><a href="' + url + '" target="_blank">' + label + '</a></p>').join('');
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(50 + links.length * 34), title);
}


/* ======================= 定期実行 ======================= */

/** 5分おき（メニューからは force=true で必ず作り直す） */
function opsRefresh(force) {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(20000)) return;
  try {
    opsRetirePast_();
    opsFillDefaults_();
    opsBuildBoards_(force === true);
  } finally {
    lock.releaseLock();
  }
}

/** 毎晩23時台。月末の日だけ、今月の一覧表を記録する */
function opsDaily() {
  if (opsAddDays_(opsTodayKey_(), 1) % 100 !== 1) return;
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try {
    opsRecordMonth_(false);
  } finally {
    lock.releaseLock();
  }
}

/** 毎週月曜の朝 */
function opsWeekly() {
  opsSendWatch_(opsWatchItems_(opsData_()));
}


/* ======================= 台帳を読む ======================= */

function opsData_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheetOf = name => {
    const sheet = ss.getSheetByName(name);
    if (!sheet) throw new Error('シートが見つかりません: ' + name);
    return sheet;
  };
  const students = [], link = {};
  [['jp', OPS.SHEET_JP], ['intl', OPS.SHEET_INTL]].forEach(([region, name]) => {
    const sheet = sheetOf(name);
    // 一覧表の名前を押すと、この行が開く
    link[region] = ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + sheet.getSheetId() + '&range=A';
    opsTable_(sheet).rows.forEach(r => students.push(opsStudent_(r, region)));
  });
  return {
    classes: opsTable_(sheetOf(OPS.SHEET_CLASSES)).rows.map(opsClass_).filter(c => c.id),
    students: students.filter(s => s.id || s.name),
    today: opsTodayKey_(),
    link,
  };
}

/** シートを {列名: 値} の行の並びにする（_row はシートの行番号） */
function opsTable_(sheet) {
  const values = sheet.getDataRange().getValues();
  const head = (values.shift() || []).map(h => String(h).trim());
  const col = {};
  head.forEach((h, i) => { if (h && col[h] === undefined) col[h] = i; });
  const rows = values.map((v, i) => {
    const r = { _row: i + 2 };
    Object.keys(col).forEach(h => { r[h] = v[col[h]]; });
    return r;
  });
  return { sheet, head, col, rows };
}

function opsStudent_(r, region) {
  const s = v => String(v == null ? '' : v).trim();
  return {
    region, row: r._row,
    id: s(r['生徒ID']),
    name: s(r['名前']),
    display: s(r['Display name']) || s(r['名前']),
    hasDisplay: !!s(r['Display name']),
    status: s(r['ステータス']),
    cls: s(r['クラス'] !== undefined ? r['クラス'] : r['提案クラス']), // 列の整理の前でも動くように
    start: opsKey_(r['開始日']),
    end: opsKey_(r['最終日']),
    paid: opsKey_(r['支払い済み〜']),
    applied: opsKey_(r['申込日時']),
    sex: s(r['性別']),
    grade: s(r['学年']),
    level: s(r['英語レベル']),
    seat: s(r['席番号']),
    email: s(r['Email']),
    phone: s(r['電話']),
    school: s(r['学校名']),
    password: s(r['Wixパスワード']),
  };
}

function opsClass_(c) {
  const s = v => String(v == null ? '' : v).trim();
  let time = c['時間(JST)'];
  if (time instanceof Date) time = Utilities.formatDate(time, opsSheetTz_(), 'HH:mm');
  const old = s(c['ターム・開始日']); // 列の整理の前の書き方（例「Oct - Dec Term 2」）
  const no = s(c['ターム']) || ((old.match(/Term\s*(\d+)/i) || [])[1] || '');
  return {
    id: s(c['Group ID']),
    day: opsDay_(c['曜日']),
    time: s(time).replace(/^(\d):/, '0$1:'),
    teacher: s(c['講師']),
    lpJp: s(c['空き_JP']),
    lpIntl: s(c['空き_海外']),
    termNo: no.replace(/\D/g, ''),
    termStart: opsKey_(c['ターム開始日']),
    termText: old,
    memo: s(c['メモ']),
  };
}

function opsDay_(v) {
  const t = String(v == null ? '' : v).trim();
  const hit = OPS_DAYS.find(([en, ja]) => t.toLowerCase().indexOf(en.toLowerCase()) === 0 || t.indexOf(ja.charAt(0)) === 0);
  return hit ? hit[0] : '';
}


/* ======================= 日付（20261019 のような数で比べる） ======================= */

let OPS_SHEET_TZ_ = '';
function opsSheetTz_() {
  if (!OPS_SHEET_TZ_) OPS_SHEET_TZ_ = SpreadsheetApp.getActiveSpreadsheet().getSpreadsheetTimeZone() || OPS.TZ;
  return OPS_SHEET_TZ_;
}

/** セルの日付（日付型か "2026/11/02" のような文字）→ 20261102。日付でなければ 0 */
function opsKey_(v) {
  if (v instanceof Date) return isNaN(v) ? 0 : Number(Utilities.formatDate(v, opsSheetTz_(), 'yyyyMMdd'));
  const m = String(v == null ? '' : v).trim().match(/^(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  return m ? Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]) : 0;
}

function opsTodayKey_() {
  return Number(Utilities.formatDate(new Date(), OPS.TZ, 'yyyyMMdd'));
}

function opsAddDays_(k, n) {
  const d = new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100 + n));
  return d.getUTCFullYear() * 10000 + (d.getUTCMonth() + 1) * 100 + d.getUTCDate();
}

/** k を含む月から add か月後の月 */
function opsMonth_(k, add) {
  let y = Math.floor(k / 10000), m = Math.floor(k / 100) % 100 + (add || 0);
  while (m > 12) { m -= 12; y++; }
  while (m < 1) { m += 12; y--; }
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return { y, m, start: y * 10000 + m * 100 + 1, end: y * 10000 + m * 100 + last };
}

function opsMd_(k) {
  return (Math.floor(k / 100) % 100) + '/' + (k % 100);
}

/** 文字から日付を拾う（2026/11/4 も 11/4 も可。年が無ければ month に近い年） */
function opsFindDate_(text, month) {
  const t = String(text || '');
  let m = t.match(/(\d{4})[\/\-.年](\d{1,2})[\/\-.月](\d{1,2})/);
  if (m) return Number(m[1]) * 10000 + Number(m[2]) * 100 + Number(m[3]);
  m = t.match(/(\d{1,2})\/(\d{1,2})/);
  if (!m) return 0;
  const mo = Number(m[1]), d = Number(m[2]);
  if (mo < 1 || mo > 12 || d < 1 || d > 31) return 0;
  const diff = mo - month.m;
  const y = month.y + (diff < -6 ? 1 : diff > 6 ? -1 : 0);
  return y * 10000 + mo * 100 + d;
}


/* ======================= 席の割り当て ======================= */

/** 表示する月に、どのクラスの席に誰が出るか */
function opsPlace_(data, month) {
  const slots = {};
  data.classes.forEach(c => { slots[c.id] = { cls: c, jp: [], intl: [], prop: 0, waitJp: 0, waitIntl: 0 }; });
  const problems = [];
  const ref = Math.max(data.today, month.start); // 海外の支払いはこの日で見る
  data.students.forEach(st => {
    const seated = OPS.SEAT_STATUSES.indexOf(st.status) !== -1;
    if (!st.cls) {
      if (seated) problems.push({ st, why: 'クラスが空' });
      return;
    }
    const slot = slots[st.cls];
    if (!slot) {
      if (seated || st.status === '提案中' || st.status === '空き待ち') problems.push({ st, why: 'クラス一覧に無いクラス' });
      return;
    }
    if (st.status === '提案中') {
      if (!st.start || st.start <= month.end) slot.prop++;
      return;
    }
    if (st.status === '空き待ち') {
      slot[st.region === 'jp' ? 'waitJp' : 'waitIntl']++;
      return;
    }
    if (!seated) return;
    if (st.start && st.start > month.end) return;
    if (st.end && st.end < month.start) return;
    slot[st.region].push({
      st,
      leaving: !!(st.end && st.end <= month.end),
      fresh: !!(st.start && st.start >= month.start),
      unpaid: st.status === '支払待ち' || (st.region === 'intl' && st.status === '在籍' && (!st.paid || st.paid < ref)),
      paused: st.status === '休会',
    });
  });
  Object.keys(slots).forEach(id => ['jp', 'intl'].forEach(r => { slots[id][r] = opsSeatOrder_(slots[id][r]); }));
  return { slots, problems };
}

/** 席番号（JP-03 なら3番目）の位置に並べる。番号が無い・重なる生徒は空いている所へ。空席は undefined */
function opsSeatOrder_(list) {
  const out = [];
  const byStart = list.slice().sort((a, b) => (a.st.start || 0) - (b.st.start || 0) || (a.st.id < b.st.id ? -1 : a.st.id > b.st.id ? 1 : 0));
  const rest = [];
  byStart.forEach(x => {
    const n = opsSeatNo_(x.st.seat);
    if (n && !out[n - 1]) out[n - 1] = x; else rest.push(x);
  });
  rest.forEach(x => { let i = 0; while (out[i]) i++; out[i] = x; });
  return out;
}

/** "JP-03" → 3（読めなければ 0） */
function opsSeatNo_(seat) {
  const m = String(seat || '').match(/(\d+)\s*$/);
  return m ? Number(m[1]) : 0;
}

/** 退会予定を除いた人数 */
function opsCount_(slot) {
  const n = r => slot[r].filter(x => x && !x.leaving).length;
  return { jp: n('jp'), intl: n('intl') };
}

/** ターム開始日（無ければ古い「ターム・開始日」の文字から拾う） */
function opsTermStart_(cls, month) {
  return cls.termStart || opsFindDate_(cls.termText, month);
}

function opsClassState_(cls, month) {
  const d = opsTermStart_(cls, month);
  if (d) return d > month.end ? 'newclass' : d >= month.start ? 'newterm' : 'ongoing';
  return /recruit|募集/i.test(cls.termText) ? 'newclass' : 'ongoing';
}

/** 一覧表のクラス名の横に出す文字（例「Oct-Dec Term 2」「Recruiting Class・Term 1・11/3〜」） */
function opsTermLabel_(cls, month) {
  const d = opsTermStart_(cls, month);
  const term = cls.termNo ? 'Term ' + cls.termNo : '';
  if (opsClassState_(cls, month) === 'newclass') return ['Recruiting Class', term, d ? opsMd_(d) + '〜' : ''].filter(Boolean).join('・');
  if (!d) return term || cls.termText;
  const m = Math.floor(d / 100) % 100 - 1;
  return OPS_MONTHS[m] + '-' + OPS_MONTHS[(m + 2) % 12] + (term ? ' ' + term : '');
}

/** クラスの生徒の内訳（学年・男女・英語レベル）。一覧表の人数の欄にメモで出す */
function opsBreakdown_(slot) {
  const tally = (list, f, order) => {
    const n = {};
    list.forEach(x => { const k = f(x.st); if (k) n[k] = (n[k] || 0) + 1; });
    const keys = Object.keys(n).sort((a, b) => (order || []).indexOf(a) - (order || []).indexOf(b) || a.localeCompare(b, 'ja', { numeric: true }));
    return keys.map(k => k + n[k]).join('・');
  };
  const grade = st => st.grade.replace(/\(.*?\)|（.*?）/g, '').replace(/^中学(\d)年生?$/, '中$1').replace(/^高校(\d)年生?$/, '高$1').replace(/^Grade\s*/i, 'G').trim() + ':';
  const sex = st => ({ 男: '男', 男性: '男', Male: '男', 女: '女', 女性: '女', Female: '女' })[st.sex] || '';
  const level = st => (((st.level.match(/準?[1-5]級/) || [])[0]) || (/満たない/.test(st.level) ? '準2級未満' : /相談|わから/.test(st.level) ? '相談' : st.level.slice(0, 20))) + ':';
  const line = (label, r) => {
    const list = slot[r].filter(x => x && !x.leaving);
    if (!list.length) return '';
    return label + '：' + [tally(list, grade), tally(list, sex, ['男', '女']), tally(list, level)].filter(Boolean).join('／');
  };
  return [line('日本生', 'jp'), line('海外生', 'intl')].filter(Boolean).join('\n');
}


/* ======================= 一覧表（Class Structure と同じ並び） ======================= */

/** 一覧表のマス目を作る（シートには書かない）。cells[行][列] = {v, bg, color, bold, strike, size, align, wrap, note, link} */
function opsBoardGrid_(data, month, title) {
  const place = opsPlace_(data, month);
  const C = OPS_COLOR, CAP = OPS.CAPACITY;
  const days = OPS_DAYS.filter(([en], i) => i < 5 || data.classes.some(c => c.day === en));
  const times = Array.from(new Set(data.classes.map(c => c.time).filter(Boolean))).sort();
  const seen = Array.from(new Set(data.classes.map(c => c.teacher).filter(Boolean)));
  const teachers = OPS.TEACHER_ORDER.filter(t => seen.indexOf(t) !== -1).concat(seen.filter(t => OPS.TEACHER_ORDER.indexOf(t) === -1));
  const width = 1 + days.length * 2;
  const cells = [], merges = [];
  const blank = () => Array.from({ length: width }, () => ({ v: '' }));
  const push = row => { cells.push(row); return cells.length; };
  const span = (r, c, n) => merges.push([r, c, 1, n]);
  const link = data.link || {};

  // 見出し・凡例
  let row = blank();
  row[0] = { v: 'Class Structure（自動）　' + title, bold: true, size: 12, align: 'left' };
  span(push(row), 1, width);
  row = blank();
  row[0] = { v: '', color: C.muted, size: 9, align: 'left' }; // 説明と更新時刻は書く時に入れる
  span(push(row), 1, width);
  row = blank();
  const legend = [
    { v: 'クラス', bold: true }, { v: 'Ongoing Term', bg: C.ongoing }, { v: 'New Term', bg: C.newterm }, { v: 'New Class', bg: C.newclass },
    { v: '生徒', bold: true }, { v: '空席', color: C.muted }, { v: 'Before Payment', bg: C.pay }, { v: 'New User', bg: C.fresh },
    { v: '退会予定', bg: C.leave, strike: true, color: C.muted }, { v: '差' + OPS.DIFF_ALERT + '以上は赤', color: C.alert, bold: true },
  ];
  legend.slice(0, width).forEach((l, i) => { row[i] = Object.assign({ size: 9 }, l); });
  push(row);
  row = blank();
  row[0] = { v: '名前を押すと生徒管理スプシのその生徒の行が開きます。人数の欄にカーソルを置くと、学年・男女・英語レベルの内訳が出ます。', color: C.muted, size: 9, align: 'left' };
  span(push(row), 1, width);
  push(blank());

  const byKey = {};
  data.classes.forEach(c => { byKey[c.teacher + '|' + c.day + '|' + c.time] = c; });

  teachers.forEach(teacher => {
    row = blank();
    row[0] = { v: teacher, bold: true, size: 12, align: 'left' };
    days.forEach(([, ja], i) => { row[1 + i * 2] = { v: ja, bg: C.head, bold: true }; row[2 + i * 2] = { v: '', bg: C.head }; });
    const r1 = push(row);
    days.forEach((d, i) => span(r1, 2 + i * 2, 2));
    row = blank();
    days.forEach((d, i) => {
      row[1 + i * 2] = { v: '日本生', bg: C.head, color: C.muted, size: 9 };
      row[2 + i * 2] = { v: '海外生', bg: C.head, color: C.muted, size: 9 };
    });
    push(row);

    times.forEach(time => {
      const here = days.map(([en]) => byKey[teacher + '|' + en + '|' + time]);
      const slotOf = i => here[i] ? place.slots[here[i].id] : null;

      row = blank();
      row[0] = { v: time, bold: true };
      here.forEach((c, i) => {
        if (c) {
          const bg = C[opsClassState_(c, month)];
          const label = opsTermLabel_(c, month);
          row[1 + i * 2] = { v: c.id + (label ? '・' + label : ''), bg, bold: true, size: 9, wrap: true, note: c.memo };
          row[2 + i * 2] = { v: '', bg };
        } else {
          row[1 + i * 2] = { v: '', bg: C.none };
          row[2 + i * 2] = { v: '', bg: C.none };
        }
      });
      const rl = push(row);
      here.forEach((c, i) => span(rl, 2 + i * 2, 2));

      let seats = CAP;
      here.forEach((c, i) => { if (c) seats = Math.max(seats, slotOf(i).jp.length, slotOf(i).intl.length); });
      for (let k = 0; k < seats; k++) {
        row = blank();
        row[0] = { v: ('0' + (k + 1)).slice(-2), color: C.muted, size: 9 }; // 席番号（JP-01・ID-01 の 01）
        here.forEach((c, i) => {
          if (!c) {
            row[1 + i * 2] = { v: '', bg: C.none };
            row[2 + i * 2] = { v: '', bg: C.none };
            return;
          }
          row[1 + i * 2] = opsSeatCell_(slotOf(i).jp[k], k, link.jp);
          row[2 + i * 2] = opsSeatCell_(slotOf(i).intl[k], k, link.intl);
        });
        push(row);
      }

      row = blank();
      row[0] = { v: '人数', color: C.muted, size: 9 };
      here.forEach((c, i) => {
        if (!c) {
          row[1 + i * 2] = { v: '', bg: C.none };
          row[2 + i * 2] = { v: '', bg: C.none };
          return;
        }
        const sl = slotOf(i), n = opsCount_(sl), diff = Math.abs(n.jp - n.intl);
        const wait = sl.waitJp + sl.waitIntl;
        const text = '日本 ' + n.jp + '/' + CAP + '・海外 ' + n.intl + '/' + CAP + '・差' + diff +
          (sl.prop ? '・提案中' + sl.prop : '') + (wait ? '・空き待ち' + wait : '');
        const note = opsBreakdown_(sl);
        row[1 + i * 2] = diff >= OPS.DIFF_ALERT ? { v: text, size: 9, color: C.alert, bold: true, note } : { v: text, size: 9, color: C.muted, note };
        row[2 + i * 2] = { v: '' };
      });
      const rc = push(row);
      here.forEach((c, i) => span(rc, 2 + i * 2, 2));
    });
    push(blank());
  });
  return { width, cells, merges, problems: place.problems };
}

function opsSeatCell_(seat, k, linkBase) {
  const C = OPS_COLOR;
  if (!seat) return k < OPS.CAPACITY ? { v: '空席', color: C.muted, size: 9 } : { v: '' };
  const st = seat.st;
  const name = st.display + (seat.leaving ? '（' + opsMd_(st.end) + 'まで）' : '') + (seat.paused ? '（休会）' : '');
  const cell = { v: name, link: linkBase ? linkBase + st.row : '' };
  if (seat.leaving) return Object.assign(cell, { bg: C.leave, strike: true, color: C.muted });
  if (seat.unpaid) return Object.assign(cell, { bg: C.pay });
  if (seat.fresh) return Object.assign(cell, { bg: C.fresh });
  return cell;
}

/**
 * 一覧表を作り直す（中身が前と同じなら書かない。force で必ず書く）
 *  - Class Structure（スタッフ・講師も見る）… リンク無し
 *  - 生徒管理スプシの「一覧表_今月／来月」（あなた用）… 名前を押すと生徒の行が開く
 *  - スタッフ用の名簿（クラス別シート）
 */
function opsBuildBoards_(force) {
  const data = opsData_();
  const board = opsBoardFile_();
  const ledger = SpreadsheetApp.getActiveSpreadsheet();
  const stamp = Utilities.formatDate(new Date(), OPS.TZ, 'M/d HH:mm');
  [[0, '今月', OPS.TAB_THIS, OPS.LEDGER_TAB_THIS], [1, '来月', OPS.TAB_NEXT, OPS.LEDGER_TAB_NEXT]].forEach(([add, label, tab, ledgerTab]) => {
    const month = opsMonth_(data.today, add);
    const grid = opsBoardGrid_(data, month, label + '：' + month.y + '年' + month.m + '月');
    const shared = opsStripLinks_(grid);
    shared.cells[3][0].v = '人数の欄にカーソルを置くと、学年・男女・英語レベルの内訳が出ます。';
    opsWriteIfChanged_(board, tab, add, shared, 'OPS_HASH_' + add, force,
      '生徒管理スプシから自動で作っています（このタブは手で直さない）。最終更新 ' + stamp);
    opsWriteIfChanged_(ledger, ledgerTab, ledger.getSheets().length, grid, 'OPS_HASH_L' + add, force,
      '生徒管理スプシから自動で作っています（直す時は生徒_JP／生徒_海外を直す）。最終更新 ' + stamp);
  });
  opsDropBlankFirstSheet_(board);
  opsBuildRoster_(data, force);
}

function opsWriteIfChanged_(ss, tab, index, grid, key, force, note) {
  const props = PropertiesService.getScriptProperties();
  const hash = opsHash_(grid);
  if (!force && ss.getSheetByName(tab) && props.getProperty(key) === hash) return;
  grid.cells[1][0].v = note;
  opsWriteGrid_(opsTab_(ss, tab, index), grid);
  props.setProperty(key, hash);
}

function opsHash_(obj) {
  return Utilities.base64Encode(Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, JSON.stringify(obj), Utilities.Charset.UTF_8));
}

/** スタッフ・講師が見る一覧表には、生徒管理スプシへのリンクを付けない */
function opsStripLinks_(grid) {
  const copy = JSON.parse(JSON.stringify(grid));
  copy.cells.forEach(row => row.forEach(c => { delete c.link; }));
  return copy;
}


/* ======================= スタッフ用の名簿（旧名簿のクラス別シートの代わり） ======================= */

const OPS_ROSTER_HEAD = ['Group ID', 'Student ID', 'Display name', 'Full name', 'Gender', 'Email (Google Account)', 'Notes (if any)',
  '学年', 'School', '海外生WA', 'Password'];

/** 1クラス分の行（席番号順。日本生→海外生。空けて、やめた生徒） */
function opsRosterRows_(data, cls) {
  const T = data.today;
  const mine = data.students.filter(s => s.cls === cls.id);
  // 載せるのは入会した生徒（在籍・休会）だけ。支払待ちの生徒は、席番号は押さえるが、名簿にはまだ出さない
  const now = mine.filter(s => (s.status === '在籍' || s.status === '休会') && !(s.end && s.end < T));
  const row = s => [cls.id, s.seat, s.display, s.name, s.sex, s.email, s.level, s.grade, s.school,
    s.region === 'intl' ? s.phone : '', s.password];
  const bySeat = (a, b) => (opsSeatNo_(a.seat) || 99) - (opsSeatNo_(b.seat) || 99) || (a.start || 0) - (b.start || 0);
  const rows = ['jp', 'intl'].reduce((acc, r) => acc.concat(now.filter(s => s.region === r).sort(bySeat).map(row)), []);
  const past = mine.filter(s => s.status === '退会').sort((a, b) => (b.end || 0) - (a.end || 0)).map(row);
  return past.length ? rows.concat([OPS_ROSTER_HEAD.map(() => ''), ['（やめた生徒）'].concat(OPS_ROSTER_HEAD.slice(1).map(() => ''))], past) : rows;
}

function opsBuildRoster_(data, force) {
  const ss = opsStaffFile_();
  const props = PropertiesService.getScriptProperties();
  data.classes.forEach(cls => {
    const rows = opsRosterRows_(data, cls);
    const key = 'OPS_HASH_R_' + cls.id, hash = opsHash_(rows);
    let sheet = ss.getSheetByName(cls.id);
    if (!force && sheet && props.getProperty(key) === hash) return;
    if (!sheet) sheet = ss.insertSheet(cls.id, ss.getSheets().length);
    sheet.clear();
    const values = [OPS_ROSTER_HEAD].concat(rows);
    sheet.getRange(1, 1, values.length, OPS_ROSTER_HEAD.length).setNumberFormat('@').setValues(values);
    sheet.getRange(1, 1, 1, OPS_ROSTER_HEAD.length).setFontWeight('bold').setBackground(OPS_COLOR.head);
    sheet.setFrozenRows(1);
    props.setProperty(key, hash);
  });
  opsDropBlankFirstSheet_(ss);
}

function opsStaffFile_() {
  if (OPS.STAFF_FILE_ID) return SpreadsheetApp.openById(OPS.STAFF_FILE_ID);
  return opsTestFile_('OPS_TEST_STAFF_ID', 'スタッフ用の名簿（自動・テスト）');
}

/** テスト用のファイルを開く（無ければ作る） */
function opsTestFile_(prop, title) {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty(prop);
  if (id) {
    try { return SpreadsheetApp.openById(id); } catch (err) { /* 消されていたら作り直す */ }
  }
  const ss = SpreadsheetApp.create(title);
  props.setProperty(prop, ss.getId());
  return ss;
}

function opsWriteGrid_(sheet, grid) {
  const R = grid.cells.length, W = grid.width;
  sheet.getRange(1, 1, sheet.getMaxRows(), sheet.getMaxColumns()).breakApart();
  sheet.clear();
  sheet.clearNotes();
  if (sheet.getMaxRows() < R) sheet.insertRowsAfter(sheet.getMaxRows(), R - sheet.getMaxRows());
  if (sheet.getMaxColumns() < W) sheet.insertColumnsAfter(sheet.getMaxColumns(), W - sheet.getMaxColumns());
  const pick = (f, dflt, map) => grid.cells.map(row => row.map(c => {
    const v = c[f] === undefined || c[f] === null || c[f] === '' ? dflt : c[f];
    return map ? map(v) : v;
  }));
  const range = sheet.getRange(1, 1, R, W);
  range.setNumberFormat('@'); // "20:30" などを時刻にしない
  range.setValues(pick('v', ''));
  range.setBackgrounds(pick('bg', OPS_COLOR.white));
  range.setFontColors(pick('color', OPS_COLOR.ink));
  range.setFontWeights(pick('bold', false, b => b ? 'bold' : 'normal'));
  range.setFontLines(pick('strike', false, b => b ? 'line-through' : 'none'));
  range.setFontSizes(pick('size', 10));
  range.setHorizontalAlignments(pick('align', 'center'));
  range.setWraps(pick('wrap', false, b => !!b));
  range.setNotes(pick('note', ''));
  range.setVerticalAlignment('middle');
  // 名前に生徒の行へのリンクを付ける（付けられなくても一覧表はそのまま使える）
  try {
    range.setRichTextValues(grid.cells.map(row => row.map(c => {
      const text = String(c.v == null ? '' : c.v);
      const b = SpreadsheetApp.newRichTextValue().setText(text);
      if (!text) return b.build();
      b.setTextStyle(SpreadsheetApp.newTextStyle().setForegroundColor(c.color || OPS_COLOR.ink).setBold(!!c.bold)
        .setStrikethrough(!!c.strike).setUnderline(false).setFontSize(c.size || 10).build());
      if (c.link) b.setLinkUrl(c.link);
      return b.build();
    })));
  } catch (err) {
    console.warn('リンクを付けられませんでした: ' + err);
  }
  grid.merges.forEach(([r, c, nr, nc]) => sheet.getRange(r, c, nr, nc).merge());
  const top = 6; // 見出し・凡例の下から罫線
  if (R >= top) sheet.getRange(top, 1, R - top + 1, W).setBorder(true, true, true, true, true, true, OPS_COLOR.line, SpreadsheetApp.BorderStyle.SOLID);
  sheet.setColumnWidth(1, 70);
  for (let c = 2; c <= W; c++) sheet.setColumnWidth(c, 104);
}

function opsTab_(ss, name, index) {
  return ss.getSheetByName(name) || ss.insertSheet(name, Math.min(index, ss.getSheets().length));
}

/** テスト用に新しく作ったファイルの、空の「シート1」を消す */
function opsDropBlankFirstSheet_(ss) {
  ['シート1', 'Sheet1'].forEach(name => {
    const sh = ss.getSheetByName(name);
    if (sh && sh.getLastRow() === 0 && ss.getSheets().length > 1) ss.deleteSheet(sh);
  });
}

function opsBoardFile_() {
  if (OPS.BOARD_FILE_ID) return SpreadsheetApp.openById(OPS.BOARD_FILE_ID);
  return opsTestFile_('OPS_TEST_BOARD_ID', 'Class Structure（自動・テスト）');
}


/* ======================= 月の記録 ======================= */

/** 今月の一覧表を、記録のタブ（あとから直さない）とPDFに残す。manual はメニューから */
function opsRecordMonth_(manual) {
  const data = opsData_();
  const ss = opsBoardFile_();
  const month = opsMonth_(data.today, 0);
  const now = new Date();
  const base = String(month.y).slice(2) + OPS_MONTHS[month.m - 1];
  let name = base + (manual ? '（' + Utilities.formatDate(now, OPS.TZ, 'M月d日') + '）' : '（自動）');
  if (ss.getSheetByName(name)) {
    if (!manual) return null; // 月末の自動は1回だけ
    let i = 2;
    while (ss.getSheetByName(name + '-' + i)) i++;
    name = name + '-' + i;
  }
  const sheet = ss.insertSheet(name, Math.min(2, ss.getSheets().length));
  const grid = opsBoardGrid_(data, month, '記録：' + month.y + '年' + month.m + '月');
  grid.cells[1][0].v = Utilities.formatDate(now, OPS.TZ, 'yyyy/M/d HH:mm') + ' 時点の一覧表（記録なので、あとから変わりません）';
  opsWriteGrid_(sheet, grid);
  opsDropBlankFirstSheet_(ss);
  const pdf = opsRecordFolder_().createFile(opsSheetPdf_(ss, sheet, 'Class Structure ' + name));
  return { url: ss.getUrl() + '#gid=' + sheet.getSheetId(), pdfUrl: pdf.getUrl() };
}

function opsRecordFolder_() {
  const props = PropertiesService.getScriptProperties();
  const id = props.getProperty('OPS_RECORD_FOLDER_ID');
  if (id) {
    try { return DriveApp.getFolderById(id); } catch (err) { /* 消されていたら作り直す */ }
  }
  const name = OPS.RECORD_FOLDER + (OPS.BOARD_FILE_ID ? '' : '（テスト）');
  const found = DriveApp.getFoldersByName(name);
  const folder = found.hasNext() ? found.next() : DriveApp.createFolder(name);
  props.setProperty('OPS_RECORD_FOLDER_ID', folder.getId());
  return folder;
}

function opsSheetPdf_(ss, sheet, name) {
  SpreadsheetApp.flush();
  const url = 'https://docs.google.com/spreadsheets/d/' + ss.getId() + '/export?format=pdf&gid=' + sheet.getSheetId() +
    '&size=A4&portrait=false&fitw=true&gridlines=false&printtitle=false&sheetnames=false&pagenum=UNDEFINED&fzr=false';
  const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + ScriptApp.getOAuthToken() }, muteHttpExceptions: true });
  if (res.getResponseCode() !== 200) throw new Error('PDFを作れませんでした（' + res.getResponseCode() + '）');
  return res.getBlob().setName(name + '.pdf');
}


/* ======================= 生徒シートの自動の書き込み ======================= */

/** 最終日を過ぎた生徒のステータスを「退会」にする */
function opsRetirePast_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = opsTodayKey_();
  [OPS.SHEET_JP, OPS.SHEET_INTL].forEach(name => {
    const t = opsTable_(ss.getSheetByName(name));
    const cs = t.col['ステータス'];
    if (cs === undefined || t.col['最終日'] === undefined) return;
    t.rows.forEach(r => {
      const end = opsKey_(r['最終日']);
      if (end && end < today && OPS.SEAT_STATUSES.indexOf(String(r['ステータス']).trim()) !== -1) {
        t.sheet.getRange(r._row, cs + 1).setValue('退会');
      }
    });
  });
}

/** 支払待ち・在籍で Wixパスワード が空なら作る／海外生の Display name が空なら名前から作る／席番号が空なら空いている番号を入れる */
function opsFillDefaults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const active = ['新規', '提案中', '支払待ち', '在籍', '休会', '空き待ち'];
  const today = opsTodayKey_();
  [[OPS.SHEET_JP, 'jp'], [OPS.SHEET_INTL, 'intl']].forEach(([name, region]) => {
    const t = opsTable_(ss.getSheetByName(name));
    const cp = t.col['Wixパスワード'], cd = t.col['Display name'], cs = t.col['席番号'];
    if (cs !== undefined) {
      opsAssignSeats_(t.rows, region, today).forEach(([r, seat]) => t.sheet.getRange(r._row, cs + 1).setValue(seat));
    }
    t.rows.forEach(r => {
      const st = String(r['ステータス'] || '').trim();
      if (cp !== undefined && (st === '支払待ち' || st === '在籍') && !String(r['Wixパスワード'] || '').trim()) {
        t.sheet.getRange(r._row, cp + 1).setNumberFormat('@').setValue(opsNewPassword_());
      }
      if (region === 'intl' && cd !== undefined && active.indexOf(st) !== -1 &&
          !String(r['Display name'] || '').trim() && String(r['名前'] || '').trim()) {
        t.sheet.getRange(r._row, cd + 1).setValue(opsShortName_(r['名前']));
      }
    });
  });
}

/**
 * 席番号が空の生徒に、そのクラスで空いている一番小さい番号を割り当てる（日本生 JP-01〜、海外生 ID-01〜）。
 * 対象は席に出るステータスで、最終日を過ぎていない生徒。[行, 席番号] の並びを返す
 */
function opsAssignSeats_(rows, region, today) {
  const prefix = region === 'jp' ? 'JP-' : 'ID-';
  const live = rows.filter(r => OPS.SEAT_STATUSES.indexOf(String(r['ステータス'] || '').trim()) !== -1 &&
    String(r['クラス'] || '').trim() && !(opsKey_(r['最終日']) && opsKey_(r['最終日']) < today));
  const used = {};
  live.forEach(r => {
    const n = opsSeatNo_(r['席番号']);
    if (n) (used[String(r['クラス']).trim()] = used[String(r['クラス']).trim()] || {})[n] = true;
  });
  const out = [];
  live.filter(r => !String(r['席番号'] || '').trim())
    .sort((a, b) => (opsKey_(a['開始日']) || 0) - (opsKey_(b['開始日']) || 0) || a._row - b._row)
    .forEach(r => {
      const cls = String(r['クラス']).trim();
      const u = used[cls] = used[cls] || {};
      let n = 1;
      while (u[n]) n++;
      u[n] = true;
      out.push([r, prefix + ('0' + n).slice(-2)]);
    });
  return out;
}

/** 打ち間違えにくい文字だけで8文字（td＋6文字） */
function opsNewPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'td';
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** "Putri Anggraini" → "Putri A." */
function opsShortName_(name) {
  const p = String(name).trim().split(/\s+/);
  if (p.length < 2) return p[0] || '';
  return p[0] + ' ' + p[p.length - 1].charAt(0).toUpperCase() + '.';
}


/* ======================= 見張りメール ======================= */

/** 対応が要るものを {title, lines} の並びで返す（無い項目は出さない） */
function opsWatchItems_(data) {
  const T = data.today, S = data.students, CAP = OPS.CAPACITY, md = opsMd_;
  const who = s => s.name + '（' + s.id + (s.cls ? '・' + s.cls : '') + '）';
  const items = [];
  const add = (title, lines) => { if (lines.length) items.push({ title, lines }); };
  const live = s => s.status === '支払待ち' || s.status === '在籍';

  add('新規のまま3日以上（受付の返信がまだ）',
    S.filter(s => s.status === '新規' && s.applied && s.applied <= opsAddDays_(T, -3)).map(s => who(s) + ' 申込 ' + md(s.applied)));
  add('提案中で、開始日まで7日を切った（返事を確かめる）',
    S.filter(s => s.status === '提案中' && (!s.start || s.start <= opsAddDays_(T, 7))).map(s => who(s) + ' ' + (s.start ? md(s.start) + 'から' : '開始日が空')));
  add('支払待ちのまま開始日を過ぎた（日本生）',
    S.filter(s => s.region === 'jp' && s.status === '支払待ち' && s.start && s.start < T).map(s => who(s) + ' ' + md(s.start) + 'から'));
  add('海外生の支払い',
    S.filter(s => s.region === 'intl' && live(s) && !(s.end && s.end < T)).map(s => {
      if (!s.paid) return s.start && s.start <= opsAddDays_(T, -14) ? who(s) + ' ' + md(s.start) + 'から・まだ' : '';
      if (s.paid < T) return who(s) + ' ' + md(s.paid) + 'で切れた';
      if (s.paid <= opsAddDays_(T, 14)) return who(s) + ' ' + md(s.paid) + 'で切れる';
      return '';
    }).filter(Boolean));
  add('Display name が空（日本生）', S.filter(s => s.region === 'jp' && live(s) && !s.hasDisplay).map(who));

  const diffs = [], waits = [], lp = [];
  [['今月', 0], ['来月', 1]].forEach(([label, add1]) => {
    const p = opsPlace_(data, opsMonth_(T, add1));
    Object.keys(p.slots).forEach(id => {
      const sl = p.slots[id], n = opsCount_(sl), diff = Math.abs(n.jp - n.intl);
      if (diff >= OPS.DIFF_ALERT) diffs.push(label + ' ' + id + '（日本' + n.jp + '・海外' + n.intl + '）');
      if (add1 !== 1) return;
      if (sl.waitJp && n.jp < CAP) waits.push(id + '：日本生の空き' + (CAP - n.jp) + '・空き待ち' + sl.waitJp + '人');
      if (sl.waitIntl && n.intl < CAP) waits.push(id + '：海外生の空き' + (CAP - n.intl) + '・空き待ち' + sl.waitIntl + '人');
      [['lpJp', '日本', n.jp], ['lpIntl', '海外', n.intl]].forEach(([k, lab, cnt]) => {
        const v = sl.cls[k];
        if (!v || v === '非表示') return;
        if (v === '満席' && cnt < CAP) lp.push(id + '（' + lab + '）：LPは満席、来月の空き' + (CAP - cnt));
        if (v !== '満席' && cnt >= CAP) lp.push(id + '（' + lab + '）：LPは' + v + '、来月は満席');
      });
    });
  });
  add('日本生と海外生の差が' + OPS.DIFF_ALERT + '名以上', diffs);
  add('空き待ちの人がいて、来月空きがあるクラス', waits);
  add('来週が初回（日本生にはリマインド）',
    S.filter(s => live(s) && s.start && s.start > T && s.start <= opsAddDays_(T, 7)).map(s => who(s) + ' ' + md(s.start)));
  add('この1週間に、最終日を過ぎて「退会」にした',
    S.filter(s => s.status === '退会' && s.end && s.end < T && s.end >= opsAddDays_(T, -7)).map(s => who(s) + ' 最終日 ' + md(s.end)));
  add('LPの空き状況が人数と合っていない（来月の人数で比べています）', lp);
  // タームは12回。11回目の週を過ぎたら、次のタームの番号と開始日をクラス一覧に入れてもらう
  const m0 = opsMonth_(T, 0);
  add('そろそろ次のターム（クラス一覧の「ターム」と「ターム開始日」を直す）',
    data.classes.map(c => {
      const d = opsTermStart_(c, m0);
      if (!d || opsAddDays_(d, (OPS.TERM_WEEKS - 2) * 7) > T) return '';
      return c.id + '：Term ' + (c.termNo || '?') + '（' + md(d) + '〜）→ 次は Term ' + (c.termNo ? Number(c.termNo) + 1 : '?');
    }).filter(Boolean));
  add('クラス一覧のタームか開始日が空', data.classes.filter(c => !c.termNo || !opsTermStart_(c, m0)).map(c => c.id));
  add('クラスの欄を確かめる', opsPlace_(data, m0).problems.map(p => who(p.st) + ' ' + p.why));
  // 同じクラス・同じ席番号の生徒が2人いる（スライドの交流テーブルがずれる）
  const seen = {}, dup = [];
  S.filter(s => OPS.SEAT_STATUSES.indexOf(s.status) !== -1 && s.cls && s.seat && !(s.end && s.end < T)).forEach(s => {
    const k = s.cls + '|' + s.region + '|' + opsSeatNo_(s.seat);
    if (seen[k]) dup.push(s.cls + ' ' + s.seat + '：' + seen[k].name + ' と ' + s.name); else seen[k] = s;
  });
  add('同じ席番号の生徒が2人いる（どちらかの席番号を直す）', dup);
  return items;
}

function opsSendWatch_(items) {
  const to = OPS.MAIL_TO || Session.getEffectiveUser().getEmail();
  const body = (items.length
    ? items.map(it => '■ ' + it.title + '\n' + it.lines.map(l => '・' + l).join('\n')).join('\n\n')
    : '今週、対応が要るものはありません。') +
    '\n\n―――\nClass Structure（自動）: ' + opsBoardFile_().getUrl() +
    '\nこのメールは「TDEN 生徒管理」の Ops.gs が毎週月曜の朝に送っています。';
  MailApp.sendEmail(to, OPS.MAIL_SUBJECT + '今週の対応（' + opsMd_(opsTodayKey_()) + '）', body);
  return to;
}


/* ======================= 列の整理（最初に1回） ======================= */

function opsSetupColumns() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('列を整理します',
    '生徒_JP・生徒_海外の列を、使う場面ごとに並べ替えます。足りない列（最終日など）は足し、申込の時だけ見る列は畳み、ステータスで行に色を付けます。' +
    'クラス一覧の「ターム・開始日」は「ターム」と「ターム開始日」に分けます。' +
    '中身は消しません（日本の「国」「WhatsApp」は、空か Japan だけの時に限り列ごと消します）。進めますか？', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = Object.keys(OPS_LAYOUT).map(name => {
    const sheet = ss.getSheetByName(name);
    return sheet ? name + '：' + opsArrangeSheet_(sheet, OPS_LAYOUT[name], ss).join('、') : name + '：シートが無い';
  });
  const classes = ss.getSheetByName(OPS.SHEET_CLASSES);
  if (classes) report.push(OPS.SHEET_CLASSES + '：' + opsArrangeClasses_(classes).join('、'));
  ui.alert('列を整理しました', report.join('\n\n'), ui.ButtonSet.OK);
}

function opsHead_(sheet) {
  return sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim());
}

/** 1枚のシートの列を整理する。やったことを短い文の並びで返す */
function opsArrangeSheet_(sheet, layout, ss) {
  const notes = [];
  let head = opsHead_(sheet);

  Object.keys(OPS_RENAME).forEach(from => {
    const to = OPS_RENAME[from], i = head.indexOf(from);
    if (i !== -1 && head.indexOf(to) === -1) {
      sheet.getRange(1, i + 1).setValue(to);
      notes.push('「' + from + '」を「' + to + '」に');
    }
  });
  head = opsHead_(sheet);

  layout.drop.forEach(name => {
    const i = head.indexOf(name);
    if (i === -1) return;
    const last = sheet.getLastRow();
    const vals = last > 1 ? sheet.getRange(2, i + 1, last - 1, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
    if (vals.every(v => v === '' || v === 'Japan')) {
      sheet.deleteColumn(i + 1);
      notes.push('「' + name + '」を消した');
      head = opsHead_(sheet);
    } else {
      notes.push('「' + name + '」は中身があるので残した');
    }
  });

  const missing = layout.order.filter(h => head.indexOf(h) === -1);
  if (missing.length) {
    const last = sheet.getLastColumn();
    if (sheet.getMaxColumns() < last + missing.length) sheet.insertColumnsAfter(sheet.getMaxColumns(), last + missing.length - sheet.getMaxColumns());
    sheet.getRange(1, last + 1, 1, missing.length).setValues([missing]);
    notes.push(missing.map(h => '「' + h + '」').join('') + 'を足した');
    head = opsHead_(sheet);
  }

  // 列ごと動かすので、中身・書式・入力規則も一緒に動く。並びに無い列は右端に残る
  let moved = 0;
  layout.order.forEach((name, target) => {
    const cur = head.indexOf(name);
    if (cur === target) return;
    sheet.moveColumns(sheet.getRange(1, cur + 1), target + 1);
    head.splice(cur, 1);
    head.splice(target, 0, name);
    moved++;
  });
  if (moved) notes.push(moved + '列を並べ替えた');

  const fold = head.indexOf(OPS_FOLD_FROM);
  if (fold !== -1 && sheet.getColumnGroupDepth(fold + 1) === 0) {
    const n = layout.order.length - fold;
    sheet.setColumnGroupControlPosition(SpreadsheetApp.GroupControlTogglePosition.BEFORE);
    sheet.getRange(1, fold + 1, 1, n).shiftColumnGroupDepth(1);
    sheet.getColumnGroup(fold + 1, 1).collapse();
    notes.push('申込の時だけ見る' + n + '列を畳んだ');
  }

  sheet.setFrozenRows(1);
  sheet.setFrozenColumns(2);
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  const col = h => head.indexOf(h) + 1;
  if (col('ステータス')) {
    sheet.getRange(2, col('ステータス'), rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(OPS.STATUSES, true).setAllowInvalid(false).build());
  }
  const classes = ss.getSheetByName(OPS.SHEET_CLASSES);
  const gid = classes ? opsHead_(classes).indexOf('Group ID') + 1 : 0;
  if (col('クラス') && gid) {
    // コンボ（2クラス）を書けるよう、一覧に無い値も警告だけで受け付ける
    sheet.getRange(2, col('クラス'), rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(classes.getRange(2, gid, Math.max(classes.getMaxRows() - 1, 1), 1), true).setAllowInvalid(true).build());
  }
  OPS_DATE_COLS.forEach(h => {
    if (!col(h)) return;
    const fixed = opsDateColumn_(sheet, col(h));
    if (fixed) notes.push('「' + h + '」の文字の日付' + fixed + '件を日付に');
  });
  if (col('Wixパスワード')) sheet.getRange(2, col('Wixパスワード'), rows, 1).setNumberFormat('@');
  if (opsStatusColors_(sheet)) notes.push('ステータスで行に色を付けた');
  return notes.length ? notes : ['変更なし'];
}

/** 日付の列にする（文字で入っている日付は入れ直す。カレンダーで選べるように）。直した件数を返す */
function opsDateColumn_(sheet, c) {
  const range = sheet.getRange(2, c, Math.max(sheet.getMaxRows() - 1, 1), 1);
  range.setNumberFormat('yyyy/mm/dd');
  let fixed = 0;
  range.getValues().forEach((r, i) => {
    if (typeof r[0] === 'string' && /^\d{4}[\/\-.]\d{1,2}[\/\-.]\d{1,2}$/.test(r[0].trim())) {
      sheet.getRange(i + 2, c).setValue(r[0].trim().replace(/[\-.]/g, '/'));
      fixed++;
    }
  });
  range.setDataValidation(SpreadsheetApp.newDataValidation().requireDate().setAllowInvalid(true).build());
  return fixed;
}

/** ステータスで行に色を付ける（前に付けた Ops の色は付け直す。自分で付けた条件付き書式は残す）。付けたら true */
function opsStatusColors_(sheet) {
  const c = opsHead_(sheet).indexOf('ステータス') + 1;
  if (!c) return false;
  let letter = '', n = c;
  while (n) { const r = (n - 1) % 26; letter = String.fromCharCode(65 + r) + letter; n = Math.floor((n - 1) / 26); }
  const mine = /^=OR\(\$[A-Z]+2="/;
  const keep = sheet.getConditionalFormatRules().filter(rule => {
    const cond = rule.getBooleanCondition();
    const f = cond && cond.getCriteriaValues && cond.getCriteriaValues()[0];
    return !(typeof f === 'string' && mine.test(f));
  });
  const range = sheet.getRange(2, 1, Math.max(sheet.getMaxRows() - 1, 1), Math.max(sheet.getMaxColumns(), 1));
  const added = OPS_STATUS_COLORS.map(s => {
    let b = SpreadsheetApp.newConditionalFormatRule()
      .whenFormulaSatisfied('=OR(' + s.statuses.map(v => '$' + letter + '2="' + v + '"').join(',') + ')')
      .setRanges([range]);
    if (s.bg) b = b.setBackground(s.bg);
    if (s.font) b = b.setFontColor(s.font);
    return b.build();
  });
  sheet.setConditionalFormatRules(keep.concat(added));
  return true;
}

/** クラス一覧の「ターム・開始日」を「ターム」（1〜6）と「ターム開始日」に分ける */
function opsArrangeClasses_(sheet) {
  const notes = [];
  let head = opsHead_(sheet);
  const old = head.indexOf('ターム・開始日');
  if (head.indexOf('ターム') === -1 && head.indexOf('ターム開始日') === -1 && old !== -1) {
    const last = sheet.getLastRow();
    const texts = last > 1 ? sheet.getRange(2, old + 1, last - 1, 1).getDisplayValues().map(r => String(r[0]).trim()) : [];
    sheet.insertColumnsAfter(old + 1, 1); // 古い列の右に「ターム開始日」
    sheet.getRange(1, old + 1).setValue('ターム');
    sheet.getRange(1, old + 2).setValue('ターム開始日');
    const month = opsMonth_(opsTodayKey_(), 0);
    let unread = 0;
    texts.forEach((t, i) => {
      if (!t) return;
      const no = (t.match(/Term\s*(\d+)/i) || [])[1] || '';
      const d = opsFindDate_(t, month);
      sheet.getRange(i + 2, old + 1).setValue(no);
      // 日付が読めない時は、元の文字をそのまま残す（消さない）
      sheet.getRange(i + 2, old + 2).setValue(d ? Math.floor(d / 10000) + '/' + (Math.floor(d / 100) % 100) + '/' + (d % 100) : t);
      if (!no || !d) unread++;
    });
    notes.push('「ターム・開始日」を「ターム」と「ターム開始日」に分けた' + (unread ? '（読めなかった' + unread + '行は、ターム開始日を入れてください）' : ''));
    head = opsHead_(sheet);
  }
  const ct = head.indexOf('ターム') + 1, cd = head.indexOf('ターム開始日') + 1;
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  if (ct) sheet.getRange(2, ct, rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['1', '2', '3', '4', '5', '6'], true).setAllowInvalid(true).build());
  if (cd) opsDateColumn_(sheet, cd);
  return notes.length ? notes : ['変更なし'];
}


/* ======================= 旧名簿から今の生徒を取り込む（最初に1回） ======================= */

// 旧名簿のクラス別シートの列（1行目の名前で探し、見つからなければこの位置）
const OPS_OLD_COLS = {
  seat: { names: ['Student ID'], at: 1 }, display: { names: ['Display name'], at: 2 }, full: { names: ['Full name'], at: 3 },
  sex: { names: ['Gender'], at: 4 }, email: { names: ['Email (Google Account)', 'Email'], at: 5 }, notes: { names: ['Notes (if any)', 'Notes'], at: 6 },
  grade: { names: ['学年'], at: 7 }, school: { names: ['School'], at: 8 }, wa: { names: ['海外生WA'], at: 9 }, password: { names: ['Password'], at: 10 },
};
// Japanese Applicants（旧GASの転記先。日本生も海外生も入っている）の列
const OPS_APPLICANT_COLS = {
  applied: { names: ['申込日時'], at: 3 }, via: { names: ['経由'], at: 4 }, name: { names: ['名前'], at: 5 }, country: { names: ['国名'], at: 6 },
  sex: { names: ['性別'], at: 7 }, email: { names: ['Eメール', 'Email', 'メール'], at: 8 }, level: { names: ['英語レベル'], at: 9 },
  grade: { names: ['学年'], at: 10 }, school: { names: ['学校名'], at: 11 }, phone: { names: ['電話番号', '電話'], at: 12 },
  comment: { names: ['ご要望など'], at: 16 },
};

function opsImportOld() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = { jp: ss.getSheetByName(OPS.SHEET_JP), intl: ss.getSheetByName(OPS.SHEET_INTL) };
  if (['jp', 'intl'].some(r => ['クラス', '席番号'].some(h => opsHead_(sheets[r]).indexOf(h) === -1))) {
    ui.alert('先にメニューの「列を整理する（最初に1回）」を押してください（「クラス」「席番号」の列が要ります）。');
    return;
  }
  const ok = ui.alert('旧名簿から今の生徒を取り込みます',
    '旧名簿のクラス別シート（クラス一覧にあるクラスだけ）から、空の行までの生徒を読み、生徒_JP・生徒_海外に「在籍」で入れます。' +
    '申込日時・電話・経由などは Japanese Applicants から探します。すでにある生徒（メールか名前が同じ）は、クラスと席番号を書き足します。' +
    '最後に全体を申込順に並べ直し、生徒IDも申込順に振り直します（今のIDも変わります）。旧名簿は読むだけで、書き換えません。進めますか？', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  const old = opsOldFile_();
  const ja = old.getSheetByName(OPS.OLD_APPLICANTS_SHEET);
  const ledger = {};
  ['jp', 'intl'].forEach(r => { ledger[r] = opsReadWithFormulas_(sheets[r]); });
  const res = opsImportMerge_({
    classIds: opsData_().classes.map(c => c.id),
    sheets: old.getSheets().filter(sh => sh.getName() !== OPS.OLD_APPLICANTS_SHEET).map(sh => ({ name: sh.getName(), values: sh.getDataRange().getValues() })),
    applicants: ja ? ja.getDataRange().getValues() : [[]],
    ledger,
  });
  ['jp', 'intl'].forEach(r => {
    const head = ledger[r].head, sheet = sheets[r];
    const out = res[r].map(row => head.map(h => row[h] === undefined || row[h] === null ? '' : row[h]));
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, head.length).clearContent();
    if (out.length) sheet.getRange(2, 1, out.length, head.length).setValues(out);
  });
  const rp = res.report;
  ui.alert('取り込みました', [
    '新しく入れた生徒：' + rp.added + '人　／　すでにあった生徒に書き足した：' + rp.updated + '人',
    rp.noDate.length ? 'Japanese Applicants に見つからず、申込日時が空の生徒（いちばん上に入れました）：' + rp.noDate.join('、') : '',
    rp.twice.length ? '2つのクラスシートにいた生徒（最初のクラスだけ入れました）：' + rp.twice.join('、') : '',
    rp.skipped.length ? 'クラス一覧に無いので読まなかったシート：' + rp.skipped.join('、') : '',
    rp.missing.length ? '旧名簿にシートが無かったクラス：' + rp.missing.join('、') : '',
    '次は「一覧表を今すぐ作り直す」。取り込んだ生徒は、開始日・最終日（海外は支払い済み〜も）が空なので、分かる所から入れてください。',
  ].filter(Boolean).join('\n\n'), ui.ButtonSet.OK);
}

function opsOldFile_() {
  if (OPS.OLD_FILE_ID) return SpreadsheetApp.openById(OPS.OLD_FILE_ID);
  const id = PropertiesService.getScriptProperties().getProperty('OPS_TEST_OLD_ID');
  if (!id) throw new Error('旧名簿のスプシIDが入っていません（Ops.gs の OLD_FILE_ID）');
  return SpreadsheetApp.openById(id);
}

/** 生徒シートを {列名: 値} で読む。数式（WhatsApp のリンク）は数式のまま持つ */
function opsReadWithFormulas_(sheet) {
  const range = sheet.getDataRange();
  const values = range.getValues(), formulas = range.getFormulas();
  const head = values[0].map(h => String(h).trim());
  const rows = values.slice(1).map((v, i) => {
    const r = {};
    head.forEach((h, j) => { if (h) r[h] = formulas[i + 1][j] || v[j]; });
    return r;
  }).filter(r => head.some(h => h && String(r[h]).trim() !== ''));
  return { head, rows };
}

/** 表（1行目＝列名）を、決めた項目名の行に読み替える */
function opsReadAs_(values, cols) {
  const head = (values[0] || []).map(h => String(h).trim());
  const idx = {};
  Object.keys(cols).forEach(k => {
    const i = cols[k].names.map(n => head.indexOf(n)).filter(i => i !== -1)[0];
    idx[k] = i !== undefined ? i : cols[k].at;
  });
  return values.slice(1).map(v => {
    const o = {};
    Object.keys(idx).forEach(k => {
      const x = v[idx[k]];
      o[k] = x instanceof Date ? Utilities.formatDate(x, OPS.TZ, 'yyyy/MM/dd HH:mm:ss') : String(x == null ? '' : x).trim();
    });
    return o;
  });
}

/**
 * 旧名簿の今の生徒を、生徒シートの行に合わせる（シートには書かない）。
 * 返す行は申込順（申込日時が分からない生徒がいちばん上）で、生徒IDも申込順に振り直してある
 */
function opsImportMerge_(input) {
  const report = { added: 0, updated: 0, noDate: [], twice: [], skipped: [], missing: [] };
  const lower = v => String(v || '').trim().toLowerCase();
  const classOf = {};
  input.classIds.forEach(id => { classOf[lower(id)] = id; });
  const apps = opsReadAs_(input.applicants, OPS_APPLICANT_COLS).filter(a => a.name || a.email);
  const findApps = (email, name) => apps.filter(a => (email && lower(a.email) === lower(email)) || (name && a.name === name));
  const rows = { jp: input.ledger.jp.rows.slice(), intl: input.ledger.intl.rows.slice() };
  const done = {}, seenClass = {};

  input.sheets.forEach(sh => {
    const id = classOf[lower(sh.name)];
    if (!id) { report.skipped.push(sh.name); return; }
    seenClass[id] = true;
    const list = opsReadAs_(sh.values, OPS_OLD_COLS);
    for (const o of list) {
      if (!o.display && !o.full) break; // 空の行から下は、やめた生徒
      const found = findApps(o.email, o.full);
      const first = found.slice().sort((a, b) => (a.applied < b.applied ? -1 : 1))[0] || {};
      const last = found[found.length - 1] || {};
      const region = /^JP/i.test(o.seat) ? 'jp' : /^ID/i.test(o.seat) ? 'intl' : (last.country && last.country !== 'Japan' ? 'intl' : 'jp');
      const key = lower(o.email) || o.full || o.display;
      if (done[key]) { report.twice.push((o.full || o.display) + '（' + done[key] + '・' + id + '）'); continue; }
      done[key] = id;
      const hit = rows[region].filter(r => (o.email && lower(r['Email']) === lower(o.email)) || (o.full && r['名前'] === o.full))[0];
      if (hit) {
        hit['クラス'] = id;
        hit['席番号'] = o.seat;
        if (['', '新規', '提案中', '支払待ち', '空き待ち', '見送り'].indexOf(String(hit['ステータス'] || '')) !== -1) hit['ステータス'] = '在籍';
        if (!hit['Display name']) hit['Display name'] = o.display;
        if (!hit['Wixパスワード']) hit['Wixパスワード'] = o.password;
        if (!hit['英語レベル']) hit['英語レベル'] = o.notes || last.level || '';
        report.updated++;
        continue;
      }
      rows[region].push({
        '申込日時': first.applied || '', '経由': last.via || '旧名簿', 'ステータス': '在籍',
        '国': region === 'intl' ? (last.country || '') : 'Japan',
        '名前': o.full || last.name || o.display, 'Display name': o.display, '性別': o.sex || last.sex, '学年': o.grade || last.grade,
        '学校名': o.school || last.school, 'Email': o.email || last.email,
        '電話': region === 'intl' ? (o.wa || last.phone || '') : (last.phone || ''),
        '英語レベル': o.notes || last.level || '', 'コメント': last.comment || '',
        'クラス': id, '席番号': o.seat, 'Wixパスワード': o.password, 'メモ': '旧名簿から取り込み',
      });
      report.added++;
      if (!first.applied) report.noDate.push(o.full || o.display);
    }
  });
  input.classIds.forEach(id => { if (!seenClass[id]) report.missing.push(id); });

  const key = r => r['申込日時'] instanceof Date ? Utilities.formatDate(r['申込日時'], OPS.TZ, 'yyyy/MM/dd HH:mm:ss') : String(r['申込日時'] || '');
  const out = {};
  [['jp', 'J'], ['intl', 'G']].forEach(([r, prefix]) => {
    out[r] = rows[r].slice().sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
      .map((row, i) => Object.assign(row, { '生徒ID': prefix + ('000' + (i + 1)).slice(-4) }));
  });
  out.report = report;
  return out;
}

