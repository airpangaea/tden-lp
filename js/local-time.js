/* 授業時刻（日本時間）を、見ている人のタイムゾーンで表示する（/en/・/id/・/en/global-academic-pass/ で共用）
 *
 *  data-jst-range="20:30-21:30"   … 時間帯（"20:30" だけなら開始時刻のみ）
 *  data-jst-days="20:30"          … 「月〜金」の曜日。その時刻で日付がずれる国では曜日もずらす
 *  data-tz-label / data-tz-short  … 表示中のタイムゾーン名（例: Jakarta (UTC+7) ／ WIB (UTC+7)）
 *  data-tz-picker / data-tz-select … タイムゾーンの切り替え（JSが動いた時だけ表示する）
 *
 * 表示の言語は <html lang> で切り替える（en／id）。インドネシア語では24時間表記（18.30）と WIB／WITA／WIT を使う。
 * JSが動かない環境では、HTMLに書いた時刻の表記がそのまま残る。
 */
(function () {
  if (!window.Intl || !Intl.DateTimeFormat || !Intl.DateTimeFormat.prototype.formatToParts) return;

  var JAPAN = 'Asia/Tokyo';
  var INDONESIA = { 'Asia/Jakarta': 'WIB', 'Asia/Pontianak': 'WIB', 'Asia/Makassar': 'WITA', 'Asia/Jayapura': 'WIT' };

  var TEXT = {
    en: {
      locale: 'en-US',
      clock: { hour: 'numeric', minute: '2-digit' },
      days: ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'],
      japan: 'Japan time',
      yourLocal: 'your local time — ',
      myZone: 'My time zone — ',
      nextDay: ' (next day)',
      prevDay: ' (previous day)',
      presets: [
        ['Asia/Jakarta', 'Jakarta'],
        ['Asia/Bangkok', 'Bangkok / Hanoi'],
        ['Asia/Kuala_Lumpur', 'Kuala Lumpur'],
        ['Asia/Singapore', 'Singapore'],
        ['Asia/Manila', 'Manila'],
        ['Asia/Taipei', 'Taipei'],
        [JAPAN, 'Tokyo']
      ]
    },
    id: {
      locale: 'id-ID',
      clock: { hour: '2-digit', minute: '2-digit', hourCycle: 'h23' },
      days: ['Minggu', 'Senin', 'Selasa', 'Rabu', 'Kamis', 'Jumat', 'Sabtu'],
      japan: 'waktu Jepang',
      yourLocal: 'waktu setempatmu — ',
      myZone: 'Zona waktuku — ',
      nextDay: ' (hari berikutnya)',
      prevDay: ' (hari sebelumnya)',
      presets: [
        ['Asia/Jakarta', 'WIB — Jakarta'],
        ['Asia/Makassar', 'WITA — Bali, Makassar'],
        ['Asia/Jayapura', 'WIT — Jayapura'],
        ['Asia/Kuala_Lumpur', 'Kuala Lumpur'],
        ['Asia/Singapore', 'Singapura'],
        [JAPAN, 'Tokyo']
      ]
    }
  };
  var LANG = (document.documentElement.lang || '').slice(0, 2) === 'id' ? 'id' : 'en';
  var T = TEXT[LANG];

  function isValidTz(tz) {
    try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true; } catch (e) { return false; }
  }
  var deviceTz = '';
  try { deviceTz = Intl.DateTimeFormat().resolvedOptions().timeZone; } catch (e) {}
  if (!deviceTz || !isValidTz(deviceTz)) deviceTz = JAPAN;

  // 次の月曜（日本時間）の hh:mm。夏時間のある国でも「いまの時期」の時差で表示するため、固定日ではなく直近の日付を使う
  function nextMondayJst(hhmm) {
    var j = new Date(Date.now() + 9 * 3600000); // 日本の壁時計を UTC の getter で読む
    var add = (8 - j.getUTCDay()) % 7;
    var t = hhmm.split(':');
    return new Date(Date.UTC(j.getUTCFullYear(), j.getUTCMonth(), j.getUTCDate() + add, +t[0] - 9, +t[1]));
  }

  function partsOf(date, tz) {
    var o = {};
    new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: 'numeric', day: 'numeric', hour: 'numeric', minute: 'numeric'
    }).formatToParts(date).forEach(function (p) { o[p.type] = +p.value; });
    return o;
  }

  function offsetMinutes(date, tz) {
    var p = partsOf(date, tz);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day, p.hour % 24, p.minute) - date.getTime()) / 60000);
  }

  function utcLabel(min) {
    var a = Math.abs(min);
    return 'UTC' + (min < 0 ? '-' : '+') + Math.floor(a / 60) + (a % 60 ? ':' + ('0' + (a % 60)).slice(-2) : '');
  }

  // その国の日付が、日本の日付から何日ずれるか（-1, 0, +1）
  function dayShift(date, tz) {
    var p = partsOf(date, tz);
    var j = partsOf(date, JAPAN);
    return Math.round((Date.UTC(p.year, p.month - 1, p.day) - Date.UTC(j.year, j.month - 1, j.day)) / 86400000);
  }

  function clock(date, tz) {
    var opts = { timeZone: tz };
    for (var k in T.clock) opts[k] = T.clock[k];
    return new Intl.DateTimeFormat(T.locale, opts).format(date);
  }

  function cityOf(tz) {
    return tz.split('/').pop().replace(/_/g, ' ');
  }

  // タイムゾーン切り替えの選択肢に出す名前（例: Kuala Lumpur ／ WIB — Jakarta）
  function pickerName(tz) {
    for (var i = 0; i < T.presets.length; i++) if (T.presets[i][0] === tz) return T.presets[i][1];
    if (LANG === 'id' && INDONESIA[tz]) return INDONESIA[tz] + ' — ' + cityOf(tz);
    return cityOf(tz);
  }

  // 本文に出す名前（英語: Jakarta ／ インドネシア語: WIB, waktu Kuala Lumpur）
  function zoneName(tz) {
    if (tz === JAPAN) return T.japan;
    if (LANG === 'id') return INDONESIA[tz] || 'waktu ' + pickerName(tz);
    return pickerName(tz);
  }

  function each(sel, fn) { Array.prototype.forEach.call(document.querySelectorAll(sel), fn); }

  function render(tz) {
    var utc = utcLabel(offsetMinutes(nextMondayJst('20:30'), tz));
    var name = zoneName(tz);

    each('[data-tz-label]', function (el) {
      el.textContent = (tz === deviceTz && tz !== JAPAN ? T.yourLocal : '') + name + ' (' + utc + ')';
    });
    each('[data-tz-short]', function (el) {
      if (LANG === 'id' && INDONESIA[tz]) el.textContent = name;
      else if (LANG === 'en' && tz !== JAPAN) el.textContent = name + ' time, ' + utc;
      else el.textContent = name + ', ' + utc;
    });

    var daysEl = document.querySelector('[data-jst-days]');
    var baseShift = dayShift(nextMondayJst(daysEl ? daysEl.getAttribute('data-jst-days') : '20:30'), tz);

    each('[data-jst-days]', function (el) {
      var s = dayShift(nextMondayJst(el.getAttribute('data-jst-days')), tz);
      el.textContent = T.days[(1 + s + 7) % 7] + ' – ' + T.days[(5 + s + 7) % 7];
    });
    each('[data-jst-range]', function (el) {
      var r = el.getAttribute('data-jst-range').split('-');
      var start = nextMondayJst(r[0]);
      var text = clock(start, tz) + (r[1] ? ' – ' + clock(nextMondayJst(r[1]), tz) : '');
      var s = dayShift(start, tz);
      if (s !== baseShift) text += s > baseShift ? T.nextDay : T.prevDay;
      el.textContent = text;
    });
  }

  function setupPicker() {
    var selects = document.querySelectorAll('[data-tz-select]');
    if (!selects.length) return;
    var ref = nextMondayJst('20:30');
    var options = [[deviceTz, T.myZone + pickerName(deviceTz) + ' (' + utcLabel(offsetMinutes(ref, deviceTz)) + ')']];
    T.presets.forEach(function (p) {
      if (p[0] !== deviceTz) options.push([p[0], p[1] + ' (' + utcLabel(offsetMinutes(ref, p[0])) + ')']);
    });
    Array.prototype.forEach.call(selects, function (sel) {
      options.forEach(function (o) {
        var opt = document.createElement('option');
        opt.value = o[0];
        opt.textContent = o[1];
        sel.appendChild(opt);
      });
      sel.addEventListener('change', function () {
        var tz = sel.value;
        Array.prototype.forEach.call(selects, function (s) { s.value = tz; });
        render(tz);
      });
    });
    each('[data-tz-picker]', function (el) { el.hidden = false; });
  }

  function init() {
    setupPicker();
    render(deviceTz);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init);
  else init();
})();
