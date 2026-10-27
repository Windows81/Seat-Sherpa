// js/ss-captcha.js
//
// Cloudflare Turnstile for Supabase Auth (2026-10-14, after scripted sign-up
// floods: 500+ fake accounts in minutes, all straight to the Auth API with the
// public key, never touching the app or this site). Once CAPTCHA is switched on
// in Supabase (Authentication > Attack Protection > Turnstile), email-code
// sign-in, sign-up, password sign-in and password resets are refused without a
// token. Google/Apple sign-in are exempt (id_token grants skip the check).
//
// Every page sends its auth request with NO token first and imports this file
// (solveAndRetry) only when Auth answers with a captcha error, so nothing
// changes for anyone until the switch is flipped, and nothing breaks if it is
// flipped off again.
//
// The widget is "interaction-only": invisible unless Cloudflare wants a click,
// in which case it appears in a small centred card. The app gets its token from
// the same widget through /captcha (captcha.html), which hands it back over the
// seatsherpa:// link.
//
// This is the one auth helper that touches the DOM, which is why it is not in
// ss-session.js (that module is DOM-free by contract and only imports this
// file when Auth asks for a captcha).

// Turnstile SITE key (public by design; the SECRET key lives only in Supabase).
export const TURNSTILE_SITE_KEY = '0x4AAAAAAFW1a8VTYHPkyG2S'; // widget "Seat Sherpa sign-in" (Justin's Cloudflare, 10/14)

let loading = null;

function loadTurnstile() {
  if (window.turnstile) return Promise.resolve();
  if (loading) return loading;
  loading = new Promise((resolve, reject) => {
    const s = document.createElement('script');
    s.src = 'https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit';
    s.async = true;
    s.onload = () => resolve();
    s.onerror = () => {
      loading = null;
      reject(new Error('captcha script failed to load'));
    };
    document.head.appendChild(s);
    // A request that never fires onload or onerror must not hang every later
    // attempt on the page: give up after 15 s, drop the tag and the cached
    // promise so the next attempt re-injects it (bug check 10/14 + 10/15).
    setTimeout(() => {
      if (window.turnstile) return;
      loading = null;
      try { s.remove(); } catch (_) { /* already gone */ }
      reject(new Error('captcha script timed out'));
    }, 15000);
  });
  return loading;
}

/** Resolves with a fresh single-use token (tokens expire after 5 minutes, so
 *  fetch one right before the auth call). `container` renders the widget in
 *  place (used by /captcha); without it a floating card is used. */
export async function getCaptchaToken({ container } = {}) {
  // loadTurnstile gives up after 15 s on its own (see above), so a hung
  // script request never holds the sign-in button for good.
  await loadTurnstile();
  return new Promise((resolve, reject) => {
    let box = container;
    let overlay = null;
    if (!box) {
      // Dimmed overlay + small card (Justin, 2026-10-14: the bare widget sat on
      // top of the email field and looked accidental). It stays INVISIBLE
      // unless Cloudflare asks for a click (before-interactive-callback), so
      // people who pass silently never see anything at all.
      overlay = document.createElement('div');
      overlay.style.cssText =
        'position:fixed;inset:0;z-index:99999;display:flex;align-items:center;justify-content:center;' +
        'padding:16px;background:rgba(12,22,21,.45);visibility:hidden;';
      const card = document.createElement('div');
      card.setAttribute('role', 'dialog');
      card.setAttribute('aria-modal', 'true');
      card.setAttribute('aria-label', 'Quick security check');
      card.style.cssText =
        'background:#fff;color:#14201f;border-radius:14px;padding:18px 18px 14px;max-width:340px;width:100%;' +
        'box-shadow:0 10px 40px rgba(0,0,0,.25);text-align:center;font:inherit;';
      const title = document.createElement('div');
      title.textContent = 'One quick check before we send your code';
      title.style.cssText = 'font-weight:600;font-size:16px;line-height:1.35;margin:0 0 12px;';
      box = document.createElement('div');
      box.style.cssText = 'display:flex;justify-content:center;min-height:65px;';
      // A way out: without it the card held the page for up to two minutes.
      const cancel = document.createElement('button');
      cancel.type = 'button';
      cancel.textContent = 'Cancel';
      cancel.style.cssText =
        'margin-top:10px;background:none;border:0;color:#5b6b69;font:inherit;font-size:14px;' +
        'text-decoration:underline;cursor:pointer;padding:6px 10px;';
      cancel.addEventListener('click', () => finish(reject, new Error('captcha cancelled')));
      card.appendChild(title);
      card.appendChild(box);
      card.appendChild(cancel);
      overlay.appendChild(card);
      document.body.appendChild(overlay);
    }
    let id = null;
    let done = false;
    const finish = (fn, v) => {
      if (done) return;
      done = true;
      try { if (id !== null) window.turnstile.remove(id); } catch (_) { /* already gone */ }
      if (overlay) overlay.remove();
      fn(v);
    };
    id = window.turnstile.render(box, {
      sitekey: TURNSTILE_SITE_KEY,
      appearance: container ? 'always' : 'interaction-only',
      'before-interactive-callback': () => { if (overlay) overlay.style.visibility = 'visible'; },
      callback: (token) => finish(resolve, token),
      'error-callback': () => finish(reject, new Error('captcha failed')),
      'expired-callback': () => finish(reject, new Error('captcha expired')),
      'timeout-callback': () => finish(reject, new Error('captcha timed out')),
    });
    setTimeout(() => finish(reject, new Error('captcha timed out')), 120000);
  });
}

export function isCaptchaError(err) {
  return !!err && (err.code === 'captcha_failed' || /captcha/i.test(err.message || ''));
}

/** After Auth refused a request for lack of a captcha: solve one and run the
 *  request again with it. run(captchaToken) must return supabase-js's
 *  { error } shape. Pages import this lazily, only on that refusal, so a
 *  normal sign-in never depends on this file loading. */
export async function solveAndRetry(run) {
  let token = null;
  try {
    token = await getCaptchaToken();
  } catch (_) {
    token = null;
  }
  if (!token) {
    return { error: { code: 'captcha_failed', message: "We couldn't finish the quick security check. Please try again." } };
  }
  return run(token);
}
