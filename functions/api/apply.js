export async function onRequestPost(context) {
  const { request, env } = context;
  const formData = await request.formData();

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

  // --- Commentsフィールドの組み立て ---
  // 希望コース・プランはフィールドレベルの編集制限があるため、Commentsに含める
  const commentParts = [];
  if (preferredCourse) commentParts.push(`【希望コース】${preferredCourse}`);
  if (message)         commentParts.push(message);
  const combinedComments = commentParts.join('\n');

  // --- Airtable フィールド ---
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
  if (school)           fields['fldHofD6n1pignZRl'] = school;           // School Name
  if (phone)            fields['fldvaJlyLqANY3IYw'] = phone;            // Phone
  if (combinedComments) fields['flddosiHxBy3F59nM'] = combinedComments; // Comments

  const airtableRes = await fetch(
    `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${env.AIRTABLE_TABLE_ID}`,
    {
      method: 'POST',
      headers: {
        'Authorization': `Bearer ${env.AIRTABLE_TOKEN}`,
        'Content-Type': 'application/json',
      },
      body: JSON.stringify({ records: [{ fields }], typecast: true }),
    }
  );

  if (!airtableRes.ok) {
    const errText = await airtableRes.text();
    console.error('Airtable error:', errText);
    return new Response('送信に失敗しました。しばらく待ってから再度お試しください。', { status: 500 });
  }

  return Response.redirect(new URL('/thanks.html', request.url).toString(), 303);
}
