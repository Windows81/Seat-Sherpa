// js/ss-session.js
//
// SHARED RIDER WEB SESSION (2026-08-20) — the auth plumbing behind the hidden
// rider surface (/trips). Pages import this; it is the only place a Supabase
// client is constructed for that surface.
//
// WHY A SHARED MODULE INSTEAD OF INLINE SCRIPT:
//   1. Two client instances in the same tab race each other's token refresh —
//      one rotates the refresh token, the other retries with the spent copy and
//      the rider gets silently signed out mid-poll. One client per tab, always.
//   2. The repo has no build step, so anything inlined per-page drifts. The
//      auth gate, the OTP error copy and the edge-function header shape are
//      exactly the things that must not drift.
//
// WHY THIS MATTERS MORE THAN A NORMAL LOGIN: a web rider's session is the ONLY
// route to get_my_pickup_code (0043). The driver types that code into their
// app, and that stamp — bookings.pickup_code_entered_at — is the single gate
// stripe-release-to-driver checks before the driver is reimbursed. A session
// that quietly dies between "you're booked" on Tuesday and the curb on Friday
// means the driver never gets reimbursed for the trip they actually drove.
// Everything below optimises for "still signed in three days later", not for
// login ergonomics.
//
// THIS MODULE IS STRICTLY DOM-FREE. That is the ownership boundary: this file
// exports plumbing, the pages own every pixel. Nothing here touches document,
// renders markup, or decides what a rider sees.

import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';

export const SUPA = 'https://vmfmbntacifqoqxqxgsk.supabase.co';
// Publishable (anon) key — safe to expose in client-side code by design.
export const ANON = 'sb_publishable_TGebz9q_z0kkH0Tuivlr4w_3MPLMxF3';

// Matches book.html's resend timer so the two surfaces never disagree about
// how long a rider is asked to wait.
export const OTP_RESEND_COOLDOWN_SEC = 60;
export const OTP_CODE_LENGTH = 6;

// ── Storage contract — DO NOT BREAK ─────────────────────────────────────────
// NEVER pass `storageKey`. This module and book.html both build their client
// from the same project URL, so both inherit the library default
// `sb-vmfmbntacifqoqxqxgsk-auth-token` in localStorage. That shared key IS the
// handoff: the rider signs in once inside the book.html funnel, and /trips
// finds that session already sitting there. Adding a storageKey to either file
// — even a "namespaced" one that looks tidier — silently orphans the other and
// the rider is asked to sign in again at the curb.
//
// NEVER copy reset-password.html's `persistSession: false`. That page is
// deliberately ephemeral (a password reset on a possibly-shared computer);
// this one has to survive the tab closing and the phone sleeping for days.
//
// NEVER set `detectSessionInUrl: true`. We only ever use typed 6-digit codes,
// so no token reaches a URL at all — and a URL-parsing auth flow is a GET that
// mutates, which mail scanners burn on the rider's behalf (the
// email-unsubscribe lesson).
//
// autoRefreshToken is spelled out rather than left implicit: the access token
// lives ~1h, and a tab left open on the pickup-code screen while the rider
// waits at the curb must refresh itself instead of 401-ing on the RPC.
export const supabase = createClient(SUPA, ANON, {
  auth: {
    persistSession: true,
    autoRefreshToken: true,
    detectSessionInUrl: false,
  },
});

// ── Session reads ───────────────────────────────────────────────────────────

// 0220: stamp profiles.web_seen_at once per tab. Mirrors the app's
// stampAppOpened (contexts/session.tsx) so admin can tell a web-only account
// from an app user on POSITIVE evidence rather than on a missing push token.
// Fire-and-forget: never awaited, never surfaced, and tolerant of a
// not-yet-run 0220 (the unknown-column error is simply ignored).
//
// Declared ABOVE its callers on purpose — `webSeenStamped` is a `let`, and a
// reference from a function that ran before this line evaluated would hit the
// temporal dead zone.
let webSeenStamped = false;
function stampWebSeen(userId) {
  if (webSeenStamped || !userId) return;
  webSeenStamped = true;
  try {
    supabase.from('profiles')
      .update({ web_seen_at: new Date().toISOString() })
      .eq('id', userId)
      .then(() => {}, () => {});
    // Web ToS evidence (2026-09-01): the signup surfaces show a
    // sign-in-wrap notice ("By continuing you agree..."); log the
    // acceptance once per browser. Versions mirror lib/legal-versions.ts.
    try {
      // Only pages that actually SHOW the notice may log an acceptance —
      // /trips, /account, /driving load this module too and used to write
      // acceptance rows on passive page views (audit 2026-09-02). Flag is per
      // user, not per browser, so a second person on the same device is logged.
      var tosKey = 'ss-tos-web-v1:' + userId;
      if (document.querySelector('[data-tos-notice]') && !localStorage.getItem(tosKey)) {
        supabase.from('terms_acceptances')
          .insert({ user_id: userId, terms_version: '2026-05-26', privacy_version: '2026-07-08', platform: 'web' })
          .then((r) => { if (!r || !r.error) { try { localStorage.setItem(tosKey, '1'); } catch (_) {} } }, () => {});
      }
    } catch (_) { /* best-effort */ }
  } catch (_) { /* best-effort */ }
}

// Web welcome email (Justin, 2026-08-29: "for web sign ups, lets send the
// welcome email after email, dont wait for phone").
//
// The app deliberately waits for phone verification — that's its last signup
// step. The web has no phone step at signup (the gate only appears at book/
// post), so waiting for one meant web signups got NOTHING, ever. The missing
// phone is chased separately two days later.
//
// Safe to call on every sign-in: send-welcome-email claims the send with an
// atomic NULL→now() flip on profiles.welcome_email_sent_at, so only the first
// call ever mails. The 24h age check is belt-and-braces so a long-standing
// APP user signing in on the web doesn't suddenly get a web-flavoured welcome.
const WELCOME_MAX_AGE_MS = 24 * 60 * 60 * 1000;
let welcomeTried = false;
export async function sendWebWelcomeIfNew() {
  if (welcomeTried) return;
  welcomeTried = true;
  void syncWebAttribution();
  try {
    const { data } = await supabase.auth.getUser();
    const user = data?.user;
    if (!user?.created_at) return;
    if (Date.now() - new Date(user.created_at).getTime() > WELCOME_MAX_AGE_MS) return;
    const { data: sess } = await supabase.auth.getSession();
    const token = sess?.session?.access_token;
    if (!token) return;
    await fetch(`${SUPA}/functions/v1/send-welcome-email`, {
      method: 'POST',
      // apikey is REQUIRED by the functions gateway — without it the call 401s
      // before reaching the function (ate Robert's + Lisa's welcomes, 8/30).
      headers: { 'Content-Type': 'application/json', apikey: ANON, Authorization: `Bearer ${token}` },
      body: JSON.stringify({ web: true }),
    });
  } catch (_) { /* never block sign-in on a welcome email */ }
}

// SELF-HEALING RETRY (2026-08-31, the Chris O'Connor miss): the signup-moment
// send is a single shot from a popup that the user can close mid-flight, so a
// lost request used to mean no welcome ever. Every page that loads this module
// now retries once, a few seconds after boot, for accounts under 24h old.
// Cheap: the age check reads the LOCAL session (no network), and the server's
// atomic claim on welcome_email_sent_at guarantees at most one email ever.
if (typeof window !== 'undefined') {
  setTimeout(() => {
    supabase.auth
      .getSession()
      .then(({ data }) => {
        const u = data?.session?.user;
        if (!u?.created_at) return;
        if (Date.now() - new Date(u.created_at).getTime() > WELCOME_MAX_AGE_MS) return;
        return sendWebWelcomeIfNew();
      })
      .catch(() => {});
  }, 4000);
}

// LINK ATTRIBUTION (2026-09-03, migration 0238). A code parked by the /r/<CODE>
// invite page (ss_attr_code) or a ?c= campaign parked by any landing page
// (ss_campaign) gets stamped on a NEW account's profile — and the code is
// auto-applied server-side exactly as if typed. Same 24h age guard as the
// welcome email; both keys are cleared once the server has answered.
export async function syncWebAttribution() {
  let code = null, camp = null;
  try { code = localStorage.getItem('ss_attr_code'); camp = localStorage.getItem('ss_campaign'); } catch (_) {}
  if (!code && !camp) return;
  try {
    const { data } = await supabase.auth.getSession();
    const u = data?.session?.user;
    if (!u?.created_at) return;
    if (Date.now() - new Date(u.created_at).getTime() > WELCOME_MAX_AGE_MS) return;
    const { error } = await supabase.rpc('set_signup_attribution', { p_code: code, p_campaign: camp, p_source: 'web' });
    if (!error) { try { localStorage.removeItem('ss_attr_code'); localStorage.removeItem('ss_campaign'); } catch (_) {} }
  } catch (_) { /* never block sign-in on attribution */ }
}

// TYPED CODE ON THE WEB (2026-09-03). The app has had a code field since
// launch; the web had none, so a rider who heard "TAYLOR5" and signed up in a
// browser had nowhere to put it. Same order as the app's applyEntryCode:
// referral namespace first, then promo. For an account under 30 days old the
// 0238 RPC does stamp + apply in one call (so the ambassador gets credit even
// when the person typed rather than clicked); older accounts skip the stamp
// and just redeem, exactly like the app.
const CODE_MSG = {
  ok: 'Code applied — your ride credit is added and applies automatically at checkout.',
  ok_pending: 'Code applied — the credit unlocks after a couple of completed trips.',
  invalid_code: "That code doesn't exist — check the spelling.",
  inactive: 'That code is no longer active.',
  expired: 'That code has expired.',
  exhausted: 'That code has been fully used.',
  already_used: "You've already used a code on this account.",
  self: "That's your own code — share it with a friend instead.",
  empty: 'Enter a code.',
  not_signed_in: 'Sign in first, then apply your code.',
  error: 'Could not apply that code right now — try again in a moment.',
};
export async function applyWebCode(raw) {
  const code = String(raw || '').toUpperCase().replace(/[^A-Z0-9]/g, '');
  if (!code) return { ok: false, code: 'empty', message: CODE_MSG.empty };
  let result = 'error';
  try {
    const { data: sess } = await supabase.auth.getSession();
    if (!sess?.session) return { ok: false, code: 'not_signed_in', message: CODE_MSG.not_signed_in };
    const { data: st, error: stErr } = await supabase.rpc('set_signup_attribution', { p_code: code, p_campaign: null, p_source: 'web_typed' });
    if (!stErr && typeof st === 'string' && st.startsWith('stamped:')) {
      result = st.slice('stamped:'.length);
    } else {
      const ref = await supabase.rpc('apply_referral_code', { p_code: code });
      result = ref.error ? 'error' : ref.data;
      if (result === 'invalid_code') {
        const promo = await supabase.rpc('redeem_promo_code', { p_code: code });
        result = promo.error ? 'error' : promo.data;
      }
    }
  } catch (_) { result = 'error'; }
  const ok = result === 'ok' || result === 'ok_pending';
  return { ok, code: result, message: CODE_MSG[result] || CODE_MSG.error };
}

/** Bind an input + button (+ optional message node) to applyWebCode. Pages
 *  own the markup; this owns the behaviour so the three entry points agree. */
export function wireCodeEntry({ input, button, msg, onApplied }) {
  const $i = document.getElementById(input), $b = document.getElementById(button), $m = msg ? document.getElementById(msg) : null;
  if (!$i || !$b) return;
  const run = async () => {
    if ($m) { $m.className = 'msg hidden'; }
    const label = $b.textContent;
    $b.disabled = true; $b.textContent = 'Applying…';
    const r = await applyWebCode($i.value);
    $b.disabled = false; $b.textContent = label;
    if ($m) { $m.textContent = r.message; $m.className = 'msg ' + (r.ok ? 'ok' : 'err'); $m.style.color = r.ok ? '#4ade80' : '#ff8a8a'; }
    if (r.ok) { $i.value = ''; try { if (onApplied) await onApplied(r); } catch (_) {} }
  };
  $b.addEventListener('click', run);
  $i.addEventListener('keydown', (e) => { if (e.key === 'Enter') { e.preventDefault(); run(); } });
}

// Cheap read. supabase-js awaits its own recover-and-refresh before answering,
// so an access token that expired while the tab was closed is renewed here
// transparently — but this does NOT prove the session is still valid server
// side (a revoked refresh token, a deleted account, or a password reset
// elsewhere all still look fine from localStorage). Use it for "do we have
// something to try with"; use getUserFresh() to gate the UI.
export async function getSession() {
  const { data, error } = await supabase.auth.getSession();
  if (error) return null;
  // Stamp here too: account.html gates on getSession(), so a visitor who only
  // ever opens their account page would otherwise never be counted as web.
  if (data?.session?.user?.id) stampWebSeen(data.session.user.id);
  return data?.session || null;
}

// Authoritative: a real /auth/v1/user round-trip. Returns the user, or null if
// the rider genuinely needs to sign in again.
export async function getUserFresh() {
  const { data, error } = await supabase.auth.getUser();
  if (!error && data?.user) { stampWebSeen(data.user.id); return data.user; }

  // CRITICAL: do not confuse "offline" with "signed out". This page's whole job
  // happens at a curb on a phone with one bar — if a flaky fetch cleared the
  // stored session, the rider would lose the pickup code exactly when they need
  // it and the driver would go unreimbursed. Only a real auth rejection (401/
  // 403 from the auth server) clears anything; network errors, timeouts and 5xx
  // leave the session alone so a retry can succeed.
  if (error && !isRetryableAuthError(error)) await clearLocalSession();
  return null;
}

function isRetryableAuthError(error) {
  const status = error?.status;
  if (error?.name === 'AuthRetryableFetchError') return true;
  // status 0 / undefined = the request never reached the auth server.
  if (status === 0 || status === undefined || status === null) return true;
  return status >= 500;
}

// ── Email OTP ───────────────────────────────────────────────────────────────
// Every function below returns `null` on success or a ready-to-display string
// on failure — the same convention book.html uses, so error copy stays in one
// shape across both surfaces. Nothing here logs: an auth error object can carry
// request context, and console output on a shared/borrowed phone is readable.

export async function sendEmailOtp(email) {
  // shouldCreateUser:false is the ONE deliberate divergence from book.html.
  // book.html exists to onboard a stranger, so it mints accounts. On /trips
  // there is nothing to create — minting an account for a typo'd address would
  // hand the rider a permanently empty trip list and no way to tell that the
  // address was the problem.
  const { error } = await supabase.auth.signInWithOtp({
    email,
    options: { shouldCreateUser: false },
  });
  if (!error) return null;

  const msg = (error.message || '').toLowerCase();
  const code = error.code || '';
  if (code === 'otp_disabled' || msg.includes('signups not allowed') || msg.includes('user not found')) {
    return "We couldn't find an account for that email. Double-check the spelling — if you booked with a different address, try that one instead.";
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many codes requested. Try again in an hour.';
  }
  if (msg.includes('invalid') && msg.includes('email')) {
    return "That doesn't look like a valid email address.";
  }
  return error.message || "Couldn't send the code. Try again.";
}

export async function verifyEmailOtp(email, code) {
  const token = String(code || '').replace(/\D/g, '');
  // 6–8 digits: the actual length is a Supabase Auth dashboard setting, and it
  // was silently bumped to 8 while the pages demanded exactly 6 — bricking
  // every web sign-in (2026-08-27). Supabase rejects a wrong code anyway;
  // never be stricter here than the email.
  if (token.length < OTP_CODE_LENGTH) return 'Enter the code from the email.';

  const { error } = await supabase.auth.verifyOtp({ email, token, type: 'email' });
  if (!error) return null;

  const msg = (error.message || '').toLowerCase();
  if (msg.includes('expired') || msg.includes('invalid')) {
    return 'That code is incorrect or has expired. Tap Resend for a new one.';
  }
  if (msg.includes('rate limit') || msg.includes('too many')) {
    return 'Too many attempts. Try again in an hour.';
  }
  return error.message || "Couldn't verify that code. Try again.";
}

// ── Sign out ────────────────────────────────────────────────────────────────

// scope:'local' — NOT the library default of 'global'. A global sign-out
// revokes EVERY refresh token the user holds, which would also log them out of
// the Seat Sherpa app on their phone. A rider tidying up a browser tab must
// never knock out the app they actually take the trip with. Local scope clears
// this browser's stored session and nothing else.
export async function signOut() {
  try {
    await supabase.auth.signOut({ scope: 'local' });
  } catch (_) {
    // Already gone / storage unavailable — the caller only cares that this
    // browser no longer believes it is signed in.
  }
}

// Internal alias so the intent reads differently at the call sites where we are
// discarding a session the server has already rejected, rather than honouring a
// rider's request to sign out.
const clearLocalSession = signOut;

// ── Edge function calls ─────────────────────────────────────────────────────

// Two header shapes, and mixing them is the classic 401:
//   auth:'anon' → anon-key functions (public-ride, public-rides)
//   auth:'user' → verify_jwt=true functions (web-create-booking,
//                 web-cancel-booking) — these need `apikey` AND the rider's
//                 access token as the Bearer.
//
// The access token rides in a header and ONLY in a header. It never goes in the
// path or a query string, because a URL lands in browser history, in the
// Referer header of any outbound link, and in Vercel's request logs.
export async function callFn(name, opts = {}) {
  const { body = null, auth = 'user', method = 'POST', signal } = opts;

  const headers = { apikey: ANON };
  if (auth === 'user') {
    const session = await getSession();
    const token = session?.access_token;
    if (!token) throw fnError(401, 'NO_SESSION', 'Please sign in again.', null, true);
    headers.Authorization = 'Bearer ' + token;
  } else {
    headers.Authorization = 'Bearer ' + ANON;
  }
  if (body != null) headers['Content-Type'] = 'application/json';

  let res;
  try {
    res = await fetch(SUPA + '/functions/v1/' + name, {
      method,
      headers,
      body: body == null ? undefined : JSON.stringify(body),
      signal,
    });
  } catch (e) {
    // Offline / aborted. Distinct from an auth failure — never clears anything.
    if (e && e.name === 'AbortError') throw e;
    throw fnError(0, 'NETWORK', "We couldn't reach Seat Sherpa. Check your connection and try again.");
  }

  // Read as text first: an edge function that dies before its json() helper
  // returns HTML or an empty body, and JSON.parse would throw over the top of
  // the real status code.
  const text = await res.text().catch(() => '');
  let parsed = null;
  try { parsed = text ? JSON.parse(text) : null; } catch (_) { parsed = null; }

  if (res.ok) return parsed;

  // 401 from a verify_jwt function means the GATEWAY rejected the token, not
  // that the function disagreed with the rider — so the stored session really
  // is dead and the page should fall back to its signed-out state. Anything
  // else (403 wrong rider, 409 already-cancelled) leaves the session intact.
  const expired = res.status === 401;
  if (expired) await clearLocalSession();

  throw fnError(
    res.status,
    (parsed && parsed.error) || null,
    (parsed && (parsed.message || parsed.error)) || 'Something went wrong. Try again.',
    parsed,
    expired,
  );
}

function fnError(status, error, message, body, sessionExpired) {
  const e = new Error(message);
  e.status = status;
  e.error = error;              // machine code, e.g. 'GATE_PHONE', 'PIN_ENTERED'
  e.body = body || null;        // raw payload, for codes that carry extra fields
  e.sessionExpired = !!sessionExpired;
  return e;
}
