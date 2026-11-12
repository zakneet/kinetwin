import { computeBaseline, type CalibrationSample } from '../lib/calibration';
import type { Handedness } from '../lib/landmarks';
import { appStore, setBaseline } from './appStore';
import { liveHub } from './frameHub';
import { createStore } from './store';

export type CalibPhase = 'idle' | 'countdown' | 'capturing' | 'done' | 'failed' | 'mismatch';

export const calibrationStore = createStore<{
  phase: CalibPhase;
  countdown: number;
  progress: number;
  message: string;
  hand: Handedness;
}>({ phase: 'idle', countdown: 0, progress: 0, message: '', hand: 'Right' });

const CAPTURE_MS = 2500;
const COUNTDOWN_S = 3;
let timer = 0;
let unsub: (() => void) | null = null;

function cleanup() {
  window.clearInterval(timer);
  unsub?.();
  unsub = null;
}

export function cancelCalibration(): void {
  cleanup();
  calibrationStore.set({ phase: 'idle', countdown: 0, progress: 0, message: '' });
}

export function startCalibration(hand: Handedness): void {
  cleanup();
  calibrationStore.set({ phase: 'countdown', countdown: COUNTDOWN_S, progress: 0, message: '', hand });
  let n = COUNTDOWN_S;
  timer = window.setInterval(() => {
    n--;
    if (n > 0) {
      calibrationStore.set({ countdown: n });
      return;
    }
    window.clearInterval(timer);
    capture(hand);
  }, 1000);
}

function capture(hand: Handedness) {
  const samples: CalibrationSample[] = [];
  const t0 = performance.now();
  calibrationStore.set({ phase: 'capturing', progress: 0 });
  unsub = liveHub.subscribe((s) => {
    if (!s) return;
    samples.push({ t: s.at, handedness: s.frame.handedness, score: s.frame.handednessScore, analysis: s.analysis });
  });
  timer = window.setInterval(() => {
    const p = (performance.now() - t0) / CAPTURE_MS;
    calibrationStore.set({ progress: Math.min(1, p) });
    if (p < 1) return;
    cleanup();
    finish(hand, samples);
  }, 100);
}

function finish(hand: Handedness, samples: CalibrationSample[]) {
  if (samples.length > 0) {
    const detected = samples.filter((s) => s.handedness === hand).length;
    if (detected < samples.length / 2) {
      const other = hand === 'Left' ? 'right' : 'left';
      calibrationStore.set({
        phase: 'mismatch',
        message: `MediaPipe labelled this hand as your ${other} hand. If you are showing your ${hand.toLowerCase()} hand, swap the handedness labels and calibrate again.`,
      });
      return;
    }
  }
  const r = computeBaseline(samples.filter((s) => s.handedness === hand));
  if (!r.ok) {
    calibrationStore.set({ phase: 'failed', message: r.reason });
    return;
  }
  setBaseline(r.baseline);
  calibrationStore.set({ phase: 'done', message: `Baseline saved from ${r.baseline.frameCount} frames.` });
}

export function swapHandednessLabels(): void {
  appStore.set((s) => ({ swapHandedness: !s.swapHandedness }));
  calibrationStore.set({ phase: 'idle', message: '' });
}
