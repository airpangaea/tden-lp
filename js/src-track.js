/*
 * 流入元の記録（どこから来た人の申込か）
 * - ページを開いた時の utm_*・Dairin の印（_by）・広告クリックの印・参照元のドメイン・開いたページを、このブラウザ（localStorage）に覚える
 * - 覚えるのは「最初に来た時」（90日）と「最後に外から来た時」の2つ。サイト内の移動や、ブックマーク・直接の再訪では「最後」を変えない
 * - 申込フォーム（/api/apply）の見えない項目 src に読める文で入れる → apply.js → GAS → 生徒シートの「流入元」列
 *   例）「Dairin（_by）11/25 /success-stories ／ 最初: 検索（google.com）11/20 /」先頭の言葉が数える時の経路
 * - 名前・メールなどの個人情報は扱わない。クリックIDの値も残さない（あったかどうかだけ）
 * - 置くページ：sitemap.xml の公開ページ全部（記事などから最初に着くのがフォームの無いページでも拾うため）
 */
(function () {
  'use strict';
  var KEY = 'td_src_v1';
  var KEEP_MS = 90 * 864e5;
  var now = Date.now();

  function host(u) {
    try { return new URL(u).hostname.replace(/^www\./, '').toLowerCase(); } catch (e) { return ''; }
  }
  function clip(v, n) {
    return String(v || '').replace(/[^\w.\-\/]/g, '').slice(0, n || 40);
  }

  var q = null;
  try { q = new URLSearchParams(location.search); } catch (e) { q = null; }
  function p(name) { return q ? q.get(name) : null; }

  var ref = host(document.referrer);
  if (ref && ref === location.hostname.replace(/^www\./, '').toLowerCase()) ref = '';

  var touch = {
    s: clip(p('utm_source')), m: clip(p('utm_medium')), c: clip(p('utm_campaign')), ct: clip(p('utm_content')),
    g: !!(p('gclid') || p('gbraid') || p('wbraid')),
    f: !!p('fbclid'),
    d: !!p('_by'),
    r: clip(ref, 60),
    p: clip(location.pathname, 60) || '/',
    t: now
  };
  var fromOutside = !!(touch.s || touch.m || touch.g || touch.f || touch.d || touch.r);

  var st = null;
  try { st = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (e) { st = null; }
  if (!st || !st.first || !(now - st.first.t < KEEP_MS)) {
    st = { first: touch, last: fromOutside ? touch : null };
  } else if (fromOutside) {
    st.last = touch;
  }
  try { localStorage.setItem(KEY, JSON.stringify(st)); } catch (e) { /* 保存できなくても、このページの分は送る */ }

  var AI = /(^|\.)(chatgpt\.com|openai\.com|perplexity\.ai|gemini\.google\.com|copilot\.microsoft\.com|claude\.ai|felo\.ai|genspark\.ai)$/;
  var SNS = /(^|\.)(instagram\.com|facebook\.com|fb\.com|t\.co|x\.com|twitter\.com|line\.me|youtube\.com|youtu\.be|tiktok\.com|threads\.net)$/;
  var SNS_SRC = /^(instagram|facebook|fb|ig|youtube|line|x|twitter|tiktok|threads)$/;
  var SEARCH = /(^|\.)(google\.[a-z.]+|bing\.com|yahoo\.co\.jp|yahoo\.com|duckduckgo\.com|ecosia\.org|baidu\.com|naver\.com|search\.brave\.com)$/;

  function cat(x) {
    var m = (x.m || '').toLowerCase(), s = (x.s || '').toLowerCase();
    if (x.d) return 'Dairin';
    if (m === 'paid' || m === 'cpc' || m === 'ppc' || x.g) return '広告';
    if (m === 'email') return 'メール';
    if (s === 'activo' || /(^|\.)activo\.jp$/.test(x.r)) return 'activo';
    if (x.r && AI.test(x.r)) return 'AI';
    if (SNS_SRC.test(s) || m === 'social' || (x.r && SNS.test(x.r)) || x.f) return 'SNS';
    if (x.r && SEARCH.test(x.r)) return '検索';
    if (x.r && /(^|\.)airpangaea\.com$/.test(x.r)) return '自社サイト';
    if (x.r || m === 'referral') return '他サイト';
    if (s || m) return 'その他';
    return '直接';
  }
  function detail(x) {
    var parts = [];
    var u = [x.s, x.m, x.c, x.ct].filter(Boolean).join('/');
    if (u) parts.push(u);
    if (x.r) parts.push(x.r);
    if (x.g) parts.push('gclid');
    if (x.f) parts.push('fbclid');
    if (x.d) parts.push('_by');
    return parts.join(' ');
  }
  function one(x) {
    var d = new Date(x.t), dt = detail(x);
    return cat(x) + (dt ? '（' + dt + '）' : '') + ' ' + (d.getMonth() + 1) + '/' + d.getDate() + ' ' + x.p;
  }
  function text() {
    var main = st.last || st.first;
    var s = one(main);
    if (main !== st.first && main.t !== st.first.t) s += ' ／ 最初: ' + one(st.first);
    return s.slice(0, 280);
  }

  function fill(form) {
    if (!form) return;
    var el = form.querySelector('input[name="src"]');
    if (!el) {
      el = document.createElement('input');
      el.type = 'hidden';
      el.name = 'src';
      form.appendChild(el);
    }
    el.value = text();
  }
  function fillAll() {
    var fs = document.querySelectorAll('form[action="/api/apply"]');
    for (var i = 0; i < fs.length; i++) fill(fs[i]);
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', fillAll);
  else fillAll();
  document.addEventListener('submit', function (e) {
    var f = e.target;
    if (f && f.matches && f.matches('form[action="/api/apply"]')) fill(f);
  }, true);
})();
