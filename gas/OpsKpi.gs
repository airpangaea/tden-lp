/***** KPI ダッシュボードの実績を台帳から書く（OpsKpi） *****
 *
 * スプシ「TOMODACHI留学_KPI_v3.1」（タブ v3.1）の実績の行のうち、台帳から出せるものを毎晩書く。
 * Ops.gs と同じプロジェクトに別ファイルで置く（関数・定数は opsKpi／OPS_KPI で始める）。
 * 毎晩23時の opsDaily から呼ばれる（新しいトリガーは要らない）。メニュー「KPI を今すぐ書く」でも動く。
 *
 * 書く行（ほかの行・式・手入力には触らない）
 *  - フォーム申込数 … 生徒_JP の「申込日時」の月。経由は問わない（LP も activo も）。「既存照合」が入っている行（前からいる生徒の申込）は数えない
 *  - 新規入会数(JP) … 受講で、その人の最初のレッスン（開始日）の月
 *  - 復帰 … 一度去った人が、また受講を始めた月。受講のメモに「復帰」と書いた人も（台帳に前の履歴が無い人のため）
 *  - 退会者数（休会を含む） … 最終日の「翌月」の欄。次の受講の開始日が最終日の翌月中なら、続き（クラス替え・GAP への切り替え）として数えない
 *  - MRR実績（OS） … その月に受講している海外生の人数 × OS単価（シートの B 列。2クラスでも1人分）
 *  - GAP新規・うち直行新規・GAP離脱・うちコンボ … 受講で、クラス一覧の種別が GAP のクラス。日本生だけ。離脱も翌月の欄
 *  誰を数えたかは、そのセルのメモ（右上の黒い三角）に書く。
 *
 * 書く月：自動で書き始める月（OPS_KPI.FROM＝2026/12。フォーム申込数・MRR（OS）は 2026/11）以降の、先月・今月・来月（先月より前の欄はもう変えない）。
 *         フォーム申込数・MRR（OS）・コンボは今月まで（来月の欄に 0 を入れると CV などの式がずれるため）。
 *         来月の欄がシートに無ければ、右端の月の列を写して作る（式は写し、手入力のセルは空にする）。
 * 書かない行：MRR実績（JP / Stripe）と広告費（毎月1日に Claude が Stripe とマネーフォワードから入れる）、調整、式の行。
 *
 * 見張りメール（Ops.gs の opsWatchItems_ から呼ばれる）
 *  - Stripe で請求していない在籍生／Stripe で請求しているのに受講していない人（スクリプトプロパティ STRIPE_KEY がある時だけ）
 *  - 休会のまま1年を過ぎた人（退会にするか決める）
 *
 * 設定（スクリプトプロパティ）
 *  - KPI_FILE_ID … KPI のスプシのID。空なら「KPI（自動・テスト）」を新しく作って書く（テスト用）
 *  - STRIPE_KEY … Stripe の制限付きキー（Customers・Subscriptions の読み取りだけ）。メニュー「Stripe のキーを入れる」から
 */

const OPS_KPI = {
  FILE_PROP: 'KPI_FILE_ID',
  TEST_PROP: 'OPS_TEST_KPI_ID',
  STRIPE_PROP: 'STRIPE_KEY',
  TAB: 'v3.1',
  FROM: 202612,          // この月の欄から自動で書く（2026/11 までは手入力のまま）
  FROM_ROW: { forms: 202611, mrrOs: 202611 }, // 行ごとに早く始めるもの（11月の申込数・海外の人数は台帳からしか出せないため）
  OS_PRICE_LABEL: 'OS単価',
  // A 列の見出しの書き出し（前の全角の空白は無視）→ 中で使う名前
  ROWS: [
    ['フォーム申込数', 'forms'],
    ['新規入会数(JP)', 'newJp'],
    ['復帰', 'back'],
    ['退会者数', 'leave'],
    ['MRR実績（OS）', 'mrrOs'],
    ['GAP新規', 'gapNew'],
    ['うち直行新規', 'gapDirect'],
    ['GAP離脱', 'gapOut'],
    ['うちコンボ', 'combo'],
  ],
  UPTO_THIS_MONTH: ['forms', 'mrrOs', 'combo'], // 来月の欄には書かない行
  BACK_WORD: '復帰',
  RECESS_DAYS: 365,      // 休会がこれを過ぎたら見張りメールに出す
};

function opsKpiRunNow() {
  opsRun_(() => {
    const res = opsKpiRun_();
    opsShowLink_('KPI を書きました（' + res.months.join('・') + '）', res.url, 'KPI を開く');
  });
}

/** Stripe の制限付きキーを入れる（Customers・Subscriptions の読み取りだけのキー） */
function opsKpiSetStripeKey() {
  opsRun_(() => {
    const ui = SpreadsheetApp.getUi();
    const res = ui.prompt('Stripe の制限付きキー',
      'Stripe → 開発者 → API キー → 制限付きのキーを作成（Customers と Subscriptions を「読み取り」、ほかは「なし」）で作ったキー（rk_live_…）を貼ってください。',
      ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const key = res.getResponseText().trim();
    if (!/^rk_(live|test)_\w+$/.test(key)) throw new Error('キーの形が違います（rk_live_ で始まる制限付きキーを使ってください。sk_ で始まる秘密キーは使いません）');
    PropertiesService.getScriptProperties().setProperty(OPS_KPI.STRIPE_PROP, key);
    const subs = opsKpiStripeSubs_();
    SpreadsheetApp.getActiveSpreadsheet().toast('キーを入れました（請求中のサブスク ' + subs.filter(x => !x.paused).length + '件・一時停止 ' + subs.filter(x => x.paused).length + '件）', 'Stripe', 8);
  });
}

/** 毎晩（opsDaily から）。失敗しても台帳のほかの処理は止めない */
function opsKpiDaily_() {
  if (new Date().getDate() !== 1) return; // 書くのは毎月1日だけ（途中で見たい時はメニュー「KPI を今すぐ書く」）
  try { opsKpiRun_(); } catch (err) { console.error('KPI: ' + (err && err.message || err)); }
}


/* ======================= 書く ======================= */

function opsKpiRun_() {
  const data = opsData_();
  const today = data.today;
  const sheet = opsKpiSheet_();
  const thisYm = Math.floor(today / 100);
  const fromOf = key => OPS_KPI.FROM_ROW[key] || OPS_KPI.FROM;
  const first = Math.min.apply(null, OPS_KPI.ROWS.map(([, key]) => fromOf(key)));
  const months = [-1, 0, 1].map(n => opsKpiYmAdd_(thisYm, n)).filter(ym => ym >= first);
  if (!months.length) return { months: [], url: sheet.getParent().getUrl() };
  let layout = opsKpiLayout_(sheet);
  months.forEach(ym => { if (!layout.cols[ym]) { opsKpiAddMonth_(sheet, layout, ym); layout = opsKpiLayout_(sheet); } });

  const res = opsKpiCompute_(opsKpiInput_(data), months);
  const price = opsKpiOsPrice_(sheet);
  const stamp = '自動（台帳から・' + Utilities.formatDate(new Date(), OPS.TZ, 'M/d HH:mm') + '）';
  months.forEach(ym => {
    const col = layout.cols[ym], m = res[ym];
    OPS_KPI.ROWS.forEach(([, key]) => {
      const row = layout.rows[key];
      if (!row || ym < fromOf(key)) return;
      if (OPS_KPI.UPTO_THIS_MONTH.indexOf(key) !== -1 && ym > thisYm) return;
      const cell = sheet.getRange(row, col);
      if (cell.getFormula()) return; // 式のセルには書かない
      const list = m[key];
      let value = list.length, note = list.length ? list.join('\n') : 'なし';
      if (key === 'mrrOs') {
        if (!price) return;
        value = list.length * price;
        note = '海外生 ' + list.length + '人 × ' + price + '円\n' + list.join('、');
      }
      cell.setValue(value).setNote(stamp + '\n' + note);
    });
  });
  return { months: months.map(opsKpiYmText_), url: sheet.getParent().getUrl() };
}

/** 台帳を、計算に使う形にする（名前は Display name だけ） */
function opsKpiInput_(data) {
  const gap = {};
  data.classes.forEach(c => { if (/gap/i.test(c.type)) gap[c.id] = true; });
  return {
    enrolls: data.enrolls.filter(e => e.sid).map(e => ({ sid: e.sid, name: e.name || (e.st && e.st.display) || e.sid, cls: e.cls, start: e.start, end: e.end, memo: e.memo })),
    gap,
    forms: data.students.filter(s => s.region === 'jp' && s.applied).map(s => ({ applied: s.applied, existing: !!opsStr_(s.existing), label: (s.hasDisplay ? s.display : s.id) + '（' + s.id + '・' + opsMd_(s.applied) + '）' })),
  };
}


/* ======================= 数える（GAS を使わない。手元でも試せる） ======================= */

const opsKpiYm_ = k => Math.floor(k / 100);                       // 20261124 → 202611
const opsKpiYmIndex_ = ym => Math.floor(ym / 100) * 12 + (ym % 100) - 1;
const opsKpiYmFromIndex_ = i => Math.floor(i / 12) * 100 + (i % 12) + 1;
const opsKpiYmAdd_ = (ym, n) => opsKpiYmFromIndex_(opsKpiYmIndex_(ym) + n);
const opsKpiYmText_ = ym => Math.floor(ym / 100) + '/' + ('0' + ym % 100).slice(-2);
const opsKpiMd_ = k => (Math.floor(k / 100) % 100) + '/' + (k % 100);
const opsKpiEom_ = ym => { const y = Math.floor(ym / 100), m = ym % 100; return ym * 100 + new Date(Date.UTC(y, m, 0)).getUTCDate(); };

/**
 * 受講の行を、1人ごとに「続いている期間」にまとめる。
 * 次の行の開始日が、前の期間の最終日の翌月中まで（または前の期間がまだ終わっていない・開始日が空）なら同じ期間。
 */
function opsKpiSpells_(rows) {
  const sorted = rows.slice().sort((a, b) => (a.start || 0) - (b.start || 0));
  const spells = [];
  sorted.forEach(r => {
    const cur = spells[spells.length - 1];
    const joins = cur && (!cur.end || !r.start || opsKpiYmIndex_(opsKpiYm_(r.start)) <= opsKpiYmIndex_(opsKpiYm_(cur.end)) + 1);
    if (joins) {
      cur.end = (!cur.end || !r.end) ? 0 : Math.max(cur.end, r.end);
      cur.rows.push(r);
    } else {
      spells.push({ start: r.start || 0, end: r.end || 0, rows: [r] });
    }
  });
  return spells;
}

/**
 * input = { enrolls: [{sid, name, cls, start, end, memo}], gap: {classId: true}, forms: [{applied, existing, label}] }
 * 返り値 = { 202612: { forms: [...], newJp: [...], back, leave, mrrOs, gapNew, gapDirect, gapOut, combo }, ... }（中身はメモに書く文字）
 */
function opsKpiCompute_(input, months) {
  const out = {};
  months.forEach(ym => { out[ym] = { forms: [], newJp: [], back: [], leave: [], mrrOs: [], gapNew: [], gapDirect: [], gapOut: [], combo: [] }; });
  const put = (ym, key, text) => { if (out[ym]) out[ym][key].push(text); };

  input.forms.forEach(f => { if (!f.existing) put(opsKpiYm_(f.applied), 'forms', f.label); });

  const people = {};
  input.enrolls.forEach(e => { (people[e.sid] = people[e.sid] || []).push(e); });
  Object.keys(people).sort().forEach(sid => {
    const rows = people[sid], name = rows[0].name + '（' + sid + '）';
    const isGap = r => !!input.gap[r.cls];
    const activeAtEom = (r, ym) => { const eom = opsKpiEom_(ym); return (r.start || 0) <= eom && (!r.end || r.end >= eom); };
    const inMonth = (r, ym) => (!r.start || opsKpiYm_(r.start) <= ym) && (!r.end || opsKpiYm_(r.end) >= ym);

    if (sid.charAt(0) === 'G') { // 海外生：その月に受講していれば1人
      months.forEach(ym => { if (rows.some(r => inMonth(r, ym))) put(ym, 'mrrOs', rows[0].name); });
      return;
    }
    if (sid.charAt(0) !== 'J') return;

    const spells = opsKpiSpells_(rows);
    spells.forEach((sp, i) => {
      if (sp.start) {
        const marked = sp.rows.some(r => (r.memo || '').indexOf(OPS_KPI.BACK_WORD) !== -1);
        put(opsKpiYm_(sp.start), (i > 0 || marked) ? 'back' : 'newJp', name + ' ' + opsKpiMd_(sp.start) + '〜');
      }
      if (sp.end) put(opsKpiYmAdd_(opsKpiYm_(sp.end), 1), 'leave', name + ' 最終日 ' + opsKpiMd_(sp.end));
    });

    opsKpiSpells_(rows.filter(isGap)).forEach(gs => {
      if (gs.start) {
        const whole = spells.find(sp => sp.rows.indexOf(gs.rows[0]) !== -1);
        const direct = whole && whole.start === gs.start && !whole.rows.some(r => !isGap(r) && (r.start || 0) < gs.start);
        put(opsKpiYm_(gs.start), 'gapNew', name + ' ' + opsKpiMd_(gs.start) + '〜' + (direct ? '（直行）' : '（ステップアップ）'));
        if (direct) put(opsKpiYm_(gs.start), 'gapDirect', name);
      }
      if (gs.end) put(opsKpiYmAdd_(opsKpiYm_(gs.end), 1), 'gapOut', name + ' 最終日 ' + opsKpiMd_(gs.end));
    });

    months.forEach(ym => {
      if (rows.some(r => isGap(r) && activeAtEom(r, ym)) && rows.some(r => !isGap(r) && activeAtEom(r, ym))) put(ym, 'combo', name);
    });
  });
  return out;
}


/* ======================= KPI のシート ======================= */

function opsKpiSheet_() {
  const id = PropertiesService.getScriptProperties().getProperty(OPS_KPI.FILE_PROP);
  if (id) {
    const sheet = SpreadsheetApp.openById(id).getSheetByName(OPS_KPI.TAB);
    if (!sheet) throw new Error('KPI のスプシにタブ「' + OPS_KPI.TAB + '」がありません');
    return sheet;
  }
  const ss = opsTestFile_(OPS_KPI.TEST_PROP, 'KPI（自動・テスト）');
  return ss.getSheetByName(OPS_KPI.TAB) || opsKpiTestSheet_(ss);
}

/** { cols: {202612: 18, ...}, rows: {forms: 28, ...}, headRows: [27, 37, ...], lastCol } */
function opsKpiLayout_(sheet) {
  const values = sheet.getDataRange().getDisplayValues();
  const cols = {}, rows = {}, headRows = [];
  let lastCol = 0;
  values.forEach((v, i) => {
    const months = v.slice(1).map(x => (String(x).trim().match(/^(\d{4})\/(\d{1,2})$/) || null));
    if (months.filter(Boolean).length >= 2) {
      headRows.push(i + 1);
      if (!Object.keys(cols).length) months.forEach((m, j) => { if (m) { cols[Number(m[1]) * 100 + Number(m[2])] = j + 2; lastCol = Math.max(lastCol, j + 2); } });
      return;
    }
    const label = String(v[0]).replace(/^[\s　]+/, '');
    if (!headRows.length) return; // 前提パラメータの表は見ない
    OPS_KPI.ROWS.forEach(([head, key]) => { if (!rows[key] && label.indexOf(head) === 0) rows[key] = i + 1; });
  });
  if (!headRows.length) throw new Error('KPI のシートに月の見出し（2026/12 のような行）が見つかりません');
  return { cols, rows, headRows, lastCol };
}

/** 右端の月の列を写して、次の月の列を作る（式は写る。手入力のセルとメモは空にする） */
function opsKpiAddMonth_(sheet, layout, ym) {
  const last = layout.lastCol;
  const lastYm = Number(Object.keys(layout.cols).find(k => layout.cols[k] === last));
  if (opsKpiYmAdd_(lastYm, 1) !== ym) throw new Error('KPI のシートの右端が ' + opsKpiYmText_(lastYm) + ' で、' + opsKpiYmText_(ym) + ' の列を作れません');
  if (sheet.getMaxColumns() <= last) sheet.insertColumnsAfter(sheet.getMaxColumns(), 6);
  // 前提パラメータの表（最初の月の見出しより上）は写さない
  const top = layout.headRows[0], height = sheet.getLastRow() - top + 1;
  const src = sheet.getRange(top, last, height, 1), dst = sheet.getRange(top, last + 1, height, 1);
  src.copyTo(dst);
  sheet.setColumnWidth(last + 1, sheet.getColumnWidth(last));
  const formulas = dst.getFormulas();
  const values = dst.getValues();
  values.forEach((v, i) => {
    const r = top + i, cell = sheet.getRange(r, last + 1);
    if (layout.headRows.indexOf(r) !== -1) { cell.setNumberFormat('@').setValue(opsKpiYmText_(ym)); return; }
    if (!formulas[i][0] && v[0] !== '') cell.clearContent();
    if (!formulas[i][0]) cell.clearNote();
  });
  // 前提パラメータの「直近」の式（$R$ まで見ている）を、新しい列まで伸ばす
  const oldL = opsKpiColLetter_(last), newL = opsKpiColLetter_(last + 1);
  const params = sheet.getRange(1, 2, layout.headRows[0], 2);
  const pf = params.getFormulas();
  pf.forEach((row, i) => row.forEach((f, j) => {
    if (f && f.indexOf('$' + oldL + '$') !== -1) sheet.getRange(i + 1, j + 2).setFormula(f.split('$' + oldL + '$').join('$' + newL + '$'));
  }));
}

function opsKpiColLetter_(n) {
  let s = '';
  for (; n > 0; n = Math.floor((n - 1) / 26)) s = String.fromCharCode(65 + (n - 1) % 26) + s;
  return s;
}

function opsKpiOsPrice_(sheet) {
  const v = sheet.getRange(1, 1, 30, 2).getValues().find(r => String(r[0]).trim() === OPS_KPI.OS_PRICE_LABEL);
  return v && Number(v[1]) > 0 ? Number(v[1]) : 0;
}

/** テスト用の KPI（本番の v3.1 と同じ見出しの、行と列だけのひな形） */
function opsKpiTestSheet_(ss) {
  const sheet = ss.insertSheet(OPS_KPI.TAB);
  const months = [];
  for (let ym = 202609; ym <= 202612; ym = opsKpiYmAdd_(ym, 1)) months.push(opsKpiYmText_(ym));
  const head = [''].concat(months);
  const rows = [
    ['KPI（テスト用のひな形）'], ['OS単価', 600], [''],
    ['■ 実績【人ベース】'], head,
    ['フォーム申込数（純新規のみ）'], ['新規入会数(JP)（純新規のみ）'], ['復帰（休会からの再開）'], ['退会者数（休会を含む）'], ['調整（実頭数との差。通常は空欄）'], [''],
    ['■ 実績【金額・効率】'], head, ['MRR実績（JP / Stripe）'], ['MRR実績（OS）'], [''],
    ['■ 実績【枠ベース：GAP】'], head, ['GAP新規（当月）'], ['　うち直行新規（既存生でない人）'], ['　うちステップアップ（既存スタンダード生から）'], ['GAP離脱（当月。退会・スタンダード戻りの合計）'], ['GAP受講者数（月末）'], ['　うちコンボ（スタンダード併用・月末）'],
  ];
  const width = head.length;
  rows.forEach((r, i) => { if (r === head) sheet.getRange(i + 1, 1, 1, width).setNumberFormat('@'); }); // 「2026/09」を日付にしない
  sheet.getRange(1, 1, rows.length, width).setValues(rows.map(r => r.concat(new Array(width - r.length).fill(''))));
  // ステップアップは式（本番と同じ）
  for (let c = 2; c <= width; c++) {
    const L = opsKpiColLetter_(c);
    sheet.getRange(21, c).setFormula('=IF(' + L + '19="","",' + L + '19-' + L + '20)');
  }
  const first = ss.getSheets()[0];
  if (first.getName() !== OPS_KPI.TAB && first.getLastRow() === 0) ss.deleteSheet(first);
  return sheet;
}


/* ======================= Stripe（見張りメールの照合だけ） ======================= */

/** 有効なサブスクの [{name, email, paused}]。キーが無ければ null */
function opsKpiStripeSubs_() {
  const key = PropertiesService.getScriptProperties().getProperty(OPS_KPI.STRIPE_PROP);
  if (!key) return null;
  const out = [];
  let after = '';
  for (let page = 0; page < 20; page++) {
    const url = 'https://api.stripe.com/v1/subscriptions?status=active&limit=100&expand%5B%5D=data.customer' + (after ? '&starting_after=' + after : '');
    const res = UrlFetchApp.fetch(url, { headers: { Authorization: 'Bearer ' + key }, muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) throw new Error('Stripe ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 200));
    const body = JSON.parse(res.getContentText());
    (body.data || []).forEach(s => {
      const c = s.customer || {};
      out.push({ name: opsStr_(c.name) || opsStr_(c.email) || s.id, email: opsStr_(c.email).toLowerCase(), paused: !!s.pause_collection });
    });
    if (!body.has_more || !body.data.length) break;
    after = body.data[body.data.length - 1].id;
  }
  return out;
}


/* ======================= 見張りメール（Ops.gs の opsWatchItems_ から） ======================= */

function opsKpiWatchItems_(data) {
  const items = [];
  const add = (title, lines) => { if (lines.length) items.push({ title, lines }); };
  const T = data.today;

  // 休会のまま1年を過ぎた（最後の最終日から）
  const lastEnd = {};
  data.enrolls.forEach(e => { if (e.sid && e.end) lastEnd[e.sid] = Math.max(lastEnd[e.sid] || 0, e.end); });
  add('休会のまま1年を過ぎた（退会にするか決める。休会は最大1年）',
    data.students.filter(s => s.status === '休会' && lastEnd[s.id] && lastEnd[s.id] < opsAddDays_(T, -OPS_KPI.RECESS_DAYS))
      .map(s => s.name + '（' + s.id + '）最終日 ' + Math.floor(lastEnd[s.id] / 10000) + '/' + opsMd_(lastEnd[s.id])));

  let subs;
  try { subs = opsKpiStripeSubs_(); } catch (err) { return items.concat([{ title: 'Stripe を確かめられなかった', lines: [String(err && err.message || err)] }]); }
  if (!subs) return items;
  const billing = {};
  subs.filter(x => !x.paused && x.email).forEach(x => { billing[x.email] = x; });
  const mails = s => [s.email].concat(String(s.email2 || '').split(/[,、\s]+/)).map(m => opsStr_(m).toLowerCase()).filter(Boolean);
  // 日本生で在籍、かつ受講が今も続いている（これから始まる行を含む）人
  const current = data.students.filter(s => s.region === 'jp' && s.status === '在籍' &&
    data.enrolls.some(e => e.st === s && (!e.end || e.end >= T)));
  const known = {};
  current.forEach(s => mails(s).forEach(m => { known[m] = true; }));
  add('在籍で受講しているのに、Stripe で請求していない（クラスの切り替え中・兄弟で1件などは正しいこともある）',
    current.filter(s => !mails(s).some(m => billing[m])).map(s => s.name + '（' + s.id + '）'));
  add('Stripe で請求しているのに、台帳では在籍で受講していない（止め忘れ・メアドの違いを確かめる）',
    Object.keys(billing).filter(m => !known[m]).map(m => billing[m].name));
  return items;
}
