// /js/ss-photo-zoom.js
//
// Click a driver's or rider's photo to see it bigger (Justin, 2026-10-04: "if
// a driver or passenger clicks on their driver or passenger picture, the pic
// get larger? (both web and app)"). The app twin is
// SeatSherpaApp/components/photo-zoom.tsx.
//
// Pages call SSPhotoZoom.mark(img, name) on a photo once its src is set. One
// listener on the document handles every marked photo, including ones drawn
// later, and runs before the page's own row handlers, so a click on the photo
// enlarges it instead of doing what the row does.
//
// Close: click anywhere, the Close button, or Escape. Focus goes back to the
// photo. The src is the one the page already set (pages only ever assign
// https URLs), and the name is set as text, never as HTML.
//
// Load it in <head>, before the page scripts, so SSPhotoZoom exists by the
// time a page draws its first photo. Used on ride.html, trips.html and
// driving.html.
(function () {
  if (window.SSPhotoZoom) return;

  var css =
    '.ss-zoomable{cursor:zoom-in;}' +
    '.ss-zoomable:focus-visible{outline:2px solid #00D4C8;outline-offset:2px;}' +
    '.ss-zoom{position:fixed;inset:0;z-index:2147483000;background:rgba(0,0,0,0.92);' +
    'display:flex;flex-direction:column;align-items:center;justify-content:center;gap:14px;' +
    'padding:64px 16px 32px;box-sizing:border-box;cursor:zoom-out;}' +
    // The same circle as the small avatar, only bigger (Justin, 2026-10-07):
    // a centered square crop, so enlarging never shows more of the photo.
    '.ss-zoom img{display:block;width:min(92vw,560px,72vh);height:min(92vw,560px,72vh);' +
    'border-radius:50%;object-fit:cover;object-position:center;background:#17171d;}' +
    '.ss-zoom-name{color:#fff;font-size:18px;font-weight:700;line-height:1.3;text-align:center;' +
    'max-width:92vw;overflow:hidden;text-overflow:ellipsis;white-space:nowrap;}' +
    '.ss-zoom-close{position:absolute;top:16px;right:16px;width:44px;height:44px;border-radius:50%;' +
    'border:1px solid rgba(255,255,255,0.25);background:rgba(255,255,255,0.12);color:#fff;' +
    'font-size:24px;line-height:1;cursor:pointer;display:flex;align-items:center;justify-content:center;padding:0;}' +
    '.ss-zoom-close:focus-visible{outline:2px solid #00D4C8;outline-offset:2px;}';
  var style = document.createElement('style');
  style.textContent = css;
  (document.head || document.documentElement).appendChild(style);

  var overlay = null;
  var opener = null;
  var savedOverflow = '';

  function nameOf(img) {
    return String(img.getAttribute('data-zoom-name') || '').trim();
  }

  function close() {
    if (!overlay) return;
    overlay.remove();
    overlay = null;
    document.documentElement.style.overflow = savedOverflow;
    document.removeEventListener('keydown', onKey, true);
    if (opener && document.contains(opener)) {
      try { opener.focus({ preventScroll: true }); } catch (e) { /* old browser */ }
    }
    opener = null;
  }

  function onKey(e) {
    if (e.key === 'Escape') {
      e.preventDefault();
      close();
    } else if (e.key === 'Tab' && overlay) {
      // The Close button is the only control: keep focus on it.
      e.preventDefault();
      var b = overlay.querySelector('.ss-zoom-close');
      if (b) b.focus();
    }
  }

  function open(img) {
    if (overlay) close();
    var name = nameOf(img);
    opener = img;

    overlay = document.createElement('div');
    overlay.className = 'ss-zoom';
    overlay.setAttribute('role', 'dialog');
    overlay.setAttribute('aria-modal', 'true');
    overlay.setAttribute('aria-label', name ? name + "'s photo" : 'Photo');

    var big = document.createElement('img');
    big.src = img.currentSrc || img.src;
    // The same crop as the avatar that was tapped (bug check 2026-10-07): the
    // trips and driving avatars anchor at 50% 25%, so a centered zoom showed a
    // lower slice of a portrait photo and could cut off the face.
    try {
      var pos = window.getComputedStyle(img).objectPosition;
      if (pos) big.style.objectPosition = pos;
    } catch (_) { /* keep the default center */ }
    big.alt = name ? name + "'s photo" : 'Photo';
    overlay.appendChild(big);

    if (name) {
      var cap = document.createElement('div');
      cap.className = 'ss-zoom-name';
      cap.textContent = name;
      overlay.appendChild(cap);
    }

    var btn = document.createElement('button');
    btn.type = 'button';
    btn.className = 'ss-zoom-close';
    btn.setAttribute('aria-label', 'Close');
    btn.textContent = String.fromCharCode(215); // the multiplication sign, kept ASCII-only in the file
    overlay.appendChild(btn);

    // Any click on the overlay closes it, the button included.
    overlay.addEventListener('click', function (e) {
      e.preventDefault();
      e.stopPropagation();
      close();
    });

    savedOverflow = document.documentElement.style.overflow;
    document.documentElement.style.overflow = 'hidden';
    document.body.appendChild(overlay);
    document.addEventListener('keydown', onKey, true);
    try { btn.focus({ preventScroll: true }); } catch (e) { btn.focus(); }
  }

  function zoomTarget(e) {
    var t = e.target;
    if (!t || !t.closest) return null;
    var img = t.closest('img[data-zoom]');
    // A photo that failed to load has nothing to show (pages swap it for the
    // initial anyway).
    if (!img || !img.src || !img.complete || img.naturalWidth === 0) return null;
    return img;
  }

  // Capture phase: runs before a row's own click handler.
  document.addEventListener('click', function (e) {
    var img = zoomTarget(e);
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    open(img);
  }, true);

  document.addEventListener('keydown', function (e) {
    if (e.key !== 'Enter' && e.key !== ' ') return;
    var img = zoomTarget(e);
    if (!img) return;
    e.preventDefault();
    e.stopPropagation();
    open(img);
  }, true);

  window.SSPhotoZoom = {
    /** Make a photo enlargeable. name: the display name shown elsewhere ("Hiba A."). */
    mark: function (img, name) {
      if (!img) return;
      var n = String(name || '').trim();
      img.setAttribute('data-zoom', '');
      img.setAttribute('data-zoom-name', n);
      img.setAttribute('tabindex', '0');
      img.setAttribute('role', 'button');
      img.setAttribute('aria-label', n ? 'Enlarge ' + n + "'s photo" : 'Enlarge photo');
      img.classList.add('ss-zoomable');
    },
    open: open,
    close: close,
  };
})();
