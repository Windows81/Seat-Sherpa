// js/ss-appbar.js
//
// CONSOLE APP BAR (2026-08-28) — Justin: "make everything as good as you can
// for the dashboard for web, take BlaBlaCar / Rover / Airbnb as inspiration".
//
// Replaces the centred pill strip under a centred logo (a phone pattern that
// wrapped to two rows on a laptop) with one full-bleed sticky bar, the shape
// every one of those products uses:
//
//   [wordmark]   Trips  Driving  Messages      [Post a ride]  [avatar]
//
// - Sections are underline tabs, not filled pills: the active tab is the only
//   teal thing on the left, so "where am I" reads instantly.
// - "Post a ride" is the standing primary action, always in the same place
//   (BlaBlaCar keeps Publish pinned to the bar for exactly this reason).
// - One row always. Below 720px the tab strip scrolls horizontally instead of
//   wrapping, and the CTA collapses to a "+" so the bar stays one line.
// - Profile menu is delegated to ss-menu.js (already the shared owner of the
//   avatar, dropdown and local-scope sign-out).
//
// Pages that need an in-page action in the bar (driving.html's Wallet and
// Car & license switch state without navigating) pass `extra` items with an
// onClick; everything else is a plain href.
//
// mount() is a no-op when signed out — signed-out pages keep their own hero.

(function () {
  'use strict';

  var KEY = 'sb-vmfmbntacifqoqxqxgsk-auth-token';

  function signedIn() {
    try {
      var t = JSON.parse(localStorage.getItem(KEY) || 'null');
      return !!(t && t.user);
    } catch (_) { return false; }
  }

  var WORDMARK =
    '<svg viewBox="0 -22 600 144" role="img" aria-label="Seat Sherpa" xmlns="http://www.w3.org/2000/svg">' +
    '<defs><linearGradient id="ssabg" x1="0" y1="1" x2="0.35" y2="0">' +
    '<stop offset="0" stop-color="#0F9C93"/><stop offset="1" stop-color="#24E4D8"/></linearGradient></defs>' +
    '<g transform="translate(-36.4 -50) scale(0.427)">' +
    '<path d="M150 342 C 162 312, 236 286, 240 250 C 245 210, 90 196, 94 160 C 97 115, 158 99, 186 86 Q 200 76 214 86 ' +
    'C 192 99, 141 115, 146 160 C 150 196, 313 210, 316 250 C 320 286, 254 312, 250 342 Z" ' +
    'fill="url(#ssabg)" stroke="#0B5650" stroke-width="4"/>' +
    '<path d="M200 342 C 208 312, 278 286, 278 250 C 279 210, 120 196, 120 160 C 119 115, 175 99, 200 86" ' +
    'fill="none" stroke="#FFFFFF" stroke-width="5" stroke-linecap="butt" stroke-dasharray="9 16"/></g>' +
    '<text x="101" y="96" font-family="Outfit, sans-serif" font-weight="600" font-size="86" fill="#00D4C8">eat</text>' +
    '<text x="263" y="96" font-family="Outfit, sans-serif" font-weight="600" font-size="86" fill="#ffffff">Sherpa</text></svg>';

  var STYLE = [
    // Full-bleed bar. Pages keep their own centred content column; only the
    // bar spans the viewport, which is what makes it read as app chrome.
    // width/align-self keep it full-bleed inside account.html's centred flex
    // body as well as the plain block bodies elsewhere.
    '.ss-bar{position:sticky;top:0;z-index:900;margin-bottom:24px;width:100%;align-self:stretch;',
    'background:rgba(14,14,16,0.88);backdrop-filter:saturate(160%) blur(12px);',
    '-webkit-backdrop-filter:saturate(160%) blur(12px);border-bottom:1px solid #202027;}',
    // max-width is overwritten at mount to match the host page's own content
    // column, so the wordmark lines up with the page's left edge instead of
    // floating out in the margin. 1180 is only the fallback.
    '.ss-bar-in{max-width:1180px;margin:0 auto;display:flex;align-items:center;gap:18px;height:62px;}',
    '.ss-bar-logo{display:flex;align-items:center;flex:none;}',
    '.ss-bar-logo svg{height:28px;width:auto;display:block;}',
    // Tab strip. Scrolls rather than wraps — a two-row bar is the thing we
    // are fixing, so it must never come back at any width.
    '.ss-bar-tabs{display:flex;align-items:center;gap:4px;flex:1;min-width:0;',
    'overflow-x:auto;scrollbar-width:none;-ms-overflow-style:none;height:62px;}',
    '.ss-bar-tabs::-webkit-scrollbar{display:none;}',
    // When the strip overflows, fade its trailing edge so a clipped tab reads
    // as "there is more, scroll" rather than as a rendering bug.
    '.ss-bar-tabs.over-r{-webkit-mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);',
    'mask-image:linear-gradient(90deg,#000 calc(100% - 34px),transparent);}',
    '.ss-bar-tabs.over-l{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px);',
    'mask-image:linear-gradient(90deg,transparent,#000 34px);}',
    '.ss-bar-tabs.over-l.over-r{-webkit-mask-image:linear-gradient(90deg,transparent,#000 34px,#000 calc(100% - 34px),transparent);',
    'mask-image:linear-gradient(90deg,transparent,#000 34px,#000 calc(100% - 34px),transparent);}',
    '.ss-bar-tabs a,.ss-bar-tabs button{position:relative;display:inline-flex;align-items:center;gap:7px;',
    'height:62px;padding:0 13px;font-family:inherit;font-size:14.5px;font-weight:600;color:#adadb8;',
    'text-decoration:none;background:none;border:0;cursor:pointer;white-space:nowrap;flex:none;}',
    '.ss-bar-tabs a:hover,.ss-bar-tabs button:hover{color:#fff;}',
    // The underline IS the active state — no filled pill, no border ring.
    '.ss-bar-tabs a::after,.ss-bar-tabs button::after{content:"";position:absolute;left:13px;right:13px;',
    'bottom:0;height:2px;border-radius:2px 2px 0 0;background:transparent;}',
    '.ss-bar-tabs a.on,.ss-bar-tabs button.on{color:#fff;font-weight:700;}',
    '.ss-bar-tabs a.on::after,.ss-bar-tabs button.on::after{background:#00D4C8;}',
    // Count badge (pending requests, unread messages).
    '.ss-bar-badge{display:inline-flex;align-items:center;justify-content:center;min-width:19px;height:19px;',
    'padding:0 6px;border-radius:999px;background:#FFB84D;color:#241a05;font-size:11.5px;font-weight:800;}',
    '.ss-bar-right{display:flex;align-items:center;gap:10px;flex:none;margin-left:auto;}',
    '.ss-bar-cta{display:inline-flex;align-items:center;gap:6px;height:38px;padding:0 16px;border-radius:999px;',
    'background:#00D4C8;color:#04201e;font-size:14.5px;font-weight:700;text-decoration:none;white-space:nowrap;}',
    '.ss-bar-cta:hover{background:#25e6da;}',
    '.ss-bar-cta .lbl{display:inline;}',
    // Signed-out: a plain "Sign in" link where the avatar menu would be.
    '.ss-bar-signin{display:inline-flex;align-items:center;height:38px;padding:0 8px;color:#E8E8EC;',
    'font-size:14.5px;font-weight:600;text-decoration:none;white-space:nowrap;}',
    '.ss-bar-signin:hover{color:#fff;}',
    // Tighten before truncating: at mid widths the strip fits if the tabs
    // give up some padding, so scrolling stays a last resort.
    '@media (max-width:1100px){.ss-bar-in{gap:12px;}',
    '.ss-bar-tabs a,.ss-bar-tabs button{padding:0 10px;font-size:14px;}',
    '.ss-bar-tabs a::after,.ss-bar-tabs button::after{left:10px;right:10px;}}',
    '@media (max-width:860px){.ss-bar-in{gap:10px;height:56px;}',
    '.ss-bar-tabs,.ss-bar-tabs a,.ss-bar-tabs button{height:56px;}',
    '.ss-bar-cta{padding:0 13px;}.ss-bar-cta .lbl{display:none;}',
    '.ss-bar-logo svg{height:24px;}}',
  ].join('');

  function ensureStyle() {
    if (document.getElementById('ssBarStyle')) return;
    var s = document.createElement('style');
    s.id = 'ssBarStyle';
    s.textContent = STYLE;
    document.head.appendChild(s);
  }

  function tab(item, active) {
    var node;
    if (item.onClick) {
      node = document.createElement('button');
      node.type = 'button';
      node.addEventListener('click', item.onClick);
    } else {
      node = document.createElement('a');
      node.href = item.href;
    }
    if (item.id) node.id = item.id;
    node.appendChild(document.createTextNode(item.label));
    if (item.badge) {
      var b = document.createElement('span');
      b.className = 'ss-bar-badge';
      b.textContent = String(item.badge);
      node.appendChild(b);
    }
    if (item.key && item.key === active) node.classList.add('on');
    return node;
  }

  /**
   * mount(opts)
   *   opts.active  — key of the current section ('trips'|'driving'|'messages'|…)
   *   opts.extra   — [{label, onClick|href, key?, id?, badge?}] appended after
   *                  the standard tabs (driving.html's Wallet / Car & license)
   *   opts.mountTo — element to replace; defaults to #ssAppBar, else prepends
   *                  to document.body
   *   opts.id      — id to give the bar (pages with their own show() logic
   *                  pass 'consoleNav' so their toggling keeps working)
   *   opts.startHidden — render hidden; the page's show() reveals it
   * Returns the bar element, or null when signed out.
   */
  function mount(opts) {
    opts = opts || {};
    // Remember the page's options even when signed out, so ensure() after an
    // in-page sign-in mounts the SAME bar (tabs, id, extras) — it used to
    // mount an empty one (audit 2026-09-04).
    lastOpts = opts;
    // Signed-out visitors get a bar too (Justin, 2026-09-06: "every screen
    // should have a nav") — public sections instead of the console tabs, and
    // a Sign-in link where the avatar menu sits. ensure() swaps it for the
    // signed-in bar the moment a session exists.
    var authed = signedIn();
    ensureStyle();

    var bar = document.createElement('div');
    bar.className = 'ss-bar';
    bar.setAttribute('data-authed', authed ? '1' : '0');
    // trips.html / driving.html already toggle a #consoleNav element per
    // state (the bar must not show over the sign-in or loading screens).
    // Adopting that id keeps their show() working untouched.
    if (opts.id) bar.id = opts.id;
    if (opts.startHidden) bar.classList.add('hidden');
    var inner = document.createElement('div');
    inner.className = 'ss-bar-in';

    var logo = document.createElement('a');
    logo.className = 'ss-bar-logo';
    logo.href = '/';
    logo.setAttribute('aria-label', 'Seat Sherpa — home');
    logo.innerHTML = WORDMARK;
    inner.appendChild(logo);

    var tabs = document.createElement('div');
    tabs.className = 'ss-bar-tabs';
    var items = (authed ? [
      { key: 'trips', label: 'Trips', href: '/trips' },
      { key: 'driving', label: 'Driving', href: '/driving' },
      { key: 'messages', label: 'Messages', href: '/messages', badge: opts.unread },
      { key: 'rides', label: 'Find a ride', href: '/rides?web=1' },
    ] : [
      { key: 'rides', label: 'Find a ride', href: '/rides?web=1' },
      { key: 'requests', label: 'Ride requests', href: '/requests' },
      { key: 'faq', label: 'How it works', href: '/faq' },
    ]).concat(authed ? (opts.extra || []) : []);
    items.forEach(function (it) { tabs.appendChild(tab(it, opts.active)); });
    inner.appendChild(tabs);

    var right = document.createElement('div');
    right.className = 'ss-bar-right';
    var cta = document.createElement('a');
    cta.className = 'ss-bar-cta';
    cta.href = '/post?new=1'; // always a brand-new ride (Justin, 2026-09-04)
    cta.innerHTML = '<span aria-hidden="true">+</span><span class="lbl">Post a ride</span>';
    cta.setAttribute('aria-label', 'Post a ride');
    right.appendChild(cta);
    var menuSlot = document.createElement('span');
    if (authed) {
      right.appendChild(menuSlot);
    } else {
      var si = document.createElement('a');
      si.className = 'ss-bar-signin';
      si.href = '/signin?next=' + encodeURIComponent(location.pathname + location.search);
      si.textContent = 'Sign in';
      right.appendChild(si);
    }
    inner.appendChild(right);

    bar.appendChild(inner);

    // Full-bleed regardless of the host page's own body padding — the four
    // console pages each chose a different one (26/16, 32/20, …). Measure it
    // and cancel it rather than hard-coding a value that only fits one page.
    var bp = window.getComputedStyle(document.body);
    var bodyIsColumn = bp.maxWidth && bp.maxWidth !== 'none';
    // Centred-column bodies (privacy, terms, delete-account: body itself has
    // a max-width) — span the viewport by measuring, not with 100vw, which
    // includes the scrollbar and overshoots by its width on both sides.
    function placeColumn() {
      var br = document.body.getBoundingClientRect();
      var contentLeft = br.left + parseFloat(bp.paddingLeft || '0');
      // border-box: the width below must INCLUDE the side padding copied
      // from the body, or the bar runs past the viewport by that much.
      bar.style.boxSizing = 'border-box';
      bar.style.width = document.documentElement.clientWidth + 'px';
      bar.style.marginLeft = (-contentLeft) + 'px';
      bar.style.marginRight = '0';
    }
    if (bodyIsColumn) {
      placeColumn();
      window.addEventListener('resize', placeColumn);
    } else {
      bar.style.marginLeft = '-' + bp.paddingLeft;
      bar.style.marginRight = '-' + bp.paddingRight;
    }
    // Cancel the body's top padding AND top margin (privacy/terms use
    // `margin:40px auto`): a first child's negative margin collapses with the
    // parent's, so the bar reaches the top of the page instead of leaving a
    // strip of page background above it.
    bar.style.marginTop = '-' + (parseFloat(bp.paddingTop || '0') + parseFloat(bp.marginTop || '0')) + 'px';
    bar.style.paddingLeft = bp.paddingLeft;
    bar.style.paddingRight = bp.paddingRight;

    var target = opts.mountTo || document.getElementById('ssAppBar');
    if (target && target.parentNode) target.parentNode.replaceChild(bar, target);
    else document.body.insertBefore(bar, document.body.firstChild);

    if (authed && window.SS_MENU && window.SS_MENU.mount) {
      try { window.SS_MENU.mount(menuSlot); } catch (_) {}
    }

    // Keep the bar's inner column the same width as the page's content column
    // (.wrap), so the wordmark and the page's first heading share a left edge.
    // Both are media-query driven, so re-sync on resize rather than once.
    var col = opts.alignTo || document.querySelector('.wrap') || (bodyIsColumn ? document.body : null);
    function syncWidth() {
      if (!col) return;
      var mw = window.getComputedStyle(col).maxWidth;
      inner.style.maxWidth = (mw && mw !== 'none') ? mw : '1180px';
      syncFade();
    }
    // Fade whichever edge has content hidden behind it, so a clipped tab
    // reads as "scroll for more" rather than as a rendering bug.
    function syncFade() {
      var over = tabs.scrollWidth > tabs.clientWidth + 2;
      tabs.classList.toggle('over-l', over && tabs.scrollLeft > 2);
      tabs.classList.toggle('over-r', over && tabs.scrollLeft + tabs.clientWidth < tabs.scrollWidth - 2);
    }
    syncWidth();
    window.addEventListener('resize', syncWidth);
    tabs.addEventListener('scroll', syncFade, { passive: true });
    // ensure() calls this before discarding a bar so its window listeners go
    // with it (each swap used to leave two resize handlers on a detached node).
    bar._ssCleanup = function () {
      window.removeEventListener('resize', syncWidth);
      window.removeEventListener('resize', placeColumn);
    };

    // On a phone the strip starts scrolled to "Trips", so the tab you are
    // actually on can sit off-screen and the bar stops answering "where am
    // I". Nudge the active tab into view. Setting scrollLeft directly rather
    // than scrollIntoView(), which would also scroll the page body.
    var on = tabs.querySelector('.on');
    if (on && tabs.scrollWidth > tabs.clientWidth) {
      // Delta between the two rects, NOT offsetLeft: the strip isn't a
      // positioned element, so each tab's offsetParent is the sticky .ss-bar
      // and offsetLeft carries the wordmark's width with it — that overshot
      // and scrolled the active tab straight back off the left edge.
      var d = on.getBoundingClientRect().left - tabs.getBoundingClientRect().left;
      tabs.scrollLeft = Math.max(0, tabs.scrollLeft + d - 12);
      syncFade();
    }
    return bar;
  }

  // ensure(opts) — mount only if a bar isn't already in the DOM.
  //
  // trips.html and driving.html sign in WITHOUT reloading (verify OTP, then
  // render()). At first parse the visitor is signed out, so mount() no-ops
  // and there is no bar; calling ensure() from their show() puts one up the
  // moment a session exists, and is a cheap no-op on every later call.
  var lastOpts = null;
  function ensure(opts) {
    if (opts) lastOpts = opts;
    var existing = document.querySelector('.ss-bar');
    if (existing) {
      // Bar already matches the session state → nothing to do. A signed-out
      // bar left over from first parse is swapped for the signed-in one
      // (same options), keeping any hidden/shown state the page set on it.
      if ((existing.getAttribute('data-authed') === '1') === signedIn()) return null;
      var wasHidden = existing.classList.contains('hidden');
      var fresh = mount(lastOpts || {});
      if (fresh) { fresh.classList.toggle('hidden', wasHidden); }
      try { if (existing._ssCleanup) existing._ssCleanup(); } catch (_) {}
      if (existing.parentNode) existing.parentNode.removeChild(existing);
      return fresh;
    }
    return mount(lastOpts || {});
  }

  window.SS_APPBAR = { mount: mount, ensure: ensure, signedIn: signedIn };
})();
