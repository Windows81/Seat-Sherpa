// ss-photo-check.js — REAL-PHOTO gate shared by every web avatar picker
// (account.html, book.html, post.html). Justin, 2026-09-07: "the app is
// accepting AI photos". The face detector only asks "is there a face"; this
// asks the vision model (read-document task:'avatar') whether the image is a
// camera photograph of a real person.
//
// Contract: resolves { ok:true, realPhoto:boolean } — realPhoto is false ONLY
// on a confident "no" from the server. Any failure (offline, no session, the
// function erroring or failing open) resolves realPhoto:true so an outage
// never stops someone finishing their profile. Never throws.
//
// Deliberately does not import ss-session.js: post.html and requests.html run
// their own auth client, and a second client on the same storage key is the
// thing that module's header says never to do. The caller passes the token.

const SUPA = 'https://vmfmbntacifqoqxqxgsk.supabase.co';
const ANON = 'sb_publishable_TGebz9q_z0kkH0Tuivlr4w_3MPLMxF3';

export const NOT_REAL_PHOTO_MESSAGE =
  'That looks like an illustration or a generated image. Riders and drivers need to recognize you at pickup, so your profile photo has to be an actual photo of you.';

function blobToBase64(blob) {
  return new Promise((res, rej) => {
    const fr = new FileReader();
    fr.onload = () => res(String(fr.result).split(',')[1] || '');
    fr.onerror = rej;
    fr.readAsDataURL(blob);
  });
}

/**
 * @param {Blob} blob   the downscaled JPEG candidate
 * @param {string} accessToken  the signed-in user's access token
 */
export async function checkRealPhoto(blob, accessToken) {
  try {
    if (!blob || !accessToken) return { ok: true, realPhoto: true, checked: false };
    const imageBase64 = await blobToBase64(blob);
    const res = await fetch(SUPA + '/functions/v1/read-document', {
      method: 'POST',
      headers: { apikey: ANON, Authorization: 'Bearer ' + accessToken, 'Content-Type': 'application/json' },
      body: JSON.stringify({ task: 'avatar', imageBase64, mediaType: blob.type === 'image/png' ? 'image/png' : 'image/jpeg' }),
    });
    if (!res.ok) return { ok: true, realPhoto: true, checked: false };
    const j = await res.json().catch(() => null);
    return { ok: true, realPhoto: !(j && j.real_photo === false), checked: !!(j && j.checked) };
  } catch (_) {
    return { ok: true, realPhoto: true, checked: false };
  }
}
