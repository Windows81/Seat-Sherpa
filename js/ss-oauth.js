// js/ss-oauth.js
//
// SOCIAL SIGN-IN (Google / Apple) for the web surfaces (2026-08-28).
// One shared module so /signin, /book and /post render identical buttons and
// share one popup flow. Plain script (not an ES module) — book/post/signin all
// load it with a classic <script src> before their inline module scripts.
//
// FLOW: click → popup opens Supabase's /auth/v1/authorize (implicit flow —
// tokens come back in the URL FRAGMENT, which never reaches any server log)
// → the popup lands on /auth-callback, which persists the session into the
// SHARED localStorage key (ss-session.js documents the no-storageKey rule)
// and closes itself → this module polls that key and hands control back to
// the page's continuation. The page's own supabase client reads storage on
// every getSession()/getUser() call, so it picks the new session up without
// a reload — and crucially the page NEVER navigates, so a booker's seat
// selection and a poster's staged legs survive sign-in.
//
// POPUP-BLOCKED FALLBACK: full-page redirect. We stash the current URL in
// ss_oauth_next; /auth-callback bounces back to it after the session lands.
//
// WEBVIEWS (Instagram / Facebook / TikTok in-app browsers): Google hard-blocks
// OAuth there ("disallowed_useragent"), so the buttons don't render at all and
// the email code remains the only path. A hidden button beats a broken one.
//
// NOT rendered through supabase-js on purpose: the implicit-flow authorize URL
// is static, and calling signInWithOAuth from page clients configured with
// detectSessionInUrl:false adds nothing but a dependency on client internals.

(function () {
  'use strict';

  var KEY = 'sb-vmfmbntacifqoqxqxgsk-auth-token';
  var AUTH_BASE = 'https://vmfmbntacifqoqxqxgsk.supabase.co/auth/v1/authorize';
  var CALLBACK = 'https://seatsherpa.app/auth-callback';

  function currentToken() {
    try {
      var t = JSON.parse(localStorage.getItem(KEY) || 'null');
      return t && t.access_token && t.user ? t.access_token : null;
    } catch (_) { return null; }
  }

  function hasSession() { return !!currentToken(); }

  function inWebview() {
    // Named in-app browsers PLUS generic Android WebViews ("; wv)" token,
    // Gmail/LinkedIn embeds) — Google refuses OAuth in all of them, and the
    // popup-blocked fallback would dead-end on Google's error page (review
    // finding #11). Email code remains the path there.
    var ua = navigator.userAgent || '';
    // (GSA/Gmail tokens removed after review: GSA's in-app browser handles
    // Google OAuth fine, and Gmail's iOS webview UA never says "Gmail".)
    return /(FBAN|FBAV|FB_IAB|Instagram|TikTok|musical_ly|Snapchat|Line\/|LinkedInApp|; ?wv\))/i.test(ua);
  }

  function authUrl(provider) {
    return AUTH_BASE + '?provider=' + encodeURIComponent(provider) +
      '&redirect_to=' + encodeURIComponent(CALLBACK);
  }

  var G_SVG =
    '<svg width="19" height="19" viewBox="0 0 48 48" aria-hidden="true">' +
    '<path fill="#EA4335" d="M24 9.5c3.54 0 6.71 1.22 9.21 3.6l6.85-6.85C35.9 2.38 30.47 0 24 0 14.62 0 6.51 5.38 2.56 13.22l7.98 6.19C12.43 13.72 17.74 9.5 24 9.5z"/>' +
    '<path fill="#4285F4" d="M46.98 24.55c0-1.57-.15-3.09-.38-4.55H24v9.02h12.94c-.58 2.96-2.26 5.48-4.78 7.18l7.73 6c4.51-4.18 7.09-10.36 7.09-17.65z"/>' +
    '<path fill="#FBBC05" d="M10.53 28.59c-.48-1.45-.76-2.99-.76-4.59s.27-3.14.76-4.59l-7.98-6.19C.92 16.46 0 20.12 0 24c0 3.88.92 7.54 2.56 10.78l7.97-6.19z"/>' +
    '<path fill="#34A853" d="M24 48c6.48 0 11.93-2.13 15.89-5.81l-7.73-6c-2.15 1.45-4.92 2.3-8.16 2.3-6.26 0-11.57-4.22-13.47-9.91l-7.98 6.19C6.51 42.62 14.62 48 24 48z"/></svg>';

  var APPLE_SVG =
    '<svg width="18" height="18" viewBox="0 0 24 24" fill="currentColor" aria-hidden="true">' +
    '<path d="M17.05 20.28c-.98.95-2.05.86-3.08.41-1.09-.47-2.09-.48-3.24 0-1.44.62-2.2.44-3.06-.41C2.79 15.25 3.51 7.59 9.05 7.31c1.35.07 2.29.74 3.08.78 1.18-.24 2.31-.93 3.57-.84 1.51.12 2.65.72 3.4 1.8-3.12 1.87-2.38 5.98.48 7.13-.57 1.5-1.31 2.99-2.54 4.1zM12.03 7.25c-.15-2.23 1.66-4.07 3.74-4.25.29 2.58-2.34 4.5-3.74 4.25z"/></svg>';

  var STYLE =
    '.ss-oauth-btn{width:100%;display:flex;align-items:center;justify-content:center;gap:10px;' +
    'padding:13px 16px;border-radius:12px;border:1px solid #d7d7dc;background:#fff;color:#1f1f24;' +
    'font-size:15.5px;font-weight:700;font-family:inherit;cursor:pointer;margin-bottom:10px;}' +
    '.ss-oauth-btn:disabled{opacity:0.45;cursor:default;}' +
    '.ss-oauth-btn.apple{background:#000;color:#fff;border-color:#3a3a42;}' +
    '.ss-oauth-msg{font-size:13.5px;line-height:1.5;margin:2px 0 8px;color:#8a8a92;text-align:center;}' +
    '.ss-oauth-msg.err{color:#ff8a8a;}' +
    '.ss-oauth-msg:empty{display:none;}' +
    '.ss-oauth-or{display:flex;align-items:center;gap:12px;color:#6f6f78;font-size:13px;margin:14px 0;}' +
    '.ss-oauth-or::before,.ss-oauth-or::after{content:"";flex:1;height:1px;background:#2a2a33;}';

  function ensureStyle() {
    if (document.getElementById('ssOauthStyle')) return;
    var s = document.createElement('style');
    s.id = 'ssOauthStyle';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  // mount(el, { onSignedIn }) — renders "Continue with Google / Apple" plus an
  // "or" divider into el and wires the popup flow. onSignedIn(provider) fires
  // once the session is in localStorage (popup path only — the full-redirect
  // fallback comes back through /auth-callback → ss_oauth_next instead, where
  // the page's normal already-signed-in boot path takes over).
  function mount(el, opts) {
    if (!el || inWebview()) return;
    ensureStyle();
    opts = opts || {};

    el.innerHTML =
      '<button type="button" class="ss-oauth-btn" data-p="google">' + G_SVG + '<span>Continue with Google</span></button>' +
      '<button type="button" class="ss-oauth-btn apple" data-p="apple">' + APPLE_SVG + '<span>Continue with Apple</span></button>' +
      '<div class="ss-oauth-msg"></div>' +
      '<div class="ss-oauth-or"><span>or</span></div>';

    var msg = el.querySelector('.ss-oauth-msg');
    var btns = el.querySelectorAll('.ss-oauth-btn');
    var busy = false;

    function setBusy(b, provider) {
      busy = b;
      for (var i = 0; i < btns.length; i++) btns[i].disabled = b;
      msg.classList.remove('err');
      msg.textContent = b
        ? 'Waiting for ' + (provider === 'apple' ? 'Apple' : 'Google') + '… finish signing in in the popup.'
        : '';
    }
    function showErr(text) {
      msg.classList.add('err');
      msg.textContent = text;
    }

    function onClick(e) {
      if (busy) return;
      var provider = e.currentTarget.getAttribute('data-p');

      // The popup MUST open synchronously inside the click, or blockers eat
      // it. We open blank first, then point it at the authorize URL.
      var w = null;
      try { w = window.open('', 'ss_oauth', 'popup=yes,width=480,height=700'); } catch (_) {}
      if (!w) {
        // Popup blocked → full-page redirect. /auth-callback returns here.
        try { localStorage.setItem('ss_oauth_next', location.href); } catch (_) {}
        location.href = authUrl(provider);
        return;
      }
      try { w.location.href = authUrl(provider); } catch (_) {}
      setBusy(true, provider);

      // A STALE session (expired/revoked but still in storage — the page
      // showed sign-in because getUser() failed) must not read as instant
      // success: success = a token DIFFERENT from the one present at click.
      var tokenAtClick = currentToken();
      function freshSession() {
        var t = currentToken();
        return !!(t && t !== tokenAtClick);
      }

      var start = Date.now();
      var closedAt = 0;
      var iv = setInterval(function () {
        if (freshSession()) { done(null); return; }
        try { if (w.closed && !closedAt) closedAt = Date.now(); } catch (_) {}
        // Grace period after close: the callback page writes storage moments
        // before window.close(), and storage can land a beat later.
        if (closedAt && Date.now() - closedAt > 1500) { done('closed'); return; }
        if (Date.now() - start > 4 * 60 * 1000) { done('timeout'); }
      }, 500);

      function done(err) {
        clearInterval(iv);
        try { if (!w.closed) w.close(); } catch (_) {}
        if (freshSession()) err = null;
        setBusy(false);
        if (!err) {
          if (opts.onSignedIn) opts.onSignedIn(provider);
          return;
        }
        if (err === 'timeout') showErr('That took too long — try again, or use the email code below.');
        // 'closed' = the user changed their mind. Stay quiet.
      }
    }

    for (var i = 0; i < btns.length; i++) btns[i].addEventListener('click', onClick);
  }

  window.SS_OAUTH = { mount: mount, hasSession: hasSession, authUrl: authUrl, inWebview: inWebview };
})();
