/**
 * Camera-free replay of a recorded session. Landmarks are interpolated
 * between recorded frames and re-analysed, then published to replayHub so the
 * same 3D twin and readouts render the recorded movement.
 */
import { analyzeFrame } from '../lib/analysis';
import { sampleSession, type Session } from '../lib/recording';
import { getSession } from '../lib/storage';
import { replayHub } from './frameHub';
import { createStore } from './store';

export interface ReplayState {
  sessionId: string | null;
  session: Session | null;
  playing: boolean;
  time: number;
  duration: number;
  speed: number;
  gap: boolean;
  loading: boolean;
}

export const replayStore = createStore<ReplayState>({
  sessionId: null,
  session: null,
  playing: false,
  time: 0,
  duration: 0,
  speed: 1,
  gap: false,
  loading: false,
});

export const SPEEDS = [0.25, 0.5, 1, 1.5, 2];

let raf = 0;
let last = 0;
let time = 0;
let lastUi = 0;

function publishAt(t: number) {
  const s = replayStore.get().session;
  if (!s) return;
  const r = sampleSession(s.frames, t);
  if (r.frame) replayHub.publish({ frame: r.frame, analysis: analyzeFrame(r.frame), at: performance.now() });
  else replayHub.publish(null);
  const now = performance.now();
  if (now - lastUi > 60 || !replayStore.get().playing) {
    lastUi = now;
    replayStore.set({ time: t, gap: r.gap });
  }
}

function tick() {
  raf = requestAnimationFrame(tick);
  const st = replayStore.get();
  if (!st.session || !st.playing) return;
  const now = performance.now();
  const dt = Math.min(100, now - last);
  last = now;
  time += dt * st.speed;
  if (time >= st.duration) {
    time = st.duration;
    publishAt(time);
    replayStore.set({ playing: false, time });
    return;
  }
  publishAt(time);
}

export async function loadReplay(id: string): Promise<boolean> {
  replayStore.set({ loading: true });
  const s = await getSession(id);
  if (!s) {
    replayStore.set({ loading: false });
    return false;
  }
  stopReplayLoop();
  const t0 = s.frames[0]?.t ?? 0;
  const duration = Math.max(s.frames[s.frames.length - 1]?.t ?? 0, s.durationMs);
  time = t0;
  replayStore.set({ sessionId: id, session: s, duration, time: t0, playing: false, loading: false, gap: false });
  publishAt(time);
  return true;
}

export function playReplay(): void {
  const st = replayStore.get();
  if (!st.session) return;
  if (time >= st.duration) time = st.session.frames[0]?.t ?? 0;
  last = performance.now();
  replayStore.set({ playing: true });
  cancelAnimationFrame(raf);
  raf = requestAnimationFrame(tick);
}

export function pauseReplay(): void {
  replayStore.set({ playing: false, time });
}

export function restartReplay(): void {
  const st = replayStore.get();
  if (!st.session) return;
  time = st.session.frames[0]?.t ?? 0;
  publishAt(time);
  playReplay();
}

export function seekReplay(t: number): void {
  const st = replayStore.get();
  if (!st.session) return;
  time = Math.max(0, Math.min(st.duration, t));
  publishAt(time);
  replayStore.set({ time });
}

export function setReplaySpeed(speed: number): void {
  replayStore.set({ speed });
}

function stopReplayLoop() {
  cancelAnimationFrame(raf);
  replayStore.set({ playing: false });
}

export function closeReplay(): void {
  stopReplayLoop();
  replayHub.publish(null);
  replayStore.set({ sessionId: null, session: null, time: 0, duration: 0, gap: false });
}
