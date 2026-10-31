/***** TD留学 台帳の自動化（Ops） *****
 *
 * スプシ「TDEN 生徒管理」の Apps Script に、Code.gs とは別のファイルとして置く。
 * テスト用のスプシでは、このファイルだけで動く（Code.gs は要らない）。
 *
 * 台帳（生徒管理スプシ）
 *  - 生徒_JP／生徒_海外 … 1人1行。ステータス・名前・連絡先など。「受講中のクラス」は自動
 *  - 受講 … 1行＝1人×1クラス（生徒ID・クラス・席番号・開始日・最終日）。スタンダード2つ＋GAP など何クラスでも書ける
 *  - クラス一覧 … 1クラス1行（Class ID＝曜日＋時刻＋講師コード、状態 active／non-active、種別 Standard／GAP、講師・アシスタント、ターム）
 *  - 講師 … 講師・アシスタントの名前・コード・カタカナ
 *
 * 役割
 *  1. 一覧表 … あなた用（生徒管理の「一覧表_今月(10月)／来月(11月)」。名前を押すと生徒の行が開く）、Class Structure（スタッフ・講師用・リンク無し）、
 *               スタッフ用の名簿（クラス別シート・席番号順・講師とアシスタント・(admin)・足りない情報は赤）を作る
 *  2. 5分おき … 一覧表を作り直す（中身が変わった時だけ）／受講の席番号が空なら空いている番号を入れる／すべてのクラスを去った生徒を「退会」にする／
 *               支払待ち・在籍で「Wixパスワード」が空なら作る（GAPだけの生徒は作らない）／「Display name」が空でアルファベットの名前なら作る（Go A.）
 *  3. 月の記録 … 月末に、今月の一覧表を「26Nov」のようなタブに写し（Class Structure の自動のタブは「26Nov (live)」）、PDFをDriveの「TD 月の記録」に残す（メニューからいつでも）。
 *               毎晩、受講を曜日・時刻・クラス・席番号の順に並べ替える
 *  受講に生徒を足す時は、生徒_JP／生徒_海外で行を選んでメニュー「選んだ生徒を受講に追加」
 *  4. 見張りメール … 毎週月曜の朝、対応が要るものだけを送る
 *  5. 列の整理・旧名簿からの取り込み（最初に1回）
 *
 * 初回（手順は gas/README.md）
 *  - メニュー「TD台帳」→「列を整理する」→「旧名簿から今の生徒を取り込む」→「一覧表を今すぐ作り直す」→ よければ「自動の更新を始める」
 *
 * 注意
 *  - Code.gs と同じプロジェクトに入るので、関数・定数はすべて ops／OPS で始める（名前がぶつからないように）
 *  - メニュー・トリガーから呼ぶ関数は末尾に _ を付けない（_ 付きはメニュー・トリガーから呼べないため）
 */

const OPS = {
  // Class Structure のスプシID。空のあいだは「Class Structure（自動・テスト）」を新しく作って使う（テスト用）
  // Class Structure はスタッフ・講師も見るので、生徒管理へのリンクは付けない（生徒には見せない）
  BOARD_FILE_ID: '',
  // スタッフ用の名簿（クラス別シート。メール・パスワード入り。スタッフだけに共有）。空ならテスト用を新しく作る
  STAFF_FILE_ID: '',
  // 旧名簿（クラス別シートと申込の一覧があるスプシ）。本番で取り込む時だけ入れる。空ならテスト用のダミーを読む
  OLD_FILE_ID: '',
  // 旧名簿の申込の一覧（申込日時などを探す。クラス別シートとしては読まない）
  OLD_APPLICANTS_SHEETS: ['Japanese Applicants', 'Overseas Applicants'],
  SHEET_JP: '生徒_JP',
  SHEET_INTL: '生徒_海外',
  SHEET_ENROLL: '受講',
  SHEET_CLASSES: 'クラス一覧',
  SHEET_TEACHERS: '講師',
  TZ: 'Asia/Tokyo',

  CAPACITY: 5,       // 1クラスの定員（日本生・海外生それぞれ）
  DIFF_ALERT: 3,     // 日本生と海外生の差がこれ以上なら、一覧表で赤・見張りメールに出す
  TERM_WEEKS: 12,    // 1ターム＝12回（毎週1回）
  TEACHER_ORDER: ['Marina', 'Nerissa', 'Jomer'], // 一覧表の講師の並び（入社順）。ここに無い講師はクラス一覧に出てくる順で後ろに

  STATUSES: ['新規', '提案中', '支払待ち', '在籍', '休会', '退会', '見送り', '空き待ち'],
  // 海外生は期間で払うので「支払待ち」を使わない（払った期間は「支払い済みの最終日」で見る）
  STATUSES_INTL: ['新規', '提案中', '在籍', '休会', '退会', '見送り', '空き待ち'],
  SEAT_STATUSES: ['支払待ち', '在籍', '休会'], // 一覧表の席に出るステータス
  CLASS_STATES: ['active', 'non-active'],     // non-active＝閉じているが、LPには満席などで出しておくクラス

  // Class Structure の自動のタブは「26Oct (live)」のように月の名前で作る。月末の記録は「26Oct」（あとから変わらない）
  LIVE_SUFFIX: ' (live)',
  LEDGER_TAB_THIS: '一覧表_今月', // 生徒管理スプシの中の、あなた用の一覧表（名前を押すと生徒の行が開く）。タブ名は「一覧表_今月(10月)」
  LEDGER_TAB_NEXT: '一覧表_来月',
  RECORD_FOLDER: 'TD 月の記録',
  // 見張りメールの件名の頭。Code.gs の SEARCH_QUERY に一致しない文言にしておくこと
  MAIL_SUBJECT: '【TD週1チェック】',
  MAIL_TO: '', // 空なら、スクリプトを動かしている人（自分）に送る
};

// 一覧表の色。クラスの色（Ongoing 青・New Term 紫・New Class ピンク）と生徒の色（Before Payment オレンジ・New User 緑）が似ないように
const OPS_COLOR = {
  ongoing: '#c9dcf5', newterm: '#ddd0f2', newclass: '#f7cfe0',
  pay: '#fbd3a2', fresh: '#cfeac0', leave: '#e3e5e6', none: '#f6f7f7', head: '#eceeef',
  staff: '#eef1f5', gap: '#7a3db8', open: '#eeeff0', // open＝空席と人数の欄（名前のある席と見分ける）
  ink: '#1c2528', muted: '#6b777b', alert: '#b23a3a', white: '#ffffff', line: '#d2d9da', missing: '#f8e3e3',
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
    // 電話はクラス確定・支払いまでSMSを送るので、いつも見る所に
    order: ['生徒ID', '名前', 'ステータス', '受講中のクラス', '希望クラス', '希望開始日', '電話', 'メモ',
            'Display name', '性別', '学年', '英語レベル', '学校名', 'Email', 'Wixパスワード',
            '申込日時', '経由', '希望コース', '第1希望', '第2希望', '第3希望', 'コメント', '知ったきっかけ', '既存照合'],
    drop: ['国', 'WhatsApp'], // 日本の申込では空か Japan だけ。中身がある時は消さない
  },
  '生徒_海外': {
    // 電話（＝WhatsAppの番号）をいつも見る所に。右の「WhatsApp」は、定型文を入れてWhatsAppを開くボタン（Code.gs が作る）
    order: ['生徒ID', '名前', 'ステータス', '受講中のクラス', '希望クラス', '希望開始日', '支払い済みの最終日', '電話', 'WhatsApp', 'メモ',
            'Display name', '性別', '学年', '英語レベル', '学校名', 'Email', '国', 'Wixパスワード',
            '申込日時', '経由', '希望コース', '第1希望', '第2希望', '第3希望', 'コメント', '既存照合'],
    drop: [],
  },
};
const OPS_FOLD_FROM = '申込日時'; // ここから右（申込の時だけ見る列）を畳む
// 提案中・空き待ちの時のクラスと開始日（席が決まったら「受講」に書く）。Code.gs はこの2列を使っていない
const OPS_RENAME = { '提案クラス': '希望クラス', '開始日': '希望開始日', '支払い済み〜': '支払い済みの最終日' };
const OPS_STUDENT_DATES = ['希望開始日', '支払い済みの最終日'];
// 手で生徒を足す時に必ず書く列（見出しを濃い色に）。スタッフ用の名簿で赤になる列と同じ
const OPS_REQUIRED_HEAD = {
  '生徒_JP': ['名前', 'ステータス', 'Display name', '性別', '学年', '英語レベル', '学校名', 'Email', '電話'],
  '生徒_海外': ['名前', 'ステータス', '性別', '学年', '英語レベル', '学校名', 'Email', '電話', '国'],
};
// 自動で入る列（見出しを緑に）
const OPS_AUTO_HEAD = { '生徒_JP': ['生徒ID', '受講中のクラス', 'Wixパスワード'], '生徒_海外': ['生徒ID', '受講中のクラス', 'Display name', 'WhatsApp', 'Wixパスワード'] };
const OPS_HEAD_COLOR = { required: '#a9bfd8', auto: '#cfe8d8' };
// 1行目にカーソルを置くと出る説明
const OPS_HEAD_NOTES = {
  '生徒ID': '空なら自動（名前を書くと、次の番号 J0001／G0001… が入る）',
  '受講中のクラス': '自動（受講シートから）。直す時は受講シートを直す',
  '支払い済みの最終日': '払ってもらった期間の最後の日（3か月払いなら3か月後の前日、月払いならその月末など）。ダブルクリックでカレンダーから選べる。空か過ぎていると一覧表でオレンジ',
  'WhatsApp': '押すと定型文入りでWhatsAppが開く（申込の時に自動で作る）。番号は左の「電話」',
};
const OPS_ENROLL_HEAD = ['生徒ID', 'Display name', 'クラス', '席番号', '開始日', '最終日', 'メモ']; // Display name は自動（前の列名「名前」も読む）
const OPS_TEACHER_HEAD = ['名前', 'コード', 'カタカナ', '役割', 'Zoom URL']; // Zoom URL は講師だけ（クラス一覧の Zoom URL に自動で写す）
const OPS_MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
const OPS_DAYS = [['Mon', '月曜'], ['Tue', '火曜'], ['Wed', '水曜'], ['Thu', '木曜'], ['Fri', '金曜'], ['Sat', '土曜'], ['Sun', '日曜']];
const OPS_DAY_NAMES = { Mon: 'Monday', Tue: 'Tuesday', Wed: 'Wednesday', Thu: 'Thursday', Fri: 'Friday', Sat: 'Saturday', Sun: 'Sunday' };


/* ======================= メニュー ======================= */

function onOpen() {
  const menu = SpreadsheetApp.getUi().createMenu('TD台帳')
    .addItem('一覧表を今すぐ作り直す', 'opsRefreshNow')
    .addItem('今の一覧表を記録する（タブとPDF）', 'opsRecordNow')
    .addItem('見張りメールを今すぐ送る', 'opsWeeklyNow')
    .addSeparator()
    .addItem('選んだ生徒を受講に追加', 'opsAddToEnroll')
    .addItem('受講を並べ替える', 'opsSortEnrollNow')
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
  opsRun_(opsRefreshNow_);
}

function opsRefreshNow_() {
  opsRefresh(true);
  const tab = opsLedgerTab_(OPS.LEDGER_TAB_THIS, opsMonth_(opsTodayKey_(), 0));
  const ledger = SpreadsheetApp.getActiveSpreadsheet().getSheetByName(tab);
  opsShowLinks_('一覧表を作り直しました', [
    [SpreadsheetApp.getActiveSpreadsheet().getUrl() + '#gid=' + ledger.getSheetId(), 'あなた用の一覧表（このスプシの「' + tab + '」）'],
    [opsBoardFile_().getUrl(), 'Class Structure（スタッフ・講師用）'],
    [opsStaffFile_().getUrl(), 'スタッフ用の名簿（クラス別シート）'],
  ]);
}

function opsRecordNow() {
  opsRun_(opsRecordNow_);
}

function opsRecordNow_() {
  const rec = opsRecordMonth_(true);
  opsShowLink_('記録しました（タブとPDF）', rec.url, '記録したタブを開く');
}

function opsWeeklyNow() {
  opsRun_(opsWeeklyNow_);
}

function opsWeeklyNow_() {
  const to = opsSendWatch_(opsWatchItems_(opsData_()));
  SpreadsheetApp.getActiveSpreadsheet().toast(to + ' に送りました', '見張りメール', 5);
}

/**
 * 生徒_JP／生徒_海外で選んだ行（セルをどれか選べばよい。Shift・⌘で複数）の生徒を、受講の一番下に足す。
 * 生徒ID と Display name が入るので、あとはクラスと開始日を選ぶ
 */
function opsAddToEnroll() {
  opsRun_(opsAddToEnroll_);
}

function opsAddToEnroll_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), sh = ss.getActiveSheet();
  if ([OPS.SHEET_JP, OPS.SHEET_INTL].indexOf(sh.getName()) === -1) {
    throw new Error(OPS.SHEET_JP + ' か ' + OPS.SHEET_INTL + ' で、足したい生徒の行を選んでから押してください');
  }
  const rowNos = [];
  sh.getActiveRangeList().getRanges().forEach(rg => {
    for (let i = rg.getRow(); i < rg.getRow() + rg.getNumRows(); i++) if (i > 1 && rowNos.indexOf(i) === -1) rowNos.push(i);
  });
  const byRow = {};
  opsTable_(sh).rows.forEach(r => { byRow[r._row] = r; });
  const picked = rowNos.sort((a, b) => a - b).map(i => byRow[i]).filter(r => r && opsStr_(r['生徒ID']));
  if (!picked.length) throw new Error('生徒IDのある行を選んでください（手で足したばかりの生徒は、生徒IDが入るまで5分ほど待つ）');
  const es = ss.getSheetByName(OPS.SHEET_ENROLL);
  const head = opsHead_(es);
  const nk = head.indexOf('Display name') !== -1 ? 'Display name' : '名前';
  const values = picked.map(r => head.map(h =>
    h === '生徒ID' ? opsStr_(r['生徒ID']) : h === nk ? (opsStr_(r['Display name']) || opsStr_(r['名前'])) : ''));
  const start = es.getLastRow() + 1;
  es.getRange(start, 1, values.length, head.length).setValues(values);
  es.activate();
  es.getRange(start, head.indexOf('クラス') + 1).activate();
  ss.toast(values.length + '人を受講に足しました。クラスと開始日を選んでください（席番号は5分以内に入ります）', '受講', 6);
}

function opsSortEnrollNow() {
  opsRun_(() => {
    const lock = LockService.getDocumentLock();
    if (!lock.tryLock(30000)) throw new Error('ほかの処理が動いています。少し待ってからもう一度押してください');
    try {
      opsSortEnroll_();
    } finally {
      lock.releaseLock();
    }
    SpreadsheetApp.getActiveSpreadsheet().toast('受講を曜日・時刻・クラス・席番号の順に並べ替えました', '受講', 5);
  });
}

/**
 * 受講を、曜日（月→日）・時刻・Class ID・席番号（JP→ID）の順に並べる。最終日を過ぎた行は下にまとめて灰色の文字に。
 * 毎晩と、メニューから
 */
function opsSortEnroll_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet(), es = ss.getSheetByName(OPS.SHEET_ENROLL);
  if (!es || es.getLastRow() < 3) return;
  const head = opsHead_(es), ix = h => head.indexOf(h);
  const range = es.getRange(2, 1, es.getLastRow() - 1, head.length);
  const values = range.getValues();
  const classes = {};
  opsTable_(ss.getSheetByName(OPS.SHEET_CLASSES)).rows.map(opsClass_).forEach(c => { classes[c.id] = c; });
  const today = opsTodayKey_();
  const dayNo = d => { const i = OPS_DAYS.findIndex(x => x[0] === d); return i < 0 ? 9 : i; };
  const keyOf = v => {
    const id = opsStr_(v[ix('クラス')]), c = classes[id] || {}, seat = opsStr_(v[ix('席番号')]);
    const end = opsKey_(v[ix('最終日')]);
    return [
      !opsStr_(v[ix('生徒ID')]) && !id ? 2 : (end && end < today ? 1 : 0), // 空の行は一番下、過ぎた行はその上
      dayNo(c.day || id.slice(0, 3)),
      String(c.time || id.slice(3, 7)).replace(':', ''),
      id,
      /^ID/i.test(seat) ? 1 : 0,
      opsSeatNo_(seat) || 99,
      opsKey_(v[ix('開始日')]) || 0,
    ];
  };
  const keyed = values.map(v => ({ v, k: keyOf(v) }));
  keyed.sort((a, b) => {
    for (let i = 0; i < a.k.length; i++) if (a.k[i] !== b.k[i]) return a.k[i] < b.k[i] ? -1 : 1;
    return 0;
  });
  range.setValues(keyed.map(x => x.v));
  range.setFontColor(null);
  keyed.forEach((x, i) => { if (x.k[0] === 1) es.getRange(i + 2, 1, 1, head.length).setFontColor('#9aa0a6'); });
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

/** メニューから動かした処理でエラーが出たら、中身を画面に出す（Googleの通知だけでは原因が分からないため） */
function opsRun_(fn) {
  try {
    fn();
  } catch (err) {
    const where = String(err && err.stack || '').split('\n').slice(0, 4).join('\n');
    SpreadsheetApp.getUi().alert('エラーが出ました', String(err && err.message || err) + '\n\n' + where + '\n\nこの画面のスクショを送ってください。', SpreadsheetApp.getUi().ButtonSet.OK);
  }
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

/** 毎晩23時台。受講を並べ替え、月末の日だけ今月の一覧表を記録する */
function opsDaily() {
  const lock = LockService.getDocumentLock();
  if (!lock.tryLock(30000)) return;
  try {
    opsSortEnroll_();
    if (opsAddDays_(opsTodayKey_(), 1) % 100 === 1) opsRecordMonth_(false);
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
    if (!sheet) throw new Error('シートが見つかりません: ' + name + '（先にメニューの「列を整理する」を押してください）');
    return sheet;
  };
  const students = [], link = {}, byId = {};
  [['jp', OPS.SHEET_JP], ['intl', OPS.SHEET_INTL]].forEach(([region, name]) => {
    const sheet = sheetOf(name);
    // 一覧表の名前を押すと、この行が開く
    link[region] = ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + sheet.getSheetId() + '&range=A';
    opsTable_(sheet).rows.forEach(r => {
      const st = opsStudent_(r, region);
      if (!st.id && !st.name) return;
      students.push(st);
      if (st.id) byId[st.id] = st;
    });
  });
  const enrollSheet = ss.getSheetByName(OPS.SHEET_ENROLL);
  const enrolls = enrollSheet ? opsTable_(enrollSheet).rows.map(opsEnroll_).filter(e => e.sid || e.cls) : [];
  enrolls.forEach(e => { e.st = byId[e.sid] || null; });
  const teacherSheet = ss.getSheetByName(OPS.SHEET_TEACHERS);
  return {
    classes: opsTable_(sheetOf(OPS.SHEET_CLASSES)).rows.map(opsClass_).filter(c => c.id),
    teachers: teacherSheet ? opsTable_(teacherSheet).rows.map(opsTeacher_).filter(t => t.name) : [],
    students, enrolls,
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

const opsStr_ = v => String(v == null ? '' : v).trim();

function opsStudent_(r, region) {
  const s = opsStr_;
  return {
    region, row: r._row,
    id: s(r['生徒ID']),
    name: s(r['名前']),
    display: s(r['Display name']) || s(r['名前']),
    hasDisplay: !!s(r['Display name']),
    status: s(r['ステータス']),
    wish: s(r['希望クラス'] !== undefined ? r['希望クラス'] : r['提案クラス']), // 列の整理の前でも動くように
    wishStart: opsKey_(r['希望開始日'] !== undefined ? r['希望開始日'] : r['開始日']),
    paid: opsKey_(r['支払い済みの最終日'] !== undefined ? r['支払い済みの最終日'] : r['支払い済み〜']),
    applied: opsKey_(r['申込日時']),
    sex: s(r['性別']),
    grade: s(r['学年']),
    level: s(r['英語レベル']),
    email: s(r['Email']),
    phone: s(r['電話']),
    school: s(r['学校名']),
    password: s(r['Wixパスワード']),
    memo: s(r['メモ']),
  };
}

/** 受講の1行（1人×1クラス） */
function opsEnroll_(r) {
  const s = opsStr_;
  return { row: r._row, sid: s(r['生徒ID']), name: s(r['Display name'] !== undefined ? r['Display name'] : r['名前']), cls: s(r['クラス']), seat: s(r['席番号']),
    start: opsKey_(r['開始日']), end: opsKey_(r['最終日']), memo: s(r['メモ']) };
}

function opsTeacher_(r) {
  const s = opsStr_;
  return { name: s(r['名前']), code: s(r['コード']), kana: s(r['カタカナ']), role: s(r['役割']), zoom: s(r['Zoom URL']) };
}

function opsClass_(c) {
  const s = opsStr_;
  let time = c['時間(JST)'];
  if (time instanceof Date) time = Utilities.formatDate(time, opsSheetTz_(), 'HH:mm');
  const old = s(c['ターム・開始日']); // 列の整理の前の書き方（例「Oct - Dec Term 2」）
  const no = s(c['ターム']) || ((old.match(/Term\s*(\d+)/i) || [])[1] || '');
  const memo = s(c['メモ']);
  const state = s(c['状態']) || (/non-?active/i.test(memo) ? 'non-active' : 'active'); // 列の整理の前はメモ欄の「non-active」
  return {
    id: s(c['Class ID'] !== undefined ? c['Class ID'] : c['Group ID']),
    state, active: state !== 'non-active',
    type: s(c['種別']),
    day: opsDay_(c['曜日']),
    time: s(time).replace(/^(\d):/, '0$1:'),
    teacher: s(c['講師']),
    assistant: s(c['アシスタント']),
    lpJp: s(c['空き_JP']),
    lpIntl: s(c['空き_海外']),
    termNo: no.replace(/\D/g, ''),
    termStart: opsKey_(c['ターム開始日']),
    termText: old,
    memo,
  };
}

function opsDay_(v) {
  const t = String(v == null ? '' : v).trim();
  const hit = OPS_DAYS.find(([en, ja]) => t.toLowerCase().indexOf(en.toLowerCase()) === 0 || t.indexOf(ja.charAt(0)) === 0);
  return hit ? hit[0] : '';
}

/** この受講は今も続いているか（ステータスが席に出るもので、最終日を過ぎていない） */
function opsLiveEnroll_(e, today) {
  return !!(e.st && OPS.SEAT_STATUSES.indexOf(e.st.status) !== -1 && !(e.end && e.end < today));
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

/** 表示する月に、どのクラスの席に誰が出るか（active のクラスだけ） */
function opsPlace_(data, month) {
  const slots = {}, known = {};
  data.classes.forEach(c => { known[c.id] = c; });
  data.classes.filter(c => c.active).forEach(c => { slots[c.id] = { cls: c, jp: [], intl: [], prop: 0, waitJp: 0, waitIntl: 0 }; });
  const problems = [];
  const ref = Math.max(data.today, month.start); // 海外の支払いはこの日で見る
  // 提案中・空き待ちは、生徒シートの「希望クラス」で数える（席には出さない）
  data.students.forEach(st => {
    if ((st.status !== '提案中' && st.status !== '空き待ち') || !st.wish) return;
    const slot = slots[st.wish];
    if (!slot) {
      if (!known[st.wish]) problems.push({ st, why: '希望クラスがクラス一覧に無い' });
      return;
    }
    if (st.status === '提案中') { if (!st.wishStart || st.wishStart <= month.end) slot.prop++; }
    else slot[st.region === 'jp' ? 'waitJp' : 'waitIntl']++;
  });
  data.enrolls.forEach(en => {
    const st = en.st;
    if (!st) { problems.push({ st: { name: en.name || '（名前なし）', id: en.sid, cls: en.cls }, why: '受講の生徒IDが生徒シートに無い' }); return; }
    if (OPS.SEAT_STATUSES.indexOf(st.status) === -1) return;
    if (!known[en.cls]) { problems.push({ st: Object.assign({}, st, { cls: en.cls }), why: '受講のクラスがクラス一覧に無い' }); return; }
    const slot = slots[en.cls];
    if (!slot) return; // non-active のクラス（見張りメールで別に知らせる）
    if (en.start && en.start > month.end) return;
    if (en.end && en.end < month.start) return;
    slot[st.region].push({
      st, en,
      leaving: !!(en.end && en.end <= month.end),
      fresh: !!(en.start && en.start >= month.start),
      unpaid: st.status === '支払待ち' || (st.region === 'intl' && st.status === '在籍' && (!st.paid || st.paid < ref)),
      paused: st.status === '休会',
    });
  });
  const has = {};
  data.enrolls.forEach(e => { if (opsLiveEnroll_(e, data.today)) has[e.sid] = true; });
  data.students.forEach(st => {
    if ((st.status === '在籍' || st.status === '休会') && st.id && !has[st.id]) problems.push({ st, why: '在籍なのに受講にクラスが無い' });
  });
  Object.keys(slots).forEach(id => ['jp', 'intl'].forEach(r => { slots[id][r] = opsSeatOrder_(slots[id][r]); }));
  return { slots, problems };
}

/**
 * 席番号（JP-03 なら3番目）の位置に並べる。番号が無い・重なる生徒は空いている所へ。空席は undefined。
 * 同じ番号に、その月で去る人と続ける人がいれば、続ける人を番号の位置に、去る人（取り消し線）を一番下に出す
 */
function opsSeatOrder_(list) {
  const out = [];
  const byStart = list.slice().sort((a, b) => (a.leaving ? 1 : 0) - (b.leaving ? 1 : 0) ||
    (a.en.start || 0) - (b.en.start || 0) || (a.st.id < b.st.id ? -1 : a.st.id > b.st.id ? 1 : 0));
  const rest = [], gone = [];
  byStart.forEach(x => {
    const n = opsSeatNo_(x.en.seat);
    if (n && !out[n - 1]) out[n - 1] = x; else (x.leaving && n ? gone : rest).push(x);
  });
  rest.forEach(x => { let i = 0; while (out[i]) i++; out[i] = x; });
  gone.forEach(x => { out[out.length] = x; });
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

/** タームは 1〜6 をくり返す（6 の次は 1） */
function opsNextTermNo_(no) {
  return no >= 6 ? 1 : no + 1;
}

/** k の n か月後の同じ日（月末を超える日は月末に） */
function opsAddMonths_(k, n) {
  const mo = opsMonth_(k, n);
  return Math.min(mo.start - 1 + (k % 100), mo.end);
}

/**
 * その月のターム（番号と開始日）。クラス一覧のターム開始日から3か月ごとに次のタームとして数える
 * （例 Aug-Oct Term 1 のクラスは、11月の表では Nov-Jan Term 2・New Term。Term 6 の次は Term 1）。実際の開始日が違う時はクラス一覧を直す
 */
function opsTermAt_(cls, month) {
  let d = opsTermStart_(cls, month), no = cls.termNo ? Number(cls.termNo) : 0;
  if (!d) return { start: 0, no };
  for (let next = opsAddMonths_(d, 3); next <= month.end; next = opsAddMonths_(d, 3)) {
    d = next;
    if (no) no = opsNextTermNo_(no);
  }
  return { start: d, no };
}

function opsClassState_(cls, month) {
  const d = opsTermAt_(cls, month).start;
  if (d) return d > month.end ? 'newclass' : d >= month.start ? 'newterm' : 'ongoing';
  return /recruit|募集/i.test(cls.termText) ? 'newclass' : 'ongoing';
}

/** 一覧表のクラス名の横に出す文字（例「Oct-Dec Term 2」「Recruiting Class · Term 1 · from 11/3」） */
function opsTermLabel_(cls, month) {
  const at = opsTermAt_(cls, month), d = at.start;
  const term = at.no ? 'Term ' + at.no : '';
  if (opsClassState_(cls, month) === 'newclass') return ['Recruiting Class', term, d ? 'from ' + opsMd_(d) : ''].filter(Boolean).join(' · ');
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
  // 講師も見るので英語で（中1→JHS1、高1→HS1、Grade 9→G9、英検準2級→Pre-2 など）
  const toHalf = t => t.replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0));
  const grade = st => toHalf(st.grade).replace(/\(.*?\)|（.*?）/g, '').replace(/^中学?(\d)(年生?)?$/, 'JHS$1').replace(/^高校?(\d)(年生?)?$/, 'HS$1').replace(/^Grade\s*/i, 'G').trim() + ':';
  const sex = st => ({ 男: 'M', 男性: 'M', Male: 'M', 女: 'F', 女性: 'F', Female: 'F' })[st.sex] || '';
  const level = st => {
    const t = toHalf(st.level), m = t.match(/(準?)([1-5])級/);
    const v = m ? (m[1] ? 'Pre-' : 'Eiken ') + m[2] : /満たない/.test(t) ? 'below Pre-2' : /相談|わから/.test(t) ? 'unsure' : t.slice(0, 20);
    return v + ':';
  };
  const line = (label, r) => {
    const list = slot[r].filter(x => x && !x.leaving);
    if (!list.length) return '';
    return label + ': ' + [tally(list, grade), tally(list, sex, ['M', 'F']), tally(list, level)].filter(Boolean).join(' / ');
  };
  return [line('Japan', 'jp'), line('Overseas', 'intl')].filter(Boolean).join('\n');
}


/* ======================= 一覧表（Class Structure と同じ並び） ======================= */

/** 一覧表のマス目を作る（シートには書かない）。cells[行][列] = {v, bg, color, bold, strike, size, align, wrap, note, link} */
function opsBoardGrid_(data, month, title) {
  const classes = data.classes.filter(c => c.active); // non-active のクラスは出さない
  const place = opsPlace_(data, month);
  const C = OPS_COLOR, CAP = OPS.CAPACITY;
  const days = OPS_DAYS.filter(([en], i) => i < 5 || classes.some(c => c.day === en));
  const times = Array.from(new Set(classes.map(c => c.time).filter(Boolean))).sort();
  const seen = Array.from(new Set(classes.map(c => c.teacher).filter(Boolean)));
  const teachers = OPS.TEACHER_ORDER.filter(t => seen.indexOf(t) !== -1).concat(seen.filter(t => OPS.TEACHER_ORDER.indexOf(t) === -1));
  const width = 1 + days.length * 2;
  const cells = [], merges = [];
  const blank = () => Array.from({ length: width }, () => ({ v: '' }));
  const push = row => { cells.push(row); return cells.length; };
  const span = (r, c, n) => merges.push([r, c, 1, n]);
  const link = data.link || {};

  // 見出し・凡例
  let row = blank();
  row[0] = { v: 'Class Structure — ' + title, bold: true, size: 12, align: 'left' };
  span(push(row), 1, width);
  row = blank();
  row[0] = { v: '', color: C.muted, size: 9, align: 'left' }; // 説明と更新時刻は書く時に入れる
  span(push(row), 1, width);
  row = blank();
  const legend = [
    { v: 'Class', bold: true }, { v: 'Ongoing Term', bg: C.ongoing }, { v: 'New Term', bg: C.newterm }, { v: 'New Class', bg: C.newclass },
    { v: 'GAP class', color: C.gap, bold: true },
    { v: 'Student', bold: true }, { v: 'Open seat', bg: C.open, color: C.muted }, { v: 'Before Payment', bg: C.pay }, { v: 'New User', bg: C.fresh },
    { v: 'Leaving', bg: C.leave, strike: true, color: C.muted }, { v: 'Gap ≥' + OPS.DIFF_ALERT + ' in red', color: C.alert, bold: true },
  ];
  legend.slice(0, width).forEach((l, i) => { row[i] = Object.assign({ size: 9 }, l); });
  push(row);
  row = blank();
  row[0] = { v: 'Click a name to open the student\'s row. Hover over the count to see grade, gender and English level.', color: C.muted, size: 9, align: 'left' };
  span(push(row), 1, width);
  push(blank());

  const byKey = {};
  classes.forEach(c => { byKey[c.teacher + '|' + c.day + '|' + c.time] = c; });

  teachers.forEach(teacher => {
    row = blank();
    row[0] = { v: teacher, bold: true, size: 12, align: 'left' };
    days.forEach(([en], i) => { row[1 + i * 2] = { v: OPS_DAY_NAMES[en], bg: C.head, bold: true }; row[2 + i * 2] = { v: '', bg: C.head }; });
    const r1 = push(row);
    days.forEach((d, i) => span(r1, 2 + i * 2, 2));
    row = blank();
    days.forEach((d, i) => {
      row[1 + i * 2] = { v: 'Japan', bg: C.head, color: C.muted, size: 9 };
      row[2 + i * 2] = { v: 'Overseas', bg: C.head, color: C.muted, size: 9 };
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
          const gap = /gap/i.test(c.type);
          row[1 + i * 2] = { v: c.id + (gap ? ' · GAP' : '') + (label ? ' · ' + label : ''), bg, bold: true, size: 9, wrap: true, note: c.memo,
            color: gap ? C.gap : undefined };
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
      row[0] = { v: 'Count', color: C.muted, size: 9 };
      here.forEach((c, i) => {
        if (!c) {
          row[1 + i * 2] = { v: '', bg: C.none };
          row[2 + i * 2] = { v: '', bg: C.none };
          return;
        }
        const sl = slotOf(i), n = opsCount_(sl), diff = Math.abs(n.jp - n.intl);
        const wait = sl.waitJp + sl.waitIntl;
        const text = 'JP ' + n.jp + '/' + CAP + ' · OS ' + n.intl + '/' + CAP + ' · Gap ' + diff +
          (sl.prop ? ' · Proposed ' + sl.prop : '') + (wait ? ' · Waitlist ' + wait : '');
        const note = opsBreakdown_(sl);
        row[1 + i * 2] = diff >= OPS.DIFF_ALERT ? { v: text, bg: C.open, size: 9, color: C.alert, bold: true, note } : { v: text, bg: C.open, size: 9, color: C.muted, note };
        row[2 + i * 2] = { v: '', bg: C.open };
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
  if (!seat) return k < OPS.CAPACITY ? { v: 'Open', bg: C.open, color: C.muted, size: 9 } : { v: '' };
  const st = seat.st;
  const name = st.display + (seat.leaving ? ' (until ' + opsMd_(seat.en.end) + ')' : '') + (seat.paused ? ' (on break)' : '');
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
  const liveTabs = [], ledgerTabs = [];
  [[0, 'This month', OPS.LEDGER_TAB_THIS], [1, 'Next month', OPS.LEDGER_TAB_NEXT]].forEach(([add, label, ledgerBase]) => {
    const month = opsMonth_(data.today, add);
    const ledgerTab = opsLedgerTab_(ledgerBase, month); // 例「一覧表_今月(10月)」
    ledgerTabs.push(ledgerTab);
    const tab = opsMonthTab_(month) + OPS.LIVE_SUFFIX; // 例「26Oct (live)」
    liveTabs.push(tab);
    const grid = opsBoardGrid_(data, month, OPS_MONTHS[month.m - 1] + ' ' + month.y + ' (' + label + ')');
    const shared = opsStripLinks_(grid);
    shared.cells[3][0].v = 'Hover over the count to see grade, gender and English level.';
    opsWriteIfChanged_(board, tab, add, shared, 'OPS_HASH_' + add, force,
      'Auto-generated from the student ledger every 5 minutes. Do not edit this tab. Monthly records are kept as tabs like "' + opsMonthTab_(opsMonth_(data.today, -1)) + '". Last updated ' + stamp + ' JST');
    opsWriteIfChanged_(ledger, ledgerTab, ledger.getSheets().length, grid, 'OPS_HASH_L' + add, force,
      '生徒管理スプシから自動で作っています（直す時は生徒_JP／生徒_海外・受講を直す）。最終更新 ' + stamp);
  });
  // 月が替わったら、前の月の (live) タブと古い名前のタブを消す（記録は「26Oct」のタブとPDFに残っている）
  board.getSheets().forEach(sh => {
    const n = sh.getName();
    const old = n === '今月（自動）' || n === '来月（自動）' || (n.slice(-OPS.LIVE_SUFFIX.length) === OPS.LIVE_SUFFIX && liveTabs.indexOf(n) === -1);
    if (old && board.getSheets().length > 1) board.deleteSheet(sh);
  });
  // 生徒管理スプシの一覧表も、月が替わったら前の月の名前のタブを消す（「一覧表_今月」だけの古い名前も）
  ledger.getSheets().forEach(sh => {
    const n = sh.getName();
    const mine = [OPS.LEDGER_TAB_THIS, OPS.LEDGER_TAB_NEXT].some(b => n === b || n.indexOf(b + '(') === 0);
    if (mine && ledgerTabs.indexOf(n) === -1) ledger.deleteSheet(sh);
  });
  opsDropBlankFirstSheet_(board);
  opsBuildRoster_(data, force);
}

/** 生徒管理スプシの一覧表のタブ名（例「一覧表_今月(10月)」） */
function opsLedgerTab_(base, month) {
  return base + '(' + month.m + '月)';
}

/** タブの名前の月（例「26Oct」） */
function opsMonthTab_(month) {
  return String(month.y).slice(2) + OPS_MONTHS[month.m - 1];
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

const OPS_ROSTER_HEAD = ['Class ID', 'Student ID', 'Display name', 'Full name', 'Gender', 'Email (Google Account)', 'Notes (if any)',
  '学年', 'School', '海外生WA', 'Password', 'Wix DB削除確認'];
const OPS_ROSTER_CHECK = ['未確認', '確認済み']; // Wix DB削除確認の選択肢（スタッフが選ぶ）

/**
 * 1クラス分の行。日本生→海外生（席番号順）、人数が少ない側は (admin)、講師・アシスタント、空けて、このクラスを去った生徒。
 * {v: 11列, fresh: 1か月以内に入った（B・C列を緑に）, check: Wix DB削除確認の最初の値, key: 書き換えを残すための目印, missing: 足りない列}
 */
function opsRosterRows_(data, cls) {
  const T = data.today, recent = opsAddDays_(T, -30), gap = /gap/i.test(cls.type);
  const mine = data.enrolls.filter(e => e.cls === cls.id && e.st);
  // 載せるのは入会した生徒（在籍・休会）だけ。支払待ちの生徒は、席番号は押さえるが、名簿にはまだ出さない
  const live = mine.filter(e => (e.st.status === '在籍' || e.st.status === '休会') && !(e.end && e.end < T));
  const blank = (a, b, c) => ({ v: [a || '', b || '', c || ''].concat(OPS_ROSTER_HEAD.slice(3, 11).map(() => '')), fresh: false, check: '', key: '', missing: [] });
  const row = e => {
    const s = e.st;
    const v = [cls.id, e.seat, s.display, s.name, s.sex, s.email, s.level, s.grade, s.school, s.region === 'intl' ? s.phone : '', s.password];
    // 足りない情報は赤に（GAPのクラスはメール・パスワードが無くてよい。WAは海外生だけ）
    const need = [1, 2, 3, 4, 6, 7, 8].concat(gap ? [] : [5, 10]).concat(s.region === 'intl' ? [9] : []);
    return {
      v,
      fresh: !!(e.start && e.start >= recent), // 1か月以内に入った・クラスを替えた（これから始まる生徒も）
      check: /旧名簿から取り込み/.test(e.memo + s.memo) ? '確認済み' : '未確認', // 旧名簿から移した生徒は確認済み、新しく入った生徒は未確認
      key: (s.email || s.name).toLowerCase(),
      missing: need.filter(i => !String(v[i] || '').trim()),
    };
  };
  const bySeat = (a, b) => (opsSeatNo_(a.seat) || 99) - (opsSeatNo_(b.seat) || 99) || (a.start || 0) - (b.start || 0);
  const lists = { jp: live.filter(e => e.st.region === 'jp'), intl: live.filter(e => e.st.region === 'intl') };
  const n = Math.max(lists.jp.length, lists.intl.length);
  const out = [];
  [['jp', 'JP-'], ['intl', 'ID-']].forEach(([r, prefix]) => {
    const list = lists[r].slice();
    // 人数が少ない側は、空いている席番号に (admin)（アシスタントが1対1で代わりに入る）
    for (let k = 1; k <= n && list.length < n; k++) {
      if (!list.some(e => opsSeatNo_(e.seat) === k)) list.push({ admin: true, seat: prefix + ('0' + k).slice(-2) });
    }
    list.sort(bySeat).forEach(e => out.push(e.admin ? blank(cls.id, e.seat, '(admin)') : row(e)));
  });
  // コース・講師・アシスタント（スタッフが Class Slide に書く）。枠と色で囲む
  const kana = name => (data.teachers.filter(t => t.name === name)[0] || {}).kana || '';
  const staff = (a, b, c) => Object.assign(blank(a, b, c), { staff: true });
  out.push(blank(), staff('Course', gap ? 'Global Academic Pass' : 'Standard'),
    staff('Instructor', cls.teacher, kana(cls.teacher)), staff('Assistant', cls.assistant, kana(cls.assistant)));
  const past = mine.filter(e => e.end && e.end < T).sort((a, b) => (b.end || 0) - (a.end || 0))
    .map(e => Object.assign(row(e), { fresh: false, missing: [], past: true }));
  return past.length ? out.concat([blank(), Object.assign(blank('Past students (left this class)'), { section: true })], past) : out;
}

function opsBuildRoster_(data, force) {
  const ss = opsStaffFile_();
  const props = PropertiesService.getScriptProperties();
  const W = OPS_ROSTER_HEAD.length;
  data.classes.filter(c => c.active).forEach(cls => {
    const rows = opsRosterRows_(data, cls);
    const key = 'OPS_HASH_R_' + cls.id, hash = opsHash_(rows);
    let sheet = ss.getSheetByName(cls.id);
    if (!force && sheet && props.getProperty(key) === hash) return;
    // スタッフが選んだ「Wix DB削除確認」は、作り直しても残す（メールか名前で引き継ぐ）
    const kept = {};
    if (sheet && sheet.getLastRow() > 1) {
      sheet.getRange(2, 1, sheet.getLastRow() - 1, W).getValues().forEach(v => {
        const k = String(v[5] || v[3] || '').trim().toLowerCase();
        if (k && v[11]) kept[k] = v[11];
      });
    }
    if (!sheet) sheet = ss.insertSheet(cls.id, ss.getSheets().length);
    sheet.clear();
    sheet.getRange(1, 1, sheet.getMaxRows(), W).clearDataValidations();
    const values = [OPS_ROSTER_HEAD].concat(rows.map(r => r.v.concat([r.key ? (kept[r.key] || r.check) : ''])));
    sheet.getRange(1, 1, values.length, W).setNumberFormat('@').setValues(values);
    sheet.getRange(1, 1, 1, W).setFontWeight('bold').setBackground(OPS_COLOR.head);
    // コース・講師・アシスタントの3行は、色と枠で囲む
    const st = rows.map((r, i) => r.staff ? i + 2 : 0).filter(Boolean);
    if (st.length) {
      const box = sheet.getRange(st[0], 1, st.length, 3);
      box.setBackground(OPS_COLOR.staff).setBorder(true, true, true, true, true, true, OPS_COLOR.muted, SpreadsheetApp.BorderStyle.SOLID);
      sheet.getRange(st[0], 1, st.length, 1).setFontWeight('bold');
      sheet.getRange(st[0], 2, 1, 1).setFontWeight('bold').setFontColor(/gap/i.test(cls.type) ? OPS_COLOR.gap : OPS_COLOR.ink);
    }
    rows.forEach((r, i) => {
      if (r.section) sheet.getRange(i + 2, 1, 1, W).setBackground(OPS_COLOR.head).setFontWeight('bold');
      if (r.past) sheet.getRange(i + 2, 1, 1, W).setFontColor(OPS_COLOR.muted);
      if (r.fresh) sheet.getRange(i + 2, 2, 1, 2).setBackground(OPS_COLOR.fresh); // B・C列（Student ID・Display name）を緑
      r.missing.forEach(c => sheet.getRange(i + 2, c + 1).setBackground(OPS_COLOR.missing));
      if (r.key) sheet.getRange(i + 2, W).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(OPS_ROSTER_CHECK, true).build());
    });
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
  const base = opsMonthTab_(month);
  // 月末の自動の記録は「26Oct」、メニューからは「26Oct (10/25)」
  let name = base + (manual ? ' (' + Utilities.formatDate(now, OPS.TZ, 'M/d') + ')' : '');
  if (ss.getSheetByName(name)) {
    if (!manual) return null; // 月末の自動は1回だけ
    let i = 2;
    while (ss.getSheetByName(name + '-' + i)) i++;
    name = name + '-' + i;
  }
  const sheet = ss.insertSheet(name, Math.min(2, ss.getSheets().length)); // (live) の2つのすぐ右
  const grid = opsStripLinks_(opsBoardGrid_(data, month, OPS_MONTHS[month.m - 1] + ' ' + month.y + ' (record)'));
  grid.cells[1][0].v = 'Record as of ' + Utilities.formatDate(now, OPS.TZ, 'yyyy/M/d HH:mm') + ' JST. This tab does not change.';
  grid.cells[3][0].v = 'Hover over the count to see grade, gender and English level.';
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


/* ======================= 台帳の自動の書き込み ======================= */

/** すべてのクラスを去った生徒（受講があり、どれも最終日を過ぎた）のステータスを「退会」にする */
function opsRetirePast_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const enrollSheet = ss.getSheetByName(OPS.SHEET_ENROLL);
  if (!enrollSheet) return;
  const today = opsTodayKey_();
  const any = {}, live = {};
  opsTable_(enrollSheet).rows.map(opsEnroll_).forEach(e => {
    if (!e.sid) return;
    any[e.sid] = true;
    if (!(e.end && e.end < today)) live[e.sid] = true;
  });
  [OPS.SHEET_JP, OPS.SHEET_INTL].forEach(name => {
    const t = opsTable_(ss.getSheetByName(name));
    const cs = t.col['ステータス'];
    if (cs === undefined) return;
    t.rows.forEach(r => {
      const id = opsStr_(r['生徒ID']);
      if (id && any[id] && !live[id] && OPS.SEAT_STATUSES.indexOf(opsStr_(r['ステータス'])) !== -1) t.sheet.getRange(r._row, cs + 1).setValue('退会');
    });
  });
}

/**
 * 受講：席番号が空なら空いている番号、名前は生徒シートから。
 * 生徒シート：受講中のクラス、支払待ち・在籍で Wixパスワード が空なら作る（GAPだけの生徒は作らない）、海外生の Display name が空なら名前から作る
 */
function opsFillDefaults_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const today = opsTodayKey_();
  const active = ['新規', '提案中', '支払待ち', '在籍', '休会', '空き待ち'];
  const gapClass = {};
  const classT = opsTable_(ss.getSheetByName(OPS.SHEET_CLASSES));
  classT.rows.map(opsClass_).forEach(c => { gapClass[c.id] = /gap/i.test(c.type); });
  // クラス一覧の Zoom URL は、講師シートの講師の Zoom URL から（講師で決まるため）
  const teacherSheet = ss.getSheetByName(OPS.SHEET_TEACHERS);
  const zc = classT.col['Zoom URL'];
  if (teacherSheet && zc !== undefined) {
    const zoomOf = {};
    opsTable_(teacherSheet).rows.map(opsTeacher_).forEach(t => { if (t.name && t.zoom) zoomOf[t.name] = t.zoom; });
    classT.rows.forEach(r => {
      const z = zoomOf[opsStr_(r['講師'])];
      if (z && opsStr_(r['Zoom URL']) !== z) classT.sheet.getRange(r._row, zc + 1).setValue(z);
    });
  }
  const sheets = {}, byId = {};
  [['jp', OPS.SHEET_JP], ['intl', OPS.SHEET_INTL]].forEach(([region, name]) => {
    sheets[region] = opsTable_(ss.getSheetByName(name));
    sheets[region].rows.forEach(r => { const id = opsStr_(r['生徒ID']); if (id) byId[id] = { r, region }; });
  });
  const enrollSheet = ss.getSheetByName(OPS.SHEET_ENROLL);
  const classesOf = {};
  if (enrollSheet) {
    const t = opsTable_(enrollSheet);
    const isLive = r => {
      const who = byId[opsStr_(r['生徒ID'])];
      return !!who && OPS.SEAT_STATUSES.indexOf(opsStr_(who.r['ステータス'])) !== -1 && !(opsKey_(r['最終日']) && opsKey_(r['最終日']) < today);
    };
    if (t.col['席番号'] !== undefined) {
      opsAssignSeats_(t.rows, r => (byId[opsStr_(r['生徒ID'])] || {}).region, isLive)
        .forEach(([r, seat]) => t.sheet.getRange(r._row, t.col['席番号'] + 1).setValue(seat));
    }
    // 列名「名前」は「Display name」に変える（中身は生徒シートの Display name）
    const nk = t.col['Display name'] !== undefined ? 'Display name' : '名前';
    if (nk === '名前' && t.col['名前'] !== undefined) t.sheet.getRange(1, t.col['名前'] + 1).setValue('Display name');
    t.rows.forEach(r => {
      const who = byId[opsStr_(r['生徒ID'])];
      if (!who) return;
      const name = opsStr_(who.r['Display name']) || opsStr_(who.r['名前']);
      if (t.col[nk] !== undefined && name && opsStr_(r[nk]) !== name) t.sheet.getRange(r._row, t.col[nk] + 1).setValue(name);
      if (isLive(r)) (classesOf[opsStr_(r['生徒ID'])] = classesOf[opsStr_(r['生徒ID'])] || []).push(opsStr_(r['クラス']));
    });
  }
  // 手で足した生徒の生徒IDが空なら、次の番号を入れる（Code.gs の申込と番号がぶつからないよう、Code.gs と同じロックを取る）
  const idLock = LockService.getScriptLock();
  if (idLock.tryLock(10000)) {
    try {
      [['jp', 'J'], ['intl', 'G']].forEach(([region, prefix]) => {
        const t = sheets[region], ci = t.col['生徒ID'];
        if (ci === undefined || t.col['名前'] === undefined) return;
        let max = 0;
        t.rows.forEach(r => { const m = opsStr_(r['生徒ID']).match(new RegExp('^' + prefix + '(\\d+)$')); if (m) max = Math.max(max, Number(m[1])); });
        t.rows.filter(r => !opsStr_(r['生徒ID']) && opsStr_(r['名前'])).forEach(r => {
          const id = prefix + String(++max).padStart(4, '0');
          t.sheet.getRange(r._row, ci + 1).setValue(id);
          r['生徒ID'] = id;
        });
      });
    } finally {
      idLock.releaseLock();
    }
  }
  ['jp', 'intl'].forEach(region => {
    const t = sheets[region];
    const cp = t.col['Wixパスワード'], cd = t.col['Display name'], cc = t.col['受講中のクラス'];
    t.rows.forEach(r => {
      const id = opsStr_(r['生徒ID']), st = opsStr_(r['ステータス']);
      const list = classesOf[id] || [];
      if (cc !== undefined && opsStr_(r['受講中のクラス']) !== list.join('、')) t.sheet.getRange(r._row, cc + 1).setValue(list.join('、'));
      const onlyGap = list.length > 0 && list.every(c => gapClass[c]);
      if (cp !== undefined && (st === '支払待ち' || st === '在籍') && !onlyGap && !opsStr_(r['Wixパスワード'])) {
        t.sheet.getRange(r._row, cp + 1).setNumberFormat('@').setValue(opsNewPassword_());
      }
      // Display name が空なら名前から作る（日本生も海外生も。LPの申込のようにアルファベットの名前だけ。activo の漢字の名前は作らない）
      if (cd !== undefined && active.indexOf(st) !== -1 && !opsStr_(r['Display name']) && /^[A-Za-z][A-Za-z .'\-]*$/.test(opsStr_(r['名前']))) {
        t.sheet.getRange(r._row, cd + 1).setValue(opsShortName_(r['名前']));
      }
    });
  });
}

/**
 * 受講の席番号が空の行に、そのクラスで空いている一番小さい番号を割り当てる（日本生 JP-01〜、海外生 ID-01〜）。
 * 開始日〜最終日が重ならなければ同じ番号を使える（10/27 で去る生徒の席に 11/3 から入る生徒を入れる）。
 * regionOf(行) で日本／海外、isLive(行) で今も続いている受講か。[行, 席番号] の並びを返す
 */
function opsAssignSeats_(rows, regionOf, isLive) {
  const live = rows.filter(r => opsStr_(r['クラス']) && regionOf(r) && isLive(r));
  const used = {}; // クラス|地域 → 席番号 → [期間…]
  const key = r => opsStr_(r['クラス']) + '|' + regionOf(r);
  const take = (r, n) => { const u = used[key(r)] = used[key(r)] || {}; (u[n] = u[n] || []).push(opsSpan_(r['開始日'], r['最終日'])); };
  live.forEach(r => { const n = opsSeatNo_(r['席番号']); if (n) take(r, n); });
  const out = [];
  live.filter(r => !opsStr_(r['席番号']))
    .sort((a, b) => (opsKey_(a['開始日']) || 0) - (opsKey_(b['開始日']) || 0) || a._row - b._row)
    .forEach(r => {
      const u = used[key(r)] || {}, span = opsSpan_(r['開始日'], r['最終日']);
      let n = 1;
      while ((u[n] || []).some(p => opsOverlap_(p, span))) n++;
      take(r, n);
      out.push([r, (regionOf(r) === 'jp' ? 'JP-' : 'ID-') + ('0' + n).slice(-2)]);
    });
  return out;
}

/** 受講の期間（開始日・最終日が空なら、ずっと前から・ずっと先まで） */
function opsSpan_(start, end) {
  return [opsKey_(start) || 0, opsKey_(end) || 99999999];
}

/** 2つの期間が1日でも重なるか */
function opsOverlap_(a, b) {
  return a[0] <= b[1] && b[0] <= a[1];
}

/** 打ち間違えにくい文字だけで8文字（td＋6文字） */
function opsNewPassword_() {
  const chars = 'abcdefghjkmnpqrstuvwxyz23456789';
  let s = 'td';
  for (let i = 0; i < 6; i++) s += chars.charAt(Math.floor(Math.random() * chars.length));
  return s;
}

/** "Putri Anggraini" → "Putri A."、"Braian Alex Garcia Gomez" → "Braian A. G. G."（最初の語のあとは頭文字） */
function opsShortName_(name) {
  const p = String(name).trim().split(/\s+/).filter(Boolean);
  if (p.length < 2) return p[0] || '';
  return p[0] + ' ' + p.slice(1).map(w => w.charAt(0).toUpperCase() + '.').join(' ');
}


/* ======================= 見張りメール ======================= */

/** 対応が要るものを {title, lines} の並びで返す（無い項目は出さない） */
function opsWatchItems_(data) {
  const T = data.today, S = data.students, E = data.enrolls, CAP = OPS.CAPACITY, md = opsMd_;
  const who = s => s.name + '（' + s.id + ((s.cls || s.wish) ? '・' + (s.cls || s.wish) : '') + '）';
  const items = [];
  const add = (title, lines) => { if (lines.length) items.push({ title, lines }); };
  const live = s => s.status === '支払待ち' || s.status === '在籍';
  const liveE = e => opsLiveEnroll_(e, T);
  const firstStart = s => E.filter(e => e.st === s && liveE(e) && e.start).map(e => e.start).sort()[0] || s.wishStart || 0;
  const m0 = opsMonth_(T, 0);

  add('新規のまま3日以上（受付の返信がまだ）',
    S.filter(s => s.status === '新規' && s.applied && s.applied <= opsAddDays_(T, -3)).map(s => who(s) + ' 申込 ' + md(s.applied)));
  add('提案中で、開始日まで7日を切った（返事を確かめる）',
    S.filter(s => s.status === '提案中' && (!s.wishStart || s.wishStart <= opsAddDays_(T, 7))).map(s => who(s) + ' ' + (s.wishStart ? md(s.wishStart) + 'から' : '希望開始日が空')));
  add('支払待ちのまま開始日を過ぎた（日本生）',
    S.filter(s => s.region === 'jp' && s.status === '支払待ち' && firstStart(s) && firstStart(s) < T).map(s => who(s) + ' ' + md(firstStart(s)) + 'から'));
  add('海外生の支払い',
    S.filter(s => s.region === 'intl' && live(s) && E.some(e => e.st === s && liveE(e))).map(s => {
      const start = firstStart(s);
      if (!s.paid) return start && start <= opsAddDays_(T, -14) ? who(s) + ' ' + md(start) + 'から・まだ' : '';
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
      // LPの空き状況のずれ（non-active のクラスは、生徒0人でも満席に見せているので調べない。p.slots は active だけ）
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
    E.filter(e => liveE(e) && e.start && e.start > T && e.start <= opsAddDays_(T, 7)).map(e => who(Object.assign({}, e.st, { cls: e.cls })) + ' ' + md(e.start)));
  add('この1週間に、クラスを去った（最終日を過ぎた）',
    E.filter(e => e.st && e.end && e.end < T && e.end >= opsAddDays_(T, -7)).map(e => who(Object.assign({}, e.st, { cls: e.cls })) + ' 最終日 ' + md(e.end)));
  add('LPの空き状況が人数と合っていない（来月の人数で比べています）', lp);
  // 次のタームは、一覧表では今のタームの開始日から3か月後として出している。2週間前になったら、実際の開始日と合っているか確かめてもらう
  add('2週間以内に次のターム（一覧表は3か月後として表示。違う時はクラス一覧の「ターム」「ターム開始日」を直す）',
    data.classes.filter(c => c.active).map(c => {
      const at = opsTermAt_(c, m0);
      if (!at.start) return '';
      const next = opsAddMonths_(at.start, 3);
      if (next < T || next > opsAddDays_(T, 14)) return '';
      return c.id + '：Term ' + (at.no ? opsNextTermNo_(at.no) : '?') + ' が ' + md(next) + ' から';
    }).filter(Boolean));
  add('クラス一覧のタームか開始日が空', data.classes.filter(c => c.active && (!c.termNo || !opsTermStart_(c, m0))).map(c => c.id));
  // Class ID は「曜日＋時刻＋講師コード」（例 Mon2030NM）。講師のコードは「講師」シートから
  const codeOf = {};
  data.teachers.forEach(t => { if (t.code) codeOf[t.name] = t.code; });
  add('Class ID が「曜日＋時刻＋講師コード」になっていない', data.classes.map(c => {
    if (!c.day || !c.time || !codeOf[c.teacher]) return '';
    const want = c.day + c.time.replace(':', '') + codeOf[c.teacher];
    return c.id === want ? '' : c.id + '（曜日・時刻・講師から見ると ' + want + '）';
  }).filter(Boolean));
  add('non-active のクラスに生徒がいる（クラス一覧の状態を active にする）',
    data.classes.filter(c => !c.active && E.some(e => e.cls === c.id && liveE(e))).map(c => c.id));
  add('確かめてほしい行', opsPlace_(data, m0).problems.map(p => who(p.st) + ' ' + p.why));
  // 同じクラス・同じ席番号の生徒が同じ時期に2人いる（スライドの交流テーブルがずれる）。期間が重ならない入れ替わりはよい
  const seen = {}, dup = [];
  E.filter(e => liveE(e) && e.seat).forEach(e => {
    const k = e.cls + '|' + e.st.region + '|' + opsSeatNo_(e.seat);
    const span = [e.start || 0, e.end || 99999999];
    const hit = (seen[k] || []).find(x => opsOverlap_([x.start || 0, x.end || 99999999], span));
    if (hit) dup.push(e.cls + ' ' + e.seat + '：' + hit.st.name + ' と ' + e.st.name);
    (seen[k] = seen[k] || []).push(e);
  });
  add('同じ席番号の生徒が2人いる（受講の席番号を直す）', dup);
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
  opsRun_(opsSetupColumns_);
}

function opsSetupColumns_() {
  const ui = SpreadsheetApp.getUi();
  const ok = ui.alert('列を整理します',
    'クラス一覧（Class ID・状態・アシスタント・ターム）、講師シート、生徒_JP・生徒_海外（並べ替え・畳む・行の色）、受講シートを整えます。' +
    '中身は消しません（日本の「国」「WhatsApp」は、空か Japan だけの時に限り列ごと消します）。進めますか？', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const report = [];
  const classes = ss.getSheetByName(OPS.SHEET_CLASSES);
  report.push(OPS.SHEET_CLASSES + '：' + opsArrangeClasses_(classes).join('、'));
  report.push(OPS.SHEET_TEACHERS + '：' + opsEnsureTeacherSheet_(ss).join('、'));
  opsClassValidations_(ss);
  Object.keys(OPS_LAYOUT).forEach(name => {
    const sheet = ss.getSheetByName(name);
    report.push(sheet ? name + '：' + opsArrangeSheet_(sheet, OPS_LAYOUT[name], ss).join('、') : name + '：シートが無い');
  });
  report.push(OPS.SHEET_ENROLL + '：' + opsEnsureEnrollSheet_(ss).join('、'));
  // 結果は右下の通知で出す（Googleアカウントに複数ログインしていると、画面を出したところで止まることがあるため）
  ss.toast(report.join(' ／ ').slice(0, 300), '列を整理しました', 20);
}

function opsHead_(sheet) {
  return sheet.getRange(1, 1, 1, Math.max(sheet.getLastColumn(), 1)).getDisplayValues()[0].map(h => String(h).trim());
}

/** クラス一覧の Class ID の範囲（プルダウンに使う） */
function opsClassIdRange_(ss) {
  const classes = ss.getSheetByName(OPS.SHEET_CLASSES);
  const head = opsHead_(classes);
  const c = (head.indexOf('Class ID') + 1) || (head.indexOf('Group ID') + 1);
  return c ? classes.getRange(2, c, Math.max(classes.getMaxRows() - 1, 1), 1) : null;
}

/** 生徒シートの列を整理する。やったことを短い文の並びで返す */
function opsArrangeSheet_(sheet, layout, ss) {
  const notes = [];
  let head = opsHead_(sheet);

  Object.keys(OPS_RENAME).forEach(from => {
    const to = OPS_RENAME[from], i = head.indexOf(from);
    if (i !== -1 && head.indexOf(to) === -1) {
      sheet.getRange(1, i + 1).setValue(to);
      head[i] = to;
      notes.push('「' + from + '」を「' + to + '」に');
    }
  });

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
  // 列を動かすと畳んだ範囲がずれるので、畳み方は毎回作り直す
  for (let c = 1; c <= sheet.getMaxColumns(); c++) {
    let d = sheet.getColumnGroupDepth(c);
    while (d > 0) {
      try { sheet.getColumnGroup(c, d).remove(); } catch (err) { break; }
      d = sheet.getColumnGroupDepth(c);
    }
  }
  if (fold !== -1) {
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
    const intl = sheet.getName() === OPS.SHEET_INTL;
    if (intl && sheet.getLastRow() > 1) {
      // 海外生は「支払待ち」を使わないので「在籍」に（払った期間は「支払い済みの最終日」で見る）
      const r = sheet.getRange(2, col('ステータス'), sheet.getLastRow() - 1, 1);
      const v = r.getValues();
      const n = v.filter(x => String(x[0]).trim() === '支払待ち').length;
      if (n) { r.setValues(v.map(x => [String(x[0]).trim() === '支払待ち' ? '在籍' : x[0]])); notes.push('支払待ち' + n + '人を在籍に'); }
    }
    sheet.getRange(2, col('ステータス'), rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInList(intl ? OPS.STATUSES_INTL : OPS.STATUSES, true).setAllowInvalid(false).build());
  }
  const ids = opsClassIdRange_(ss);
  if (col('希望クラス') && ids) {
    sheet.getRange(2, col('希望クラス'), rows, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(ids, true).setAllowInvalid(true).build());
  }
  OPS_STUDENT_DATES.forEach(h => {
    if (!col(h)) return;
    const fixed = opsDateColumn_(sheet, col(h));
    if (fixed) notes.push('「' + h + '」の文字の日付' + fixed + '件を日付に');
  });
  if (col('Wixパスワード')) sheet.getRange(2, col('Wixパスワード'), rows, 1).setNumberFormat('@');
  if (col('電話')) sheet.getRange(2, col('電話'), rows, 1).setNumberFormat('@'); // 先頭の0や+を残す
  // 足した列の見出しも、ほかの見出しと同じ見た目に（色を付けない列「メモ」の書式を写す）。説明はメモで
  const plain = col('メモ') || col('経由') || 1;
  sheet.getRange(1, plain).copyFormatToRange(sheet, 1, head.length, 1, 1);
  Object.keys(OPS_HEAD_NOTES).forEach(h => { if (col(h)) sheet.getRange(1, col(h)).setNote(OPS_HEAD_NOTES[h]); });
  // 手で足す時に必ず書く列は濃い色、自動の列は緑
  (OPS_REQUIRED_HEAD[sheet.getName()] || []).forEach(h => {
    if (!col(h)) return;
    const r = sheet.getRange(1, col(h)).setBackground(OPS_HEAD_COLOR.required).setFontWeight('bold');
    if (!OPS_HEAD_NOTES[h]) r.setNote('手で生徒を足す時に必ず書く列');
  });
  (OPS_AUTO_HEAD[sheet.getName()] || []).forEach(h => { if (col(h)) sheet.getRange(1, col(h)).setBackground(OPS_HEAD_COLOR.auto); });
  if (opsStatusColors_(sheet)) notes.push('ステータスで行に色を付けた');
  return notes.length ? notes : ['変更なし'];
}

/** 受講シートが無ければ作る。席が決まっている生徒（支払待ち・在籍・休会で希望クラスがある）の行を最初に入れる */
function opsEnsureEnrollSheet_(ss) {
  let sheet = ss.getSheetByName(OPS.SHEET_ENROLL);
  const notes = [];
  if (!sheet) {
    const after = ss.getSheetByName(OPS.SHEET_INTL) || ss.getSheetByName(OPS.SHEET_JP);
    sheet = ss.insertSheet(OPS.SHEET_ENROLL, after ? after.getIndex() : ss.getSheets().length);
    sheet.getRange(1, 1, 1, OPS_ENROLL_HEAD.length).setValues([OPS_ENROLL_HEAD]).setFontWeight('bold').setBackground(OPS_COLOR.head);
    sheet.setFrozenRows(1);
    notes.push('受講シートを作った');
    const seed = [];
    [OPS.SHEET_JP, OPS.SHEET_INTL].forEach(name => {
      opsTable_(ss.getSheetByName(name)).rows.forEach(r => {
        const st = opsStr_(r['ステータス']), cls = opsStr_(r['希望クラス']), id = opsStr_(r['生徒ID']);
        if (id && cls && OPS.SEAT_STATUSES.indexOf(st) !== -1) {
          const d = opsKey_(r['希望開始日']);
          seed.push([id, opsStr_(r['Display name']) || opsStr_(r['名前']), cls, '', d ? Math.floor(d / 10000) + '/' + (Math.floor(d / 100) % 100) + '/' + (d % 100) : '', '', '']);
        }
      });
    });
    if (seed.length) {
      sheet.getRange(2, 1, seed.length, OPS_ENROLL_HEAD.length).setValues(seed);
      notes.push('席が決まっている生徒' + seed.length + '人の行を入れた');
    }
  }
  const head = opsHead_(sheet), rows = Math.max(sheet.getMaxRows() - 1, 1);
  const col = h => head.indexOf(h) + 1;
  const ids = opsClassIdRange_(ss);
  if (col('クラス') && ids) sheet.getRange(2, col('クラス'), rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInRange(ids, true).setAllowInvalid(true).build());
  ['開始日', '最終日'].forEach(h => { if (col(h)) opsDateColumn_(sheet, col(h)); });
  if (col('席番号')) sheet.getRange(2, col('席番号'), rows, 1).setNumberFormat('@');
  return notes.length ? notes : ['変更なし'];
}

/** 講師シート（名前・コード・カタカナ・役割）が無ければ作る。クラス一覧の講師と Class ID の末尾のコードから最初の行を入れる */
function opsEnsureTeacherSheet_(ss) {
  const have = ss.getSheetByName(OPS.SHEET_TEACHERS);
  if (have) {
    // あとから増えた列（Zoom URL など）を右に足す
    const head = opsHead_(have);
    const add = OPS_TEACHER_HEAD.filter(h => head.indexOf(h) === -1);
    if (!add.length) return ['変更なし'];
    const last = head.filter(Boolean).length;
    if (have.getMaxColumns() < last + add.length) have.insertColumnsAfter(have.getMaxColumns(), last + add.length - have.getMaxColumns());
    have.getRange(1, last + 1, 1, add.length).setValues([add]);
    have.getRange(1, 1).copyFormatToRange(have, last + 1, last + add.length, 1, 1);
    return [add.map(h => '「' + h + '」').join('') + 'を足した'];
  }
  const after = ss.getSheetByName(OPS.SHEET_CLASSES);
  const sheet = ss.insertSheet(OPS.SHEET_TEACHERS, after ? after.getIndex() : ss.getSheets().length);
  sheet.getRange(1, 1, 1, OPS_TEACHER_HEAD.length).setValues([OPS_TEACHER_HEAD]).setFontWeight('bold').setBackground(OPS_COLOR.head);
  sheet.setFrozenRows(1);
  const seen = {}, rows = [];
  opsTable_(ss.getSheetByName(OPS.SHEET_CLASSES)).rows.map(opsClass_).forEach(c => {
    if (c.teacher && !seen[c.teacher]) {
      seen[c.teacher] = true;
      rows.push([c.teacher, c.id.slice(7), '', '講師', '']); // Mon2030NM → NM
    }
    if (c.assistant && !seen[c.assistant]) { seen[c.assistant] = true; rows.push([c.assistant, '', '', 'アシスタント', '']); }
  });
  if (rows.length) sheet.getRange(2, 1, rows.length, OPS_TEACHER_HEAD.length).setValues(rows);
  sheet.getRange(2, 4, Math.max(sheet.getMaxRows() - 1, 1), 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['講師', 'アシスタント'], true).build());
  return ['講師シートを作った（' + rows.length + '人。カタカナは取り込みで入る）'];
}

/** クラス一覧の講師・アシスタントを、講師シートの名前から選べるようにする */
function opsClassValidations_(ss) {
  const classes = ss.getSheetByName(OPS.SHEET_CLASSES), teachers = ss.getSheetByName(OPS.SHEET_TEACHERS);
  if (!classes || !teachers) return;
  const head = opsHead_(classes), rows = Math.max(classes.getMaxRows() - 1, 1);
  const names = teachers.getRange(2, 1, Math.max(teachers.getMaxRows() - 1, 1), 1);
  ['講師', 'アシスタント'].forEach(h => {
    const c = head.indexOf(h) + 1;
    if (c) classes.getRange(2, c, rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInRange(names, true).setAllowInvalid(true).build());
  });
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

/**
 * クラス一覧を整える：Group ID → Class ID、状態（active／non-active。メモ欄の「non-active」から移す）、アシスタント、
 * 「ターム・開始日」→「ターム」（1〜6）と「ターム開始日」
 */
function opsArrangeClasses_(sheet) {
  const notes = [];
  let head = opsHead_(sheet);
  const gi = head.indexOf('Group ID');
  if (gi !== -1 && head.indexOf('Class ID') === -1) {
    sheet.getRange(1, gi + 1).setValue('Class ID');
    notes.push('「Group ID」を「Class ID」に');
    head = opsHead_(sheet);
  }
  const last = () => sheet.getLastRow();
  const column = name => { const i = head.indexOf(name); return i === -1 ? [] : last() > 1 ? sheet.getRange(2, i + 1, last() - 1, 1).getDisplayValues().map(r => String(r[0]).trim()) : []; };

  // 状態（Class ID の右）
  if (head.indexOf('状態') === -1) {
    const idc = head.indexOf('Class ID') + 1;
    const memos = column('メモ');
    sheet.insertColumnsAfter(idc, 1);
    sheet.getRange(1, idc + 1).setValue('状態');
    head = opsHead_(sheet);
    const mc = head.indexOf('メモ') + 1;
    const ids = column('Class ID');
    let off = 0;
    ids.forEach((id, i) => {
      if (!id) return;
      const memo = memos[i] || '';
      const non = /non-?active/i.test(memo);
      sheet.getRange(i + 2, idc + 1).setValue(non ? 'non-active' : 'active');
      if (non) { off++; if (mc) sheet.getRange(i + 2, mc).setValue(memo.replace(/[、,／\/\s]*non-?active[、,／\/\s]*/i, ' ').trim()); }
    });
    notes.push('「状態」を足した（non-active ' + off + 'クラス）');
  }
  // アシスタント（講師の右）
  if (head.indexOf('アシスタント') === -1 && head.indexOf('講師') !== -1) {
    sheet.insertColumnsAfter(head.indexOf('講師') + 1, 1);
    sheet.getRange(1, head.indexOf('講師') + 2).setValue('アシスタント');
    head = opsHead_(sheet);
    notes.push('「アシスタント」を足した');
  }
  // ターム
  const old = head.indexOf('ターム・開始日');
  if (head.indexOf('ターム') === -1 && head.indexOf('ターム開始日') === -1 && old !== -1) {
    const texts = column('ターム・開始日');
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
  const rows = Math.max(sheet.getMaxRows() - 1, 1);
  const col = h => head.indexOf(h) + 1;
  if (col('状態')) sheet.getRange(2, col('状態'), rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(OPS.CLASS_STATES, true).build());
  if (col('種別')) sheet.getRange(2, col('種別'), rows, 1).setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(['Standard', 'GAP'], true).setAllowInvalid(true).build());
  if (col('ターム')) sheet.getRange(2, col('ターム'), rows, 1).setDataValidation(
    SpreadsheetApp.newDataValidation().requireValueInList(['1', '2', '3', '4', '5', '6'], true).setAllowInvalid(true).build());
  if (col('ターム開始日')) opsDateColumn_(sheet, col('ターム開始日'));
  return notes.length ? notes : ['変更なし'];
}


/* ======================= 旧名簿から今の生徒を取り込む（最初に1回） ======================= */

// 旧名簿のクラス別シートの列（1行目の名前で探し、見つからなければこの位置）
const OPS_OLD_COLS = {
  cls: { names: ['Group ID', 'Class ID'], at: 0 },
  seat: { names: ['Student ID'], at: 1 }, display: { names: ['Display name'], at: 2 }, full: { names: ['Full name'], at: 3 },
  sex: { names: ['Gender'], at: 4 }, email: { names: ['Email (Google Account)', 'Email'], at: 5 }, notes: { names: ['Notes (if any)', 'Notes'], at: 6 },
  grade: { names: ['学年'], at: 7 }, school: { names: ['School'], at: 8 }, wa: { names: ['海外生WA'], at: 9 }, password: { names: ['Password'], at: 10 },
};
// 申込の一覧（Japanese Applicants・Overseas Applicants。列の並びが違うので列名で読む）
const OPS_APPLICANT_COLS = {
  applied: { names: ['申込日時'], at: 3 }, via: { names: ['経由'], at: 4 }, name: { names: ['名前'], at: 5 }, country: { names: ['国名'], at: 6 },
  sex: { names: ['性別'], at: 7 }, email: { names: ['Eメール', 'Email', 'メール'], at: 8 }, level: { names: ['英語レベル'], at: 9 },
  grade: { names: ['学年'], at: 10 }, school: { names: ['学校名'], at: 11 }, phone: { names: ['電話番号', '電話'], at: 12 },
  comment: { names: ['ご要望など', 'メッセージ'], at: 16 },
};

function opsImportOld() {
  opsRun_(opsImportOld_);
}

function opsImportOld_() {
  const ui = SpreadsheetApp.getUi();
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const sheets = { jp: ss.getSheetByName(OPS.SHEET_JP), intl: ss.getSheetByName(OPS.SHEET_INTL) };
  const enrollSheet = ss.getSheetByName(OPS.SHEET_ENROLL), teacherSheet = ss.getSheetByName(OPS.SHEET_TEACHERS);
  const classSheet = ss.getSheetByName(OPS.SHEET_CLASSES);
  if (!enrollSheet || !teacherSheet || opsHead_(classSheet).indexOf('Class ID') === -1 || ['jp', 'intl'].some(r => opsHead_(sheets[r]).indexOf('希望クラス') === -1)) {
    ui.alert('先にメニューの「列を整理する（最初に1回）」を押してください。');
    return;
  }
  const ok = ui.alert('旧名簿から今の生徒を取り込みます',
    '旧名簿のクラス別シート（クラス一覧で active のクラスだけ。シート名の「-GAP」は外して読む）から、空の行までの生徒を読みます。' +
    '生徒は生徒_JP・生徒_海外に「在籍」で、クラスと席番号は受講シートに入れます。申込日時・電話・経由などは Japanese Applicants と Overseas Applicants から探します。' +
    'Instructor・Assistant の行は、クラス一覧と講師シートに入れます。最後に生徒を申込順に並べ直し、生徒IDも申込順に振り直します（今のIDも変わります）。' +
    '旧名簿は読むだけで、書き換えません。進めますか？', ui.ButtonSet.OK_CANCEL);
  if (ok !== ui.Button.OK) return;

  const old = opsOldFile_();
  const ledger = {};
  ['jp', 'intl'].forEach(r => { ledger[r] = opsReadWithFormulas_(sheets[r]); });
  const enrolls = opsReadWithFormulas_(enrollSheet);
  const res = opsImportMerge_({
    classes: opsTable_(classSheet).rows.map(opsClass_).filter(c => c.id),
    sheets: old.getSheets().filter(sh => OPS.OLD_APPLICANTS_SHEETS.indexOf(sh.getName()) === -1).map(sh => ({ name: sh.getName(), values: sh.getDataRange().getValues() })),
    applicants: OPS.OLD_APPLICANTS_SHEETS.map(n => old.getSheetByName(n)).filter(Boolean).map(sh => sh.getDataRange().getValues()),
    ledger, enrolls: enrolls.rows,
  });
  const writeRows = (sheet, head, rows) => {
    const out = rows.map(row => head.map(h => row[h] === undefined || row[h] === null ? '' : row[h]));
    if (sheet.getLastRow() > 1) sheet.getRange(2, 1, sheet.getLastRow() - 1, head.length).clearContent();
    if (out.length) sheet.getRange(2, 1, out.length, head.length).setValues(out);
  };
  ['jp', 'intl'].forEach(r => writeRows(sheets[r], ledger[r].head, res[r]));
  writeRows(enrollSheet, enrolls.head.length > 1 ? enrolls.head : OPS_ENROLL_HEAD, res.enrolls);
  // クラス一覧の講師・アシスタント・種別
  const ct = opsTable_(classSheet);
  ct.rows.forEach(r => {
    const id = opsStr_(r['Class ID']), u = res.classUpdates[id];
    if (!u) return;
    Object.keys(u).forEach(h => { if (ct.col[h] !== undefined) classSheet.getRange(r._row, ct.col[h] + 1).setValue(u[h]); });
  });
  // 講師シート（無い人は足し、カタカナ・役割が空なら入れる）
  const tt = opsTable_(teacherSheet);
  res.teachers.forEach(t => {
    const hit = tt.rows.filter(r => opsStr_(r['名前']) === t.name)[0];
    if (hit) {
      if (!opsStr_(hit['カタカナ']) && t.kana) teacherSheet.getRange(hit._row, tt.col['カタカナ'] + 1).setValue(t.kana);
      if (!opsStr_(hit['役割']) && t.role) teacherSheet.getRange(hit._row, tt.col['役割'] + 1).setValue(t.role);
    } else {
      teacherSheet.appendRow(OPS_TEACHER_HEAD.map(h => ({ '名前': t.name, 'コード': '', 'カタカナ': t.kana, '役割': t.role })[h]));
    }
  });
  const rp = res.report;
  ui.alert('取り込みました', [
    '新しく入れた生徒：' + rp.added + '人　／　すでにあった生徒に書き足した：' + rp.updated + '人　／　受講に入れたクラス：' + rp.enrolled + '件',
    rp.noDate.length ? '申込の一覧に見つからず、申込日時が空の生徒（いちばん上に入れました）：' + rp.noDate.join('、') : '',
    rp.inactive.length ? 'non-active なので読まなかったシート：' + rp.inactive.join('、') : '',
    rp.skipped.length ? 'クラス一覧に無いので読まなかったシート：' + rp.skipped.join('、') : '',
    rp.missing.length ? '旧名簿にシートが無かった active のクラス：' + rp.missing.join('、') : '',
    rp.teacherDiff.length ? '旧名簿の Instructor とクラス一覧の講師が違うクラス（旧名簿の方を入れました）：' + rp.teacherDiff.join('、') : '',
    '次は「一覧表を今すぐ作り直す」。取り込んだ受講は開始日・最終日（海外は支払い済み〜も）が空なので、分かる所から入れてください。',
  ].filter(Boolean).join('\n\n'), ui.ButtonSet.OK);
}

function opsOldFile_() {
  if (OPS.OLD_FILE_ID) return SpreadsheetApp.openById(OPS.OLD_FILE_ID);
  const id = PropertiesService.getScriptProperties().getProperty('OPS_TEST_OLD_ID');
  if (!id) throw new Error('旧名簿のスプシIDが入っていません（Ops.gs の OLD_FILE_ID）');
  return SpreadsheetApp.openById(id);
}

/** シートを {列名: 値} で読む。数式（WhatsApp のリンク）は数式のまま持つ */
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
  const found = k => cols[k].names.map(n => head.indexOf(n)).filter(i => i !== -1)[0];
  const byName = Object.keys(cols).filter(k => found(k) !== undefined).length >= 3; // 1行目が列名として読める表か
  Object.keys(cols).forEach(k => {
    const i = found(k);
    idx[k] = i !== undefined ? i : byName ? -1 : cols[k].at;
  });
  return values.slice(1).map(v => {
    const o = {};
    Object.keys(idx).forEach(k => {
      const x = v[idx[k]];
      o[k] = x instanceof Date ? Utilities.formatDate(x, OPS.TZ, 'yyyy/MM/dd HH:mm:ss') : String(x == null ? '' : x).trim();
    });
    o._first = String(v[0] == null ? '' : v[0]).trim();
    o._row = v;
    return o;
  });
}

/**
 * 旧名簿の今の生徒を、生徒シートと受講シートの行に合わせる（シートには書かない）。
 * 返す生徒の行は申込順（申込日時が分からない生徒がいちばん上）で、生徒IDも申込順に振り直し、受講の生徒IDも付け替えてある
 */
function opsImportMerge_(input) {
  const report = { added: 0, updated: 0, enrolled: 0, noDate: [], skipped: [], inactive: [], missing: [], teacherDiff: [] };
  const lower = v => String(v || '').trim().toLowerCase();
  const classOf = {};
  input.classes.forEach(c => { classOf[lower(c.id)] = c; });
  // Japanese Applicants と Overseas Applicants の両方から探す（海外生は Overseas に無いこともある）
  const apps = [].concat.apply([], input.applicants.map(v => opsReadAs_(v, OPS_APPLICANT_COLS))).filter(a => a.name || a.email);
  const findApps = (email, name) => apps.filter(a => (email && lower(a.email) === lower(email)) || (name && a.name === name));
  const rows = { jp: input.ledger.jp.rows.slice(), intl: input.ledger.intl.rows.slice() };
  const byOldId = {};
  ['jp', 'intl'].forEach(r => rows[r].forEach(row => { if (row['生徒ID']) byOldId[String(row['生徒ID']).trim()] = row; }));
  const enrolls = input.enrolls.slice();
  enrolls.forEach(e => { e._st = byOldId[String(e['生徒ID'] || '').trim()] || null; });
  const classUpdates = {}, teachers = {}, seen = {}, found = {};
  const upd = (id, h, v) => { (classUpdates[id] = classUpdates[id] || {})[h] = v; };

  input.sheets.forEach(sh => {
    const gap = /-\s*GAP\s*$/i.test(sh.name);
    const cls = classOf[lower(sh.name.replace(/\s*-\s*GAP\s*$/i, ''))];
    if (!cls) { report.skipped.push(sh.name); return; }
    if (!cls.active) { report.inactive.push(sh.name); return; }
    found[cls.id] = true;
    if (gap && !/gap/i.test(cls.type)) upd(cls.id, '種別', 'GAP');
    const list = opsReadAs_(sh.values, OPS_OLD_COLS);
    // 講師・アシスタント（生徒の下の「Instructor／名前／カタカナ」「Assistant／名前／カタカナ」）
    list.forEach(o => {
      const role = /^instructor$/i.test(o._first) ? '講師' : /^assistant$/i.test(o._first) ? 'アシスタント' : '';
      if (!role) return;
      const name = String(o._row[1] || '').trim(), kana = String(o._row[2] || '').trim();
      if (!name) return;
      teachers[name] = { name, kana: kana || (teachers[name] || {}).kana || '', role };
      if (role === '講師') {
        if (cls.teacher && cls.teacher !== name) report.teacherDiff.push(cls.id + '（' + cls.teacher + '→' + name + '）');
        if (cls.teacher !== name) upd(cls.id, '講師', name);
      } else if (cls.assistant !== name) upd(cls.id, 'アシスタント', name);
    });
    for (let li = 0; li < list.length; li++) {
      const o = list[li];
      if (/^(instructor|assistant)$/i.test(o._first)) break;
      if (!o.display && !o.full) {
        // 空席（JP-05 などの席番号だけの行）は飛ばす。日本生と海外生の間に空きがあっても、あとに席番号付きの生徒が続くなら読み続ける。
        // 席番号の無い空の行のあと、席番号付きの生徒がもういなければ、そこから下は去った生徒（退会・休会・移動などのメモは読まない）
        if (o.seat) continue;
        let more = false;
        for (let k = li + 1; k < list.length; k++) {
          if (/^(instructor|assistant)$/i.test(list[k]._first)) break;
          if ((list[k].display || list[k].full) && /^(JP|ID)\s*-?\s*\d/i.test(list[k].seat)) { more = true; break; }
        }
        if (more) continue;
        break;
      }
      const got = findApps(o.email, o.full);
      const first = got.slice().sort((a, b) => (a.applied < b.applied ? -1 : 1))[0] || {};
      const last = got[got.length - 1] || {};
      const region = /^JP/i.test(o.seat) ? 'jp' : /^ID/i.test(o.seat) ? 'intl' : (last.country && last.country !== 'Japan' ? 'intl' : 'jp');
      const key = lower(o.email) || o.full || o.display;
      let st = seen[key] || rows[region].filter(r => (o.email && lower(r['Email']) === lower(o.email)) || (o.full && r['名前'] === o.full))[0];
      if (st && !seen[key]) {
        if (['', '新規', '提案中', '支払待ち', '空き待ち', '見送り'].indexOf(String(st['ステータス'] || '')) !== -1) st['ステータス'] = '在籍';
        if (!st['Display name']) st['Display name'] = o.display;
        if (!st['Wixパスワード']) st['Wixパスワード'] = o.password;
        if (!st['英語レベル']) st['英語レベル'] = o.notes || last.level || '';
        report.updated++;
      } else if (!st) {
        st = {
          '申込日時': first.applied || '', '経由': last.via || '旧名簿', 'ステータス': '在籍',
          '国': region === 'intl' ? (last.country || '') : 'Japan',
          '名前': o.full || last.name || o.display, 'Display name': o.display, '性別': o.sex || last.sex, '学年': o.grade || last.grade,
          '学校名': o.school || last.school, 'Email': o.email || last.email,
          '電話': region === 'intl' ? (o.wa || last.phone || '') : (last.phone || ''),
          '英語レベル': o.notes || last.level || '', 'コメント': last.comment || '',
          'Wixパスワード': o.password, 'メモ': '旧名簿から取り込み',
        };
        rows[region].push(st);
        report.added++;
        if (!first.applied) report.noDate.push(o.full || o.display);
      }
      seen[key] = st;
      // 受講（同じ生徒・同じクラスの行があれば席番号を足すだけ）
      const hit = enrolls.filter(e => e._st === st && String(e['クラス'] || '').trim() === cls.id && !e['最終日'])[0];
      if (hit) { if (!hit['席番号']) hit['席番号'] = o.seat; }
      else {
        enrolls.push({ 'Display name': o.display, '名前': o.display, 'クラス': cls.id, '席番号': o.seat, '開始日': '', '最終日': '', 'メモ': '旧名簿から取り込み', _st: st });
        report.enrolled++;
      }
    }
  });
  input.classes.forEach(c => { if (c.active && !found[c.id]) report.missing.push(c.id); });

  const key = r => r['申込日時'] instanceof Date ? Utilities.formatDate(r['申込日時'], OPS.TZ, 'yyyy/MM/dd HH:mm:ss') : String(r['申込日時'] || '');
  const out = {};
  [['jp', 'J'], ['intl', 'G']].forEach(([r, prefix]) => {
    out[r] = rows[r].slice().sort((a, b) => key(a) < key(b) ? -1 : key(a) > key(b) ? 1 : 0)
      .map((row, i) => Object.assign(row, { '生徒ID': prefix + ('000' + (i + 1)).slice(-4) }));
  });
  out.enrolls = enrolls.map(e => {
    const row = Object.assign({}, e);
    if (e._st) { row['生徒ID'] = e._st['生徒ID']; row['名前'] = row['Display name'] = e._st['Display name'] || e._st['名前'] || row['名前']; }
    delete row._st;
    return row;
  });
  out.classUpdates = classUpdates;
  out.teachers = Object.keys(teachers).map(k => teachers[k]);
  out.report = report;
  return out;
}
