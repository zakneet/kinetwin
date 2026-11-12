import { parseSession, serializeSession, SessionRecorder, type ExerciseType, type Session } from '../lib/recording';
import { deleteAllSessions, deleteSession, downloadJson, getSession, listSessions, saveSession, type SessionMeta } from '../lib/storage';
import { appStore, toast } from './appStore';
import { liveHub } from './frameHub';
import { createStore } from './store';

// ---------------- session list ----------------

export const sessionsStore = createStore<{ list: SessionMeta[]; loaded: boolean; error: string | null }>({ list: [], loaded: false, error: null });

export async function refreshSessions(): Promise<void> {
  try {
    const list = await listSessions();
    sessionsStore.set({ list, loaded: true, error: null });
  } catch (e) {
    sessionsStore.set({ loaded: true, error: e instanceof Error ? e.message : String(e) });
  }
}

export async function persistSession(s: Session): Promise<SessionMeta | null> {
  try {
    const meta = await saveSession(s);
    await refreshSessions();
    return meta;
  } catch (e) {
    toast(`Session could not be saved: ${e instanceof Error ? e.message : String(e)}`, 'error');
    return null;
  }
}

export async function removeSession(id: string): Promise<void> {
  await deleteSession(id);
  await refreshSessions();
}

export async function removeAllSessions(): Promise<void> {
  await deleteAllSessions();
  await refreshSessions();
}

export async function exportSession(id: string): Promise<void> {
  const s = await getSession(id);
  if (!s) return toast('Session not found', 'error');
  const safe = s.name.replace(/[^\w\-]+/g, '_').slice(0, 60);
  downloadJson(`kinetwin_${safe}_${s.id}.json`, serializeSession(s, true));
}

export async function importSessionFile(file: File): Promise<void> {
  const text = await file.text();
  const parsed = parseSession(text);
  if (!parsed.ok) return toast(`Import failed: ${parsed.error}`, 'error');
  const existing = sessionsStore.get().list.some((m) => m.id === parsed.session.id);
  const session = existing ? { ...parsed.session, id: `${parsed.session.id}_imp${Date.now().toString(36)}` } : parsed.session;
  const meta = await persistSession(session);
  if (meta) toast(`Imported “${meta.name}”${parsed.droppedFrames ? ` (${parsed.droppedFrames} invalid frames skipped)` : ''}`);
}

// ---------------- recorder ----------------

export interface RecorderUi {
  state: 'idle' | 'recording' | 'paused';
  elapsedMs: number;
  frames: number;
  exerciseType: ExerciseType;
  lastSavedId: string | null;
}

export const recorderStore = createStore<RecorderUi>({ state: 'idle', elapsedMs: 0, frames: 0, exerciseType: 'free', lastSavedId: null });

const recorder = new SessionRecorder();
let unsub: (() => void) | null = null;
let ticker = 0;

function sync() {
  recorderStore.set({ state: recorder.state, elapsedMs: recorder.elapsed(performance.now()), frames: recorder.frameCount });
}

export function startRecording(exerciseType: ExerciseType = recorderStore.get().exerciseType, name?: string): void {
  if (recorder.state !== 'idle') return;
  const handed = liveHub.current?.frame.handedness;
  const baselines = appStore.get().baselines;
  const calibration = handed ? baselines[handed] : baselines.Right ?? baselines.Left;
  recorder.start(performance.now(), { exerciseType, calibration: calibration ?? null, name });
  recorderStore.set({ exerciseType });
  unsub = liveHub.subscribe((s) => {
    if (s) recorder.addFrame(s.frame, s.analysis, s.at);
  });
  ticker = window.setInterval(sync, 200);
  sync();
}

export function pauseRecording(): void {
  recorder.pause(performance.now());
  sync();
}

export function resumeRecording(): void {
  recorder.resume(performance.now());
  sync();
}

export function markRecording(label: string): void {
  recorder.mark(performance.now(), label);
}

export function attachTestResult(result: unknown): void {
  recorder.setTestResult(result);
}

/** Stops and saves. Returns the saved session, or null when no hand was tracked. */
export async function stopRecording(): Promise<Session | null> {
  if (recorder.state === 'idle') return null;
  unsub?.();
  unsub = null;
  window.clearInterval(ticker);
  const session = recorder.stop(performance.now());
  sync();
  if (!session) {
    toast('Nothing was saved: no hand was tracked during the recording.', 'warn');
    return null;
  }
  const meta = await persistSession(session);
  if (meta) {
    recorderStore.set({ lastSavedId: meta.id });
    toast(`Saved “${meta.name}” · ${meta.frameCount} frames`);
  }
  return session;
}

export function discardRecording(): void {
  if (recorder.state === 'idle') return;
  unsub?.();
  unsub = null;
  window.clearInterval(ticker);
  recorder.stop(performance.now());
  sync();
}
