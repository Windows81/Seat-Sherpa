// /js/ss-meeting-spot.js
//
// Meeting spot cards for the website chats (Justin, 2026-10-04: "when you add
// an address in (similar to rover setting a meeting and greet) that is
// different than the address at the original pickup, that that is clickable
// into a map by everyone"; both sides can set one, no accept step, include
// the small map). The app twin is SeatSherpaApp/lib/meeting-spot.ts and the
// chat card in app/chat/[bookingId].tsx.
//
// A spot is a chat message with messages.place = {name, address, lat, lng}
// (migration 0347). Its text always ends with "Meeting spot: <label>", so
// older apps, inbox previews and the chat email still say where to meet. The
// newest spot in a conversation is the current one.
//
// Used by driving.html and trips.html. Everything user-supplied is set as
// text, never as HTML; map links are built from the numbers only.
(function () {
  if (window.SSMeetingSpot) return;

  var TOKEN = 'pk.eyJ1IjoiamR0MjYyIiwiYSI6ImNtcDhnb3pvNzBkbGYyenBpN2psY3g2bGsifQ.sqsxq8sjfLaq978oqGExHg';
  var PREFIX = 'Meeting spot: ';

  var css =
    '.ssms-card{border:1px solid #2a2a33;border-radius:14px;overflow:hidden;background:#141418;max-width:320px;}' +
    '.ssms-map{display:block;width:100%;aspect-ratio:7/3;object-fit:cover;background:#1f1f23;border:0;}' +
    '.ssms-body{padding:10px 12px 12px;display:flex;flex-direction:column;gap:2px;}' +
    '.ssms-eyebrow{font-size:11px;font-weight:700;letter-spacing:0.4px;text-transform:uppercase;color:#00D4C8;}' +
    '.ssms-name{font-size:15px;font-weight:700;color:#fff;}' +
    '.ssms-addr{font-size:13px;color:#adadb8;}' +
    '.ssms-dist{font-size:12px;color:#8f8f98;}' +
    '.ssms-links{display:flex;gap:14px;margin-top:6px;font-size:14px;font-weight:700;}' +
    '.ssms-links a{color:#00D4C8;text-decoration:none;}' +
    '.ssms-links a:focus-visible,.ssms-map-link:focus-visible{outline:2px solid #00D4C8;outline-offset:2px;}' +
    '.ssms-ac{border:1px solid #202027;border-radius:10px;overflow:hidden;margin:-4px 0 10px;background:#141418;}' +
    '.ssms-ac button{display:block;width:100%;text-align:left;padding:9px 12px;border:0;border-bottom:1px solid #202027;' +
    'background:transparent;color:#e8e8ee;cursor:pointer;font-size:14px;font-family:inherit;}' +
    // Light theme (2026-10-12).
    '@media (prefers-color-scheme: light){' +
    '.ssms-card{border-color:#D8DCDB;background:#FFFFFF;}.ssms-map{background:#EFF1F0;}' +
    '.ssms-eyebrow{color:#4B5357;}.ssms-name{color:#121416;}.ssms-addr{color:#4B5357;}.ssms-dist{color:#687176;}' +
    '.ssms-links a{color:#007C76;}.ssms-links a:focus-visible,.ssms-map-link:focus-visible{outline-color:#007C76;}' +
    '.ssms-ac{border-color:rgba(18,22,22,0.10);background:#FFFFFF;}' +
    '.ssms-ac button{border-bottom-color:rgba(18,22,22,0.10);color:#23272A;}}';
  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  function stripCountry(s) {
    return String(s || '').replace(/,\s*United States( of America)?$/i, '').trim();
  }

  function valid(p) {
    return !!p && typeof p.lat === 'number' && typeof p.lng === 'number' && isFinite(p.lat) && isFinite(p.lng);
  }

  /** "Starbucks, 123 Main St, San Jose, CA"; the name is left out when the
   *  address already starts with it. */
  function label(p) {
    var name = String((p && p.name) || '').trim();
    var address = stripCountry((p && p.address) || '');
    if (name && address && address.toLowerCase().indexOf(name.toLowerCase()) !== 0) return name + ', ' + address;
    return address || name;
  }

  /** The text stored with a spot message. */
  function body(note, p) {
    var line = PREFIX + label(p);
    note = String(note || '').trim();
    return note ? note + '\n' + line : line;
  }

  // "Send my location" (Justin, 2026-10-18): a one-time pin of where the
  // sender is right now, sent as a place message whose text starts
  // "My location: ". Not a meeting spot: the current-spot lookups skip it.
  // The text is the marker because the database keeps only {name, address,
  // lat, lng} in messages.place. App twin: lib/meeting-spot.ts isHerePin.
  var HERE_PREFIX = 'My location: ';
  // One line only: a meeting spot whose NOTE starts "My location: " still
  // ends with its "\nMeeting spot: ..." line (review 2026-10-18).
  function isHere(text) {
    var t = String(text || '');
    return t.indexOf(HERE_PREFIX) === 0 && t.indexOf('\n') === -1;
  }
  function hereBody(p) {
    return HERE_PREFIX + (label(p) || (p.lat.toFixed(5) + ', ' + p.lng.toFixed(5)));
  }

  /** Street address for a point (Mapbox v5, the same lookup as the app's
   *  reverseGeocode). Resolves '' when there is none. */
  function reverse(lat, lng) {
    var url = 'https://api.mapbox.com/geocoding/v5/mapbox.places/' + lng + ',' + lat +
      '.json?types=address,neighborhood,locality,place&limit=1&access_token=' + TOKEN;
    // Never leave "Finding you…" hanging: give up after 6 s and send the
    // coordinates instead.
    var ctl = typeof AbortController === 'function' ? new AbortController() : null;
    var timer = setTimeout(function () { if (ctl) ctl.abort(); }, 6000);
    return fetch(url, ctl ? { signal: ctl.signal } : undefined).then(function (r) { return r.ok ? r.json() : null; }).then(function (j) {
      var f = j && j.features && j.features[0];
      return f ? stripCountry(f.place_name) : '';
    }).catch(function () { return ''; }).then(function (s) { clearTimeout(timer); return s; });
  }

  /** What to show above the card: the text minus the "Meeting spot:" line. */
  function noteOf(text, p) {
    var t = String(text || '');
    // A location pin's text is only the address line, which the card shows.
    if (isHere(t)) return '';
    var line = PREFIX + label(p);
    if (t === line) return '';
    if (t.slice(-(line.length + 1)) === '\n' + line) return t.slice(0, -(line.length + 1)).trim();
    return t;
  }

  function miles(a, b) {
    if (!valid(a) || !valid(b)) return null;
    var R = 3958.8;
    var rad = Math.PI / 180;
    var dLat = (b.lat - a.lat) * rad;
    var dLng = (b.lng - a.lng) * rad;
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2) +
      Math.cos(a.lat * rad) * Math.cos(b.lat * rad) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
  }

  function googleUrl(p) {
    return 'https://www.google.com/maps/search/?api=1&query=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6);
  }
  function appleUrl(p) {
    return 'https://maps.apple.com/?ll=' + p.lat.toFixed(6) + ',' + p.lng.toFixed(6) + '&q=' + encodeURIComponent(label(p) || 'Meeting spot');
  }
  function mapImageUrl(p) {
    var ll = p.lng.toFixed(6) + ',' + p.lat.toFixed(6);
    return 'https://api.mapbox.com/styles/v1/mapbox/' + ((window.matchMedia && window.matchMedia('(prefers-color-scheme: light)').matches) ? 'light-v11' : 'dark-v11') + '/static/pin-s+00d4c8(' + ll + ')/' + ll +
      ',15,0/560x240@2x?access_token=' + TOKEN;
  }

  function el(tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text != null) n.textContent = text;
    return n;
  }

  /** The map card. opts.from = the original pickup {lat, lng} for the
   *  distance line; opts.footer = e.g. "Set by Hiba A. · 2:05 PM";
   *  opts.here = { title } for a "Send my location" pin. */
  function card(p, opts) {
    opts = opts || {};
    var wrap = el('div', 'ssms-card');
    if (!valid(p)) return wrap;
    var g = googleUrl(p);
    var mapLink = el('a', 'ssms-map-link');
    mapLink.href = g; mapLink.target = '_blank'; mapLink.rel = 'noopener';
    var what = opts.here ? 'the shared location' : 'the meeting spot';
    mapLink.setAttribute('aria-label', 'Open ' + what + ' in Google Maps');
    var img = el('img', 'ssms-map');
    img.alt = 'Map of ' + what;
    img.loading = 'lazy';
    img.src = mapImageUrl(p);
    img.addEventListener('error', function () { mapLink.remove(); });
    mapLink.appendChild(img);
    wrap.appendChild(mapLink);
    var b = el('div', 'ssms-body');
    b.appendChild(el('div', 'ssms-eyebrow', opts.here ? 'Shared location' : 'Meeting spot'));
    var name = opts.here ? String(opts.here.title || 'Shared location') : String(p.name || '').trim();
    var address = stripCountry(p.address || '');
    if (name) b.appendChild(el('div', 'ssms-name', name));
    if (address && address !== name) b.appendChild(el('div', 'ssms-addr', address));
    var d = miles(opts.from, p);
    if (d != null) {
      b.appendChild(el('div', 'ssms-dist', d < 0.1 ? 'At the original pickup' : (d < 10 ? d.toFixed(1) : Math.round(d)) + ' mi from the original pickup'));
    }
    if (opts.footer) b.appendChild(el('div', 'ssms-dist', opts.footer));
    var links = el('div', 'ssms-links');
    var a1 = el('a', null, 'Open in Google Maps'); a1.href = g; a1.target = '_blank'; a1.rel = 'noopener';
    var a2 = el('a', null, 'Apple Maps'); a2.href = appleUrl(p); a2.target = '_blank'; a2.rel = 'noopener';
    links.appendChild(a1); links.appendChild(a2);
    b.appendChild(links);
    wrap.appendChild(b);
    return wrap;
  }

  function uuid() {
    try { return crypto.randomUUID(); } catch (e) { return String(Date.now()) + Math.random().toString(16).slice(2); }
  }

  /** A place search box. Calls onPick({name, address, lat, lng}) when one is
   *  chosen, and onPick(null) as soon as the text is edited again. */
  function picker(onPick) {
    var box = el('div');
    var input = el('input');
    input.type = 'text';
    input.placeholder = 'Search for a place or address';
    input.setAttribute('aria-label', 'Meeting spot');
    input.autocomplete = 'off';
    var list = el('div', 'ssms-ac');
    list.style.display = 'none';
    box.appendChild(input);
    box.appendChild(list);
    var session = uuid(); var timer = null; var seq = 0;
    function render(items) {
      list.textContent = '';
      if (!items.length) { list.style.display = 'none'; return; }
      items.forEach(function (s) {
        var b = el('button', null, (s.name || '') + (s.place_formatted ? ' · ' + stripCountry(s.place_formatted) : ''));
        b.type = 'button';
        b.addEventListener('click', async function () {
          list.style.display = 'none';
          var address = stripCountry(s.full_address || ((s.name || '') + (s.place_formatted ? ', ' + s.place_formatted : '')));
          input.value = address;
          try {
            var r = await fetch('https://api.mapbox.com/search/searchbox/v1/retrieve/' + encodeURIComponent(s.mapbox_id) +
              '?access_token=' + TOKEN + '&session_token=' + session);
            var j = r.ok ? await r.json() : null;
            var f = j && j.features && j.features[0];
            session = uuid();
            // Typed over while this was loading: the pick is stale, so drop it
            // (bug check 2026-10-05) instead of attaching a spot the text no longer says.
            if (input.value !== address) return;
            if (f) onPick({ name: String(s.name || '').slice(0, 120), address: address.slice(0, 300), lat: f.geometry.coordinates[1], lng: f.geometry.coordinates[0] });
          } catch (e) { /* stays unpicked */ }
        });
        list.appendChild(b);
      });
      list.style.display = 'block';
    }
    input.addEventListener('input', function () {
      onPick(null);
      clearTimeout(timer);
      var q = input.value.trim();
      if (q.length < 3) { render([]); return; }
      timer = setTimeout(async function () {
        var my = ++seq;
        try {
          var res = await fetch('https://api.mapbox.com/search/searchbox/v1/suggest?q=' + encodeURIComponent(q) +
            '&access_token=' + TOKEN + '&session_token=' + session +
            '&country=us&bbox=-124.5,32.0,-114.0,42.0&limit=6&types=poi,address,place,locality,neighborhood');
          var j = res.ok ? await res.json() : {};
          if (my !== seq) return;
          render(j.suggestions || []);
        } catch (e) { render([]); }
      }, 250);
    });
    box.focusInput = function () { input.focus(); };
    return box;
  }

  /** A phone number in a spot note (bug check 2026-10-05: spot notes skipped
   *  the chat's off-platform warning). Same detector as the chat composers in
   *  trips.html and driving.html: plain numbers, and ten digits spread out
   *  with letters or symbols between them (0216), minus times, dates, prices
   *  and coordinates (0307). Spots exist only on Confirmed bookings, where
   *  only the phone warning applies. */
  function phoneHit(text) {
    text = String(text || '');
    if (/(^|\D)(\+?1[\s.\-·]?)?\(?\d{3}\)?[\s.\-·]?\d{3}[\s.\-·]?\d{4}(?!\d)/.test(text)) return true;
    var digs = [];
    for (var i = 0; i < text.length; i++) if (text[i] >= '0' && text[i] <= '9') digs.push(i);
    for (var j = 0; j + 9 < digs.length; j++) {
      var win = text.slice(digs[j], digs[j + 9] + 1);
      if (win.length <= 22 && !/[:/$%]/.test(win) && !/^((19|20)\d\d\D{0,3})+$/.test(win) && !/(^|[^A-Za-z0-9])[A-Za-z]{2,}([^A-Za-z0-9]|$)/.test(win) && !/\d\.\d{3,}/.test(win) && !/(^|[^0-9-])((0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01])-(19|20)?\d{2}|(19|20)\d{2}-(0?[1-9]|1[0-2])-(0?[1-9]|[12]\d|3[01]))([^0-9-]|$)/.test(win)) return true;
    }
    return false;
  }
  var PHONE_WARNING = 'Sharing phone numbers moves you off Seat Sherpa. Payment and no-show protection only work here, and you can call each other through Seat Sherpa starting the day before the ride. Tap Share again to send it anyway.';

  window.SSMeetingSpot = {
    valid: valid, label: label, body: body, noteOf: noteOf, miles: miles,
    isHere: isHere, hereBody: hereBody, reverse: reverse,
    card: card, picker: picker, googleUrl: googleUrl, appleUrl: appleUrl,
    phoneHit: phoneHit, PHONE_WARNING: PHONE_WARNING,
  };
})();
