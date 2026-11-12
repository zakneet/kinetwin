/**
 * Live tracking engine: webcam → MediaPipe Hand Landmarker → landmark
 * smoothing → biomechanical analysis → liveHub.
 *
 * Runs outside React. All processing happens in this browser tab; the video
 * stream is never recorded, stored or transmitted.
 */
import type { HandLandmarker } from '@mediapipe/tasks-vision';
import { analyzeFrame } from '../lib/analysis';
import { sanitizeLandmarks, type Handedness, type HandFrame } from '../lib/landmarks';
import { LandmarkSmoother, type OneEuroParams } from '../lib/smoothing';
import { resolveHandedness } from '../lib/transforms';
import { appStore, type SmoothingLevel } from '../state/appStore';
import { liveHub } from '../state/frameHub';
import { createStore } from '../state/store';
import { createHandLandmarker, type Delegate } from './landmarker';

export type EngineStatus = 'idle' | 'requesting-camera' | 'loading-model' | 'running' | 'error';
export type HandState = 'none' | 'searching' | 'tracking' | 'lost' | 'recovered';

export interface EngineError {
  title: string;
  detail: string;
}

export interface TrackingState {
  status: EngineStatus;
  progress: string;
  error: EngineError | null;
  delegate: Delegate | null;
  modelSource: string | null;
  handState: HandState;
  handedness: Handedness | null;
  score: number;
  /** Processed frames per second. */
  fps: number;
  /** Mean inference time (ms). */
  inferenceMs: number;
  /** Fraction of processed frames with a hand over the last ~2 s. */
  continuity: number;
  videoWidth: number;
  videoHeight: number;
  cameraLabel: string;
}

export const trackingStore = createStore<TrackingState>({
  status: 'idle',
  progress: '',
  error: null,
  delegate: null,
  modelSource: null,
  handState: 'none',
  handedness: null,
  score: 0,
  fps: 0,
  inferenceMs: 0,
  continuity: 0,
  videoWidth: 0,
  videoHeight: 0,
  cameraLabel: '',
});

const SMOOTHING: Record<SmoothingLevel, { norm: OneEuroParams; world: OneEuroParams }> = {
  // World landmarks are in metres (finger speeds ~0.1–0.5 m/s) so they need a larger beta than
  // normalized image coordinates to react equally fast.
  low: { norm: { minCutoff: 3.0, beta: 6, dCutoff: 1 }, world: { minCutoff: 3.0, beta: 40, dCutoff: 1 } },
  medium: { norm: { minCutoff: 1.5, beta: 4, dCutoff: 1 }, world: { minCutoff: 1.5, beta: 25, dCutoff: 1 } },
  high: { norm: { minCutoff: 0.7, beta: 2, dCutoff: 1 }, world: { minCutoff: 0.7, beta: 12, dCutoff: 1 } },
};

function describeCameraError(e: unknown): EngineError {
  const name = e instanceof DOMException || e instanceof Error ? e.name : '';
  switch (name) {
    case 'NotAllowedError':
    case 'PermissionDeniedError':
      return {
        title: 'Camera access was blocked',
        detail: 'Allow camera access for this page (camera icon in the address bar), then select Start camera again.',
      };
    case 'NotFoundError':
    case 'DevicesNotFoundError':
    case 'OverconstrainedError':
      return { title: 'No camera found', detail: 'Connect a webcam or enable the built-in camera, then try again.' };
    case 'NotReadableError':
    case 'TrackStartError':
      return { title: 'The camera is busy', detail: 'Another application is using the camera. Close it and try again.' };
    case 'SecurityError':
      return { title: 'Camera needs a secure page', detail: 'Open KineTwin from http://localhost or over HTTPS.' };
    default:
      return { title: 'The camera could not start', detail: e instanceof Error ? e.message : String(e) };
  }
}

class TrackingEngine {
  private video: HTMLVideoElement | null = null;
  private stream: MediaStream | null = null;
  private handle: { landmarker: HandLandmarker; delegate: Delegate } | null = null;
  private raf = 0;
  private lastVideoTime = -1;
  private lastTimestamp = 0;
  private normSmoother = new LandmarkSmoother(SMOOTHING.medium.norm);
  private worldSmoother = new LandmarkSmoother(SMOOTHING.medium.world);
  private smoothingLevel: SmoothingLevel = 'medium';
  private presence: { t: number; present: boolean }[] = [];
  private lastHandAt = 0;
  private wasLost = false;
  private recoveredAt = 0;
  private frameTimes: number[] = [];
  private inferenceEma = 0;
  private lastUiUpdate = 0;
  private runId = 0;

  /** The hidden <video> element that receives the webcam stream (used by the 2D preview). */
  getVideo(): HTMLVideoElement | null {
    return this.video;
  }

  private ensureVideo(): HTMLVideoElement {
    if (this.video) return this.video;
    const v = document.createElement('video');
    v.muted = true;
    v.playsInline = true;
    v.autoplay = true;
    v.setAttribute('aria-hidden', 'true');
    // Kept in the DOM (some browsers throttle detached videos) but invisible.
    Object.assign(v.style, { position: 'fixed', width: '2px', height: '2px', opacity: '0', pointerEvents: 'none', left: '0', top: '0' });
    document.body.appendChild(v);
    this.video = v;
    return v;
  }

  async start(): Promise<void> {
    const st = trackingStore.get().status;
    if (st === 'running' || st === 'requesting-camera' || st === 'loading-model') return;
    const run = ++this.runId;
    trackingStore.set({ status: 'requesting-camera', progress: 'Waiting for camera permission', error: null, handState: 'none' });

    if (!navigator.mediaDevices?.getUserMedia) {
      trackingStore.set({ status: 'error', error: { title: 'Camera not available', detail: 'This browser does not expose a camera API on this page. Use a recent Chrome, Edge or Firefox on http://localhost.' } });
      return;
    }

    try {
      this.stream = await navigator.mediaDevices.getUserMedia({
        audio: false,
        video: { facingMode: 'user', width: { ideal: 960 }, height: { ideal: 540 }, frameRate: { ideal: 30, max: 60 } },
      });
    } catch (e) {
      if (run !== this.runId) return;
      trackingStore.set({ status: 'error', error: describeCameraError(e), progress: '' });
      return;
    }
    if (run !== this.runId) {
      this.stopStream();
      return;
    }

    const video = this.ensureVideo();
    video.srcObject = this.stream;
    try {
      await video.play();
    } catch (e) {
      this.stopStream();
      trackingStore.set({ status: 'error', error: { title: 'The video stream could not start', detail: e instanceof Error ? e.message : String(e) } });
      return;
    }
    const track = this.stream.getVideoTracks()[0];
    trackingStore.set({ cameraLabel: track?.label ?? 'Camera', videoWidth: video.videoWidth, videoHeight: video.videoHeight });

    if (!this.handle) {
      trackingStore.set({ status: 'loading-model', progress: 'Loading hand tracking model' });
      try {
        const h = await createHandLandmarker((msg) => trackingStore.set({ progress: msg }));
        if (run !== this.runId) {
          h.landmarker.close();
          return;
        }
        this.handle = h;
        trackingStore.set({ delegate: h.delegate, modelSource: `${h.modelSource} model · ${h.wasmSource} runtime` });
      } catch (e) {
        this.stopStream();
        trackingStore.set({
          status: 'error',
          error: {
            title: 'The hand tracking model could not load',
            detail: `${e instanceof Error ? e.message : String(e)}. Check the network connection for the first load, then retry.`,
          },
        });
        return;
      }
    }

    this.resetTracking();
    trackingStore.set({ status: 'running', progress: '', handState: 'searching' });
    this.loop();
  }

  stop(): void {
    this.runId++;
    cancelAnimationFrame(this.raf);
    this.stopStream();
    this.resetTracking();
    liveHub.publish(null);
    trackingStore.set({ status: 'idle', handState: 'none', handedness: null, score: 0, fps: 0, continuity: 0, progress: '' });
  }

  private stopStream(): void {
    this.stream?.getTracks().forEach((t) => t.stop());
    this.stream = null;
    if (this.video) this.video.srcObject = null;
  }

  private resetTracking(): void {
    this.normSmoother.reset();
    this.worldSmoother.reset();
    this.presence = [];
    this.frameTimes = [];
    this.lastVideoTime = -1;
    this.wasLost = false;
    this.lastHandAt = 0;
  }

  private applySmoothingLevel(): void {
    const level = appStore.get().smoothing;
    if (level === this.smoothingLevel) return;
    this.smoothingLevel = level;
    this.normSmoother = new LandmarkSmoother(SMOOTHING[level].norm);
    this.worldSmoother = new LandmarkSmoother(SMOOTHING[level].world);
  }

  private loop = (): void => {
    this.raf = requestAnimationFrame(this.loop);
    const video = this.video;
    const handle = this.handle;
    if (!video || !handle || video.readyState < 2) return;
    if (video.currentTime === this.lastVideoTime) return; // no new camera frame yet
    this.lastVideoTime = video.currentTime;

    let now = performance.now();
    if (now <= this.lastTimestamp) now = this.lastTimestamp + 0.01; // MediaPipe needs strictly increasing timestamps
    this.lastTimestamp = now;

    let result;
    const t0 = performance.now();
    try {
      result = handle.landmarker.detectForVideo(video, now);
    } catch (e) {
      console.error('[KineTwin] detectForVideo failed', e);
      void this.recoverFromRuntimeError(e);
      return;
    }
    const inf = performance.now() - t0;
    this.inferenceEma = this.inferenceEma === 0 ? inf : this.inferenceEma * 0.9 + inf * 0.1;
    this.frameTimes.push(now);
    while (this.frameTimes.length && now - this.frameTimes[0] > 1000) this.frameTimes.shift();

    this.applySmoothingLevel();
    const lmRaw = sanitizeLandmarks(result.landmarks?.[0]);
    const wRaw = sanitizeLandmarks(result.worldLandmarks?.[0]);
    const cat = result.handedness?.[0]?.[0];
    const handedness = resolveHandedness(cat?.categoryName, { inputMirrored: false, swap: appStore.get().swapHandedness });
    const present = !!(lmRaw && wRaw && handedness);

    this.presence.push({ t: now, present });
    while (this.presence.length && now - this.presence[0].t > 2000) this.presence.shift();

    let handState: HandState = trackingStore.get().handState;
    if (present) {
      if (this.wasLost) {
        this.wasLost = false;
        this.recoveredAt = now;
        this.normSmoother.reset();
        this.worldSmoother.reset();
      }
      this.lastHandAt = now;
      handState = now - this.recoveredAt < 1500 ? 'recovered' : 'tracking';
      const frame: HandFrame = {
        t: now,
        landmarks: this.normSmoother.smooth(lmRaw!, now),
        world: this.worldSmoother.smooth(wRaw!, now),
        handedness: handedness!,
        handednessScore: cat?.score ?? 0,
      };
      liveHub.publish({ frame, analysis: analyzeFrame(frame), at: now });
    } else {
      if (this.lastHandAt > 0 && now - this.lastHandAt > 300) {
        this.wasLost = true;
        handState = 'lost';
      } else if (this.lastHandAt === 0) {
        handState = 'searching';
      }
      if (liveHub.current && now - this.lastHandAt > 300) liveHub.publish(null);
    }

    if (now - this.lastUiUpdate > 150) {
      this.lastUiUpdate = now;
      const n = this.presence.length;
      trackingStore.set({
        handState,
        handedness: present ? handedness : trackingStore.get().handedness,
        score: present ? cat?.score ?? 0 : 0,
        fps: this.frameTimes.length,
        inferenceMs: Math.round(this.inferenceEma * 10) / 10,
        continuity: n ? this.presence.filter((p) => p.present).length / n : 0,
        videoWidth: video.videoWidth,
        videoHeight: video.videoHeight,
      });
    } else if (handState !== trackingStore.get().handState) {
      trackingStore.set({ handState });
    }
  };

  private async recoverFromRuntimeError(e: unknown): Promise<void> {
    cancelAnimationFrame(this.raf);
    const failed = this.handle;
    this.handle = null;
    if (failed?.delegate === 'GPU') {
      trackingStore.set({ status: 'loading-model', progress: 'GPU inference failed — switching to CPU' });
      try {
        failed.landmarker.close();
      } catch {
        /* ignore */
      }
      try {
        const h = await createHandLandmarker((msg) => trackingStore.set({ progress: msg }), true);
        this.handle = h;
        this.resetTracking();
        trackingStore.set({ status: 'running', delegate: 'CPU', progress: '' });
        this.loop();
        return;
      } catch (e2) {
        e = e2;
      }
    }
    this.stopStream();
    trackingStore.set({ status: 'error', error: { title: 'Hand tracking stopped', detail: e instanceof Error ? e.message : String(e) } });
  }
}

export const engine = new TrackingEngine();
