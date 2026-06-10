// クラス空き状況をAirtable Timeslotsテーブルから取得して返す（公開エンドポイント）
// 返すのは枠ID・曜日・時間・講師・Statusのみ。生徒情報（JP/IND Students）は一切返さない。
const TIMESLOTS_TABLE_ID = 'tblKMHUl1Jt4kLVPv';
const F = {
  slotName: 'fldicexOtaJX4O9Mk', // Slot Name 例: "Mon 2030 Marina"
  teacher:  'fldT1dTafEyL3uft1', // Teacher (singleSelect)
  status:   'fldDPsECp1M3zrUz1', // Status (Empty / Not Full (high priority) / Not Full (low priority) / Full)
};

const DAY_ORDER = { Mon: 1, Tue: 2, Wed: 3, Thu: 4, Fri: 5, Sat: 6, Sun: 7 };
const DAY_JA = { Mon: '月曜', Tue: '火曜', Wed: '水曜', Thu: '木曜', Fri: '金曜', Sat: '土曜', Sun: '日曜' };

function timeLabel(t) {
  const known = { '2030': '20:30-21:30', '2200': '22:00-23:00' };
  if (known[t]) return known[t];
  if (/^\d{3,4}$/.test(t)) {
    const hh = t.length === 3 ? t.slice(0, 1) : t.slice(0, 2);
    const mm = t.slice(-2);
    const eh = String(Number(hh) + 1).padStart(2, '0');
    return `${hh.padStart(2, '0')}:${mm}-${eh}:${mm}`;
  }
  return t;
}

// singleSelect は REST では文字列で返るが、念のためオブジェクト形にも対応
function selName(v) {
  if (v && typeof v === 'object' && v.name) return v.name;
  return v || '';
}

function parseSlot(name) {
  const parts = String(name || '').trim().split(/\s+/);
  return { dayKey: parts[0] || '', time: parts[1] || '', teacher: parts.slice(2).join(' ') };
}

export async function onRequestGet({ env }) {
  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    // エッジで短時間キャッシュ（毎リクエストでAirtableを叩かない）
    'Cache-Control': 'public, max-age=120, s-maxage=120',
  };
  try {
    const url =
      `https://api.airtable.com/v0/${env.AIRTABLE_BASE_ID}/${TIMESLOTS_TABLE_ID}` +
      `?returnFieldsByFieldId=true&pageSize=100` +
      `&fields%5B%5D=${F.slotName}&fields%5B%5D=${F.teacher}&fields%5B%5D=${F.status}`;
    const res = await fetch(url, { headers: { Authorization: `Bearer ${env.AIRTABLE_TOKEN}` } });
    if (!res.ok) {
      return new Response(JSON.stringify({ ok: false, slots: [] }), { status: 502, headers });
    }
    const data = await res.json();
    const slots = (data.records || []).map((r) => {
      const f = r.fields || {};
      const parsed = parseSlot(f[F.slotName]);
      const teacher = selName(f[F.teacher]) || parsed.teacher;
      return {
        id: r.id,
        dayKey: parsed.dayKey,
        dayJa: DAY_JA[parsed.dayKey] || parsed.dayKey,
        time: parsed.time,
        timeLabel: timeLabel(parsed.time),
        teacher,
        status: selName(f[F.status]), // 'Empty' | 'Not Full (high priority)' | 'Not Full (low priority)' | 'Full'
      };
    });
    slots.sort(
      (a, b) =>
        (DAY_ORDER[a.dayKey] || 9) - (DAY_ORDER[b.dayKey] || 9) ||
        a.time.localeCompare(b.time) ||
        a.teacher.localeCompare(b.teacher)
    );
    return new Response(JSON.stringify({ ok: true, slots }), { status: 200, headers });
  } catch (e) {
    return new Response(JSON.stringify({ ok: false, slots: [] }), { status: 502, headers });
  }
}
