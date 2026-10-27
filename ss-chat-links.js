// /js/ss-chat-links.js
//
// Tappable addresses in the website chats (Justin, 2026-10-18: "is there a
// way I can click on an address in the chat?"). Splits a message into plain
// text, street addresses and links, and fills a bubble with text nodes and
// <a> elements: an address opens in Google Maps (app or web), a map link or
// a seatsherpa.app link opens as itself. Phone numbers and other sites stay
// plain text on purpose (off-platform). The app twin is
// SeatSherpaApp/lib/chat-links.ts; keep the patterns in step.
//
// Used by trips.html and driving.html. Chat text is typed by the other
// person, so everything is set as text nodes and hrefs are built here, never
// from HTML.
(function () {
  if (window.SSChatLinks) return;

  // The host has to END at "/", "?", "#", punctuation or the end of the text
  // (review 2026-10-18: "maps.apple.com.evil.io" and "maps.apple.com@evil.com"
  // got through as map links), and safeUrl() checks the host again.
  var LINK_RE = /(?:https?:\/\/)?(?:(?:www\.)?google\.com\/maps|maps\.google\.com|maps\.app\.goo\.gl|goo\.gl\/maps|maps\.apple\.com|maps\.apple|(?:www\.)?seatsherpa\.app)(?=[/?#\s)\].,!;:'"]|$)(?:[/?#]\S*)?/gi;
  var SAFE_HOSTS = {
    'google.com': 1, 'www.google.com': 1, 'maps.google.com': 1, 'maps.app.goo.gl': 1, 'goo.gl': 1,
    'maps.apple.com': 1, 'maps.apple': 1, 'seatsherpa.app': 1, 'www.seatsherpa.app': 1,
  };
  var SUFFIX = 'St|Street|Ave|Avenue|Av|Blvd|Boulevard|Rd|Road|Dr|Drive|Ln|Lane|Way|Ct|Court|Pl|Place|Pkwy|Parkway|Hwy|Highway|Cir|Circle|Ter|Terrace|Sq|Square|Loop|Trl|Trail|Plz|Plaza|Expy|Expressway|Fwy|Freeway|Real|Row|Mall';
  var ADDRESS_RE = new RegExp(
    '\\b\\d{1,6}[A-Za-z]?\\s+' +
      '(?:' +
      "(?:[A-Za-z0-9][A-Za-z0-9'.-]*\\s+){1,4}?(?:" + SUFFIX + ')\\b\\.?' +
      '|(?:(?:N|S|E|W|North|South|East|West)\\.?\\s+)?(?:Broadway|The Embarcadero|Embarcadero)\\b' +
      ')',
    'gi'
  );
  // ", City" needs a lowercase second letter (", OK" and ", I'm" stay out);
  // accents allowed for "San José".
  var TAIL_RE = /^(?:,?\s*(?:#|Apt\.?|Suite|Ste\.?|Unit)\s*[A-Za-z0-9-]+)?(?:,\s*[A-ZÀ-Þ][a-zß-ÿ][A-Za-zÀ-ÿ.'-]*(?:\s+[A-ZÀ-Þ][a-zß-ÿ][A-Za-zÀ-ÿ.'-]*){0,2})?(?:,?\s*(?:CA|California|NV|Nevada)\b)?(?:,?\s+\d{5}(?:-\d{4})?)?/;
  var HOUSE_NUMBER = /^\d{1,6}[A-Za-z]?$/;
  var STOP = {};
  ('the a an on in at to my your our their his her is are was be by for and or with from this that it i you we they will ' +
    'can get go have has need more than about around like just only all any some no not min mins minute minutes hour hours hr hrs ' +
    'mile miles mi people bag bags seat seats days day weeks times am pm ' +
    'each one per block blocks down up near past off kids friends').split(' ').forEach(function (w) { STOP[w] = true; });

  var css = '.bubble a.sscl{color:inherit;text-decoration:underline;text-underline-offset:2px;word-break:break-word;}' +
    '.bubble a.sscl:focus-visible{outline:2px solid currentColor;outline-offset:2px;border-radius:3px;}';
  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  /** Sentence punctuation off the end of a link; a ")" only when it closes
   *  nothing inside the link ("google.com/maps/place/Foo+(Bar)" keeps it). */
  function trimLinkTail(s) {
    var t = s.replace(/[.,!?;:'"]+$/, '');
    for (;;) {
      var last = t.slice(-1);
      var open = last === ')' ? '(' : last === ']' ? '[' : last === '}' ? '{' : '';
      if (!open || t.split(open).length > t.split(last).length - 1) break;
      t = t.slice(0, -1).replace(/[.,!?;:'"]+$/, '');
    }
    return t;
  }

  /** https URL when the host is ours or a maps host and carries no
   *  user-info; null otherwise. */
  function safeUrl(raw) {
    // Every allowed host serves https, so http is upgraded.
    var url = (/^https?:\/\//i.test(raw) ? raw.replace(/^https?/i, function (s) { return s.toLowerCase(); }) : 'https://' + raw)
      .replace(/^http:\/\//, 'https://');
    var m = /^https:\/\/([^/?#\s]+)([^?#\s]*)/i.exec(url);
    if (!m || m[1].indexOf('@') !== -1) return null;
    var host = m[1].toLowerCase();
    if (!SAFE_HOSTS[host]) return null;
    // "google.com/maps/../url?q=<anything>" normalizes to Google's redirect
    // page, an off-platform link we would be vouching for (bug check
    // 2026-10-19): no dot segments or backslashes in the path, and Google's
    // hosts only for their map paths. Keep in step with lib/chat-links.ts.
    var path = m[2];
    if (/\.\.|%2e|\\/i.test(path)) return null;
    if ((host === 'google.com' || host === 'www.google.com' || host === 'goo.gl') && !/^\/maps(\/|$)/i.test(path)) return null;
    if (host === 'maps.google.com' && !(path === '' || path === '/' || /^\/maps(\/|$)/i.test(path))) return null;
    return url;
  }

  function addressSegments(text, out) {
    var last = 0;
    var m;
    ADDRESS_RE.lastIndex = 0;
    while ((m = ADDRESS_RE.exec(text))) {
      var start = m.index;
      var tokens = m[0].split(/\s+/);
      // A later house number inside the match: the address starts there.
      var inner = -1;
      for (var i = tokens.length - 2; i >= 1; i--) {
        if (HOUSE_NUMBER.test(tokens[i])) { inner = i; break; }
      }
      if (inner > 0) {
        var off = 0;
        for (var j = 0; j < inner; j++) off = m[0].indexOf(tokens[j + 1], off + tokens[j].length);
        ADDRESS_RE.lastIndex = start + off;
        continue;
      }
      var prev = start > 0 ? text[start - 1] : '';
      var lower = m[0].toLowerCase().split(/\s+/);
      var words = lower.slice(1, -1);
      // "1 The Embarcadero": "the" is part of the street name there.
      if (lower[lower.length - 1] === 'embarcadero') words = words.filter(function (w) { return w !== 'the'; });
      var stopped = words.some(function (w) { return STOP[w.replace(/[.'-]/g, '')]; });
      if (/[$\d.,:/#-]/.test(prev) || stopped) {
        // Resume right after the number, so "Terminal 2 at 1 World Way" still
        // finds the address.
        ADDRESS_RE.lastIndex = start + tokens[0].length;
        continue;
      }
      var tail = TAIL_RE.exec(text.slice(start + m[0].length));
      var end = start + m[0].length + (tail ? tail[0].length : 0);
      if (start > last) out.push({ kind: 'text', text: text.slice(last, start) });
      out.push({ kind: 'address', text: text.slice(start, end) });
      last = end;
      ADDRESS_RE.lastIndex = end;
    }
    if (last < text.length) out.push({ kind: 'text', text: text.slice(last) });
  }

  function split(text) {
    text = String(text || '');
    var out = [];
    var last = 0;
    var m;
    LINK_RE.lastIndex = 0;
    while ((m = LINK_RE.exec(text))) {
      var raw = trimLinkTail(m[0]);
      var url = raw ? safeUrl(raw) : null;
      var start = m.index;
      // A host that runs on into a longer one is not ours: no link at all.
      var next = text.slice(start + raw.length, start + raw.length + 2);
      if (!raw || !url || next.charAt(0) === '@' || /^\.\w/.test(next)) continue;
      if (start > last) addressSegments(text.slice(last, start), out);
      out.push({ kind: 'link', text: raw, url: url });
      last = start + raw.length;
      LINK_RE.lastIndex = last;
    }
    if (last < text.length) addressSegments(text.slice(last), out);
    return out;
  }

  /** Replace node's content with the text, addresses and links made
   *  tappable. A message with nothing to tap is set as plain text. */
  function fill(node, text) {
    var segs = split(text);
    if (!segs.some(function (s) { return s.kind !== 'text'; })) { node.textContent = String(text || ''); return; }
    node.textContent = '';
    segs.forEach(function (s) {
      if (s.kind === 'text') { node.appendChild(document.createTextNode(s.text)); return; }
      var a = document.createElement('a');
      a.className = 'sscl';
      a.textContent = s.text;
      a.href = s.kind === 'address'
        ? 'https://www.google.com/maps/search/?api=1&query=' + encodeURIComponent(s.text)
        : s.url;
      a.target = '_blank';
      a.rel = 'noopener noreferrer';
      a.title = s.kind === 'address' ? 'Open in Maps' : 'Open link';
      node.appendChild(a);
    });
  }

  window.SSChatLinks = { split: split, fill: fill, safeUrl: safeUrl };
})();
