// /js/ss-stops.js — the stop catalog + loose geometric suggester, shared by
// the web surfaces that deal in en-route stops (driving.html's stops editor;
// post.html still carries its own inline copy — fold it in when next touched).
//
// MIRROR RULE: DESTS/WAYPOINTS mirror the app's lib/destinations.ts +
// lib/route-fill.ts WAYPOINTS and the server's web-posting.ts STOP_CATALOG.
// Adding/moving an entry means updating all of them (see the note on
// DESTINATIONS in the app repo).
//
// The suggester here is the LOOSE straight-line envelope (no Mapbox call):
// ≥25 mi from both endpoints, straight-line detour ≤20 mi, 4–96% along the
// route projection — the same pre-filter post.html applies before its
// drive-time pass, and strictly inside the server's validation envelope
// (web-posting.ts validateStops: detour ≤30). Classic script on purpose so
// non-module pages can consume it: everything hangs off window.SS_STOPS.
(function () {
  var DESTS = [
    { id: 'sfba', name: 'San Francisco Bay Area', lat: 37.6688, lng: -122.0808 },
    { id: 'sanjose', name: 'San Jose', lat: 37.3382, lng: -121.8863 },
    { id: 'napasonoma', name: 'Napa / Sonoma', lat: 38.2975, lng: -122.372 },
    { id: 'sacramento', name: 'Sacramento', lat: 38.5816, lng: -121.4944 },
    { id: 'tahoereno', name: 'Tahoe / Reno', lat: 39.3, lng: -119.92 },
    { id: 'la', name: 'Los Angeles', lat: 34.0522, lng: -118.2437 },
    { id: 'oc', name: 'Orange County', lat: 33.7175, lng: -117.8311 },
    { id: 'sd', name: 'San Diego', lat: 32.7157, lng: -117.1611 },
    { id: 'palm', name: 'Palm Springs', lat: 33.8303, lng: -116.5453 },
    { id: 'vegas', name: 'Las Vegas', lat: 36.1699, lng: -115.1398 },
    { id: 'manteca', name: 'Manteca', lat: 37.7974, lng: -121.2161 },
    { id: 'fresno', name: 'Fresno', lat: 36.7378, lng: -119.7871 },
    { id: 'santacruz', name: 'Santa Cruz', lat: 36.9741, lng: -122.0308 },
    { id: 'bakersfield', name: 'Bakersfield', lat: 35.3733, lng: -119.0187 },
    { id: 'slo', name: 'San Luis Obispo', lat: 35.2828, lng: -120.6596 },
    { id: 'santabarbara', name: 'Santa Barbara', lat: 34.4208, lng: -119.6982 },
    { id: 'burningman', name: 'Burning Man', lat: 40.7864, lng: -119.2065 },
  ];
  var WAYPOINTS = [
    { id: 'oakland', name: 'Oakland', lat: 37.8044, lng: -122.2712 },
    { id: 'fremont', name: 'Fremont', lat: 37.509, lng: -121.964 },
    { id: 'pleasanton', name: 'Pleasanton / Livermore', lat: 37.702, lng: -121.771 },
    { id: 'stockton', name: 'Stockton', lat: 37.9577, lng: -121.2908 },
    { id: 'modesto', name: 'Modesto', lat: 37.6391, lng: -120.9969 },
    { id: 'pasadena', name: 'Pasadena', lat: 34.1478, lng: -118.1445 },
    { id: 'longbeach', name: 'Long Beach', lat: 33.7701, lng: -118.1937 },
  ];
  var STOP_BY_ID = {};
  DESTS.concat(WAYPOINTS).forEach(function (d) { STOP_BY_ID[d.id] = d; });

  function haversineMiles(a, b) {
    if (!a || !b || !isFinite(a.lat) || !isFinite(b.lat)) return 0;
    var R = 3958.8;
    var toRad = function (d) { return (d * Math.PI) / 180; };
    var dLat = toRad(b.lat - a.lat), dLng = toRad(b.lng - a.lng);
    var h = Math.sin(dLat / 2) * Math.sin(dLat / 2)
      + Math.cos(toRad(a.lat)) * Math.cos(toRad(b.lat)) * Math.sin(dLng / 2) * Math.sin(dLng / 2);
    return 2 * R * Math.asin(Math.sqrt(h));
  }

  function routeT(start, end, p) {
    var dx = end.lng - start.lng, dy = end.lat - start.lat;
    var len2 = dx * dx + dy * dy || 1;
    return ((p.lng - start.lng) * dx + (p.lat - start.lat) * dy) / len2;
  }

  /** Loose geometric candidates between start and end, sorted along the
   *  route. Every result satisfies the server's validation envelope. */
  function looseSuggest(start, end) {
    var direct = haversineMiles(start, end);
    if (!isFinite(direct) || direct < 50) return [];
    var out = [];
    DESTS.concat(WAYPOINTS).forEach(function (c) {
      if (c.id === 'burningman') return;
      if (out.some(function (p) { return p.id === c.id; })) return;
      var toStart = haversineMiles(start, c), toEnd = haversineMiles(end, c);
      if (toStart < 25 || toEnd < 25) return;
      if (toStart + toEnd - direct > 20) return;
      var t = routeT(start, end, c);
      if (t < 0.04 || t > 0.96) return;
      out.push({ id: c.id, name: c.name, lat: c.lat, lng: c.lng, t: t });
    });
    out.sort(function (a, b) { return a.t - b.t; });
    return out;
  }

  window.SS_STOPS = {
    DESTS: DESTS,
    WAYPOINTS: WAYPOINTS,
    STOP_BY_ID: STOP_BY_ID,
    haversineMiles: haversineMiles,
    routeT: routeT,
    looseSuggest: looseSuggest,
    stopName: function (idOrObj) {
      if (idOrObj && typeof idOrObj === 'object') return idOrObj.name || '';
      return (STOP_BY_ID[idOrObj] || {}).name || String(idOrObj || '');
    },
  };
})();
