/**
 * Motion recording: compact landmark + measurement frames, JSON
 * (de)serialisation with validation, and time-based interpolated sampling for
 * camera-free replay. Webcam video is never recorded — only landmarks and
 * the measurements derived from them.
 */
import { anglesFromArray, anglesToArray, JOINT_IDS, type JointId } from './angles';
import type { FrameAnalysis } from './analysis';
import { isBaseline, type Baseline } from './calibration';
import { FINGERS, flattenLandmarks, LANDMARK_COUNT, LONG_FINGERS, unflattenLandmarks, type FingerName, type Handedness, type HandFrame } from './landmarks';
import { computeRange, type RangeSummary } from './stats';
import { checkSampling } from './kinematics';

export const EXERCISE_TYPES = ['free', 'open-close', 'finger-isolation', 'thumb-opposition', 'finger-spread'] as const;
export type ExerciseType = (typeof EXERCISE_TYPES)[number];

export const EXERCISE_LABEL: Record<ExerciseType, string> = {
  free: 'Free movement',
  'open-close': 'Open and close hand',
  'finger-isolation': 'Individual finger movement',
  'thumb-opposition': 'Thumb opposition',
  'finger-spread': 'Finger spreading',
};

export interface SessionFrame {
  /** ms since recording start, excluding paused time. */
  t: number;
  /** 21×3 normalized image landmarks, flattened. */
  lm: number[];
  /** 21×3 world landmarks (m), flattened. */
  wlm: number[];
  h: 'L' | 'R';
  /** Handedness classifier score. */
  s: number;
  /** Joint angles (deg) in JOINT_IDS order. */
  a: (number | null)[];
  /** Movement metrics: openness, thumb opposition [index,middle,ring,little], total long-finger spread, flexion per finger [thumb..little]. */
  m: { o: number | null; op: (number | null)[]; sp: number | null; f: (number | null)[] };
}

export interface SessionEvent {
  t: number;
  type: 'pause' | 'resume' | 'marker';
  label?: string;
}

export interface Session {
  schema: 'kinetwin.session';
  version: 1;
  id: string;
  name: string;
  createdAt: string;
  durationMs: number;
  exerciseType: ExerciseType;
  handedness: Handedness | 'Mixed' | null;
  calibration: Baseline | null;
  frames: SessionFrame[];
  events: SessionEvent[];
  /** Optional result block produced by a guided test. */
  testResult?: unknown;
  notes: string;
  provenance: {
    app: 'KineTwin';
    source: 'mediapipe-hand-landmarker';
    smoothing: 'one-euro';
    disclaimer: string;
  };
}

export const DISCLAIMER =
  'Webcam-based landmark estimates for education and movement analysis. Not a medical device; not clinically validated; no diagnostic value.';

const round = (v: number | null, d = 4): number | null => (v === null || !Number.isFinite(v) ? null : Math.round(v * 10 ** d) / 10 ** d + 0);

export function encodeFrame(frame: HandFrame, analysis: FrameAnalysis, t: number): SessionFrame {
  return {
    t: Math.round(t * 10) / 10 + 0,
    lm: flattenLandmarks(frame.landmarks, 5),
    wlm: flattenLandmarks(frame.world, 5),
    h: frame.handedness === 'Left' ? 'L' : 'R',
    s: Math.round(frame.handednessScore * 1000) / 1000,
    a: anglesToArray(analysis.angles),
    m: {
      o: round(analysis.openness),
      op: LONG_FINGERS.map((f) => round(analysis.opposition[f])),
      sp: round(analysis.spread.totalLong, 2),
      f: FINGERS.map((f) => round(analysis.flexion[f], 2)),
    },
  };
}

export function decodeFrame(f: SessionFrame): HandFrame | null {
  const landmarks = unflattenLandmarks(f.lm);
  const world = unflattenLandmarks(f.wlm);
  if (!landmarks || !world) return null;
  return { t: f.t, landmarks, world, handedness: f.h === 'L' ? 'Left' : 'Right', handednessScore: f.s };
}

export function newSessionId(): string {
  const rnd = Math.random().toString(36).slice(2, 8);
  return `s_${Date.now().toString(36)}_${rnd}`;
}

export type RecorderState = 'idle' | 'recording' | 'paused';

/** Accumulates frames between start() and stop(). Pure state machine; time is passed in. */
export class SessionRecorder {
  state: RecorderState = 'idle';
  private startT = 0;
  private pausedTotal = 0;
  private pausedAt = 0;
  private frames: SessionFrame[] = [];
  private events: SessionEvent[] = [];
  private meta: { exerciseType: ExerciseType; calibration: Baseline | null; name?: string; testResult?: unknown } = {
    exerciseType: 'free',
    calibration: null,
  };

  start(now: number, meta: { exerciseType: ExerciseType; calibration: Baseline | null; name?: string }): void {
    this.state = 'recording';
    this.startT = now;
    this.pausedTotal = 0;
    this.frames = [];
    this.events = [];
    this.meta = { ...meta };
  }

  pause(now: number): void {
    if (this.state !== 'recording') return;
    this.state = 'paused';
    this.pausedAt = now;
    this.events.push({ t: this.elapsed(now), type: 'pause' });
  }

  resume(now: number): void {
    if (this.state !== 'paused') return;
    this.pausedTotal += now - this.pausedAt;
    this.state = 'recording';
    this.events.push({ t: this.elapsed(now), type: 'resume' });
  }

  mark(now: number, label: string): void {
    if (this.state === 'idle') return;
    this.events.push({ t: this.elapsed(now), type: 'marker', label });
  }

  setTestResult(result: unknown): void {
    this.meta.testResult = result;
  }

  /** Recording time (ms) excluding pauses. */
  elapsed(now: number): number {
    if (this.state === 'idle') return 0;
    const pausedNow = this.state === 'paused' ? now - this.pausedAt : 0;
    return Math.max(0, now - this.startT - this.pausedTotal - pausedNow);
  }

  get frameCount(): number {
    return this.frames.length;
  }

  addFrame(frame: HandFrame, analysis: FrameAnalysis, now: number): boolean {
    if (this.state !== 'recording') return false;
    if (frame.world.length !== LANDMARK_COUNT || frame.landmarks.length !== LANDMARK_COUNT) return false;
    const t = this.elapsed(now);
    const last = this.frames[this.frames.length - 1];
    if (last && t <= last.t) return false; // keep timestamps strictly increasing
    this.frames.push(encodeFrame(frame, analysis, t));
    return true;
  }

  /** Finalises the session. Returns null when nothing was captured (no fake sessions). */
  stop(now: number, date = new Date()): Session | null {
    if (this.state === 'idle') return null;
    if (this.state === 'paused') this.resume(now);
    const durationMs = this.elapsed(now);
    this.state = 'idle';
    if (this.frames.length === 0) return null;
    const hs = new Set(this.frames.map((f) => f.h));
    const handedness: Session['handedness'] = hs.size > 1 ? 'Mixed' : hs.has('L') ? 'Left' : 'Right';
    const session: Session = {
      schema: 'kinetwin.session',
      version: 1,
      id: newSessionId(),
      name: this.meta.name ?? `${EXERCISE_LABEL[this.meta.exerciseType]} · ${date.toLocaleString()}`,
      createdAt: date.toISOString(),
      durationMs,
      exerciseType: this.meta.exerciseType,
      handedness,
      calibration: this.meta.calibration,
      frames: this.frames,
      events: this.events,
      notes: '',
      provenance: { app: 'KineTwin', source: 'mediapipe-hand-landmarker', smoothing: 'one-euro', disclaimer: DISCLAIMER },
    };
    if (this.meta.testResult !== undefined) session.testResult = this.meta.testResult;
    this.frames = [];
    this.events = [];
    return session;
  }
}

export function serializeSession(session: Session, pretty = false): string {
  return JSON.stringify(session, null, pretty ? 2 : undefined);
}

export type ParseResult = { ok: true; session: Session; droppedFrames: number } | { ok: false; error: string };

function isNumArray(a: unknown, len: number): a is number[] {
  return Array.isArray(a) && a.length === len && a.every((x) => typeof x === 'number' && Number.isFinite(x));
}

/** Parses and validates a session JSON (string or object). Invalid frames are dropped and counted. */
export function parseSession(input: string | unknown): ParseResult {
  let obj: unknown = input;
  if (typeof input === 'string') {
    try {
      obj = JSON.parse(input);
    } catch {
      return { ok: false, error: 'File is not valid JSON' };
    }
  }
  if (!obj || typeof obj !== 'object') return { ok: false, error: 'Session must be a JSON object' };
  const o = obj as Record<string, unknown>;
  if (o.schema !== 'kinetwin.session') return { ok: false, error: 'Not a KineTwin session file' };
  if (o.version !== 1) return { ok: false, error: `Unsupported session version ${String(o.version)}` };
  if (!Array.isArray(o.frames)) return { ok: false, error: 'Session has no frame list' };

  const frames: SessionFrame[] = [];
  let dropped = 0;
  let lastT = -Infinity;
  for (const raw of o.frames as unknown[]) {
    const f = raw as Partial<SessionFrame> | null;
    if (
      !f ||
      typeof f.t !== 'number' ||
      !Number.isFinite(f.t) ||
      f.t <= lastT ||
      !isNumArray(f.lm, 63) ||
      !isNumArray(f.wlm, 63) ||
      (f.h !== 'L' && f.h !== 'R')
    ) {
      dropped++;
      continue;
    }
    lastT = f.t;
    const a = Array.isArray(f.a) ? JOINT_IDS.map((_, i) => (typeof f.a![i] === 'number' && Number.isFinite(f.a![i] as number) ? (f.a![i] as number) : null)) : JOINT_IDS.map(() => null);
    const m = f.m && typeof f.m === 'object' ? f.m : { o: null, op: [], sp: null, f: [] };
    const num = (v: unknown) => (typeof v === 'number' && Number.isFinite(v) ? v : null);
    frames.push({
      t: f.t,
      lm: f.lm,
      wlm: f.wlm,
      h: f.h,
      s: typeof f.s === 'number' && Number.isFinite(f.s) ? f.s : 0,
      a,
      m: {
        o: num(m.o),
        op: LONG_FINGERS.map((_, i) => num(Array.isArray(m.op) ? m.op[i] : null)),
        sp: num(m.sp),
        f: FINGERS.map((_, i) => num(Array.isArray(m.f) ? m.f[i] : null)),
      },
    });
  }
  if (frames.length === 0) return { ok: false, error: 'Session contains no valid landmark frames' };
  const exerciseType = (EXERCISE_TYPES as readonly string[]).includes(o.exerciseType as string) ? (o.exerciseType as ExerciseType) : 'free';
  const hs = new Set(frames.map((f) => f.h));
  const session: Session = {
    schema: 'kinetwin.session',
    version: 1,
    id: typeof o.id === 'string' && o.id.length > 0 ? o.id.slice(0, 64) : newSessionId(),
    name: typeof o.name === 'string' ? o.name.slice(0, 160) : 'Imported session',
    createdAt: typeof o.createdAt === 'string' ? o.createdAt : new Date().toISOString(),
    durationMs: typeof o.durationMs === 'number' && Number.isFinite(o.durationMs) ? o.durationMs : frames[frames.length - 1].t,
    exerciseType,
    handedness: hs.size > 1 ? 'Mixed' : hs.has('L') ? 'Left' : 'Right',
    calibration: isBaseline(o.calibration) ? o.calibration : null,
    frames,
    events: Array.isArray(o.events) ? (o.events as SessionEvent[]).filter((e) => e && typeof e.t === 'number' && Number.isFinite(e.t)) : [],
    notes: typeof o.notes === 'string' ? o.notes.slice(0, 2000) : '',
    provenance: { app: 'KineTwin', source: 'mediapipe-hand-landmarker', smoothing: 'one-euro', disclaimer: DISCLAIMER },
  };
  if (o.testResult !== undefined) session.testResult = o.testResult;
  return { ok: true, session, droppedFrames: dropped };
}

/** Index of the last frame with t <= time, or -1. */
export function findFrameIndex(frames: ReadonlyArray<{ t: number }>, time: number): number {
  let lo = 0;
  let hi = frames.length - 1;
  if (hi < 0 || time < frames[0].t) return -1;
  while (lo < hi) {
    const mid = (lo + hi + 1) >> 1;
    if (frames[mid].t <= time) lo = mid;
    else hi = mid - 1;
  }
  return lo;
}

function lerpFlat(a: number[], b: number[], k: number, out: { x: number; y: number; z: number }[]): void {
  for (let i = 0; i < LANDMARK_COUNT; i++) {
    out[i] = {
      x: a[i * 3] + (b[i * 3] - a[i * 3]) * k,
      y: a[i * 3 + 1] + (b[i * 3 + 1] - a[i * 3 + 1]) * k,
      z: a[i * 3 + 2] + (b[i * 3 + 2] - a[i * 3 + 2]) * k,
    };
  }
}

export interface SampleResult {
  frame: HandFrame | null;
  /** True when `time` falls inside a tracking gap (hand not tracked while recording). */
  gap: boolean;
  index: number;
}

/**
 * Interpolated hand frame at `time` (ms). Landmarks are linearly interpolated
 * between the two bracketing recorded frames. Inside a tracking gap longer
 * than `maxGapMs`, no frame is invented: the result is { frame: null, gap: true }.
 */
export function sampleSession(frames: ReadonlyArray<SessionFrame>, time: number, maxGapMs = 250): SampleResult {
  if (frames.length === 0 || !Number.isFinite(time)) return { frame: null, gap: false, index: -1 };
  const i = findFrameIndex(frames, time);
  if (i < 0) return { frame: null, gap: false, index: -1 };
  const a = frames[i];
  const b = frames[i + 1];
  const hold = 1000 / 12; // show the last real frame briefly before declaring a gap
  if (!b) {
    if (time - a.t > hold) return { frame: null, gap: false, index: i };
    const f = decodeFrame(a);
    return { frame: f ? { ...f, t: time } : null, gap: false, index: i };
  }
  const span = b.t - a.t;
  if (span > maxGapMs) {
    if (time - a.t <= hold) {
      const f = decodeFrame(a);
      return { frame: f ? { ...f, t: time } : null, gap: false, index: i };
    }
    return { frame: null, gap: true, index: i };
  }
  const k = span > 0 ? Math.min(1, Math.max(0, (time - a.t) / span)) : 0;
  const landmarks: { x: number; y: number; z: number }[] = new Array(LANDMARK_COUNT);
  const world: { x: number; y: number; z: number }[] = new Array(LANDMARK_COUNT);
  lerpFlat(a.lm, b.lm, k, landmarks);
  lerpFlat(a.wlm, b.wlm, k, world);
  const near = k < 0.5 ? a : b;
  return {
    frame: {
      t: time,
      landmarks,
      world,
      handedness: near.h === 'L' ? 'Left' : 'Right',
      handednessScore: a.s + (b.s - a.s) * k,
    },
    gap: false,
    index: i,
  };
}

export interface SessionSummary {
  durationMs: number;
  frameCount: number;
  rateHz: number | null;
  handedness: Session['handedness'];
  joints: Record<JointId, RangeSummary | null>;
  flexion: Record<FingerName, RangeSummary | null>;
  openness: RangeSummary | null;
  oppositionMin: Record<'index' | 'middle' | 'ring' | 'little', number | null>;
  spread: RangeSummary | null;
}

export function summarizeSession(session: Pick<Session, 'frames' | 'durationMs' | 'handedness'>): SessionSummary {
  const frames = session.frames;
  const joints = {} as Record<JointId, RangeSummary | null>;
  JOINT_IDS.forEach((id, i) => {
    joints[id] = computeRange(frames.map((f) => f.a[i] ?? null), 3);
  });
  const flexion = {} as Record<FingerName, RangeSummary | null>;
  FINGERS.forEach((f, i) => {
    flexion[f] = computeRange(frames.map((fr) => fr.m.f[i] ?? null), 3);
  });
  const oppositionMin = { index: null, middle: null, ring: null, little: null } as SessionSummary['oppositionMin'];
  LONG_FINGERS.forEach((f, i) => {
    const r = computeRange(frames.map((fr) => fr.m.op[i] ?? null), 1);
    oppositionMin[f] = r ? r.min : null;
  });
  const chk = checkSampling(frames.map((f) => f.t), 0, Infinity, 2);
  return {
    durationMs: session.durationMs,
    frameCount: frames.length,
    rateHz: chk.rateHz,
    handedness: session.handedness,
    joints,
    flexion,
    openness: computeRange(frames.map((f) => f.m.o), 3),
    oppositionMin,
    spread: computeRange(frames.map((f) => f.m.sp), 3),
  };
}

/** Joint-angle time series of a recorded session (for charts). */
export function jointSeries(session: Pick<Session, 'frames'>, joint: JointId): { t: number; v: number | null }[] {
  const idx = JOINT_IDS.indexOf(joint);
  return session.frames.map((f) => ({ t: f.t, v: f.a[idx] ?? null }));
}

export { anglesFromArray };
