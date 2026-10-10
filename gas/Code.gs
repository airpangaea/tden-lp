/***** TOMODACHI留学 生徒管理（スプシ「TDEN 生徒管理」にバインドして使う） *****
 *
 * 役割
 *  1. Webアプリ doPost … LPの申込を受け取り「生徒_JP／生徒_海外」に追記 → 管理者へ通知メール ＋ 受付完了の下書き（日本のみ・宛先なし）
 *  2. Webアプリ doGet  … 「クラス一覧」の空き状況をLP（Cloudflare /api/slots）に返す
 *  3. 定期実行 processInbox … Gmailに届いた activo の応募メールと、Airtableの通知メール（海外フォーム／LPの予備経路）を読み取って追記
 *
 * 初回だけ（手順は gas/README.md）
 *  - setApiKey() を実行 → 実行ログに出るキーを Cloudflare の環境変数 GAS_KEY に登録
 *  - installTrigger() を実行 → processInbox が5分おきに動くようになる
 *
 * 注意
 *  - スプシの1行目（列名）を目印に読み書きしているので、列名は変えないこと（列の追加は右端に）
 *  - 旧GAS（Japanese Applicants への転記）の定期実行は止めること。止めないと同じメールを新旧両方が取り込む
 */

const CONFIG = {
  SPREADSHEET_ID: '14E9vIHQ46Uew7gFElSsimWIAUnnk8jhXcukGmOKO_eQ',
  SHEET_JP: '生徒_JP',
  SHEET_INTL: '生徒_海外',
  SHEET_CLASSES: 'クラス一覧',
  TZ: 'Asia/Tokyo',

  // 新規申込の通知先
  NOTIFY_TO: 'admin@airpangaea.com',
  // 通知メールの件名の頭。SEARCH_QUERY に一致しない文言にしておくこと（自分の通知を取り込んでループしないため）
  NOTIFY_SUBJECT_PREFIX: '【TD受付通知】',

  // 受付完了の下書き（Gmail）。"Template/TD-EN受付" ラベル配下に、件名が完全一致する下書きが1通必要。本文の {name} に名前を差し込む
  DRAFT_LABEL: 'Template/TD-EN受付',
  DRAFT_SUBJECT: '【受付完了】TOMODACHI留学へのお申し込み（エアパンゲア）',

  // 海外の申込者に送るWhatsAppの定型文（{name} に名前が入る）
  WA_MESSAGE: 'Hi {name}! This is Go Akashi from TOMODACHI English (AirPangaea). Thank you for your application.',
};

// 定期実行で読み取るメール（旧GASと同じ条件）
//  ・Airtableの通知「【TOMODACHI留学・新規申込】」… 海外フォームの申込、またはLPの予備経路（本文の「■ 国:」で振り分け）
//  ・activo「あなたの団体へ応募が届きました！」… TD-ENの2入口（GAP＝「論理的な英語」／スタンダード＝「マンツーマン」）のみ
const SEARCH_QUERY = 'is:unread (' +
  'subject:"【TOMODACHI留学・新規申込】"' +
  ' OR (subject:"あなたの団体へ応募が届きました！" ("論理的な英語" OR "マンツーマン"))' +
')';

// WhatsAppリンク用の国番号（電話番号が 0 始まりの国内表記だった場合に付け替える）
const COUNTRY_CODES = {
  Japan: '81', Indonesia: '62', Malaysia: '60', Vietnam: '84', Thailand: '66',
  Taiwan: '886', Philippines: '63', Singapore: '65',
};

const STUDENT_ID_PREFIX = { jp: 'J', intl: 'G' };


/* ======================= Webアプリ ======================= */

/** LPからの申込（Cloudflare /api/apply から JSON で届く） */
function doPost(e) {
  let req;
  try {
    req = JSON.parse((e && e.postData && e.postData.contents) || '{}');
  } catch (err) {
    return json_({ ok: false, error: 'bad request' });
  }
  if (!isAuthorized_(req.key)) return json_({ ok: false, error: 'unauthorized' });
  if (req.action !== 'apply') return json_({ ok: false, error: 'unknown action' });

  const region = req.region === 'intl' ? 'intl' : 'jp';
  const d = req.data || {};
  if (!d.name) return json_({ ok: false, error: 'name required' });

  let added;
  try {
    added = addApplicant_(region, {
      source: req.source || 'LP',
      country: region === 'jp' ? 'Japan' : (d.country || ''),
      name: d.name, gender: d.gender, grade: d.grade, school: d.school,
      email: d.email, phone: d.phone, englishLevel: d.englishLevel, course: d.course,
      pref1: d.pref1, pref2: d.pref2, pref3: d.pref3, message: d.message,
    });
  } catch (err) {
    console.error('doPost addApplicant: ' + err);
    return json_({ ok: false, error: 'write failed' });
  }

  // ここから先が失敗しても申込はスプシに入っているので ok を返す（LP側が予備経路に回って二重登録しないように）
  try { notifyAdmin_(region, added); } catch (err) { console.error('notifyAdmin: ' + err); }
  if (region === 'jp') {
    try { createDraftFromTemplate_(d.name); } catch (err) { console.error('createDraft: ' + err); }
  }
  return json_({ ok: true, id: added.id });
}

/** LP の空き状況表示用（Cloudflare /api/slots から呼ばれる）。返すのはクラスの基本情報と空き状況だけ */
function doGet(e) {
  const p = (e && e.parameter) || {};
  if (!isAuthorized_(p.key)) return json_({ ok: false, error: 'unauthorized' });
  if (p.action === 'classes') return json_({ ok: true, classes: readClasses_() });
  return json_({ ok: false, error: 'unknown action' });
}

function readClasses_() {
  const rows = sheet_(CONFIG.SHEET_CLASSES).getDataRange().getDisplayValues();
  const head = rows.shift();
  const at = (r, name) => {
    const i = head.indexOf(name);
    return i === -1 ? '' : String(r[i]).trim();
  };
  return rows
    .filter(r => at(r, 'Group ID'))
    .map(r => ({
      groupId: at(r, 'Group ID'),
      type: at(r, '種別'),
      day: at(r, '曜日'),
      time: at(r, '時間(JST)').replace(/\D/g, '').padStart(4, '0'), // "20:30" → "2030"
      teacher: at(r, '講師'),
      jp: at(r, '空き_JP'),
      intl: at(r, '空き_海外'),
      term: at(r, 'ターム・開始日'),
    }));
}


/* ======================= 定期実行（Gmail読み取り） ======================= */

function processInbox() {
  const threads = GmailApp.search(SEARCH_QUERY, 0, 50);
  threads.forEach(thread => {
    thread.getMessages().forEach(message => {
      // スレッド内の既読メッセージ（過去の往復など）は対象外にして二重転記を防ぐ
      if (!message.isUnread()) return;
      const subject = message.getSubject();
      if (subject.indexOf(CONFIG.NOTIFY_SUBJECT_PREFIX) === 0) return;
      try {
        const body = message.getPlainBody() || message.getBody();
        const receivedAt = message.getDate();
        if (subject.includes('【TOMODACHI留学・新規申込】')) {
          handleAirtableMail_(body, receivedAt);
        } else if (subject.includes('あなたの団体へ応募が届きました！') &&
                   (body.includes('論理的な英語') || body.includes('マンツーマン'))) {
          handleActivoMail_(body, receivedAt);
        } else {
          return; // 対象外は未読のまま残す
        }
        message.markRead();
      } catch (err) {
        console.error('processInbox: ' + err + ' / subject=' + subject);
      }
    });
  });
}

/** Airtableの通知メール：海外フォームの申込、または LP の予備経路（スプシ登録に失敗した申込） */
function handleAirtableMail_(body, receivedAt) {
  const a = parseAirtableMail_(body);
  if (a.country === 'Japan') {
    // LPの予備経路。doPost が実は成功していた場合などに二重登録しない
    if (isDuplicate_(CONFIG.SHEET_JP, a.email, a.name)) return;
    addApplicant_('jp', Object.assign(a, { source: 'LP(予備経路)', receivedAt }));
    createDraftFromTemplate_(a.name);
  } else {
    // 通知メールに国名が無い（旧形式）場合も、日本のLPは doPost 経由になったので海外として扱う
    addApplicant_('intl', Object.assign(a, { country: a.country || '（不明）', source: 'Airtableフォーム', receivedAt }));
  }
}

function parseAirtableMail_(body) {
  const comments = splitComments_(extractValueUntil_(body, '■ 希望コース・コメント:', ['Airtableで確認', 'Airtable']));
  const grade = extractValueUntil_(body, '■ 学年:', ['■ 性別:']);
  return {
    country:      extractValueUntil_(body, '■ 国:', ['■ 名前:']),
    name:         extractValueUntil_(body, '■ 名前:', ['■ 学年:']),
    grade:        grade || comments.grade,
    gender:       extractValueUntil_(body, '■ 性別:', ['■ メール:']),
    email:        normalizeEmail_(extractValueUntil_(body, '■ メール:', ['■ 電話:'])),
    phone:        extractValueUntil_(body, '■ 電話:', ['■ 学校名:']),
    school:       extractValueUntil_(body, '■ 学校名:', ['■ 英語レベル:']),
    englishLevel: extractValueUntil_(body, '■ 英語レベル:', ['■ 希望コース']),
    course:       comments.course,
    pref1:        comments.pref1,
    pref2:        comments.pref2,
    pref3:        comments.pref3,
    message:      comments.message,
  };
}

/** apply.js が Comments に入れる【希望コース】【学年】【第n希望】の行を取り出し、残りを自由コメントとする */
function splitComments_(text) {
  const out = { course: '', grade: '', pref1: '', pref2: '', pref3: '', message: '' };
  const rest = [];
  String(text || '').split(/\r?\n/).forEach(line => {
    const m = line.trim().match(/^【(希望コース|学年|第([123])希望)】\s*(.*)$/);
    if (!m) { rest.push(line); return; }
    if (m[1] === '希望コース') out.course = m[3];
    else if (m[1] === '学年') out.grade = m[3];
    else out['pref' + m[2]] = m[3];
  });
  out.message = rest.join('\n').trim();
  return out;
}

/** activo の応募メール（第一〜第三希望日程つき） */
function handleActivoMail_(body, receivedAt) {
  const name = extractValueUntil_(body, '応募者の名前：', ['メールアドレス：']);
  addApplicant_('jp', {
    source: 'activo', country: 'Japan', receivedAt,
    name,
    phone:        extractValueUntil_(body, '電話番号：', ['学校名：']),
    school:       extractValueUntil_(body, '学校名：', ['性別：']),
    gender:       extractValueUntil_(body, '性別：', ['学年：']),
    grade:        extractValueUntil_(body, '学年：', ['英語レベル：']),
    englishLevel: extractValueUntil_(body, '英語レベル：', ['希望コース・プラン：']),
    course:       extractValueUntil_(body, '希望コース・プラン：', ['第一希望日程：']),
    pref1:        extractValueUntil_(body, '第一希望日程：', ['第二希望日程：']),
    pref2:        extractValueUntil_(body, '第二希望日程：', ['第三希望日程：']),
    pref3:        extractValueUntil_(body, '第三希望日程：', ['ーーー', '—————', '<応募対応に関するヒント>']),
    email:        '', // activoの本文にメールは無い（管理ページで確認）
  });
  createDraftFromTemplate_(name);
}


/* ======================= スプシへの書き込み ======================= */

/**
 * 申込を1行追加する。列は1行目の列名で探すので、列の並べ替えや右端への追加には影響されない
 * @return {{id:string, sheet:Sheet, row:number, data:Object}}
 */
function addApplicant_(region, a) {
  const lock = LockService.getScriptLock();
  lock.waitLock(30000);
  try {
    const sheet = sheet_(region === 'intl' ? CONFIG.SHEET_INTL : CONFIG.SHEET_JP);
    const cols = headerMap_(sheet);
    const id = nextStudentId_(sheet, cols, STUDENT_ID_PREFIX[region]);
    const existing = findExisting_(sheet, cols, a.email, a.phone);

    const values = {
      '生徒ID': id,
      '申込日時': Utilities.formatDate(a.receivedAt || new Date(), CONFIG.TZ, 'yyyy/MM/dd HH:mm:ss'),
      '経由': a.source,
      'ステータス': '新規',
      '国': a.country,
      '名前': a.name,
      '性別': a.gender,
      '学年': a.grade,
      '学校名': a.school,
      'Email': a.email,
      '電話': a.phone ? "'" + String(a.phone).trim() : '', // 先頭の0や+を残すため文字列として入れる
      '英語レベル': a.englishLevel,
      '希望コース': a.course,
      '第1希望': a.pref1,
      '第2希望': a.pref2,
      '第3希望': a.pref3,
      'コメント': a.message,
      '既存照合': existing ? '既存: ' + existing : '',
    };

    const row = new Array(sheet.getLastColumn()).fill('');
    Object.keys(values).forEach(k => {
      if (cols[k] === undefined) return;
      row[cols[k]] = k === '電話' ? values[k] : safeCell_(values[k]);
    });
    const r = sheet.getLastRow() + 1;
    sheet.getRange(r, 1, 1, row.length).setValues([row]);

    if (region === 'intl' && cols['WhatsApp'] !== undefined) {
      const link = waLink_(a.phone, a.country, a.name);
      if (link) sheet.getRange(r, cols['WhatsApp'] + 1).setFormula('=HYPERLINK("' + link + '","WhatsApp")');
    }
    SpreadsheetApp.flush();
    return { id, sheet, row: r, data: Object.assign({}, a, { id }) };
  } finally {
    lock.releaseLock();
  }
}

/** フォーム入力が =,+,-,@ で始まると数式として解釈されるので、文字列として入れる */
function safeCell_(v) {
  const s = String(v == null ? '' : v).trim();
  return /^[=+\-@]/.test(s) ? "'" + s : s;
}

function nextStudentId_(sheet, cols, prefix) {
  const last = sheet.getLastRow();
  if (last < 2 || cols['生徒ID'] === undefined) return prefix + '0001';
  const ids = sheet.getRange(2, cols['生徒ID'] + 1, last - 1, 1).getValues();
  let max = 0;
  ids.forEach(([v]) => {
    const m = String(v).match(new RegExp('^' + prefix + '(\\d+)$'));
    if (m) max = Math.max(max, Number(m[1]));
  });
  return prefix + String(max + 1).padStart(4, '0');
}

/** 過去の行とメール or 電話番号（下9桁）が一致したら、その生徒IDを返す */
function findExisting_(sheet, cols, email, phone) {
  const last = sheet.getLastRow();
  if (last < 2) return '';
  const all = sheet.getRange(2, 1, last - 1, sheet.getLastColumn()).getDisplayValues();
  const mail = String(email || '').trim().toLowerCase();
  const tel = phoneKey_(phone);
  for (let i = all.length - 1; i >= 0; i--) {
    const r = all[i];
    const rowMail = cols['Email'] !== undefined ? String(r[cols['Email']]).trim().toLowerCase() : '';
    const rowTel = cols['電話'] !== undefined ? phoneKey_(r[cols['電話']]) : '';
    if ((mail && rowMail === mail) || (tel && rowTel === tel)) return r[cols['生徒ID']] || '（ID無し）';
  }
  return '';
}

function phoneKey_(phone) {
  const d = String(phone || '').replace(/\D/g, '');
  return d.length >= 9 ? d.slice(-9) : '';
}

/** 予備経路の重複チェック：直近の行に同じ名前＋メールがあるか（再入会の生徒を弾かないよう直近20行だけ見る） */
function isDuplicate_(sheetName, email, name) {
  const sheet = sheet_(sheetName);
  const cols = headerMap_(sheet);
  const last = sheet.getLastRow();
  if (last < 2) return false;
  const from = Math.max(2, last - 19);
  const all = sheet.getRange(from, 1, last - from + 1, sheet.getLastColumn()).getDisplayValues();
  const mail = String(email || '').trim().toLowerCase();
  const nm = String(name || '').trim();
  return all.some(r =>
    String(r[cols['名前']]).trim() === nm &&
    (!mail || String(r[cols['Email']]).trim().toLowerCase() === mail));
}

function waLink_(phone, country, name) {
  const raw = String(phone || '').trim();
  let digits = raw.replace(/\D/g, '');
  if (!digits) return '';
  const cc = COUNTRY_CODES[country] || '';
  if (raw.charAt(0) === '+') {
    // 国番号つき
  } else if (digits.indexOf('00') === 0) {
    digits = digits.slice(2);
  } else if (cc && digits.charAt(0) === '0') {
    digits = cc + digits.slice(1);
  } else if (cc && digits.indexOf(cc) !== 0) {
    digits = cc + digits;
  }
  const text = CONFIG.WA_MESSAGE.replace(/\{name\}/g, name || '');
  return 'https://wa.me/' + digits + '?text=' + encodeURIComponent(text);
}


/* ======================= メール ======================= */

/** 管理者への新規申込通知（LPからの申込のみ。activo・Airtableはそのメール自体が通知になる） */
function notifyAdmin_(region, added) {
  const a = added.data;
  const where = region === 'jp' ? 'JP' : '海外(' + (a.country || '不明') + ')';
  const subject = CONFIG.NOTIFY_SUBJECT_PREFIX + where + '：' + a.name + (a.grade ? '（' + a.grade + '）' : '');
  const url = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getUrl() +
    '#gid=' + added.sheet.getSheetId() + '&range=A' + added.row;
  const lines = [
    'TOMODACHI留学の新規お申込みがありました！',
    '',
    '■ 生徒ID: ' + a.id,
    '■ 名前: ' + (a.name || ''),
    '■ 学年: ' + (a.grade || ''),
    '■ 性別: ' + (a.gender || ''),
    '■ メール: ' + (a.email || ''),
    '■ 電話: ' + (a.phone || ''),
    '■ 学校名: ' + (a.school || ''),
    '■ 英語レベル: ' + (a.englishLevel || ''),
    '■ 希望コース: ' + (a.course || ''),
    '■ 第1希望: ' + (a.pref1 || ''),
    '■ 第2希望: ' + (a.pref2 || ''),
    '■ 第3希望: ' + (a.pref3 || ''),
    '■ コメント:',
    a.message || '',
    '',
    'スプシで確認 → ' + url,
  ];
  MailApp.sendEmail(CONFIG.NOTIFY_TO, subject, lines.join('\n'));
}

/** 受付完了の下書きを作る（宛先は空。名前だけ差し込む） */
function createDraftFromTemplate_(name) {
  const label = GmailApp.getUserLabelByName(CONFIG.DRAFT_LABEL);
  if (!label) { console.log('label not found: ' + CONFIG.DRAFT_LABEL); return; }

  let templateBody = null;
  for (const th of label.getThreads()) {
    for (const msg of th.getMessages()) {
      if (msg.getSubject() === CONFIG.DRAFT_SUBJECT) { templateBody = msg.getBody(); break; }
    }
    if (templateBody) break;
  }
  if (!templateBody) { console.log('template not found: ' + CONFIG.DRAFT_SUBJECT); return; }

  GmailApp.createDraft(null, CONFIG.DRAFT_SUBJECT, '', { htmlBody: templateBody.replaceAll('{name}', name || '') });
}


/* ======================= 共通 ======================= */

function sheet_(name) {
  const sheet = SpreadsheetApp.openById(CONFIG.SPREADSHEET_ID).getSheetByName(name);
  if (!sheet) throw new Error('Sheet not found: ' + name);
  return sheet;
}

/** 1行目の列名 → 列番号（0始まり） */
function headerMap_(sheet) {
  const head = sheet.getRange(1, 1, 1, sheet.getLastColumn()).getDisplayValues()[0];
  const map = {};
  head.forEach((h, i) => { if (h) map[String(h).trim()] = i; });
  return map;
}

function isAuthorized_(key) {
  const expected = PropertiesService.getScriptProperties().getProperty('API_KEY');
  return !!expected && key === expected;
}

function json_(obj) {
  return ContentService.createTextOutput(JSON.stringify(obj)).setMimeType(ContentService.MimeType.JSON);
}

/** ラベル開始 → 次ラベル直前までを取得（全角/半角コロンのラベル両対応） */
function extractValueUntil_(body, label, nextLabels) {
  const esc = s => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const re = new RegExp(esc(label) + '\\s*([\\s\\S]+?)(?=' + nextLabels.map(esc).join('|') + ')');
  const m = String(body || '').match(re);
  return m ? m[1].trim() : '';
}

/** [addr](mailto:addr) などからアドレスだけ取り出す */
function normalizeEmail_(text) {
  if (!text) return '';
  const m = text.match(/[A-Za-z0-9._%+\-]+@[A-Za-z0-9.\-]+\.[A-Za-z]{2,}/);
  return m ? m[0] : text.trim();
}


/* ======================= 初回セットアップ（手動で1回だけ実行） ======================= */

/** Cloudflare と共有する合言葉を作って保存する。実行ログに出たキーを Cloudflare の GAS_KEY に登録 */
function setApiKey() {
  const key = (Utilities.getUuid() + Utilities.getUuid()).replace(/-/g, '');
  PropertiesService.getScriptProperties().setProperty('API_KEY', key);
  console.log('GAS_KEY = ' + key);
}

/** processInbox を5分おきに実行するトリガーを作る（既存の同名トリガーは作り直す） */
function installTrigger() {
  ScriptApp.getProjectTriggers()
    .filter(t => t.getHandlerFunction() === 'processInbox')
    .forEach(t => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('processInbox').timeBased().everyMinutes(5).create();
  console.log('processInbox trigger installed (every 5 min)');
}
