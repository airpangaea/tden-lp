// 申込フォームの送信先。
//  1) 「TDEN 生徒管理」スプシへ GAS 経由で登録（通常の経路）
//  2) GAS が失敗したときだけ Airtable に書く（予備経路）。Airtable の通知メールを GAS が後で読み取り、スプシに取り込む
// 環境変数: GAS_URL, GAS_KEY（スプシ）／ AIRTABLE_TOKEN, AIRTABLE_BASE_ID, AIRTABLE_TABLE_ID（予備経路）
//
// 海外向けLP（/en/・/id/）のフォームは region=intl・country・lang（en／id）を送ってくる
//  → 「生徒_海外」に入れ、送信完了ページとエラー文をそのページの言語にする

const GAS_TIMEOUT_MS = 15000;

const MESSAGES = {
  ja: {
    thanks: '/thanks.html',
    badName: 'お名前を正しく入力してください。',
    badEmail: '有効なメールアドレスを入力してください。',
    failed: '送信に失敗しました。しばらく待ってから再度お試しください。',
  },
  en: {
    thanks: '/en/thanks.html',
    badName: 'Please enter your name.',
    badEmail: 'Please enter a valid email address.',
    failed: 'Sorry, we could not send your application. Please wait a moment and try again.',
  },
  id: {
    thanks: '/id/thanks.html',
    badName: 'Mohon isi nama lengkap kamu.',
    badEmail: 'Mohon masukkan alamat email yang valid.',
    failed: 'Maaf, pendaftaran gagal dikirim. Silakan tunggu sebentar, lalu coba lagi.',
  },
};

export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();

  const rawForm = {};
  for (const [key, value] of formData.entries()) {
    rawForm[key] = value;
  }

  const region = rawForm.region === 'intl' ? 'intl' : 'jp';
  const lang = region === 'jp' ? 'ja' : (rawForm.lang === 'id' ? 'id' : 'en');
  const msg = MESSAGES[lang];

  // --- スパム対策 ---
  const thanksUrl = new URL(msg.thanks, request.url).toString();

  // a. ハニーポット: botが非表示フィールドに入力した場合
  if (rawForm.website) {
    return Response.redirect(thanksUrl, 303); // ?ok=1なし → tracking発火しない
  }

  // b. 時間ベースチェック: 3秒未満の送信はbot
  const ts = parseInt(rawForm._ts || '0', 10);
  if (ts && (Date.now() - ts) < 3000) {
    return Response.redirect(thanksUrl, 303); // ?ok=1なし → tracking発火しない
  }

  const firstName       = rawForm.firstName || '';
  const school          = rawForm.school || '';
  const gender          = rawForm.gender || '';
  const grade           = rawForm.grade || '';
  const email           = rawForm.email || '';
  const phone           = rawForm.phone || '';
  const englishLevel    = rawForm.englishLevel || '';
  const preferredCourse = rawForm.preferredCourse || '';
  const message         = rawForm.message || '';

  // c. バリデーション: 名前の長さチェック
  if (!firstName || firstName.length > 100) {
    return new Response(msg.badName, { status: 400 });
  }

  // d. バリデーション: メール形式チェック
  const emailRegex = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
  if (!email || !emailRegex.test(email)) {
    return new Response(msg.badEmail, { status: 400 });
  }

  // e. URL含有チェック（名前・学校名にURLが含まれる場合はスパム）
  const urlPattern = /https?:\/\/|telegra\.ph|\.me\//i;
  if (urlPattern.test(firstName) || urlPattern.test(school)) {
    return Response.redirect(thanksUrl, 303); // ?ok=1なし → tracking発火しない
  }

  // --- 希望日時 ---
  // フォームの value は "GroupID|ラベル"（例: "Mon2030M|月曜 20:30-21:30 Marina講師"）。
  // "individual"（個別調整）や空文字もそのまま扱う。
  const slotText = (v) => {
    if (!v) return '';
    if (v === 'individual') return '個別調整を希望';
    const i = v.indexOf('|');
    return i === -1 ? v : v.slice(i + 1);
  };
  const prefs = [rawForm.preferredSlot1, rawForm.preferredSlot2, rawForm.preferredSlot3].map(slotText);

  const genderLabel = { '男': '男性', '女': '女性', '回答しない': '回答しない' }[gender] || gender;

  // 国は海外フォームだけが送ってくる。"Other" はコメント欄に書いてもらう運用なので空にしておく（GAS側で「（不明）」扱い）
  const country = region === 'jp' ? 'Japan'
    : (rawForm.country && rawForm.country !== 'Other' ? String(rawForm.country).slice(0, 50) : '');

  const application = {
    name: firstName,
    country,
    gender: genderLabel,
    grade,
    school,
    email,
    phone,
    englishLevel,
    course: preferredCourse,
    pref1: prefs[0],
    pref2: prefs[1],
    pref3: prefs[2],
    message,
  };

  // スプシの「経由」列：日本のLPは LP、海外は LP(EN)／LP(ID)
  const source = region === 'jp' ? 'LP' : `LP(${lang.toUpperCase()})`;
  if (await saveToSheet(env, region, source, application)) {
    return Response.redirect(thanksUrl + '?ok=1', 303);
  }
  if (await saveToAirtable(env, application, { gender, grade, englishLevel })) {
    return Response.redirect(thanksUrl + '?ok=1', 303);
  }
  return new Response(msg.failed, { status: 500 });
}

// --- 1) スプシ（GAS） ---
async function saveToSheet(env, region, source, application) {
  if (!env.GAS_URL || !env.GAS_KEY) {
    console.error('GAS_URL / GAS_KEY is not set');
    return false;
  }
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), GAS_TIMEOUT_MS);
  try {
    const res = await fetch(env.GAS_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ key: env.GAS_KEY, action: 'apply', region, source, data: application }),
      signal: controller.signal,
    });
    const data = res.ok ? await res.json() : null;
    if (data && data.ok) return true;
    console.error('GAS apply error:', res.status, data && data.error);
    return false;
  } catch (e) {
    console.error('GAS apply exception:', e);
    return false;
  } finally {
    clearTimeout(timer);
  }
}

// --- 2) 予備経路（Airtable） ---
// Airtable の Admin Notification メール（件名「【TOMODACHI留学・新規申込】」）を GAS が読み取り、
// 本文の「■ 国: Japan」を見て「生徒_JP」に取り込む。希望コース・希望日時は Comments の
// 【希望コース】【第n希望】行から GAS が取り出すので、この書式は変えないこと。
async function saveToAirtable(env, application, raw) {
  if (!env.AIRTABLE_TOKEN || !env.AIRTABLE_BASE_ID || !env.AIRTABLE_TABLE_ID) return false;

  const genderMap = {
    '男': '男性', '女': '女性', '回答しない': 'Prefer not to say',
  };
  const gradeMap = {
    '中学1年生': '中学１年生', '中学2年生': '中学２年生', '中学3年生': '中学３年生',
    '高校1年生': '高校１年生', '高校2年生': '高校２年生', '高校3年生': '高校３年生',
    '新中学1年生': '中学１年生', '新中学2年生': '中学２年生', '新中学3年生': '中学３年生',
    '新高校1年生': '高校１年生', '新高校2年生': '高校２年生', '新高校3年生': '高校３年生',
  };
  const englishLevelMap = {
    '英検3級相当':   '英検３級（または同じレベルの英語力）を保有',
    '英検準2級相当': '英検準２級（または同じレベルの英語力）を保有',
    '英検2級相当':   '英検２級（または同じレベルの英語力）を保有',
    '英検準1級相当': '英検準１級以上（または同じレベルの英語力）を保有',
    '未受験/その他': 'Not sure',
    'わからないので相談したい': 'Not sure',
  };

  // 既知の学年は School Year(singleSelect) に。未知（その他 等）は Comments に逃がす
  // 海外フォームの "Grade 7"〜"Grade 12"・性別 Male/Female・"CEFR B1" 等は Airtable の選択肢と同じ値なのでそのまま入れる
  const schoolYear = gradeMap[raw.grade] || (/^Grade (7|8|9|10|11|12)$/.test(raw.grade) ? raw.grade : undefined);
  const commentParts = [];
  if (application.course) commentParts.push(`【希望コース】${application.course}`);
  if (raw.grade && !schoolYear) commentParts.push(`【学年】${raw.grade}`);
  [application.pref1, application.pref2, application.pref3].forEach((p, i) => {
    if (p) commentParts.push(`【第${i + 1}希望】${p}`);
  });
  if (application.message) commentParts.push(application.message);

  const fields = {
    'fldiatR2syOAnGeC1': application.name,                                         // Name
    'fldkgBWAY5URfwVlO': genderMap[raw.gender] || raw.gender,                      // Gender
    'fldteul63pEfP2j9i': englishLevelMap[raw.englishLevel] || raw.englishLevel,    // English Level
    'fld7kF0rL8NBwqVL9': 'Applied',                                                // Status
    'fldq5F1H26trbiiea': 'Form',                                                   // Source
  };
  if (application.country)    fields['fld0o4qUSxBA4hkJa'] = application.country;    // Country（通知メールの「■ 国:」→ GAS がJP／海外に振り分け）
  if (schoolYear)             fields['fldxVi5K2gNiVyWf6'] = schoolYear;             // School Year
  if (application.school)     fields['fldHofD6n1pignZRl'] = application.school;     // School Name
  if (application.email)      fields['fldwEBlgkxM3TMQeo'] = application.email;      // Email
  if (application.phone)      fields['fldvaJlyLqANY3IYw'] = application.phone;      // Phone
  if (commentParts.length)    fields['flddosiHxBy3F59nM'] = commentParts.join('\n'); // Comments

  try {
    const res = await fetch(`https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`, {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    });
    if (res.ok) return true;
    console.error('Airtable create error:', await res.text());
    return false;
  } catch (e) {
    console.error('Airtable create exception:', e);
    return false;
  }
}
