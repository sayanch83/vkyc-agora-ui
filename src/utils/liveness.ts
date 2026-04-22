// src/utils/liveness.ts
// Real passive liveness using MediaPipe FaceMesh
// Analyses: face presence, eye openness, head pose, blink detection, texture variance

let _faceMesh: any = null;

async function loadMediaPipe(): Promise<any> {
  if (_faceMesh) return _faceMesh;

  // Load MediaPipe scripts
  const scripts = [
    'https://cdn.jsdelivr.net/npm/@mediapipe/camera_utils/camera_utils.js',
    'https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/face_mesh.js',
  ];

  for (const src of scripts) {
    if (document.querySelector(`script[src="${src}"]`)) continue;
    await new Promise<void>((res, rej) => {
      const s = document.createElement('script');
      s.src = src; s.crossOrigin = 'anonymous';
      s.onload = () => res(); s.onerror = () => rej(new Error('Failed: ' + src));
      document.head.appendChild(s);
    });
  }

  const FaceMesh = (window as any).FaceMesh;
  if (!FaceMesh) throw new Error('MediaPipe FaceMesh not available');

  _faceMesh = new FaceMesh({
    locateFile: (f: string) =>
      `https://cdn.jsdelivr.net/npm/@mediapipe/face_mesh/${f}`
  });

  _faceMesh.setOptions({
    maxNumFaces: 1,
    refineLandmarks: true,
    minDetectionConfidence: 0.5,
    minTrackingConfidence: 0.5,
  });

  await _faceMesh.initialize();
  return _faceMesh;
}

// Eye Aspect Ratio — measures how open the eye is
// Landmarks: 6 points per eye from MediaPipe 468-point mesh
function eyeAspectRatio(landmarks: any[], indices: number[]): number {
  const p = (i: number) => landmarks[i];
  // vertical distances
  const v1 = Math.hypot(p(indices[1]).x - p(indices[5]).x, p(indices[1]).y - p(indices[5]).y);
  const v2 = Math.hypot(p(indices[2]).x - p(indices[4]).x, p(indices[2]).y - p(indices[4]).y);
  // horizontal distance
  const h  = Math.hypot(p(indices[0]).x - p(indices[3]).x, p(indices[0]).y - p(indices[3]).y);
  return h > 0 ? (v1 + v2) / (2 * h) : 0;
}

// Head pose — yaw from nose tip vs face centre
function getHeadYaw(landmarks: any[]): number {
  const noseTip    = landmarks[4];
  const leftEar    = landmarks[234];
  const rightEar   = landmarks[454];
  const faceCenter = { x: (leftEar.x + rightEar.x) / 2, y: (leftEar.y + rightEar.y) / 2 };
  return (noseTip.x - faceCenter.x) * 100; // negative = looking left, positive = right
}

// Texture variance — measures image sharpness (blurry = spoof photo)
function textureVariance(canvas: HTMLCanvasElement, x: number, y: number, w: number, h: number): number {
  const ctx = canvas.getContext('2d');
  if (!ctx) return 0;
  const data = ctx.getImageData(x, y, w, h).data;
  let sum = 0, sumSq = 0, n = 0;
  for (let i = 0; i < data.length; i += 4) {
    const gray = 0.299 * data[i] + 0.587 * data[i+1] + 0.114 * data[i+2];
    sum += gray; sumSq += gray * gray; n++;
  }
  const mean = sum / n;
  return sumSq / n - mean * mean; // variance
}

export interface LivenessResult {
  score: number;         // 0-100
  faceDetected: boolean;
  eyesOpen: boolean;
  headCentered: boolean;
  textureOk: boolean;
  blinkDetected: boolean;
  details: string;
}

// Capture a snapshot from video into canvas and return as ImageBitmap
async function captureFrame(videoEl: HTMLVideoElement, canvas: HTMLCanvasElement): Promise<boolean> {
  if (!videoEl || videoEl.readyState < 2) return false;
  const ctx = canvas.getContext('2d');
  if (!ctx) return false;
  try {
    ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
    return true;
  } catch(e) {
    return false;
  }
}

// Analyse a single video frame for liveness signals
export async function analyseFrame(
  videoEl: HTMLVideoElement,
  canvas: HTMLCanvasElement
): Promise<LivenessResult> {
  const mesh = await loadMediaPipe();

  // Capture frame to canvas first to avoid cross-origin issues with MediaStream
  const ok = await captureFrame(videoEl, canvas);
  if (!ok) {
    return { score: 30, faceDetected: false, eyesOpen: false,
      headCentered: false, textureOk: false, blinkDetected: false,
      details: 'Could not capture frame' };
  }

  return new Promise((resolve) => {
    mesh.onResults((results: any) => {
      if (!results.multiFaceLandmarks?.length) {
        // No face — but check texture variance to detect blank/test scenarios
        const variance = textureVariance(canvas, 0, 0, canvas.width, canvas.height);
        resolve({ score: 10, faceDetected: false, eyesOpen: false,
          headCentered: false, textureOk: variance > 50, blinkDetected: false,
          details: 'No face detected - Var:' + variance.toFixed(0) });
        return;
      }

      const lm = results.multiFaceLandmarks[0];

      // Eye Aspect Ratio — normalise by face width for scale-independence
      const faceWidth = Math.hypot(
        lm[234].x - lm[454].x, lm[234].y - lm[454].y
      );
      const leftEAR  = eyeAspectRatio(lm, [362,385,387,263,373,380]) / (faceWidth + 0.001);
      const rightEAR = eyeAspectRatio(lm, [33,160,158,133,153,144]) / (faceWidth + 0.001);
      const avgEAR   = (leftEAR + rightEAR) / 2;
      // Threshold tuned for normalised EAR — lower threshold for video streams
      const eyesOpen    = avgEAR > 0.08;
      const blinkDetect = avgEAR < 0.05;

      // Head pose
      const yaw          = getHeadYaw(lm);
      const headCentered = Math.abs(yaw) < 20;

      // Texture variance — measure sharpness
      const variance = textureVariance(canvas, 
        Math.floor(canvas.width*0.25), Math.floor(canvas.height*0.15),
        Math.floor(canvas.width*0.5),  Math.floor(canvas.height*0.6));
      const textureOk = variance > 40;

      const scores = {
        faceDetected: 35,
        eyesOpen:     eyesOpen ? 25 : 5,
        headCentered: headCentered ? 20 : 8,
        texture:      textureOk ? 20 : 5,
      };
      const total = Object.values(scores).reduce((a,b) => a+b, 0);

      console.log('[Liveness] EAR:', avgEAR.toFixed(3), 'Yaw:', yaw.toFixed(1), 
        'Var:', variance.toFixed(0), 'Eyes:', eyesOpen, 'Score:', total);

      resolve({
        score: Math.min(100, total),
        faceDetected: true,
        eyesOpen,
        headCentered,
        textureOk,
        blinkDetected: blinkDetect,
        details: `EAR:${avgEAR.toFixed(3)} Yaw:${yaw.toFixed(1)} Var:${variance.toFixed(0)}`
      });
    });

    // Send canvas image (not video) to MediaPipe — avoids cross-origin issues
    mesh.send({ image: canvas });
  });
}

// Run continuous liveness analysis over N seconds
// Returns final score based on aggregated signals
export async function runPassiveLiveness(
  videoEl: HTMLVideoElement,
  durationMs = 6000,
  onProgress?: (pct: number, partial: LivenessResult) => void
): Promise<LivenessResult> {
  const canvas = document.createElement('canvas');
  canvas.width = 320; canvas.height = 240;

  const results: LivenessResult[] = [];
  let blinkSeen = false;
  const start = Date.now();
  const interval = 500; // analyse every 500ms

  while (Date.now() - start < durationMs) {
    // Draw current frame to canvas before analysis
    try {
      const ctx = canvas.getContext('2d');
      if (ctx && videoEl.readyState >= 2) {
        ctx.drawImage(videoEl, 0, 0, canvas.width, canvas.height);
      }
    } catch(e) {}
    const r = await analyseFrame(videoEl, canvas);
    if (r.blinkDetected) blinkSeen = true;
    results.push(r);
    const pct = Math.min(100, Math.round(((Date.now()-start)/durationMs)*100));
    onProgress?.(pct, r);
    await new Promise(res => setTimeout(res, interval));
  }

  // Aggregate
  const detected     = results.filter(r => r.faceDetected).length;
  const eyesOpenPct  = results.filter(r => r.eyesOpen).length / results.length;
  const centeredPct  = results.filter(r => r.headCentered).length / results.length;
  const texturePct   = results.filter(r => r.textureOk).length / results.length;
  const avgScore     = results.reduce((a,r) => a+r.score, 0) / results.length;

  // Blink bonus — real humans blink, photos don't
  const blinkBonus   = blinkSeen ? 5 : -10;
  const finalScore   = Math.min(100, Math.max(0, Math.round(avgScore + blinkBonus)));

  return {
    score: finalScore,
    faceDetected: detected > results.length * 0.7,
    eyesOpen: eyesOpenPct > 0.5,
    headCentered: centeredPct > 0.5,
    textureOk: texturePct > 0.5,
    blinkDetected: blinkSeen,
    details: `${detected}/${results.length} frames · blink:${blinkSeen} · score:${finalScore}`
  };
}
