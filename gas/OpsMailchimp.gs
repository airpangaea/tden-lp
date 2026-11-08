/***** TD留学 台帳 × Mailchimp のタグ合わせ（Ops） *****
 *
 * スプシ「TDEN 生徒管理」の Apps Script に、Ops.gs と同じプロジェクトの別ファイルとして置く。
 * 台帳（生徒_JP のステータス・受講・クラス一覧の種別）を正にして、Mailchimp の TDEN のタグを合わせる。
 *
 *  - 合わせるのは TDEN／TDEN-GAP／TDEN-Recess／Ex-TDEN の4つと、新しく入会した生徒の学年タグ（gradeN-年度）1つだけ。
 *    ほかのタグ（ほかのプログラム・英検など）には触らない
 *  - 見るのは生徒_JP だけ（海外生は Mailchimp に入れていない）。台帳にいない人（過去の Ex-TDEN など）には触らない
 *  - 在籍＝TDEN（GAP のクラスがあれば＋TDEN-GAP）／休会＝TDEN-Recess／退会＝Ex-TDEN。ほかのステータスは触らない
 *  - 学年タグ：Mailchimp に新しく足す在籍生と、受講の開始日が OPS_MC.GRADE_FROM 以降の在籍生で、学年タグがまだ無い人だけ。
 *    年は年度（4月始まり）。台帳の学年は申込の時のものなので、申込日時の年度を使う（例 2027年1月に中3 → grade9-2026）。
 *    「高校2年生(25)」のように年が書いてあれば、その年度（2025年度）の学年として使う。大学1年＝grade13
 *  - Mailchimp に無い在籍生は、「合わせる」の時に連絡先を足して TDEN などを付ける（メールアドレスだけ。名前は入れない）。
 *    Email が空の在籍生は「未登録」として知らせる
 *  - 1人が別のメアドでも Mailchimp に入っていることがある。「Mailchimp照合」タブの「台帳に無い」行に生徒IDを書くと、
 *    次から同じ人として合わせる（辞めた人なら Ex と書くと Ex-TDEN にする）
 *
 * メニュー「TD台帳」
 *  - Mailchimp の API キーを入れる（最初に1回）
 *  - Mailchimp のずれを調べる … 読むだけ。「Mailchimp照合」タブに一覧
 *  - Mailchimp のタグを台帳に合わせる … 何人・どのタグかを出して、OK を押した時だけ書き込む
 *  毎週月曜の見張りメールにも、ずれを生徒IDと名前で出す（メールアドレスは書かない）
 *
 * テスト用のスプシ（名前に「テスト」・API キーなし）では、本物の Mailchimp の代わりにダミーの連絡先で動く。
 */

const OPS_MC = {
  TAB: 'Mailchimp照合',
  KEY_PROP: 'MAILCHIMP_API_KEY',  // スクリプトプロパティ（メニュー「Mailchimp の API キーを入れる」で入る）
  LIST_PROP: 'MAILCHIMP_LIST_ID', // 空ならオーディエンス名 LIST_NAME を探して入れる
  LIST_NAME: 'AirPangaea',
  TAGS: { active: 'TDEN', gap: 'TDEN-GAP', recess: 'TDEN-Recess', ex: 'Ex-TDEN' },
  GRADE_FROM: 20261101, // この日以降に受講を始めた在籍生にだけ学年タグを付ける（前からいる生徒のタグは合っている）
  TEST_PROP: 'OPS_TEST_MC', // テスト用：ダミーの連絡先
};
const OPS_MC_HEAD = ['区分', '生徒ID', '名前', 'ステータス', 'Email', '今のタグ（TDEN関係）', '足す', '外す'];
const OPS_MC_KINDS = { change: '合わせる', add: '足す（未登録）', linked: '別のメアド', unknown: '台帳に無い', missing: '未登録', grade: '学年が読めない' };


/* ======================= メニュー ======================= */

function opsMcSetKey() {
  opsRun_(() => {
    const ui = SpreadsheetApp.getUi();
    const res = ui.prompt('Mailchimp の API キー',
      'Mailchimp → 右上のアカウント → Profile → Extras → API keys → Create A Key で作ったキーを貼ってください（例 0123abcd…-us21）。',
      ui.ButtonSet.OK_CANCEL);
    if (res.getSelectedButton() !== ui.Button.OK) return;
    const key = res.getResponseText().trim();
    if (!/^[0-9a-f]+-[a-z]+\d+$/i.test(key)) throw new Error('キーの形が違います（最後が -us21 のように終わるはずです）');
    const props = PropertiesService.getScriptProperties();
    props.setProperty(OPS_MC.KEY_PROP, key);
    props.deleteProperty(OPS_MC.LIST_PROP);
    const list = opsMcClient_().listId;
    SpreadsheetApp.getActiveSpreadsheet().toast('キーを入れました（オーディエンス ' + list + '）。次は「Mailchimp のずれを調べる」', 'Mailchimp', 8);
  });
}

function opsMcCheck() {
  opsRun_(() => {
    const r = opsMcRun_(false);
    opsMcShowSummary_('Mailchimp のずれ', r.plan, r.url, false);
  });
}

function opsMcApply() {
  opsRun_(() => {
    const ui = SpreadsheetApp.getUi();
    const r = opsMcRun_(false);
    const todo = r.plan.rows.filter(x => x.add.length || x.remove.length);
    if (!todo.length) {
      opsMcShowSummary_('Mailchimp は台帳と合っています', r.plan, r.url, false);
      return;
    }
    const ok = ui.alert('Mailchimp に書き込みます',
      opsMcCountText_(todo) + '\n\n' +
      todo.slice(0, 25).map(x => '・' + (x.name || x.sid || '（名前なし）') + '：' + opsMcChangeText_(x)).join('\n') +
      (todo.length > 25 ? '\n…ほか' + (todo.length - 25) + '件（「' + OPS_MC.TAB + '」タブ）' : '') +
      '\n\n台帳にいない人と、TDEN 以外のタグには触りません。書き込みますか？',
      ui.ButtonSet.YES_NO);
    if (ok !== ui.Button.YES) return;
    const errors = opsMcClient_().setTags(todo);
    const after = opsMcRun_(false);
    opsMcShowSummary_(errors.length ? '書き込みました（' + errors.length + '件うまくいきませんでした）' : '書き込みました',
      after.plan, after.url, errors);
  });
}


/* ======================= 見張りメール（Ops.gs の opsWatchItems_ から呼ばれる） ======================= */

function opsMcWatchItems_(data) {
  if (!opsMcReady_()) return [];
  try {
    const plan = opsMcRun_(data).plan, items = [];
    const who = x => (x.name || '（名前なし）') + '（' + (x.sid || '?') + '）';
    const add = (title, lines) => { if (lines.length) items.push({ title, lines }); };
    add('Mailchimp のタグが台帳と違う（メニュー「Mailchimp のタグを台帳に合わせる」で直す）',
      plan.rows.filter(x => x.add.length || x.remove.length).map(x => who(x) + '：' + opsMcChangeText_(x)));
    add('Email が空の在籍生（Mailchimp に足せない。生徒_JP の Email を埋める）', plan.missing.map(who));
    add('学年タグを付けられない（生徒_JP の学年を「中学3年生」の形に）', plan.badGrade.map(x => who(x) + '：' + (x.grade || '空')));
    if (plan.unknown.length) add('台帳に無いのに Mailchimp で TDEN・TDEN-GAP が付いている',
      [plan.unknown.length + '件（「' + OPS_MC.TAB + '」タブの「台帳に無い」行。同じ人の別のメアドなら生徒ID、辞めた人なら Ex を書く）']);
    return items;
  } catch (err) {
    return [{ title: 'Mailchimp を確かめられなかった', lines: [String(err && err.message || err)] }];
  }
}


/* ======================= 調べる（台帳と Mailchimp を読んで、タブに書く） ======================= */

function opsMcRun_(data) {
  const ss = SpreadsheetApp.getActiveSpreadsheet();
  data = data || opsData_();
  const tab = ss.getSheetByName(OPS_MC.TAB);
  const extras = tab ? opsMcReadExtras_(tab) : {};
  const gapClasses = {};
  data.classes.forEach(c => { if (/gap/i.test(c.type)) gapClasses[c.id] = true; });
  const client = opsMcClient_();
  const plan = opsMcPlan_({
    students: data.students.filter(s => s.region === 'jp'),
    enrolls: data.enrolls,
    gapClasses,
    members: client.members(),
    extras,
    today: data.today,
  });
  const sheet = opsMcWriteTab_(ss, plan);
  return { plan, url: ss.getUrl().replace(/\/edit.*$/, '') + '/edit#gid=' + sheet.getSheetId() };
}

/**
 * 台帳と Mailchimp を比べる（シートも API も使わない。ここだけで試せる）
 * in: students（生徒_JP）, enrolls（受講）, gapClasses {Class ID: true}, members {小文字のメール: {email, tags:[...]}},
 *     extras {小文字のメール: 生徒ID か 'EX'}, today（20261108 の形）
 * out: rows（合わせる・別のメアド）, missing（未登録の在籍生）, unknown（台帳に無いのに TDEN）, badGrade
 */
function opsMcPlan_(input) {
  const T = OPS_MC.TAGS, MANAGED = [T.active, T.gap, T.recess, T.ex];
  const low = s => String(s || '').trim().toLowerCase();
  const today = input.today;
  const members = input.members || {}, extras = input.extras || {};
  const byId = {};
  input.students.forEach(s => { if (s.id) byId[s.id] = s; });
  const enrollsOf = {};
  (input.enrolls || []).forEach(e => { (enrollsOf[e.sid] = enrollsOf[e.sid] || []).push(e); });

  // 台帳のステータスから、あるべき TDEN のタグ（null＝触らない）
  const want = s => {
    if (s.status === '在籍') {
      const gap = (enrollsOf[s.id] || []).some(e => input.gapClasses[e.cls] && !(e.end && e.end < today));
      return gap ? [T.active, T.gap] : [T.active];
    }
    if (s.status === '休会') return [T.recess];
    if (s.status === '退会') return [T.ex];
    return null;
  };
  const hasGrade = tags => tags.some(t => /grade\d+-\d{4}$/i.test(t));
  const firstStart = s => (enrollsOf[s.id] || []).map(e => e.start).filter(Boolean).sort()[0] || 0;

  const rows = [], missing = [], badGrade = [], used = {};
  const plan1 = (s, m, wantTags, kind) => {
    const isNew = kind === OPS_MC_KINDS.add;
    used[low(m.email)] = true;
    const now = m.tags.filter(t => MANAGED.some(x => low(x) === low(t)));
    const has = t => m.tags.some(x => low(x) === low(t));
    const add = wantTags ? wantTags.filter(t => !has(t)) : [];
    const remove = wantTags ? MANAGED.filter(t => wantTags.indexOf(t) === -1 && has(t)) : [];
    // 学年タグ：Mailchimp に新しく足す在籍生と、新しく入会した在籍生で、まだ学年タグが無い人だけ
    if (s && s.status === '在籍' && (isNew || firstStart(s) >= OPS_MC.GRADE_FROM) && !hasGrade(m.tags)) {
      const g = opsMcGradeTag_(s.grade, s.applied || today);
      if (g) add.push(g);
      else if (!badGrade.some(x => x.sid === s.id)) badGrade.push({ sid: s.id, name: s.name, grade: s.grade });
    }
    if (add.length || remove.length || kind === OPS_MC_KINDS.linked) {
      rows.push({ kind: isNew ? kind : add.length || remove.length ? OPS_MC_KINDS.change : kind, sub: kind, isNew,
        sid: s ? s.id : (wantTags && wantTags[0] === T.ex ? 'Ex' : ''), name: s ? s.name : '', status: s ? s.status : '退会（Ex）',
        email: m.email, now, add, remove });
    }
  };

  // 1. 台帳の生徒（Email 欄に複数書いてあっても1つずつ見る）
  input.students.forEach(s => {
    const w = want(s);
    const emails = String(s.email || '').split(/[\s,;、，／\/]+/).map(low).filter(e => e.indexOf('@') > 0);
    const found = emails.filter(e => members[e]);
    if (!w) { found.forEach(e => { used[e] = true; }); return; } // 新規・見送りなど：台帳にいるが触らない
    // Mailchimp にまだ無い在籍生は、連絡先を足してタグを付ける（足すメアドは Email 欄の1つ目）
    if (s.status === '在籍' && !found.length) {
      if (emails.length) plan1(s, { email: emails[0], tags: [] }, w, OPS_MC_KINDS.add);
      else missing.push({ sid: s.id, name: s.name, why: 'Email が空' });
    }
    found.forEach(e => plan1(s, members[e], w, OPS_MC_KINDS.change));
  });

  // 2. 「台帳に無い」行に生徒ID（か Ex）を書いてもらったメアド
  Object.keys(extras).forEach(e => {
    const m = members[e];
    if (!m || used[e]) return;
    const v = String(extras[e]).trim();
    if (/^ex$/i.test(v)) return plan1(null, m, [T.ex], OPS_MC_KINDS.linked);
    const s = byId[v];
    if (s) plan1(s, m, want(s), OPS_MC_KINDS.linked);
  });

  // 3. Mailchimp で TDEN・TDEN-GAP が付いているのに、台帳の生徒と結び付かない人
  const unknown = Object.keys(members).filter(e => !used[e] && !(extras[e] && (byId[String(extras[e]).trim()] || /^ex$/i.test(String(extras[e]).trim()))))
    .map(e => members[e])
    .filter(m => m.tags.some(t => low(t) === low(T.active) || low(t) === low(T.gap)))
    .map(m => ({ kind: OPS_MC_KINDS.unknown, sid: extras[low(m.email)] || '', name: '', status: '', email: m.email,
      now: m.tags.filter(t => MANAGED.some(x => low(x) === low(t))), add: [], remove: [] }));

  return { rows, missing, unknown, badGrade };
}

/** 台帳の学年（申込の時）と申込日 → 「grade9-2026」。「高校2年生(25)」は 2025年度の学年として読む。読めなければ '' */
function opsMcGradeTag_(grade, appliedKey) {
  let t = String(grade || '').replace(/[０-９]/g, c => String.fromCharCode(c.charCodeAt(0) - 0xFEE0)).replace(/\s+/g, '');
  const y = Math.floor(appliedKey / 10000), mo = Math.floor(appliedKey / 100) % 100;
  let fy = mo >= 4 ? y : y - 1;
  const yr = t.match(/[(（](\d{2})[)）]/);
  if (yr) fy = 2000 + Number(yr[1]);
  t = t.replace(/[(（][^)）]*[)）]/g, ''); // 「(無料体験)」などの注記は読まない
  const m = t.match(/^(小学|中学|高校|大学)(\d)年/) || t.match(/^(小|中|高|大)(\d)/);
  if (!m) return '';
  const base = { '小学': 0, '小': 0, '中学': 6, '中': 6, '高校': 9, '高': 9, '大学': 12, '大': 12 }[m[1]];
  return 'grade' + (base + Number(m[2])) + '-' + fy;
}

function opsMcChangeText_(x) {
  const t = [x.add.length ? x.add.join('・') + ' を付ける' : '', x.remove.length ? x.remove.join('・') + ' を外す' : ''].filter(Boolean).join('、');
  return x.isNew ? 'Mailchimp に足して ' + t : t;
}

/** 「TDEN を付ける：3人」のような件数のまとめ */
function opsMcCountText_(rows) {
  const n = {};
  rows.forEach(x => {
    if (x.isNew) n['Mailchimp に連絡先を足す'] = (n['Mailchimp に連絡先を足す'] || 0) + 1;
    x.add.forEach(t => { const k = (/^grade/i.test(t) ? '学年タグ' : t) + ' を付ける'; n[k] = (n[k] || 0) + 1; });
    x.remove.forEach(t => { const k = t + ' を外す'; n[k] = (n[k] || 0) + 1; });
  });
  return rows.length + '件（メアドの数）\n' + Object.keys(n).map(k => k + '：' + n[k]).join('\n');
}

function opsMcShowSummary_(title, plan, url, errors) {
  const todo = plan.rows.filter(x => !x.isNew && (x.add.length || x.remove.length));
  const line = (label, n) => '<p style="margin:6px 0">' + label + '：<b>' + n + '</b></p>';
  const html = '<div style="font-family:sans-serif;font-size:14px">' +
    line('台帳に合わせる（メアド）', todo.length) +
    line('Mailchimp に足す在籍生（「合わせる」で足す）', plan.rows.filter(x => x.isNew).length) +
    line('Email が空の在籍生', plan.missing.length) +
    line('台帳に無いのに TDEN・TDEN-GAP', plan.unknown.length) +
    line('学年が読めない', plan.badGrade.length) +
    (errors && errors.length ? '<p style="color:#b23a3a">' + errors.slice(0, 5).map(e => String(e).replace(/</g, '&lt;')).join('<br>') + '</p>' : '') +
    '<p style="margin:14px 0 0"><a href="' + url + '" target="_blank">「' + OPS_MC.TAB + '」タブを開く</a></p></div>';
  SpreadsheetApp.getUi().showModalDialog(HtmlService.createHtmlOutput(html).setWidth(420).setHeight(240 + (errors && errors.length ? 80 : 0)), title);
}


/* ======================= 「Mailchimp照合」タブ（あなた用。メールアドレスが入る） ======================= */

/** 前回のタブの「台帳に無い」「別のメアド」行に書いてもらった生徒ID（か Ex） */
function opsMcReadExtras_(sheet) {
  const t = opsTable_(sheet), out = {};
  t.rows.forEach(r => {
    const kind = opsStr_(r['区分']), id = opsStr_(r['生徒ID']), email = opsStr_(r['Email']).toLowerCase();
    if (!email || !id) return;
    if (kind === OPS_MC_KINDS.unknown || kind === OPS_MC_KINDS.linked || (kind === OPS_MC_KINDS.change && opsStr_(r['_sub']) === OPS_MC_KINDS.linked)) out[email] = id;
  });
  return out;
}

function opsMcWriteTab_(ss, plan) {
  let sheet = ss.getSheetByName(OPS_MC.TAB);
  if (!sheet) sheet = ss.insertSheet(OPS_MC.TAB, ss.getSheets().length);
  const head = OPS_MC_HEAD.concat(['_sub']);
  const order = [OPS_MC_KINDS.change, OPS_MC_KINDS.add, OPS_MC_KINDS.unknown, OPS_MC_KINDS.linked];
  const rows = plan.rows.concat(plan.unknown).sort((a, b) => order.indexOf(a.kind) - order.indexOf(b.kind));
  const values = [head]
    .concat(rows.map(x => [x.kind, x.sid, x.name, x.status, x.email, x.now.join(', '), x.add.join(', '), x.remove.join(', '), x.sub || '']))
    .concat(plan.missing.map(x => [OPS_MC_KINDS.missing, x.sid, x.name, '在籍', '', '', '', '', x.why || '']))
    .concat(plan.badGrade.map(x => [OPS_MC_KINDS.grade, x.sid, x.name, '在籍', '', '', '', '', x.grade || '']));
  sheet.clear();
  sheet.getRange(1, 1, values.length, head.length).setNumberFormat('@').setValues(values);
  sheet.getRange(1, 1, 1, head.length).setFontWeight('bold').setBackground('#eceeef');
  sheet.setFrozenRows(1);
  sheet.hideColumns(head.length); // _sub は Ops が使う印
  sheet.getRange(1, 2).setNote('「台帳に無い」行：同じ人の別のメアドなら、その生徒の生徒ID（J0012 など）を書く。辞めた人なら Ex と書く。次に調べた時から台帳に合わせます');
  sheet.getRange(1, 1).setNote('このタブは「Mailchimp のずれを調べる」と毎週の見張りメールで作り直します（生徒ID欄に書いたものは残ります）。メールアドレスが入るので、ほかの人に見せない');
  const color = { [OPS_MC_KINDS.change]: '#fde3c4', [OPS_MC_KINDS.add]: '#fde3c4', [OPS_MC_KINDS.unknown]: '#f8e3e3', [OPS_MC_KINDS.missing]: '#fff4c2', [OPS_MC_KINDS.grade]: '#fff4c2', [OPS_MC_KINDS.linked]: '#e6f4ea' };
  if (values.length > 1) sheet.getRange(2, 1, values.length - 1, 1).setBackgrounds(values.slice(1).map(v => [color[v[0]] || '#ffffff']));
  if (values.length === 1) sheet.getRange(2, 1).setValue('ずれはありません（' + opsMd_(opsTodayKey_()) + '）');
  sheet.autoResizeColumns(1, OPS_MC_HEAD.length);
  return sheet;
}


/* ======================= Mailchimp（本物の API か、テスト用のダミー） ======================= */

function opsMcReady_() {
  return !!PropertiesService.getScriptProperties().getProperty(OPS_MC.KEY_PROP) || opsMcIsTest_();
}

function opsMcIsTest_() {
  return !PropertiesService.getScriptProperties().getProperty(OPS_MC.KEY_PROP) &&
    SpreadsheetApp.getActiveSpreadsheet().getName().indexOf('テスト') !== -1 && typeof opsTestMcMembers_ === 'function';
}

/** { listId, members() → {小文字のメール: {email, tags}}, setTags(rows) → エラーの並び } */
function opsMcClient_() {
  if (opsMcIsTest_()) return opsMcTestClient_();
  const props = PropertiesService.getScriptProperties();
  const key = props.getProperty(OPS_MC.KEY_PROP);
  if (!key) throw new Error('Mailchimp の API キーがありません。メニュー「Mailchimp の API キーを入れる」から入れてください');
  const base = 'https://' + key.split('-').pop() + '.api.mailchimp.com/3.0';
  const auth = { Authorization: 'Basic ' + Utilities.base64Encode('ops:' + key) };
  const get = path => {
    const res = UrlFetchApp.fetch(base + path, { headers: auth, muteHttpExceptions: true });
    if (res.getResponseCode() >= 300) throw new Error('Mailchimp ' + res.getResponseCode() + '：' + res.getContentText().slice(0, 300));
    return JSON.parse(res.getContentText());
  };
  let listId = props.getProperty(OPS_MC.LIST_PROP);
  if (!listId) {
    const lists = get('/lists?count=100&fields=lists.id,lists.name').lists || [];
    const hit = lists.find(l => l.name === OPS_MC.LIST_NAME) || (lists.length === 1 ? lists[0] : null);
    if (!hit) throw new Error('オーディエンス「' + OPS_MC.LIST_NAME + '」が見つかりません（' + lists.map(l => l.name).join('・') + '）');
    listId = hit.id;
    props.setProperty(OPS_MC.LIST_PROP, listId);
  }
  return {
    listId,
    members() {
      const out = {};
      for (let offset = 0; ; offset += 1000) {
        const page = get('/lists/' + listId + '/members?count=1000&offset=' + offset + '&fields=total_items,members.email_address,members.tags');
        (page.members || []).forEach(m => { out[m.email_address.toLowerCase()] = { email: m.email_address, tags: (m.tags || []).map(t => t.name) }; });
        if (offset + 1000 >= page.total_items) break;
      }
      return out;
    },
    setTags(rows) {
      const errors = [];
      // Mailchimp にまだ無い人は、先に連絡先を足す（既にいれば何も変えない）
      const news = rows.filter(x => x.isNew), failed = {};
      for (let i = 0; i < news.length; i += 10) {
        UrlFetchApp.fetchAll(news.slice(i, i + 10).map(x => ({
          url: base + '/lists/' + listId + '/members/' + opsMcHash_(x.email),
          method: 'put', contentType: 'application/json', headers: auth, muteHttpExceptions: true,
          payload: JSON.stringify({ email_address: x.email, status_if_new: 'subscribed' }),
        }))).forEach((res, j) => {
          const x = news[i + j];
          if (res.getResponseCode() >= 300) { failed[x.email] = true; errors.push((x.sid || x.name || '?') + '：足せませんでした ' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120)); }
        });
      }
      rows = rows.filter(x => !failed[x.email]);
      const reqs = rows.map(x => ({
        url: base + '/lists/' + listId + '/members/' + opsMcHash_(x.email) + '/tags',
        method: 'post', contentType: 'application/json', headers: auth, muteHttpExceptions: true,
        payload: JSON.stringify({ tags: x.add.map(name => ({ name, status: 'active' })).concat(x.remove.map(name => ({ name, status: 'inactive' }))) }),
      }));
      for (let i = 0; i < reqs.length; i += 10) {
        UrlFetchApp.fetchAll(reqs.slice(i, i + 10)).forEach((res, j) => {
          if (res.getResponseCode() >= 300) errors.push((rows[i + j].sid || rows[i + j].name || '?') + '：' + res.getResponseCode() + ' ' + res.getContentText().slice(0, 120));
        });
      }
      return errors;
    },
  };
}

/** Mailchimp の連絡先のID（小文字のメールの MD5） */
function opsMcHash_(email) {
  return Utilities.computeDigest(Utilities.DigestAlgorithm.MD5, String(email).trim().toLowerCase())
    .map(b => ('0' + (b & 0xff).toString(16)).slice(-2)).join('');
}

/** テスト用：ダミーの連絡先をスクリプトプロパティに置き、書き込みもそこに反映する */
function opsMcTestClient_() {
  const props = PropertiesService.getScriptProperties();
  const load = () => {
    const raw = props.getProperty(OPS_MC.TEST_PROP);
    if (raw) return JSON.parse(raw);
    const m = opsTestMcMembers_(opsData_());
    props.setProperty(OPS_MC.TEST_PROP, JSON.stringify(m));
    return m;
  };
  return {
    listId: 'テスト（ダミーの連絡先）',
    members: load,
    setTags(rows) {
      const m = load(), low = s => s.toLowerCase();
      rows.forEach(x => {
        if (x.isNew && !m[low(x.email)]) m[low(x.email)] = { email: x.email, tags: [] };
        const c = m[low(x.email)];
        if (!c) return;
        c.tags = c.tags.filter(t => x.remove.every(r => low(r) !== low(t))).concat(x.add.filter(a => c.tags.every(t => low(t) !== low(a))));
      });
      props.setProperty(OPS_MC.TEST_PROP, JSON.stringify(m));
      return [];
    },
  };
}
