/**
 * Rolling history of live measurements (last ~12 s) and the live
 * range-of-motion tracker. Fed only by real tracked frames.
 */
import { useEffect, useState } from 'react';
import { anglesToArray, JOINT_IDS, type JointId } from '../lib/angles';
import { FINGERS, type FingerName } from '../lib/landmarks';
import { RangeTracker } from '../lib/stats';
import { liveHub } from './frameHub';

export interface HistoryPoint {
  t: number;
  a: (number | null)[];
  f: (number | null)[];
  o: number | null;
}

const WINDOW_MS = 12000;

class LiveHistory {
  points: HistoryPoint[] = [];
  rom = new RangeTracker<JointId | `flex_${FingerName}` | 'openness'>();
  romSince = performance.now();
  version = 0;

  constructor() {
    liveHub.subscribe((s) => {
      if (!s) return;
      const p: HistoryPoint = {
        t: s.at,
        a: anglesToArray(s.analysis.angles, 1),
        f: FINGERS.map((f) => s.analysis.flexion[f]),
        o: s.analysis.openness,
      };
      this.points.push(p);
      while (this.points.length && s.at - this.points[0].t > WINDOW_MS) this.points.shift();
      const vals: Partial<Record<string, number | null>> = { ...s.analysis.angles, openness: s.analysis.openness };
      FINGERS.forEach((f) => (vals[`flex_${f}`] = s.analysis.flexion[f]));
      this.rom.update(vals);
      this.version++;
    });
  }

  resetRom() {
    this.rom.reset();
    this.romSince = performance.now();
    this.version++;
  }
}

export const liveHistory = new LiveHistory();

export function jointIndex(id: JointId): number {
  return JOINT_IDS.indexOf(id);
}

/** Re-renders at `hz` while new history arrives. */
export function useHistoryTick(hz = 8): number {
  const [v, setV] = useState(liveHistory.version);
  useEffect(() => {
    const iv = window.setInterval(() => {
      setV((prev) => (prev === liveHistory.version ? prev : liveHistory.version));
    }, 1000 / hz);
    return () => window.clearInterval(iv);
  }, [hz]);
  return v;
}
