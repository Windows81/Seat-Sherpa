// ss-rating-gate.js — RATING-FIRST GATE for the signed-in web pages.
//
// WHY (Justin, 2026-09-07): "for those who have completed rides but have not
// rated their driver or passenger yet, I want the first popup when they open
// up the app again to be the rating screen (default to 5 stars), and optional
// comment, before moving on to the rest of the app. How do we make this work
// for web-only?" The app got components/rating-gate.tsx; this is the web
// twin. Web-only riders and drivers (never installed the app) hit it on the
// first signed-in page they open — /trips, /driving, /account, /messages,
// /rides, /ride, /book, /post, /requests — and see the same modal the app
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
  'passenger:profiles!bookings_passenger_profile_fkey(name:name_public)',
  'ride:rides!inner(id, driver_id, driver_name, from_dest, to_dest, departure_area, arrival_area, dep_date, dep_time, dep_timezone,'
    + ' driver:profiles!rides_driver_profile_fkey(name:name_public))',
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
  return parts[0] || fallback || String(address).trim();
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
      route: cityOf(b.ride.departure_area, b.ride.from_dest) + ' → ' + cityOf(b.ride.arrival_area, b.ride.to_dest),
      date: String(b.ride.dep_date).slice(0, 10),
      createdAt: b.created_at,
    });
  }
  out.sort((a, b) => (b.createdAt > a.createdAt ? 1 : -1));
  return out;
}

function injectStyles() {
  if (document.getElementById('ssrg-style')) return;
  const st = document.createElement('style');
  st.id = 'ssrg-style';
  st.textContent = `
    .ssrg-backdrop{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,.72);display:flex;align-items:flex-end;justify-content:center;padding:16px;font-family:inherit}
    @media(min-width:640px){.ssrg-backdrop{align-items:center}}
    .ssrg-card{width:100%;max-width:440px;background:#121218;color:#fff;border:1px solid rgba(255,255,255,.12);border-radius:18px;padding:22px 20px 18px;box-shadow:0 24px 60px rgba(0,0,0,.6)}
    .ssrg-eyebrow{font-size:12px;font-weight:700;letter-spacing:.08em;text-transform:uppercase;color:#00D4C8;margin:0 0 6px}
    .ssrg-title{font-size:20px;font-weight:700;margin:0 0 4px;line-height:1.25;text-wrap:balance}
    .ssrg-route{font-size:14px;color:#adadb8;margin:0 0 16px}
    .ssrg-stars{display:flex;gap:6px;justify-content:center;margin:4px 0 14px}
    .ssrg-star{background:none;border:0;font-size:38px;line-height:1;cursor:pointer;color:#3a3a46;padding:2px 4px;font-family:inherit}
    .ssrg-star.on{color:#00D4C8}
    .ssrg-star:focus-visible{outline:2px solid #00D4C8;outline-offset:2px;border-radius:8px}
    .ssrg-note{width:100%;box-sizing:border-box;min-height:74px;resize:vertical;background:#0b0b10;color:#fff;border:1px solid rgba(255,255,255,.14);border-radius:12px;padding:12px;font-size:15px;font-family:inherit}
    .ssrg-note:focus{outline:none;border-color:#00D4C8}
    .ssrg-msg{min-height:18px;font-size:13px;color:#ff8a80;margin:8px 0 0}
    .ssrg-submit{width:100%;margin-top:10px;background:#00D4C8;color:#04201e;border:0;border-radius:12px;padding:14px;font-size:16px;font-weight:700;cursor:pointer;font-family:inherit}
    .ssrg-submit[disabled]{opacity:.6;cursor:default}
    .ssrg-later{display:block;width:100%;margin-top:8px;background:none;border:0;color:#adadb8;font-size:14px;padding:10px;cursor:pointer;font-family:inherit}
    .ssrg-later:hover{color:#fff}
    .ssrg-count{font-size:12px;color:#7c7c8a;text-align:center;margin:6px 0 0}
  `;
  document.head.appendChild(st);
}

function el(tag, cls, text) {
  const n = document.createElement(tag);
  if (cls) n.className = cls;
  if (text != null) n.textContent = text;
  return n;
}

function showOne(item, remaining, me, onDone) {
  injectStyles();
  const backdrop = el('div', 'ssrg-backdrop');
  backdrop.setAttribute('role', 'dialog');
  backdrop.setAttribute('aria-modal', 'true');
  backdrop.setAttribute('aria-label', 'Rate your trip');
  const card = el('div', 'ssrg-card');
  card.appendChild(el('p', 'ssrg-eyebrow', item.myRole === 'driver' ? 'Rate your passenger' : 'Rate your driver'));
  card.appendChild(el('h2', 'ssrg-title', item.myRole === 'driver'
    ? 'How was ' + item.who + ' as a passenger?'
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
      // Let the page underneath (trips.html keeps its own "you rated" cache)
      // update its rating card instead of offering the form a second time.
      try { window.dispatchEvent(new CustomEvent('ss:rated', { detail: { bookingId: item.bookingId, stars: chosen } })); } catch (_) {}
      backdrop.remove();
      onDone();
    } catch (e) {
      const raw = (e && e.message) || '';
      // A trip that can't be rated any more shouldn't keep the page hostage.
      const terminal = raw.includes('ratings_one_per_rater') || raw.includes('user_can_rate_booking') || raw.includes('no pickup on record');
      msg.textContent =
        raw.includes('ratings_one_per_rater') ? 'You already rated this trip.'
        : raw.includes('user_can_rate_booking') ? 'The rating window has closed for this trip.'
        : raw.includes('no pickup on record') ? "This trip has no pickup on record, so it can't be rated."
        : 'Could not submit that just now. Try again in a moment.';
      if (terminal) { dismiss(item.bookingId); setTimeout(() => { backdrop.remove(); onDone(); }, 1600); return; }
      submit.disabled = false;
      submit.textContent = 'Submit rating';
    }
  });
  card.appendChild(submit);
  card.appendChild(msg);

  const later = el('button', 'ssrg-later', 'Not now');
  later.type = 'button';
  later.addEventListener('click', () => { dismiss(item.bookingId); backdrop.remove(); onDone(); });
  card.appendChild(later);
  if (remaining > 0) card.appendChild(el('p', 'ssrg-count', remaining + ' more trip' + (remaining === 1 ? '' : 's') + ' to rate after this one'));

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
    const queue = await pendingRatings(me);
    if (!queue.length) return;
    let i = 0;
    const step = () => {
      if (i >= queue.length) return;
      const item = queue[i++];
      showOne(item, queue.length - i, me, step);
    };
    step();
  } catch (_) {
    // Never let the gate break the page it sits on.
  }
}

if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', run);
else run();
