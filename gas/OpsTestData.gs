/***** テスト用のダミーデータ（テスト用のスプシにだけ貼る。本番の「TDEN 生徒管理」には入れない） *****
 *
 * メニュー「TD台帳」→「テスト用のダミーを入れ直す」で、生徒_JP・生徒_海外・クラス一覧・使い方を作り直す。
 * 生徒・メール・電話・学校名はすべて架空。クラスの並び（Group ID・講師・曜日・時間）は本番と同じ。
 * 日付は今日から計算するので、いつ入れ直しても、今月・来月の見どころ（新しい生徒・退会予定・支払い・差3など）が出る。
 * 本番と同じく、行は申込順で、生徒IDも申込順（J0001 がいちばん古い）。名前は、LPからの申込は英語、activo は日本語。
 * 本番の今と同じ形にするため、生徒_JP／生徒_海外には最近（10日以内）の申込だけを入れ、前からいる生徒は
 * 「旧名簿（テスト）」（クラス別シートと Japanese Applicants）に入れる。メニューの「旧名簿から今の生徒を取り込む」で試せる。
 * 列の整理を試せるよう、列は Phase 1 で作った並び（＋右端に 最終日・支払い済み〜・Wixパスワード）で入れる。
 * Ops.gs と同じプロジェクトに置く（OPS・opsMonth_ などを使う）。
 */

const OPS_TEST_JP_HEAD = ['生徒ID', '申込日時', '経由', 'ステータス', '国', '名前', 'Display name', '性別', '学年', '学校名', 'Email', '電話',
  'WhatsApp', '英語レベル', '希望コース', '第1希望', '第2希望', '第3希望', 'コメント', '提案クラス', '開始日', '既存照合', 'メモ', '最終日', 'Wixパスワード'];
const OPS_TEST_INTL_HEAD = OPS_TEST_JP_HEAD.slice(0, -1).concat(['支払い済み〜', 'Wixパスワード']);
const OPS_TEST_CLASS_HEAD = ['Group ID', '種別', '曜日', '時間(JST)', '講師', '空き_JP', '空き_海外', 'ターム・開始日', 'Zoom URL', '掲示板URL',
  'Class Student Info', 'スライド', 'Slackチャンネル', 'メモ'];

function opsTestFill() {
  opsRun_(opsTestFill_);
}

function opsTestFill_() {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  const ui = SpreadsheetApp.getUi();
  if (OPS.BOARD_FILE_ID || ss.getName().indexOf('テスト') === -1) {
    ui.alert('テスト用のスプシ（名前に「テスト」が入っているもの）でだけ使えます。');
    return;
  }
  if (ui.alert('ダミーを入れ直します', '生徒_JP・生徒_海外・クラス一覧・使い方を消して、ダミーで作り直します。進めますか？', ui.ButtonSet.OK_CANCEL) !== ui.Button.OK) return;

  const d = opsTestRows_(opsTodayKey_());
  const ours = [OPS.SHEET_JP, OPS.SHEET_INTL, OPS.SHEET_CLASSES, '使い方'];
  const firstId = ss.getSheets()[0].getSheetId();
  opsTestSheet_(ss, OPS.SHEET_JP, OPS_TEST_JP_HEAD, d.jp, { text: ['申込日時', '電話', 'Wixパスワード'], date: OPS_DATE_COLS });
  opsTestSheet_(ss, OPS.SHEET_INTL, OPS_TEST_INTL_HEAD, d.intl, { text: ['申込日時', '電話', 'Wixパスワード'], date: OPS_DATE_COLS });
  opsTestSheet_(ss, OPS.SHEET_CLASSES, OPS_TEST_CLASS_HEAD, d.classes, { text: ['時間(JST)'] });
  opsTestSheet_(ss, '使い方', ['項目', '説明'], d.howto, {});
  // ファイルを作った時の最初のシート（説明が数行だけ）は消す
  ss.getSheets().filter(s => s.getSheetId() === firstId && ours.indexOf(s.getName()) === -1 && s.getLastRow() <= 3)
    .forEach(s => ss.deleteSheet(s));

  // 入力規則（Phase 1 と同じ）と、ステータスの色
  const cls = ss.getSheetByName(OPS.SHEET_CLASSES);
  const list = (range, values) => range.setDataValidation(SpreadsheetApp.newDataValidation().requireValueInList(values, true).build());
  list(cls.getRange('B2:B200'), ['Standard', 'GAP', 'Assist']);
  list(cls.getRange('C2:C200'), ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun']);
  list(cls.getRange('F2:G200'), ['受付中', '途中参加', '満席', '非表示']);
  [OPS.SHEET_JP, OPS.SHEET_INTL].forEach(name => {
    const sh = ss.getSheetByName(name), head = opsHead_(sh);
    list(sh.getRange(2, head.indexOf('ステータス') + 1, 999, 1), OPS.STATUSES);
    sh.getRange(2, head.indexOf('提案クラス') + 1, 999, 1).setDataValidation(
      SpreadsheetApp.newDataValidation().requireValueInRange(cls.getRange('A2:A200'), true).setAllowInvalid(true).build());
    opsStatusColors_(sh);
  });
  opsTestWriteOld_(d.old);
  ss.setActiveSheet(ss.getSheetByName(OPS.SHEET_JP));
  ui.alert('ダミーを入れました', '次は、メニュー「TD台帳」の「列を整理する（最初に1回）」→「旧名簿から今の生徒を取り込む（最初に1回）」→「一覧表を今すぐ作り直す」の順にどうぞ。', ui.ButtonSet.OK);
}

const OPS_TEST_OLD_CLASS_HEAD = ['Group ID', 'Student ID', 'Display name', 'Full name', 'Gender', 'Email (Google Account)', 'Notes (if any)',
  '学年', 'School', '海外生WA', 'Password', 'DB 削除確認'];
const OPS_TEST_OLD_APP_HEAD = ['申し込み番号', '支払い', '確認メール', '申込日時', '経由', '名前', '国名', '性別', 'Eメール', '英語レベル', '学年',
  '学校名', '電話番号', '第１希望日程', '第２希望日程', '第３希望日程', 'ご要望など'];

/** 旧名簿（テスト）を作り直す。本番の旧名簿と同じく、Japanese Applicants とクラス別シート */
function opsTestWriteOld_(old) {
  const ss = opsTestFile_('OPS_TEST_OLD_ID', '旧名簿（テスト）');
  const write = (name, head, rows) => {
    const sheet = ss.getSheetByName(name) || ss.insertSheet(name, ss.getSheets().length);
    sheet.clear();
    const values = [head].concat(rows.map(r => head.map(h => (r[h] === undefined || r[h] === null) ? '' : r[h])));
    sheet.getRange(1, 1, values.length, head.length).setNumberFormat('@').setValues(values);
    sheet.getRange(1, 1, 1, head.length).setFontWeight('bold');
    return name;
  };
  const keep = [write(OPS.OLD_APPLICANTS_SHEETS[0], OPS_TEST_OLD_APP_HEAD, old.applicants)]
    .concat(old.sheets.map(sh => write(sh.name, OPS_TEST_OLD_CLASS_HEAD, sh.rows)));
  ss.getSheets().filter(sh => keep.indexOf(sh.getName()) === -1).forEach(sh => ss.deleteSheet(sh));
}

/** シートを作り直して表を入れる（前の列の束ね・入力規則・色も消える） */
function opsTestSheet_(ss, name, head, rows, fmt) {
  const old = ss.getSheetByName(name);
  const left = ss.getSheetByName(name + '（作成中）'); // 前に途中で止まった時の残り
  if (left) ss.deleteSheet(left);
  const sheet = ss.insertSheet(name + '（作成中）', ss.getSheets().length);
  if (old) ss.deleteSheet(old);
  sheet.setName(name);
  const values = [head].concat(rows.map(r => head.map(h => (r[h] === undefined || r[h] === null) ? '' : r[h])));
  const n = Math.max(values.length - 1, 1);
  (fmt.text || []).forEach(h => { const i = head.indexOf(h); if (i !== -1) sheet.getRange(2, i + 1, n, 1).setNumberFormat('@'); });
  (fmt.date || []).forEach(h => { const i = head.indexOf(h); if (i !== -1) sheet.getRange(2, i + 1, n, 1).setNumberFormat('yyyy/mm/dd'); });
  sheet.getRange(1, 1, values.length, head.length).setValues(values); // 日付は "2026/11/03" の文字で入れると日付になる
  sheet.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground(OPS_COLOR.head);
  sheet.setFrozenRows(1);
}

/** ダミーの表を作る（シートには書かない）。T は今日（20261019 のような数） */
function opsTestRows_(T) {
  const rnd = opsTestRandom_(20261019);
  const pick = a => a[Math.floor(rnd() * a.length)];
  const int = (a, b) => a + Math.floor(rnd() * (b - a + 1));
  const str = k => k ? Math.floor(k / 10000) + '/' + ('0' + Math.floor(k / 100) % 100).slice(-2) + '/' + ('0' + k % 100).slice(-2) : '';
  const m0 = opsMonth_(T, 0), m1 = opsMonth_(T, 1), mp = opsMonth_(T, -1);
  const dow = k => new Date(Date.UTC(Math.floor(k / 10000), Math.floor(k / 100) % 100 - 1, k % 100)).getUTCDay();
  const firstDay = (month, w) => { let k = month.start; while (dow(k) !== w) k = opsAddDays_(k, 1); return k; };
  const addMonths = (k, n) => { const m = opsMonth_(k, n); return m.start - 1 + Math.min(k % 100, 28); };
  // クラス一覧の「ターム・開始日」は、Class Structure の見出しと同じ書き方（例「Oct-Dec Term 2・10/5〜」）
  const term = (month, w, no) => OPS_MONTHS[month.m - 1] + '-' + OPS_MONTHS[(month.m + 1) % 12] + ' Term ' + no + '・' + opsMd_(firstDay(month, w)) + '〜';
  const recruit = (w, no) => 'Recruiting Class・Term ' + no + '・' + opsMd_(firstDay(m1, w)) + '〜';
  const DAY_JA = { Mon: '月曜', Tue: '火曜', Wed: '水曜', Thu: '木曜', Fri: '金曜' };

  const C = [ // Group ID, 曜日, 時間, 講師, 空き（LPと同じ）, ターム・開始日, メモ
    ['Mon2030JR', 'Mon', '20:30', 'Jomer', '満席', term(m0, 1, 3), ''],
    ['Mon2030M', 'Mon', '20:30', 'Marina', '途中参加', term(m0, 1, 2), ''],
    ['Mon2200JR', 'Mon', '22:00', 'Jomer', '途中参加', term(m0, 1, 4), ''],
    ['Mon2200M', 'Mon', '22:00', 'Marina', '満席', term(m0, 1, 1), ''],
    ['Tue2030JR', 'Tue', '20:30', 'Jomer', '受付中', recruit(2, 1), '新しいクラス（来月から）'],
    ['Tue2030N', 'Tue', '20:30', 'Nerissa', '受付中', recruit(2, 1), ''],
    ['Tue2200JR', 'Tue', '22:00', 'Jomer', '満席', term(m0, 2, 5), ''],
    ['Tue2200N', 'Tue', '22:00', 'Nerissa', '満席', term(m0, 2, 2), ''],
    ['Wed2030JR', 'Wed', '20:30', 'Jomer', '満席', term(m0, 3, 2), ''],
    ['Wed2030N', 'Wed', '20:30', 'Nerissa', '満席', term(m0, 3, 6), ''],
    ['Wed2200JR', 'Wed', '22:00', 'Jomer', '受付中', term(m1, 3, 3), '来月から Term 3'],
    ['Wed2200N', 'Wed', '22:00', 'Nerissa', '満席', term(m0, 3, 4), ''],
    ['Thu2030N', 'Thu', '20:30', 'Nerissa', '満席', term(mp, 4, 2), ''],
    ['Thu2200N', 'Thu', '22:00', 'Nerissa', '満席', term(mp, 4, 5), ''],
    ['Fri2030N', 'Fri', '20:30', 'Nerissa', '途中参加', term(m0, 5, 1), ''],
    ['Fri2200N', 'Fri', '22:00', 'Nerissa', '満席', term(m0, 5, 3), ''],
  ];
  const byId = {};
  C.forEach(c => { byId[c[0]] = c; });
  const pref = id => { const c = byId[id]; return DAY_JA[c[1]] + ' ' + c[2] + '-' + (c[2] === '20:30' ? '21:30' : '23:00') + ' ' + c[3] + '講師'; };

  const FAM = [['佐藤', 'Sato'], ['鈴木', 'Suzuki'], ['高橋', 'Takahashi'], ['田中', 'Tanaka'], ['伊藤', 'Ito'], ['渡辺', 'Watanabe'], ['山本', 'Yamamoto'],
    ['中村', 'Nakamura'], ['小林', 'Kobayashi'], ['加藤', 'Kato'], ['吉田', 'Yoshida'], ['山田', 'Yamada'], ['佐々木', 'Sasaki'], ['山口', 'Yamaguchi'],
    ['松本', 'Matsumoto'], ['井上', 'Inoue'], ['木村', 'Kimura'], ['林', 'Hayashi'], ['清水', 'Shimizu'], ['森', 'Mori'], ['池田', 'Ikeda'],
    ['橋本', 'Hashimoto'], ['阿部', 'Abe'], ['石川', 'Ishikawa']];
  const GIV = [['陽向', 'Hinata', '男'], ['結衣', 'Yui', '女'], ['蓮', 'Ren', '男'], ['葵', 'Aoi', '女'], ['湊', 'Minato', '男'], ['陽菜', 'Hina', '女'],
    ['悠真', 'Yuma', '男'], ['芽衣', 'Mei', '女'], ['大翔', 'Hiroto', '男'], ['莉子', 'Riko', '女'], ['颯', 'Hayate', '男'], ['美桜', 'Mio', '女'],
    ['律', 'Ritsu', '男'], ['紬', 'Tsumugi', '女'], ['樹', 'Itsuki', '男'], ['澪', 'Rei', '女'], ['奏太', 'Sota', '男'], ['彩花', 'Ayaka', '女'],
    ['健', 'Ken', '男'], ['心春', 'Koharu', '女'], ['碧', 'Aoi', '男'], ['楓', 'Kaede', '女'], ['拓海', 'Takumi', '男'], ['花音', 'Kanon', '女']];
  const IG = [['Putri', 'F'], ['Rizky', 'M'], ['Nadia', 'F'], ['Bima', 'M'], ['Citra', 'F'], ['Fajar', 'M'], ['Dewi', 'F'], ['Galih', 'M'], ['Intan', 'F'],
    ['Raka', 'M'], ['Salsa', 'F'], ['Yoga', 'M'], ['Ayu', 'F'], ['Bayu', 'M'], ['Dimas', 'M'], ['Eka', 'F'], ['Hafiz', 'M'], ['Wulan', 'F'], ['Lala', 'F'],
    ['Nisa', 'F'], ['Adit', 'M'], ['Tasya', 'F'], ['Reza', 'M'], ['Mega', 'F'], ['Arif', 'M'], ['Sinta', 'F'], ['Bagas', 'M'], ['Laras', 'F'], ['Iqbal', 'M'],
    ['Vina', 'F'], ['Gita', 'F'], ['Nabila', 'F']];
  const IF = ['Pratama', 'Anggraini', 'Saputra', 'Wijaya', 'Lestari', 'Hidayat', 'Kusuma', 'Santoso', 'Permata', 'Nugroho', 'Wibowo', 'Rahma', 'Setiawan',
    'Utami', 'Hakim', 'Sari', 'Fitri', 'Tari', 'Ayu'];
  const LEVEL_JP = ['英検3級相当', '英検準2級相当', '英検準2級相当', '英検2級相当', '英検2級相当', '英検準1級相当', 'わからないので相談したい'];
  const used = {};
  const password = () => { let s = 'td'; for (let i = 0; i < 6; i++) s += 'abcdefghjkmnpqrstuvwxyz23456789'.charAt(Math.floor(rnd() * 31)); return s; };
  const jp = [], intl = [];

  // name は [漢字, ローマ字(名 姓), Display name, 性別] で渡す（無ければ作る）
  const addJp = (cid, o) => {
    o = o || {};
    let name = o.name;
    while (!name) {
      const f = pick(FAM), g = pick(GIV), kanji = f[0] + ' ' + g[0];
      if (!used[kanji]) name = [kanji, g[1] + ' ' + f[1], g[1] + ' ' + f[1].charAt(0) + '.', g[2]];
    }
    used[name[0]] = 1;
    const status = o.status || '在籍';
    const start = o.start !== undefined ? o.start : (['在籍', '休会', '退会'].indexOf(status) !== -1 ? opsAddDays_(T, -int(40, 210)) : 0);
    const applied = Math.min(o.applied || (opsTestPending_(status) ? opsAddDays_(T, -int(1, 9)) :
      start ? opsAddDays_(start, -int(10, 30)) : opsAddDays_(T, -int(1, 18))), opsAddDays_(T, -1));
    const via = o.via || pick(['LP', 'LP', 'LP', 'activo']);
    jp.push({
      '申込日時': str(applied) + ' ' + ('0' + int(9, 22)).slice(-2) + ':' + ('0' + int(0, 59)).slice(-2) + ':00',
      '経由': via, 'ステータス': status, '国': 'Japan', '名前': via === 'activo' ? name[0] : name[1],
      'Display name': o.noDisplay ? '' : name[2], '性別': name[3], '学年': pick(['中学1年生', '中学2年生', '中学3年生', '高校1年生', '高校2年生', '高校3年生']),
      '学校名': pick(['テスト中学校', 'テスト高校', 'サンプル学園']), 'WhatsApp': '', '英語レベル': pick(LEVEL_JP), '希望コース': 'スタンダード',
      '第1希望': cid ? pref(cid) : '', '第2希望': '', '第3希望': '', 'コメント': '', '提案クラス': cid || '', '開始日': str(start), '既存照合': '',
      'メモ': o.memo || '', '最終日': str(o.end || 0),
      'Wixパスワード': (!o.noPassword && ['在籍', '休会', '退会'].indexOf(status) !== -1) ? password() : '',
    });
  };
  const addIntl = (cid, o) => {
    o = o || {};
    let name = o.name;
    while (!name) {
      const g = pick(IG), full = g[0] + ' ' + pick(IF);
      if (!used[full]) name = [full, g[1] === 'M' ? 'Male' : 'Female'];
    }
    used[name[0]] = 1;
    const status = o.status || '在籍';
    const start = o.start !== undefined ? o.start : (['在籍', '退会'].indexOf(status) !== -1 ? opsAddDays_(T, -int(40, 210)) : 0);
    let paid = o.paid;
    if (paid === undefined && status === '在籍' && start && start < T) { // 3か月ごとに払ってもらっている
      let p = start;
      while (p < opsAddDays_(T, 15)) p = addMonths(p, 3);
      paid = opsAddDays_(p, -1);
    }
    const parts = name[0].split(' ');
    intl.push({
      '申込日時': str(Math.min(o.applied || (opsTestPending_(status) ? opsAddDays_(T, -int(1, 9)) : opsAddDays_(start || T, -int(7, 25))), opsAddDays_(T, -1))) +
        ' 20:' + ('0' + int(0, 59)).slice(-2) + ':00', '経由': 'LP',
      'ステータス': status, '国': 'Indonesia', '名前': name[0], 'Display name': o.noDisplay ? '' : parts[0] + ' ' + parts[1].charAt(0) + '.',
      '性別': name[1], '学年': 'Grade ' + int(7, 12), '学校名': pick(['SMP Test', 'SMA Sample', 'SMP Contoh']), 'WhatsApp': '',
      '英語レベル': pick(['Basic', 'Intermediate', 'Intermediate', 'Upper intermediate']), '希望コース': '', '第1希望': cid ? pref(cid) : '', '第2希望': '', '第3希望': '',
      'コメント': '', '提案クラス': cid || '', '開始日': str(start), '既存照合': '', 'メモ': o.memo || '', '最終日': str(o.end || 0),
      '支払い済み〜': str(paid || 0), 'Wixパスワード': (!o.noPassword && status === '在籍') ? password() : '',
    });
  };
  const times = (n, f) => { for (let i = 0; i < n; i++) f(); };
  const tue1 = firstDay(m1, 2), wed1 = firstDay(m1, 3);
  const classIds = C.map(c => c[0]);

  // Marina
  addJp('Mon2030M', { name: ['田中 遥', 'Haru Tanaka', 'Haru T.', '男'], start: opsAddDays_(T, -190) });
  addJp('Mon2030M', { name: ['森 空', 'Sora Mori', 'Sora M.', '男'], start: opsAddDays_(T, -160) });
  addJp('Mon2030M', { name: ['山田 晴', 'Haru Yamada', 'Haru Y.', '男'], start: Math.max(m0.start, opsAddDays_(T, -7)), noPassword: true });
  addJp('Mon2030M', { name: ['松本 陽菜', 'Hina Matsumoto', 'Hina M.', '女'], status: '支払待ち', start: opsAddDays_(T, -7) });
  addIntl('Mon2030M', { name: ['Putri Anggraini', 'Female'], start: opsAddDays_(T, -105), end: m0.end, paid: opsAddDays_(T, -14), noDisplay: true, memo: 'アンケートで「続けない」' });
  addIntl('Mon2030M', { name: ['Rizky Pratama', 'Male'], status: '支払待ち', start: opsAddDays_(T, -14) });
  addIntl('Mon2030M', { name: ['Nadia Lestari', 'Female'], start: opsAddDays_(T, -42), paid: opsAddDays_(T, 48) });
  addIntl('Mon2030M', { name: ['Bima Wijaya', 'Male'], start: opsAddDays_(T, -77), paid: opsAddDays_(T, 6) });
  times(5, () => addJp('Mon2200M'));
  times(5, () => addIntl('Mon2200M'));
  addJp('Mon2200M', { name: ['高橋 奏', 'Kanade Takahashi', 'Kanade T.', '女'], status: '空き待ち', memo: '来月からを希望' });

  // Jomer
  times(5, () => addJp('Mon2030JR'));
  times(5, () => addIntl('Mon2030JR'));
  times(3, () => addJp('Mon2200JR'));
  addJp('Mon2200JR', { name: ['中村 葵', 'Aoi Nakamura', 'Aoi N.', '女'], start: opsAddDays_(T, -160), end: opsAddDays_(T, -5), memo: '部活のため退会' });
  addJp('Mon2200JR', { name: ['森 陽向', 'Hinata Mori', 'Hinata M.', '男'], start: opsAddDays_(T, 7), noPassword: true });
  times(3, () => addIntl('Mon2200JR'));
  addIntl('Mon2200JR', { name: ['Wulan Tari', 'Female'], start: opsAddDays_(T, -35), paid: opsAddDays_(T, -6) });
  addJp('Tue2030JR', { name: ['鈴木 陸', 'Riku Suzuki', 'Riku S.', '男'], status: '支払待ち', start: tue1 });
  addJp('Tue2030JR', { name: ['伊藤 湊', 'Minato Ito', 'Minato I.', '男'], status: '提案中', start: tue1, noDisplay: true });
  addIntl('Tue2030JR', { name: ['Lala Kusuma', 'Female'], start: tue1, paid: opsAddDays_(addMonths(tue1, 3), -1) });
  addIntl('Tue2030JR', { name: ['Nisa Fitri', 'Female'], start: tue1, paid: 0 });
  times(5, () => addJp('Tue2200JR'));
  times(5, () => addIntl('Tue2200JR'));
  addIntl('Tue2200JR', { name: ['Nabila Sari', 'Female'], status: '空き待ち', memo: '再来月から' });
  times(4, () => addJp('Wed2030JR'));
  addJp('Wed2030JR', { name: ['吉田 莉緒', 'Rio Yoshida', 'Rio Y.', '女'], start: opsAddDays_(T, -190), end: m1.start + 24 });
  times(5, () => addIntl('Wed2030JR'));
  addJp('Wed2200JR', { name: ['佐藤 芽衣', 'Mei Sato', 'Mei S.', '女'], start: wed1, applied: opsAddDays_(T, -230), memo: opsMd_(opsAddDays_(T, 7)) + 'まで Mon2200JR（クラス変更）' });
  addJp('Wed2200JR', { name: ['石川 恵', 'Kei Ishikawa', 'Kei I.', '男'], start: wed1 });
  addJp('Wed2200JR', { name: ['阿部 花', 'Hana Abe', 'Hana A.', '女'], start: wed1 });
  addJp('Wed2200JR', { name: ['小林 蒼', 'Aoi Kobayashi', '', '男'], status: '支払待ち', start: wed1, noDisplay: true });
  addIntl('Wed2200JR', { name: ['Gita Ayu', 'Female'], start: wed1, paid: opsAddDays_(addMonths(wed1, 3), -1) });

  // Nerissa
  addJp('Tue2030N', { start: tue1 });
  addJp('Tue2030N', { status: '支払待ち', start: tue1 });
  addIntl('Tue2030N', { start: tue1, paid: opsAddDays_(addMonths(tue1, 3), -1) });
  addIntl('Tue2030N', { start: tue1, paid: 0 });
  ['Tue2200N', 'Wed2030N', 'Wed2200N', 'Thu2200N', 'Fri2200N'].forEach(cid => { times(5, () => addJp(cid)); times(5, () => addIntl(cid)); });
  times(4, () => addJp('Thu2030N'));
  addJp('Thu2030N', { status: '休会', start: opsAddDays_(T, -220), memo: '受験のため休会' });
  times(5, () => addIntl('Thu2030N'));
  times(4, () => addJp('Fri2030N'));
  times(3, () => addIntl('Fri2030N'));

  // 席に関係しない行（本番のシートには、入会しなかった人や、やめた人もたくさん並ぶ）
  addJp('', { name: ['加藤 結', 'Yui Kato', 'Yui K.', '女'], status: '新規', applied: opsAddDays_(T, -7) });
  addJp('', { name: ['渡辺 蓮', 'Ren Watanabe', 'Ren W.', '男'], status: '新規', applied: opsAddDays_(T, -1), via: 'activo' });
  times(7, () => addJp('', { status: '見送り', applied: opsAddDays_(T, -int(20, 330)) }));
  times(7, () => { const s = opsAddDays_(T, -int(250, 420)); addJp(pick(classIds), { status: '退会', start: s, end: opsAddDays_(s, int(90, 200)) }); });
  times(3, () => addIntl('', { status: '見送り', applied: opsAddDays_(T, -int(20, 300)) }));
  times(4, () => { const s = opsAddDays_(T, -int(250, 420)); addIntl(pick(classIds), { status: '退会', start: s, end: opsAddDays_(s, int(90, 180)) }); });

  // 本番と同じく、申込順に並べて、生徒IDも申込順に振る（J0001 がいちばん古い）
  const byApplied = (a, b) => a['申込日時'] < b['申込日時'] ? -1 : a['申込日時'] > b['申込日時'] ? 1 : 0;
  const number = (rows, prefix) => rows.sort(byApplied).map((r, i) => {
    const id = prefix + ('000' + (i + 1)).slice(-4);
    return Object.assign({ '生徒ID': id }, r, { 'Email': id.toLowerCase() + '@example.com', '電話': (prefix === 'J' ? '090-0000-' : '+62 800-0000-') + id.slice(1) });
  });
  const classes = C.map(c => {
    const r = {};
    OPS_TEST_CLASS_HEAD.forEach(h => { r[h] = ''; });
    return Object.assign(r, { 'Group ID': c[0], '種別': 'Standard', '曜日': c[1], '時間(JST)': c[2], '講師': c[3], '空き_JP': c[4], '空き_海外': c[4], 'ターム・開始日': c[5], 'メモ': c[6] });
  });
  const howto = [
    ['このスプシ', 'テスト用です。生徒・メール・電話・学校名はすべて架空です。本番の「TDEN 生徒管理」やLPとはつながっていません。'],
    ['① 列を整理する', 'メニュー「TD台帳」→「列を整理する（最初に1回）」。生徒_JP・生徒_海外の列が「いつも見る → クラス分け → 申込の時だけ（畳む）」の順に並び、ステータスで行に色が付きます。クラス一覧の「ターム・開始日」が「ターム」と「ターム開始日」に分かれます。'],
    ['①の次 取り込む', '「旧名簿から今の生徒を取り込む（最初に1回）」。マイドライブの「旧名簿（テスト）」のクラス別シートから今の生徒を読み、Japanese Applicants の申込日時などを付けて入れます。最後に申込順に並べ直し、生徒IDも振り直します。'],
    ['② 一覧表を作る', '「一覧表を今すぐ作り直す」。このスプシの「一覧表_今月／来月」（あなた用・名前を押すと生徒の行が開く）、マイドライブの「Class Structure（自動・テスト）」（スタッフ・講師用・リンク無し）、「スタッフ用の名簿（自動・テスト）」（クラス別シート）ができます。'],
    ['③ 変えてみる', '生徒の行のステータス・クラス・開始日・最終日・支払い済み〜を変えて、②をもう一度。一覧表が変わります。'],
    ['④ 見張りメール', '「見張りメールを今すぐ送る」。自分宛てに【TD週1チェック】のメールが届きます。'],
    ['⑤ 月の記録', '「今の一覧表を記録する（タブとPDF）」。記録のタブと、マイドライブの「TD 月の記録（テスト）」にPDFができます。'],
    ['入れ直す', '「テスト用のダミーを入れ直す」で、いつでも最初の状態に戻せます。日付は今日から計算し直します。'],
    ['自動の更新', 'テストでは入れなくても大丈夫です（入れると5分おき・月末・月曜の朝に動きます）。'],
  ].map(r => ({ '項目': r[0], '説明': r[1] }));
  // 本番の今と同じ形に分ける：生徒シートには最近（10日以内）の申込だけ、前からの生徒は旧名簿に
  const jpAll = number(jp, 'J'), intlAll = number(intl, 'G');
  const cutoff = str(opsAddDays_(T, -10));
  const recent = r => r['申込日時'] >= cutoff;
  const applicants = jpAll.concat(intlAll).filter(r => !recent(r)).sort(byApplied).map((r, i) => ({
    '申し込み番号': i + 1, '申込日時': r['申込日時'], '経由': r['経由'], '名前': r['名前'], '国名': r['国'], '性別': r['性別'],
    'Eメール': r['Email'], '英語レベル': r['英語レベル'], '学年': r['学年'], '学校名': r['学校名'], '電話番号': r['電話'],
    'ご要望など': r['第1希望'] ? '第1希望: ' + r['第1希望'] : '',
  }));
  // クラス別シート：今の生徒（支払いが済んで入った生徒。席番号は始めた順）、空の行、やめた生徒
  const inClass = r => (r['ステータス'] === '在籍' || r['ステータス'] === '休会') && !(opsKey_(r['最終日']) && opsKey_(r['最終日']) < T);
  const toOld = (r, seat) => ({
    'Group ID': r['提案クラス'], 'Student ID': seat, 'Display name': r['Display name'] || opsShortName_(r['名前']), 'Full name': r['名前'],
    'Gender': r['性別'], 'Email (Google Account)': r['Email'], 'Notes (if any)': r['英語レベル'], '学年': r['学年'], 'School': r['学校名'],
    '海外生WA': r['国'] === 'Japan' ? '' : r['電話'], 'Password': r['Wixパスワード'],
  });
  const sheets = C.map(c => {
    const now = [], past = [];
    [['JP-', jpAll], ['ID-', intlAll]].forEach(([prefix, all]) => {
      all.filter(r => r['提案クラス'] === c[0] && inClass(r)).sort((a, b) => a['開始日'] < b['開始日'] ? -1 : 1)
        .forEach((r, i) => now.push(toOld(r, prefix + ('0' + (i + 1)).slice(-2))));
      all.filter(r => r['提案クラス'] === c[0] && r['ステータス'] === '退会').forEach(r => past.push(toOld(r, '')));
    });
    return { name: c[0], rows: past.length ? now.concat([{}], past) : now };
  });
  // 閉じたクラスのシート（クラス一覧に無いので、取り込みでは読まない）
  sheets.push({ name: 'Thu2030JR', rows: [{ 'Group ID': 'Thu2030JR', 'Student ID': 'JP-01', 'Display name': 'Old S.', 'Full name': 'Old Student' }] });
  const renumber = (rows, prefix) => rows.map((r, i) => Object.assign({}, r, { '生徒ID': prefix + ('000' + (i + 1)).slice(-4) }));
  return {
    jp: renumber(jpAll.filter(recent), 'J'), intl: renumber(intlAll.filter(recent), 'G'), classes, howto,
    all: { jp: jpAll, intl: intlAll }, old: { applicants, sheets },
  };
}

/** まだ席が決まっていない（旧名簿のクラスシートに入る前の）ステータス */
function opsTestPending_(status) {
  return ['新規', '提案中', '支払待ち', '空き待ち'].indexOf(status) !== -1;
}

/** 毎回同じダミーになるよう、種から作る乱数 */
function opsTestRandom_(seed) {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6D2B79F5) >>> 0;
    let t = a;
    t = Math.imul(t ^ (t >>> 15), t | 1);
    t ^= t + Math.imul(t ^ (t >>> 7), t | 61);
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}
