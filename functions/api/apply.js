// =============================================================
// GET /api/apply — Diagnostic endpoint (visit in browser)
// =============================================================
export async function onRequestGet(context) {
  const { env } = context;
  const results = {};

  const tableUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`;
  const token = env.AIRTABLE_TOKEN || '';
  const tokenPreview = token ? `${token.substring(0, 15)}...${token.substring(token.length - 4)} (length: ${token.length})` : '(EMPTY)';

  // --------------------------------------------------
  // 1. Minimal POST — create a single record using field ID
  // --------------------------------------------------
  const diagBody = JSON.stringify({
    records: [{ fields: { fldiatR2syOAnGeC1: '__DIAG_TEST__' } }],
  });

  const postHeaders = {
    Authorization: `Bearer ${token}`,
    'Content-Type': 'application/json',
  };

  let postStatus, postBody;
  try {
    const postRes = await fetch(tableUrl, {
      method: 'POST',
      headers: postHeaders,
      body: diagBody,
    });
    postStatus = postRes.status;
    postBody = await postRes.text();
  } catch (err) {
    postStatus = 'EXCEPTION';
    postBody = err.message || String(err);
  }

  results.minimalPost = { status: postStatus, body: postBody };

  // --------------------------------------------------
  // 2. Meta / bases — check what scopes the token has
  // --------------------------------------------------
  let metaStatus, metaBody;
  try {
    const metaRes = await fetch('https://api.airtable.com/v0/meta/bases', {
      headers: { Authorization: `Bearer ${token}` },
    });
    metaStatus = metaRes.status;
    const metaFull = await metaRes.text();
    metaBody = metaFull.substring(0, 200) + (metaFull.length > 200 ? '...(truncated)' : '');
  } catch (err) {
    metaStatus = 'EXCEPTION';
    metaBody = err.message || String(err);
  }

  results.metaBases = { status: metaStatus, body: metaBody };

  // --------------------------------------------------
  // 3. Also run a GET (read) to compare
  // --------------------------------------------------
  let getStatus, getBody;
  try {
    const getRes = await fetch(`${tableUrl}?maxRecords=1`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    getStatus = getRes.status;
    const getFull = await getRes.text();
    getBody = getFull.substring(0, 200) + (getFull.length > 200 ? '...(truncated)' : '');
  } catch (err) {
    getStatus = 'EXCEPTION';
    getBody = err.message || String(err);
  }

  results.getRead = { status: getStatus, body: getBody };

  // --------------------------------------------------
  // Build diagnostic response
  // --------------------------------------------------
  const diagnosticOutput = {
    timestamp: new Date().toISOString(),
    token: tokenPreview,
    envVars: {
      AIRTABLE_BASE_ID: env.AIRTABLE_BASE_ID || '(NOT SET)',
      AIRTABLE_TABLE_ID: env.AIRTABLE_TABLE_ID || '(NOT SET)',
    },
    requestDetails: {
      url: tableUrl,
      method: 'POST',
      headers: {
        Authorization: `Bearer ${token.substring(0, 15)}...`,
        'Content-Type': 'application/json',
      },
      body: diagBody,
    },
    results,
  };

  return new Response(JSON.stringify(diagnosticOutput, null, 2), {
    status: 200,
    headers: { 'Content-Type': 'application/json' },
  });
}

// =============================================================
// POST /api/apply — Form submission (unchanged)
// =============================================================
export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();

  const firstName       = formData.get('firstName') || '';
  const school          = formData.get('school') || '';
  const gender          = formData.get('gender') || '';
  const grade           = formData.get('grade') || '';
  const email           = formData.get('email') || '';
  const phone           = formData.get('phone') || '';
  const englishLevel    = formData.get('englishLevel') || '';
  const preferredCourse = formData.get('preferredCourse') || '';
  const message         = formData.get('message') || '';

  // --- 値のマッピング ---

  const genderMap = {
    '男': '男性',
    '女': '女性',
    '回答しない': 'Prefer not to say',
  };

  const gradeMap = {
    '中学1年生': '中学１年生',
    '中学2年生': '中学２年生',
    '中学3年生': '中学３年生',
    '高校1年生': '高校１年生',
    '高校2年生': '高校２年生',
    '高校3年生': '高校３年生',
  };

  const englishLevelMap = {
    '英検3級相当':   '英検備３級（または同じレベルの英語力）を保有',
    '英検準2級相当': '英検備２級（または同じレベルの英語力）を保有',
    '英検2級相当':   '英検２級（または同じレベルの英語力）を保有',
    '英検準1級相当': '英検備１級以上（または同じレベルの英語力）を保有',
    '未受験/その他': 'Not sure',
  };

  // 今日の日付（YYYY-MM-DD）
  const today = new Date().toISOString().split('T')[0];

  // --- Airtable レコード作成 ---

  const fields = {
    'Name':               firstName,
    'School Name':        school,
    'Gender':             genderMap[gender] || gender,
    'School Year':        gradeMap[grade] || grade,
    'Email':              email,
    'Phone':              phone,
    'English Level':      englishLevelMap[englishLevel] || englishLevel,
    '希望コース・プラン': preferredCourse,
    'Comments':           message,
    'Status':             'Applied',
    'Source':             'Form',
    'Application Date':   today,
  };

  // 空の任意フィールドは除外
  if (!school)          delete fields['School Name'];
  if (!phone)           delete fields['Phone'];
  if (!message)         delete fields['Comments'];
  if (!preferredCourse) delete fields['希望コース・プラン'];

  const airtableRes = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }] }),
    }
  );

  if (!airtableRes.ok) {
    const postErr = await airtableRes.text();
    const tableUrl = `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`;

    // GET で読み取り権限を確認（書き込みスコープとベースアクセスを区別）
    const getRes = await fetch(`${tableUrl}?maxRecords=1`, {
      headers: { 'Authorization': `Bearer ${env.AIRTABLE_TOKEN}` }
    });
    const getText = await getRes.text();

    const tok = env.AIRTABLE_TOKEN || '';
    return new Response(
      `POST (write) → ${airtableRes.status}: ${postErr}\n` +
      `GET  (read)  → ${getRes.status}: ${getText.substring(0, 80)}...\n` +
      `Token: ${tok.substring(0, 15)}... (length: ${tok.length})`,
      { status: 500 }
    );
  }

  // 成功 → /thanks.html にリダイレクト
  return Response.redirect(new URL('/thanks.html', request.url).toString(), 303);
}
