/** Small statistics helpers that skip null / non-finite values instead of propagating NaN. */

export function finiteValues(values: ReadonlyArray<number | null | undefined>): number[] {
  const out: number[] = [];
  for (const v of values) if (typeof v === 'number' && Number.isFinite(v)) out.push(v);
  return out;
}

export function mean(values: ReadonlyArray<number | null | undefined>): number | null {
  const v = finiteValues(values);
  if (v.length === 0) return null;
  let s = 0;
  for (const x of v) s += x;
  return s / v.length;
}

export function std(values: ReadonlyArray<number | null | undefined>): number | null {
  const v = finiteValues(values);
  if (v.length < 2) return null;
  const m = v.reduce((a, b) => a + b, 0) / v.length;
  let s = 0;
  for (const x of v) s += (x - m) * (x - m);
  return Math.sqrt(s / (v.length - 1));
}

/** Linear-interpolated percentile (p in [0,100]) of the finite values. */
export function percentile(values: ReadonlyArray<number | null | undefined>, p: number): number | null {
  const v = finiteValues(values).sort((a, b) => a - b);
  if (v.length === 0) return null;
  if (v.length === 1) return v[0];
  const rank = (Math.min(100, Math.max(0, p)) / 100) * (v.length - 1);
  const lo = Math.floor(rank);
  const hi = Math.ceil(rank);
  return v[lo] + (v[hi] - v[lo]) * (rank - lo);
}

export function median(values: ReadonlyArray<number | null | undefined>): number | null {
  return percentile(values, 50);
}

export interface RangeSummary {
  min: number;
  max: number;
  /** max − min */
  amplitude: number;
  /** 5th–95th percentile span, less sensitive to single-frame landmark glitches. */
  robustAmplitude: number;
  mean: number;
  count: number;
}

/** Observed range of a series. Null when fewer than `minCount` finite samples exist. */
export function computeRange(values: ReadonlyArray<number | null | undefined>, minCount = 1): RangeSummary | null {
  const v = finiteValues(values);
  if (v.length < Math.max(1, minCount)) return null;
  let min = Infinity;
  let max = -Infinity;
  let s = 0;
  for (const x of v) {
    if (x < min) min = x;
    if (x > max) max = x;
    s += x;
  }
  const p5 = percentile(v, 5) ?? min;
  const p95 = percentile(v, 95) ?? max;
  return { min, max, amplitude: max - min, robustAmplitude: p95 - p5, mean: s / v.length, count: v.length };
}

/** Incremental min/max tracker for many named channels (live range-of-motion). */
export class RangeTracker<K extends string> {
  private readonly data = new Map<K, { min: number; max: number; sum: number; count: number }>();

  update(values: Partial<Record<K, number | null>>): void {
    for (const key in values) {
      const v = values[key];
      if (typeof v !== 'number' || !Number.isFinite(v)) continue;
      const cur = this.data.get(key);
      if (!cur) this.data.set(key, { min: v, max: v, sum: v, count: 1 });
      else {
        if (v < cur.min) cur.min = v;
        if (v > cur.max) cur.max = v;
        cur.sum += v;
        cur.count++;
      }
    }
  }

  get(key: K): { min: number; max: number; amplitude: number; mean: number; count: number } | null {
    const c = this.data.get(key);
    if (!c) return null;
    return { min: c.min, max: c.max, amplitude: c.max - c.min, mean: c.sum / c.count, count: c.count };
  }

  reset(): void {
    this.data.clear();
  }

  get size(): number {
    return this.data.size;
  }
}
