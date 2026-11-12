import type { JointId } from '../lib/angles';
import type { Baseline } from '../lib/calibration';
import type { Handedness } from '../lib/landmarks';
import { loadBaseline, loadPref, storeBaseline, storePref } from '../lib/storage';
import { createStore } from './store';

export type View = 'live' | 'assessment' | 'sessions';
export type SmoothingLevel = 'low' | 'medium' | 'high';

export interface AppState {
  view: View;
  renderMode: 'surface' | 'skeleton';
  showTrails: boolean;
  flexionMap: boolean;
  mirror: boolean;
  orientation: 'camera' | 'anatomical';
  selectedJoint: JointId | null;
  smoothing: SmoothingLevel;
  swapHandedness: boolean;
  baselines: Record<Handedness, Baseline | null>;
  cameraResetNonce: number;
  toast: { id: number; text: string; tone: 'info' | 'warn' | 'error' } | null;
}

export const appStore = createStore<AppState>({
  view: 'live',
  renderMode: loadPref('renderMode', 'surface'),
  showTrails: loadPref('showTrails', true),
  flexionMap: loadPref('flexionMap', false),
  mirror: loadPref('mirror', true),
  orientation: loadPref('orientation', 'camera'),
  selectedJoint: null,
  smoothing: loadPref('smoothing', 'medium'),
  swapHandedness: loadPref('swapHandedness', false),
  baselines: { Left: loadBaseline('Left'), Right: loadBaseline('Right') },
  cameraResetNonce: 0,
  toast: null,
});

const persisted: (keyof AppState)[] = ['renderMode', 'showTrails', 'flexionMap', 'mirror', 'orientation', 'smoothing', 'swapHandedness'];
let prev = appStore.get();
appStore.subscribe(() => {
  const s = appStore.get();
  for (const k of persisted) if (s[k] !== prev[k]) storePref(k, s[k]);
  prev = s;
});

export function setBaseline(b: Baseline): void {
  storeBaseline(b);
  appStore.set((s) => ({ baselines: { ...s.baselines, [b.handedness]: b } }));
}

export function clearBaseline(h: Handedness): void {
  storeBaseline(null, h);
  appStore.set((s) => ({ baselines: { ...s.baselines, [h]: null } }));
}

let toastId = 0;
export function toast(text: string, tone: 'info' | 'warn' | 'error' = 'info'): void {
  const id = ++toastId;
  appStore.set({ toast: { id, text, tone } });
  window.setTimeout(() => {
    if (appStore.get().toast?.id === id) appStore.set({ toast: null });
  }, tone === 'error' ? 7000 : 3800);
}
