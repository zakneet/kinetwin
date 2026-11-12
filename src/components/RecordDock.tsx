import { Circle, Pause, Play, Square } from 'lucide-react';
import { EXERCISE_LABEL, EXERCISE_TYPES, type ExerciseType } from '../lib/recording';
import { pauseRecording, recorderStore, resumeRecording, startRecording, stopRecording } from '../state/sessions';
import { useStore } from '../state/store';
import { trackingStore } from '../tracking/engine';
import { fmtTime, cx } from './ui';

export function RecordDock() {
  const state = useStore(recorderStore, (s) => s.state);
  const elapsed = useStore(recorderStore, (s) => s.elapsedMs);
  const frames = useStore(recorderStore, (s) => s.frames);
  const exercise = useStore(recorderStore, (s) => s.exerciseType);
  const running = useStore(trackingStore, (s) => s.status === 'running');

  return (
    <div className="glass-strong absolute bottom-5 left-1/2 z-10 flex -translate-x-1/2 items-center gap-3 rounded-2xl px-3 py-2.5">
      {state === 'idle' ? (
        <>
          <label className="sr-only" htmlFor="exercise">
            Exercise type
          </label>
          <select
            id="exercise"
            value={exercise}
            onChange={(e) => recorderStore.set({ exerciseType: e.target.value as ExerciseType })}
            className="rounded-lg border border-line-strong bg-navy px-2.5 py-2 text-[13px] text-ink"
          >
            {EXERCISE_TYPES.map((t) => (
              <option key={t} value={t}>
                {EXERCISE_LABEL[t]}
              </option>
            ))}
          </select>
          <button
            disabled={!running}
            onClick={() => startRecording()}
            title={running ? 'Record landmarks and measurements (no video)' : 'Start the camera first'}
            className="inline-flex items-center gap-2 rounded-xl bg-coral px-4 py-2 text-[13px] font-semibold text-[#2a0710] transition-colors hover:bg-[#ff95a2] disabled:opacity-40"
          >
            <Circle size={13} fill="currentColor" /> Start recording
          </button>
        </>
      ) : (
        <>
          <span className="flex items-center gap-2 pl-1 text-[13px]">
            <span className={cx('h-2.5 w-2.5 rounded-full bg-coral', state === 'recording' && 'pulse-dot')} />
            <span className="num w-[64px] font-semibold">{fmtTime(elapsed)}</span>
            <span className="num text-muted">{frames} frames</span>
          </span>
          {state === 'recording' ? (
            <button onClick={pauseRecording} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] hover:bg-white/5">
              <Pause size={14} /> Pause
            </button>
          ) : (
            <button onClick={resumeRecording} className="inline-flex items-center gap-1.5 rounded-lg border border-line-strong px-3 py-2 text-[13px] hover:bg-white/5">
              <Play size={14} /> Resume
            </button>
          )}
          <button
            onClick={() => void stopRecording()}
            className="inline-flex items-center gap-1.5 rounded-lg bg-white/10 px-3 py-2 text-[13px] font-medium hover:bg-white/15"
          >
            <Square size={13} fill="currentColor" /> Stop and save
          </button>
        </>
      )}
    </div>
  );
}
