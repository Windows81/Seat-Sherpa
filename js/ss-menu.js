// js/ss-menu.js
//
// PROFILE MENU (2026-08-28) — "there should always be a profile section in the
// upper right hand corner where i can edit my profile, logout, etc" (Justin).
// One shared module so every signed-in web surface gets the same avatar button
// + dropdown: My trips · Driver dashboard · Account settings · Sign out.
//
// Renders nothing when signed out — pages keep their own "Sign in" pill.
// Reads the shared session key straight from localStorage (no supabase-js:
// these are mostly static pages and the menu must not cost a client). Avatar
// uses the OAuth picture from user_metadata when present, else an initial.
//
// SIGN OUT is local-scope by design (mirrors ss-session.signOut): it revokes
// only THIS browser's refresh token via /auth/v1/logout?scope=local and clears
// the shared key. It must never sign the user out of the app on their phone.

(function () {
  'use strict';

  var KEY = 'sb-vmfmbntacifqoqxqxgsk-auth-token';
  var SUPA = 'https://vmfmbntacifqoqxqxgsk.supabase.co';
  var ANON = 'sb_publishable_TGebz9q_z0kkH0Tuivlr4w_3MPLMxF3';

  function tok() {
    try { return JSON.parse(localStorage.getItem(KEY) || 'null'); } catch (_) { return null; }
  }

  var STYLE =
    '.ss-menu-wrap{position:relative;display:inline-flex;margin-left:10px;vertical-align:middle;}' +
    '.ss-menu-btn{width:34px;height:34px;border-radius:50%;border:1px solid #2a2a33;background:#17171d;' +
    'color:#00D4C8;font-weight:800;font-size:15px;cursor:pointer;display:flex;align-items:center;' +
    'justify-content:center;padding:0;overflow:hidden;font-family:inherit;flex-shrink:0;}' +
    '.ss-menu-btn:hover{border-color:rgba(0,212,200,0.5);}' +
    '.ss-menu-btn img{width:100%;height:100%;object-fit:cover;display:block;}' +
    '.ss-menu-pop{position:absolute;top:42px;right:0;min-width:200px;background:#17171d;' +
    'border:1px solid #2a2a33;border-radius:14px;padding:6px;z-index:1000;box-shadow:0 12px 32px rgba(0,0,0,0.5);}' +
    '.ss-menu-pop.hidden{display:none;}' +
    '.ss-menu-who{font-size:12px;color:#8a8a92;padding:8px 12px 6px;border-bottom:1px solid #23232b;' +
    'margin-bottom:4px;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;max-width:230px;}' +
    '.ss-menu-pop a,.ss-menu-pop button{display:block;width:100%;text-align:left;padding:9px 12px;' +
    'border-radius:9px;color:#fff;text-decoration:none;font-size:14.5px;font-weight:600;background:none;' +
    'border:0;cursor:pointer;font-family:inherit;box-sizing:border-box;}' +
    '.ss-menu-pop a:hover,.ss-menu-pop button:hover{background:#20202a;}' +
    '.ss-menu-pop .ss-menu-out{color:#ff8a8a;}';

  function ensureStyle() {
    if (document.getElementById('ssMenuStyle')) return;
    var s = document.createElement('style');
    s.id = 'ssMenuStyle';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function signOut() {
    var t = tok();
    try {
      if (t && t.access_token) {
        // Revoke this browser's refresh token server-side. keepalive so the
        // request survives the navigation right after.
        fetch(SUPA + '/auth/v1/logout?scope=local', {
          method: 'POST',
          headers: { apikey: ANON, Authorization: 'Bearer ' + t.access_token },
          keepalive: true,
        }).catch(function () {});
      }
    } catch (_) {}
    try { localStorage.removeItem(KEY); } catch (_) {}
    location.href = '/';
  }

  // mount(el) — renders the avatar button + dropdown into el when a session
  // exists; no-op when signed out or el is missing.
  function mount(el) {
    var t = tok();
    if (!el || !t || !t.user) return;
    ensureStyle();

    var meta = t.user.user_metadata || {};
    var name = String(meta.name || meta.full_name || t.user.email || '').trim();
    var initial = (name.charAt(0) || '•').toUpperCase();
    var photoUrl = null;
    if (typeof meta.avatar_url === 'string' && /^https:\/\//.test(meta.avatar_url)) photoUrl = meta.avatar_url;
    else if (typeof meta.picture === 'string' && /^https:\/\//.test(meta.picture)) photoUrl = meta.picture;

    el.classList.add('ss-menu-wrap');
    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ss-menu-btn';
    btn.setAttribute('aria-haspopup', 'menu');
    btn.setAttribute('aria-label', 'Account menu');
    if (photoUrl) {
      var img = document.createElement('img');
      img.src = photoUrl;
      img.alt = '';
      img.referrerPolicy = 'no-referrer';
      img.onerror = function () { img.remove(); btn.textContent = initial; };
      btn.appendChild(img);
    } else {
      btn.textContent = initial;
    }

    var pop = document.createElement('div');
    pop.className = 'ss-menu-pop hidden';
    var who = document.createElement('div');
    who.className = 'ss-menu-who';
    who.textContent = t.user.email || name;
    pop.appendChild(who);
    [
      ['My trips', '/trips'],
      ['Driver dashboard', '/driving'],
      ['Messages', '/messages'],
      ['Post a ride', '/post'],
      ['Find a ride', '/rides'],
      ['Account settings', '/account'],
    ].forEach(function (item) {
      var a = document.createElement('a');
      a.href = item[1];
      a.textContent = item[0];
      pop.appendChild(a);
    });
    var out = document.createElement('button');
    out.type = 'button';
    out.className = 'ss-menu-out';
    out.textContent = 'Sign out';
    out.addEventListener('click', signOut);
    pop.appendChild(out);

    el.appendChild(btn);
    el.appendChild(pop);

    btn.addEventListener('click', function (e) {
      e.stopPropagation();
      pop.classList.toggle('hidden');
    });
    document.addEventListener('click', function (e) {
      if (!pop.classList.contains('hidden') && !el.contains(e.target)) pop.classList.add('hidden');
    });
    document.addEventListener('keydown', function (e) {
      if (e.key === 'Escape') pop.classList.add('hidden');
    });
  }

  window.SS_MENU = { mount: mount, signOut: signOut };
})();
