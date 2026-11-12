/** Side-by-side comparison of two recorded sessions. */
import { JOINT_IDS, JOINT_BY_ID, type JointId } from './angles';
import { FINGERS, type FingerName } from './landmarks';
import { summarizeSession, type Session, type SessionSummary } from './recording';

export interface CompareRow {
  key: string;
  label: string;
  a: number | null;
  b: number | null;
  /** b − a, null if either is missing. */
  diff: number | null;
  unit: string;
}

export interface SessionComparison {
  a: SessionSummary;
  b: SessionSummary;
  /** True when one session is a left hand and the other a right hand. */
  leftRight: boolean;
  general: CompareRow[];
  jointAmplitude: CompareRow[];
  fingerAmplitude: CompareRow[];
  opposition: CompareRow[];
}

function row(key: string, label: string, a: number | null, b: number | null, unit: string): CompareRow {
  return { key, label, a, b, diff: a === null || b === null ? null : b - a, unit };
}

export function compareSessions(sa: Session, sb: Session): SessionComparison {
  const a = summarizeSession(sa);
  const b = summarizeSession(sb);
  const leftRight =
    (sa.handedness === 'Left' && sb.handedness === 'Right') || (sa.handedness === 'Right' && sb.handedness === 'Left');
  const general: CompareRow[] = [
    row('duration', 'Duration', a.durationMs / 1000, b.durationMs / 1000, 's'),
    row('frames', 'Tracked frames', a.frameCount, b.frameCount, ''),
    row('rate', 'Sampling rate', a.rateHz, b.rateHz, 'Hz'),
    row('openness', 'Openness range', a.openness?.amplitude ?? null, b.openness?.amplitude ?? null, ''),
    row('spread', 'Spread range', a.spread?.amplitude ?? null, b.spread?.amplitude ?? null, '°'),
  ];
  const jointAmplitude = JOINT_IDS.map((id: JointId) =>
    row(id, JOINT_BY_ID[id].label, a.joints[id]?.amplitude ?? null, b.joints[id]?.amplitude ?? null, '°'),
  );
  const fingerAmplitude = FINGERS.map((f: FingerName) =>
    row(f, f[0].toUpperCase() + f.slice(1), a.flexion[f]?.amplitude ?? null, b.flexion[f]?.amplitude ?? null, '°'),
  );
  const opposition = (['index', 'middle', 'ring', 'little'] as const).map((f) =>
    row(f, `Thumb → ${f}`, a.oppositionMin[f], b.oppositionMin[f], '× palm'),
  );
  return { a, b, leftRight, general, jointAmplitude, fingerAmplitude, opposition };
}

/**
 * Resamples a session's joint series to `points` evenly spaced samples over
 * normalised time (0..1) so two sessions of different length can be overlaid.
 */
export function normalizedJointSeries(session: Session, joint: JointId, points = 120): (number | null)[] {
  const idx = JOINT_IDS.indexOf(joint);
  const frames = session.frames;
  if (frames.length === 0) return new Array(points).fill(null);
  const t0 = frames[0].t;
  const t1 = frames[frames.length - 1].t;
  const span = Math.max(1, t1 - t0);
  const out: (number | null)[] = [];
  let j = 0;
  for (let k = 0; k < points; k++) {
    const t = t0 + (span * k) / Math.max(1, points - 1);
    while (j < frames.length - 1 && frames[j + 1].t <= t) j++;
    const v = frames[j].a[idx];
    out.push(v === undefined ? null : v);
  }
  return out;
}
