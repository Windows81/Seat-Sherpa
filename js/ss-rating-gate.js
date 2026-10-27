// ss-rating-gate.js — RATING-FIRST GATE for the signed-in web pages.
//
// WHY (Justin, 2026-09-07): "for those who have completed rides but have not
// rated their driver or passenger yet, I want the first popup when they open
// up the app again to be the rating screen (default to 5 stars), and optional
// comment, before moving on to the rest of the app. How do we make this work
// for web-only?" The app got components/rating-gate.tsx; this is the web
// twin. Web-only riders and drivers (never installed the app) hit it on the
// first signed-in page they open — the homepage (since 2026-10-07), /trips,
// /driving, /account, /messages, /rides, /ride, /book, /post, /requests,
// /verify, /rating-match — and see the same modal the app
// shows, before the page underneath is usable.
//
// Same rules as the app's services/ratings.ts getPendingRatings():
//   * Completed bookings the viewer is a party to (rider OR driver);
//   * not yet rated by the viewer;
//   * booking created within the 7-day window + 90-day grace (97 days);
//   * scheduled departure at least 3 h ago, so nobody is nagged mid-ride.
// Writes straight to public.ratings under the viewer's own session, exactly
// like trips.html's ratingCard — RLS (ratings_insert_party) + the 0093
// pickup trigger are the gate, no privileged endpoint.
//
// "Not now" hides a trip for THIS browser session (sessionStorage) so the gate
// never re-opens over someone mid-task; the next visit asks again, which is
// the "when they open the app again" contract.

// ss-session.js (and supabase-js behind it) is imported LAZILY, only when a
// session token is already in storage: anonymous visitors on /rides and /ride
// must not download a second auth client just to be told there is nothing to
// rate (review 2026-09-08). `supabase` / `getSession` are filled in by run().
let supabase = null;
let getSession = null;
const TOKEN_KEY = 'sb-vmfmbntacifqoqxqxgsk-auth-token';

const DISMISS_KEY = 'ss_rating_gate_dismissed';
const WINDOW_MS = (7 + 90) * 24 * 60 * 60 * 1000;
const TRIP_ENDED_BUFFER_MS = 3 * 60 * 60 * 1000;

const SELECT = [
  'id, ride_id, passenger_id, passenger_name, status, ref_code, created_at',
  'passenger:profiles!bookings_passenger_profile_fkey(name:name_public, photo_url)',
  'ride:rides!inner(id, driver_id, driver_name, from_dest, to_dest, departure_area, arrival_area, dep_date, dep_time, dep_timezone,'
    + ' driver:profiles!rides_driver_profile_fkey(name:name_public, photo_url))',
].join(', ');

function dismissed() {
  try { return new Set(JSON.parse(sessionStorage.getItem(DISMISS_KEY) || '[]')); } catch (_) { return new Set(); }
}
function dismiss(id) {
  try {
    const s = dismissed(); s.add(id);
    sessionStorage.setItem(DISMISS_KEY, JSON.stringify(Array.from(s)));
  } catch (_) { /* private mode: the gate simply asks again on the next page */ }
}

// Port of lib/format-address.ts cityFromAddress — the city the ride card shows.
function cityOf(address, fallback) {
  if (!address) return fallback || '';
  const STATE = /^(california|ca|nevada|nv|arizona|az|oregon|or|usa|united states|us)( +\d{5}(-\d{4})?)?$/i;
  const parts = String(address).split(',').map((s) => s.trim()).filter(Boolean)
    .filter((p) => !/^\d/.test(p) && !STATE.test(p) && !/^\d{5}(-\d{4})?$/.test(p));
  // The LAST cleaned part is the city (the first is a district or a place:
  // "Marina District, San Francisco"), with the region-as-city guard
  // ("Westwood, The Westside, California" is Los Angeles), review 2026-10-02.
  const last = parts[parts.length - 1] || '';
  const key = last.toLowerCase().replace(/^the\s+/, '');
  const CITY = { 'westside': 'Los Angeles', 'san fernando valley': 'Los Angeles', 'valley': 'Los Angeles', 'south los angeles': 'Los Angeles', 'east los angeles': 'Los Angeles' };
  const SKIP = ['south bay', 'east bay', 'peninsula', 'silicon valley', 'north bay', 'inland empire', 'central valley', 'orange county', 'bay area', 'san francisco bay area', 'los angeles county', 'san diego county', 'wine country'];
  const city = CITY[key] || (SKIP.indexOf(key) >= 0 ? (parts[parts.length - 2] || last) : last);
  return city || fallback || String(address).trim();
}

// "First L." the way the app abbreviates a counterparty (name_public is
// already abbreviated server-side; this only tidies a raw legacy value).
function shortName(raw, fallback) {
  const s = String(raw || '').trim();
  if (!s) return fallback;
  const bits = s.split(/\s+/);
  return bits.length > 1 ? bits[0] + ' ' + bits[bits.length - 1][0].toUpperCase() + '.' : bits[0];
}

function departureMs(ride) {
  // dep_date 'YYYY-MM-DD' + dep_time 'HH:MM', read as the browser's local
  // time — rides are Pacific and the 3 h buffer absorbs the zone gap.
  const d = new Date(String(ride.dep_date).slice(0, 10) + 'T' + String(ride.dep_time || '00:00').slice(0, 5) + ':00');
  return isNaN(d.getTime()) ? 0 : d.getTime();
}

async function pendingRatings(me) {
  const { data: rows, error } = await supabase.from('bookings').select(SELECT).eq('status', 'Completed');
  if (error || !rows || !rows.length) return [];
  const ids = rows.map((b) => b.id);
  const { data: mine } = await supabase.from('ratings').select('booking_id').eq('rater_id', me).in('booking_id', ids);
  const rated = new Set((mine || []).map((r) => r.booking_id));
  const skip = dismissed();
  const now = Date.now();
  const out = [];
  for (const b of rows) {
    if (rated.has(b.id) || skip.has(b.id)) continue;
    const isPassenger = b.passenger_id === me;
    const isDriver = b.ride && b.ride.driver_id === me;
    if (!isPassenger && !isDriver) continue;         // admin sessions see every booking
    if (now > new Date(b.created_at).getTime() + WINDOW_MS) continue;
    const dep = departureMs(b.ride);
    if (dep && now < dep + TRIP_ENDED_BUFFER_MS) continue;
    out.push({
      bookingId: b.id,
      myRole: isPassenger ? 'passenger' : 'driver',
      rateeId: isPassenger ? b.ride.driver_id : b.passenger_id,
      who: isPassenger
        ? shortName(b.ride.driver && b.ride.driver.name || b.ride.driver_name, 'your driver')
        : shortName(b.passenger && b.passenger.name || b.passenger_name, 'your passenger'),
      photo: isPassenger
        ? (b.ride.driver && b.ride.driver.photo_url) || null
        : (b.passenger && b.passenger.photo_url) || null,
      route: cityOf(b.ride.departure_area, b.ride.from_dest) + ' → ' + cityOf(b.ride.arrival_area, b.ride.to_dest),
      date: String(b.ride.dep_date).slice(0, 10),
      createdAt: b.created_at,
    });
  }
  out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return out;
}

// FELLOW RIDERS (Justin, 2026-10-22, migration 0400): "if there were other
// riders in the car on that trip, we should have the rider rate the other
// riders as well after they rate the driver if they share at least one leg
// of the trip with them." The server decides who shared a leg with whom
// (bookings RLS hides other riders' rows); the rating row hangs off the
// FELLOW RIDER's booking with rater_role 'copassenger'.
async function pendingCoriders(me, opts) {
  try {
    const { data, error } = await supabase.rpc('my_pending_corider_ratings');
    if (error || !data || !data.length) return [];
    // ignoreDismissed: the rider just rated the driver from the trips card,
    // so an earlier "Not now" on this trip no longer applies (review 10/23).
    const skip = opts && opts.ignoreDismissed ? new Set() : dismissed();
    const out = [];
    for (const r of data) {
      const key = 'c' + r.ratee_booking_id;
      if (skip.has(key)) continue;
      out.push({
        key,
        bookingId: r.ratee_booking_id,
        myBookingId: r.my_booking_id,
        myRole: 'copassenger',
        rateeId: r.ratee_user_id,
        who: shortName(r.ratee_name, 'a fellow rider'),
        photo: r.ratee_photo_url || null,
        route: cityOf(r.departure_area, r.from_dest) + ' → ' + cityOf(r.arrival_area, r.to_dest),
        date: String(r.dep_date).slice(0, 10),
      });
    }
    return out;
  } catch (_) {
    return [];
  }
}

// Each passenger rating is followed by that trip's fellow riders; fellow
// riders whose driver rating is no longer pending come last.
function mergeQueue(main, coriders) {
  const out = [];
  const used = new Set();
  for (const m of main) {
    out.push(m);
    if (m.myRole !== 'passenger') continue;
    for (const c of coriders) {
      if (c.myBookingId !== m.bookingId || used.has(c.key)) continue;
      used.add(c.key);
      out.push(c);
    }
  }
  for (const c of coriders) {
    if (used.has(c.key)) continue;
    used.add(c.key);
    out.push(c);
  }
  return out;
}

function injectStyles() {
  if (document.getElementById('ssrg-style')) return;
  const st = document.createElement('style');
  st.id = 'ssrg-style';
  st.textContent = `
    .ssrg-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;font-family:inherit}
    @media(min-width:640px){.ssrg-backdrop{align-items:center}}
    .ssrg-card{width:100%;max-width:440px;background:var(--ssbar-panel,#121218);color:var(--ssbar-strong,#fff);border:1px solid var(--ssbar-line,rgba(255,255,255,.12));border-radius:18px;padding:22px 20px 18px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
    .ssrg-eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:var(--ssmenu-ini,#00D4C8);margin:0 0 6px}
    .ssrg-title{font-size:20px;font-weight:700;margin:0 0 4px;line-height:1.25;text-wrap:balance}
    .ssrg-avatar{display:block;width:64px;height:64px;border-radius:50%;object-fit:cover;margin:0 auto 12px;background:var(--ssmenu-btnbg,#0b0b10);border:1px solid var(--ssbar-line,rgba(255,255,255,.12))}
    .ssrg-initials{display:flex;align-items:center;justify-content:center;width:64px;height:64px;border-radius:50%;margin:0 auto 12px;background:rgba(0,212,200,.14);color:#00D4C8;font-weight:700;font-size:22px;letter-spacing:-.5px}
    @media (prefers-color-scheme: light){.ssrg-initials{color:#007C76}}
    .ssrg-route{font-size:14px;color:var(--ssbar-tab,#adadb8);margin:0 0 16px}
    .ssrg-stars{display:flex;gap:6px;justify-content:center;margin:4px 0 14px}
    .ssrg-star{background:none;border:0;font-size:38px;line-height:1;cursor:pointer;color:var(--ssbar-btnline,#3a3a46);padding:2px 4px;font-family:inherit}
    .ssrg-star.on{color:#00D4C8}
    /* Light (bug check 2026-10-12): the stars read 1.35:1 (off) and 1.87:1
       (on) on white; 38px glyphs need 3:1. The eyebrow isn't tappable, so
       it is grey, not teal. Dark is unchanged. */
    @media (prefers-color-scheme: light){.ssrg-star{color:#8B9397}.ssrg-star.on{color:#007C76}.ssrg-eyebrow{color:#4B5357}}
    .ssrg-star:focus-visible{outline:2px solid #00D4C8;outline-offset:2px;border-radius:8px}
    .ssrg-note{width:100%;box-sizing:border-box;min-height:74px;resize:vertical;background:var(--ssmenu-btnbg,#0b0b10);color:var(--ssbar-strong,#fff);border:1px solid var(--ssbar-btnline,rgba(255,255,255,.14));border-radius:12px;padding:12px;font-size:15px;font-family:inherit}
    .ssrg-note:focus{outline:none;border-color:#00D4C8}
    .ssrg-msg{min-height:18px;font-size:13px;color:var(--ssmenu-danger,#ff8a80);margin:8px 0 0}
    .ssrg-submit{width:100%;margin-top:10px;background:#00D4C8;color:#04201e;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit}
    .ssrg-submit[disabled]{opacity:.6;cursor:default}
    .ssrg-later{display:block;width:100%;margin-top:8px;background:none;border:0;color:var(--ssbar-tab,#adadb8);font-size:14px;padding:10px;cursor:pointer;font-family:inherit}
    .ssrg-later:hover{color:var(--ssbar-strong,#fff)}
    .ssrg-count{font-size:12px;color:var(--ssmenu-cap,#7c7c8a);text-align:center;margin:6px 0 0}
  `;
  document.head.appendChild(st);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

// Popup log (0369, Justin 2026-10-07): "did Vincent get a prompt to rate when
// he logged back in?" couldn't be answered because the popup recorded
// nothing. One row per shown / dismissed / rated, about the viewer only (RLS).
// Fire-and-forget: a failed log (e.g. before 0369 runs) never touches the
// popup.
function logEvent(me, bookingId, event, suffix) {
  try {
    // A fellow-rider prompt logs the FELLOW RIDER's booking id; the '#corider'
    // page suffix is what tells it apart from a driver prompt for that booking.
    const page = String(location.pathname || '/').slice(0, 70) + (suffix || '');
    supabase.from('rating_prompt_events')
      .insert({ user_id: me, booking_id: bookingId, surface: 'web', event, page })
      .then(() => {}, () => {});
  } catch (_) { /* never let logging break the page */ }
}

function showOne(item, remaining, me, onDone, onSkip) {
  injectStyles();
  const dismissKey = item.key || item.bookingId;
  const isCorider = item.myRole === 'copassenger';
  const logSuffix = isCorider ? '#corider' : '';
  logEvent(me, item.bookingId, 'shown', logSuffix);
  const backdrop = el('div', 'ssrg-backdrop');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', isCorider ? 'Rate a fellow rider' : 'Rate your trip');
  const card = el('div', 'ssrg-card');
  card.appendChild(el('p', 'ssrg-eyebrow', item.myRole === 'driver' ? 'Rate your passenger' : isCorider ? 'Rate a fellow rider' : 'Rate your driver'));
  // Their photo, so the rater can place the face (Justin, 2026-10-23); the
  // URL is a public avatars-bucket link, set as a property, never markup.
  if (item.photo && /^https:\/\/vmfmbntacifqoqxqxgsk\.supabase\.co\//.test(String(item.photo))) {
    const img = el('img', 'ssrg-avatar');
    img.alt = '';
    img.referrerPolicy = 'no-referrer';
    img.src = String(item.photo);
    img.addEventListener('error', () => { img.replaceWith(el('div', 'ssrg-initials', String(item.who || '?').trim().charAt(0).toUpperCase())); });
    card.appendChild(img);
  } else {
    card.appendChild(el('div', 'ssrg-initials', String(item.who || '?').trim().charAt(0).toUpperCase()));
  }
  card.appendChild(el('h2', 'ssrg-title', item.myRole === 'driver'
    ? 'How was ' + item.who + ' as a passenger?'
    : isCorider
      ? 'How was riding with ' + item.who + '?'
      : 'How was the ride with ' + item.who + '?'));
  card.appendChild(el('p', 'ssrg-route', item.route + ' · ' + item.date));

  // Pre-filled 5 (Justin, 2026-08-22) — matches components/rating-modal.tsx.
  let chosen = 5;
  const stars = el('div', 'ssrg-stars');
  const starBtns = [];
  for (let i = 1; i <= 5; i++) {
    const b = el('button', 'ssrg-star on', '★');
    b.type = 'button';
    b.setAttribute('aria-label', i + ' star' + (i === 1 ? '' : 's'));
    b.setAttribute('aria-pressed', 'true');
    b.addEventListener('click', () => {
      chosen = i;
      starBtns.forEach((s, idx) => { s.classList.toggle('on', idx < chosen); s.setAttribute('aria-pressed', idx < chosen ? 'true' : 'false'); });
      msg.textContent = '';
    });
    starBtns.push(b);
    stars.appendChild(b);
  }
  card.appendChild(stars);

  const note = el('textarea', 'ssrg-note');
  note.placeholder = item.myRole === 'driver'
    ? 'Anything worth telling other drivers? (optional)'
    : isCorider
      ? 'How was sharing the car with them? (optional)'
      : 'Anything worth telling other riders? (optional)';
  note.maxLength = 500;
  card.appendChild(note);

  const msg = el('div', 'ssrg-msg');
  const submit = el('button', 'ssrg-submit', 'Submit rating');
  submit.type = 'button';
  submit.addEventListener('click', async () => {
    submit.disabled = true;
    submit.textContent = 'Submitting…';
    msg.textContent = '';
    try {
      const { error } = await supabase.from('ratings').insert({
        booking_id: item.bookingId,
        rater_id: me,
        ratee_id: item.rateeId,
        rater_role: item.myRole,
        stars: chosen,
        comment: note.value.trim() || null,
      });
      if (error) throw error;
      logEvent(me, item.bookingId, 'rated', logSuffix);
      // Let the page underneath (trips.html keeps its own "you rated" cache)
      // update its rating card instead of offering the form a second time.
      // Not for a fellow rider: the pages only cache the viewer's OWN trips,
      // and a reload per fellow rider would be wasted work.
      if (!isCorider) {
        try { window.dispatchEvent(new CustomEvent('ss:rated', { detail: { bookingId: item.bookingId, stars: chosen, role: item.myRole } })); } catch (_) {}
      }
      backdrop.remove();
      onDone();
    } catch (e) {
      const raw = (e && e.message) || '';
      // A trip that can't be rated any more shouldn't keep the page hostage.
      const terminal = raw.includes('ratings_one_per_rater') || raw.includes('user_can_rate_booking') || raw.includes('no pickup on record') || raw.includes('share a leg');
      msg.textContent =
        raw.includes('ratings_one_per_rater') ? (isCorider ? 'You already rated this rider.' : 'You already rated this trip.')
        : raw.includes('user_can_rate_booking') ? (isCorider ? 'This rider can no longer be rated for this trip.' : 'The rating window has closed for this trip.')
        : raw.includes('share a leg') ? 'This rider can no longer be rated for this trip.'
        : raw.includes('no pickup on record') ? "This trip has no pickup on record, so it can't be rated."
        : 'Could not submit that just now. Try again in a moment.';
      if (terminal) { dismiss(dismissKey); setTimeout(() => { backdrop.remove(); onDone(); }, 1600); return; }
      submit.disabled = false;
      submit.textContent = 'Submit rating';
    }
  });
  card.appendChild(submit);
  card.appendChild(msg);

  const later = el('button', 'ssrg-later', 'Not now');
  later.type = 'button';
  later.addEventListener('click', () => {
    logEvent(me, item.bookingId, 'dismissed', logSuffix);
    dismiss(dismissKey);
    if (onSkip) onSkip();
    backdrop.remove();
    onDone();
  });
  card.appendChild(later);
  if (remaining > 0) card.appendChild(el('p', 'ssrg-count', remaining + ' more to rate after this one'));

  backdrop.appendChild(card);
  document.body.appendChild(backdrop);
  submit.focus();
}

async function run() {
  try {
    let hasToken = false;
    try { hasToken = !!localStorage.getItem(TOKEN_KEY); } catch (_) { hasToken = false; }
    if (!hasToken) return;
    const S = await import('./ss-session.js');
    supabase = S.supabase;
    getSession = S.getSession;
    const session = await getSession();
    const me = session && session.user && session.user.id;
    if (!me) return;
    meId = me;
    const [main, cor] = await Promise.all([pendingRatings(me), pendingCoriders(me)]);
    const queue = mergeQueue(main, cor);
    if (!queue.length) return;
    let i = 0;
    const step = () => {
      if (i >= queue.length) return;
      const item = queue[i++];
      // "Not now" on the driver also skips that trip's fellow riders for this
      // session; they come back on the next visit, again after the driver.
      const onSkip = item.myRole === 'passenger'
        ? () => {
            for (let j = queue.length - 1; j >= i; j--) {
              const c = queue[j];
              if (c.myRole === 'copassenger' && c.myBookingId === item.bookingId) { dismiss(c.key); queue.splice(j, 1); }
            }
          }
        : null;
      showOne(item, queue.length - i, me, step, onSkip);
    };
    step();
  } catch (_) {
    // Never let the gate break the page it sits on.
  }
}

// The signed-in viewer, once run() has resolved the session (null before).
let meId = null;
// run()'s promise, so an event that lands while the session is still being
// resolved waits for it instead of being dropped (review 10/23).
let ready = null;

// trips.html's own rating card tells us when the driver was just rated; the
// fellow riders of that trip follow right away (the "after they rate the
// driver" contract), without a page reload. An earlier "Not now" on this
// trip is ignored here: the rider just chose to rate.
window.addEventListener('ss:driver-rated', async (e) => {
  const d = e && e.detail;
  if (!d || !d.bookingId) return;
  try {
    if (ready) { try { await ready; } catch (_) { /* run() never throws */ } }
    if (!meId || !supabase) return;
    const items = (await pendingCoriders(meId, { ignoreDismissed: true })).filter((c) => c.myBookingId === d.bookingId);
    let i = 0;
    const step = () => {
      if (i >= items.length) return;
      const item = items[i++];
      showOne(item, items.length - i, meId, step, null);
    };
    step();
  } catch (_) { /* never let the gate break the page */ }
});

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', () => { ready = run(); });
else ready = run();
