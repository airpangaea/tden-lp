export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();

  // フォームの全データを取得（デバッグ用にも使う）
  const rawForm = {};
  for (const [key, value] of formData.entries()) {
    rawForm[key] = value;
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

  const genderMap = {
    '男': '男性', '女': '女性', '回答しない': 'Prefer not to say',
  };
  const gradeMap = {
    '中学1年生': '中学１年生', '中学2年生': '中学２年生', '中学3年生': '中学３年生',
    '高校1年生': '高校１年生', '高校2年生': '高校２年生', '高校3年生': '高校３年生',
  };
  const englishLevelMap = {
    '英検3級相当':   '英検備３級（または同じレベルの英語力）を保有',
    '英検準2級相当': '英検備２級（または同じレベルの英語力）を保有',
    '英検2級相当':   '英検２級（または同じレベルの英語力）を保有',
    '英検準1級相当': '英検備１級以上（または同じレベルの英語力）を保有',
    '未受験/その他': 'Not sure',
  };

  const fields = {
    'fldiatR2syOAnGeC1': firstName,                                     // Name
    'fldkgBWAY5URfwVlO': genderMap[gender] || gender,                   // Gender
    'fldxVi5K2gNiVyWf6': gradeMap[grade] || grade,                      // School Year
    'fldwEBlgkxM3TMQeo': email,                                         // Email
    'fldteul63pEfP2j9i': englishLevelMap[englishLevel] || englishLevel,  // English Level
    'fld7kF0rL8NBwqVL9': 'Applied',                                     // Status
    'fldq5F1H26trbiiea': 'Form',                                        // Source
  };

  // 任意フィールド（空でなければ追加）
  if (school)          fields['fldHofD6n1pignZRl'] = school;            // School Name
  if (phone)           fields['fldvaJlyLqANY3IYw'] = phone;             // Phone
  if (message)         fields['flddosiHxBy3F59nM'] = message;           // Comments
  if (preferredCourse) fields['fldrgi5NUhq2JdXne'] = preferredCourse;   // 希望コース・プラン

  const reqBody = JSON.stringify({ records: [{ fields }], typecast: true });

  const airtableRes = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: reqBody,
    }
  );

  if (!airtableRes.ok) {
    const errText = await airtableRes.text();
    // 全情報を一画面で表示
    return new Response(JSON.stringify({
      error: `${airtableRes.status}`,
      airtableResponse: errText,
      formDataReceived: rawForm,
      fieldsSent: fields,
      requestBody: reqBody,
    }, null, 2), {
      status: 500,
      headers: { 'Content-Type': 'application/json' },
    });
  }

  return Response.redirect(new URL('/thanks.html', request.url).toString(), 303);
}
