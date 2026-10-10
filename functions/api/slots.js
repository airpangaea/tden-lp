// クラス空き状況を「TDEN 生徒管理」スプシの「クラス一覧」からGAS経由で取得して返す（公開エンドポイント）
// 返すのは枠ID(Group ID)・曜日・時間・講師・空き状況のみ。Zoom等のクラス情報や生徒情報は一切返さない。
// 環境変数: GAS_URL（GASウェブアプリのURL）, GAS_KEY（GASと共有する合言葉）

// スプシを毎回読みに行かないよう、Cloudflareのキャッシュに保存する（スプシ更新からLP反映まで最大15分）
const CACHE_SECONDS = 900;

// 「空き_JP」がこれ以外（空欄・非表示）のクラスはLPに出さない
const LP_STATUSES = ['受付中', '途中参加', '満席'];

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

export async function onRequestGet({ request, env, waitUntil }) {
  const cache = caches.default;
  const cacheKey = new Request(new URL('/api/slots', request.url).toString());
  const cached = await cache.match(cacheKey);
  if (cached) return cached;

  const headers = {
    'Content-Type': 'application/json; charset=utf-8',
    'Cache-Control': `public, max-age=${CACHE_SECONDS}`,
  };
  try {
    if (!env.GAS_URL || !env.GAS_KEY) throw new Error('GAS_URL / GAS_KEY is not set');
    const res = await fetch(`${env.GAS_URL}?action=classes&key=${encodeURIComponent(env.GAS_KEY)}`);
    const data = res.ok ? await res.json() : null;
    if (!data || !data.ok || !Array.isArray(data.classes)) throw new Error('GAS returned an error');

    const slots = data.classes
      .filter((c) => LP_STATUSES.includes(c.jp) && DAY_ORDER[c.day])
      .map((c) => ({
        id: c.groupId,
        dayKey: c.day,
        dayJa: DAY_JA[c.day],
        time: c.time,
        timeLabel: timeLabel(c.time),
        teacher: c.teacher,
        status: c.jp, // '受付中' | '途中参加' | '満席'
      }));
    slots.sort(
      (a, b) =>
        DAY_ORDER[a.dayKey] - DAY_ORDER[b.dayKey] ||
        a.time.localeCompare(b.time) ||
        a.teacher.localeCompare(b.teacher)
    );

    const response = new Response(JSON.stringify({ ok: true, slots }), { status: 200, headers });
    waitUntil(cache.put(cacheKey, response.clone()));
    return response;
  } catch (e) {
    console.error('slots error:', e);
    // 失敗時はキャッシュしない（index.html 側の FALLBACK_SLOTS で描画される）
    return new Response(JSON.stringify({ ok: false, slots: [] }), {
      status: 502,
      headers: { ...headers, 'Cache-Control': 'no-store' },
    });
  }
}
