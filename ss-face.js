// js/ss-face.js
//
// AVATAR FACE CHECK (2026-08-28, Justin: "did we fix needing to have an
// actual photo of the face for the avatar photo" — a car photo sailed
// through). The app seeds avatars from ML Kit face crops on-device; the web
// gets its own gate: MediaPipe face detection in the browser, loaded lazily
// only when someone reaches a photo step.
//
// FAIL-OPEN BY DESIGN: this is an anti-laziness gate, not an anti-adversary
// one. If the CDN/model can't load (offline-ish, blocked), we must never
// brick a booking over a nicety — the caller gets { ok:false } and proceeds.
// Only an affirmative "we looked and found zero faces" blocks.

let detectorPromise = null;

async function getDetector() {
  if (!detectorPromise) {
    detectorPromise = (async () => {
      const vision = await import('https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/vision_bundle.mjs');
      const files = await vision.FilesetResolver.forVisionTasks(
        'https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@0.10.14/wasm',
      );
      return await vision.FaceDetector.createFromOptions(files, {
        baseOptions: {
          modelAssetPath:
            'https://storage.googleapis.com/mediapipe-models/face_detector/blaze_face_short_range/float16/1/blaze_face_short_range.tflite',
        },
        runningMode: 'IMAGE',
      });
    })();
    // A failed load must not poison every later attempt.
    detectorPromise.catch(() => { detectorPromise = null; });
  }
  return detectorPromise;
}

/** Pre-warm the detector (call when the photo step shows, so the check is
 *  instant by the time a file is picked). Best-effort. */
export function warmup() {
  getDetector().catch(() => {});
}

/**
 * Check a Blob (the downscaled avatar) for a human face.
 * Returns { ok: true, faces: n } when the detector ran, { ok: false } when it
 * couldn't (caller should fail OPEN).
 */
export async function checkFace(blob) {
  let url = null;
  try {
    const det = await getDetector();
    url = URL.createObjectURL(blob);
    const img = await new Promise((res, rej) => {
      const i = new Image();
      i.onload = () => res(i);
      i.onerror = () => rej(new Error('decode'));
      i.src = url;
    });
    const out = det.detect(img);
    return { ok: true, faces: (out.detections || []).length };
  } catch (_) {
    return { ok: false, faces: 0 };
  } finally {
    if (url) URL.revokeObjectURL(url);
  }
}
