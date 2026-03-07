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

  // --- Airtable レコード作成（フィールドIDを使用）---
  // ※ Application Date (fld7taraUhhzZTNbL) はフィールド編集制限あり → 除外
  //    レコードの createdTime で作成日時は自動記録される

  const fields = {
    'fldiatR2syOAnGeC1': firstName,                                     // Name
    'fldHofD6n1pignZRl': school,                                        // School Name
    'fldkgBWAY5URfwVlO': genderMap[gender] || gender,                   // Gender
    'fldxVi5K2gNiVyWf6': gradeMap[grade] || grade,                      // School Year
    'fldwEBlgkxM3TMQeo': email,                                         // Email
    'fldvaJlyLqANY3IYw': phone,                                         // Phone
    'fldteul63pEfP2j9i': englishLevelMap[englishLevel] || englishLevel,  // English Level
    'fldrgi5NUhq2JdXne': preferredCourse,                               // 希望コース・プラン
    'flddosiHxBy3F59nM': message,                                       // Comments
    'fld7kF0rL8NBwqVL9': 'Applied',                                     // Status
    'fldq5F1H26trbiiea': 'Form',                                        // Source
  };

  // 空の任意フィールドは除外
  if (!school)          delete fields['fldHofD6n1pignZRl'];
  if (!phone)           delete fields['fldvaJlyLqANY3IYw'];
  if (!message)         delete fields['flddosiHxBy3F59nM'];
  if (!preferredCourse) delete fields['fldrgi5NUhq2JdXne'];

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

  // 成功 → /thanks.html にリダイレクト
  return Response.redirect(new URL('/thanks.html', request.url).toString(), 303);
}
