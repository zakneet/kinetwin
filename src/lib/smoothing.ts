/**
 * Landmark smoothing with the One Euro filter (Casiez, Roussel & Vogel, CHI 2012).
 * It adapts its cutoff to signal speed: strong smoothing when the hand is still
 * (suppresses landmark jitter), little lag when it moves fast.
 *
 * Smoothing changes the measured signal. Joint angles shown in the app are
 * computed from the smoothed landmarks; this is stated in the UI.
 */
import { LANDMARK_COUNT } from './landmarks';
import type { Vec3 } from './vec3';

function smoothingFactor(dtSec: number, cutoffHz: number): number {
  const r = 2 * Math.PI * cutoffHz * dtSec;
  return r / (r + 1);
}

export interface OneEuroParams {
  /** Minimum cutoff frequency (Hz). Lower = smoother at rest. */
  minCutoff: number;
  /** Speed coefficient. Higher = less lag during fast motion. */
  beta: number;
  /** Cutoff for the derivative estimate (Hz). */
  dCutoff: number;
}

export const DEFAULT_ONE_EURO: OneEuroParams = { minCutoff: 1.6, beta: 0.9, dCutoff: 1.0 };

export class OneEuroFilter {
  private xPrev: number | null = null;
  private dxPrev = 0;
  private tPrev: number | null = null;
  private readonly params: OneEuroParams;

  constructor(params: OneEuroParams = DEFAULT_ONE_EURO) {
    this.params = params;
  }

  reset(): void {
    this.xPrev = null;
    this.dxPrev = 0;
    this.tPrev = null;
  }

  /** @param x sample value  @param tMs timestamp in milliseconds */
  filter(x: number, tMs: number): number {
    if (!Number.isFinite(x)) return this.xPrev ?? x;
    if (this.xPrev === null || this.tPrev === null || !Number.isFinite(tMs)) {
      this.xPrev = x;
      this.tPrev = tMs;
      this.dxPrev = 0;
      return x;
    }
    const dt = (tMs - this.tPrev) / 1000;
    if (!(dt > 0)) {
      // Duplicate or out-of-order timestamp: keep the previous estimate.
      return this.xPrev;
    }
    const dx = (x - this.xPrev) / dt;
    const aD = smoothingFactor(dt, this.params.dCutoff);
    const dxHat = aD * dx + (1 - aD) * this.dxPrev;
    const cutoff = this.params.minCutoff + this.params.beta * Math.abs(dxHat);
    const a = smoothingFactor(dt, cutoff);
    const xHat = a * x + (1 - a) * this.xPrev;
    this.xPrev = xHat;
    this.dxPrev = dxHat;
    this.tPrev = tMs;
    return xHat;
  }
}

/**
 * Smooths a full 21-landmark set. `speedScale` converts landmark units to a
 * comparable speed domain (normalized image coords vs metres differ by ~10×).
 */
export class LandmarkSmoother {
  private readonly filters: OneEuroFilter[];
  private lastT: number | null = null;
  private readonly resetAfterMs: number;

  constructor(params: OneEuroParams = DEFAULT_ONE_EURO, resetAfterMs = 300) {
    this.filters = Array.from({ length: LANDMARK_COUNT * 3 }, () => new OneEuroFilter(params));
    this.resetAfterMs = resetAfterMs;
  }

  reset(): void {
    for (const f of this.filters) f.reset();
    this.lastT = null;
  }

  smooth(points: Vec3[], tMs: number): Vec3[] {
    // After a tracking gap the old state is stale: restart instead of sliding.
    if (this.lastT !== null && tMs - this.lastT > this.resetAfterMs) this.reset();
    this.lastT = tMs;
    const out: Vec3[] = new Array(points.length);
    for (let i = 0; i < points.length; i++) {
      const p = points[i];
      out[i] = {
        x: this.filters[i * 3].filter(p.x, tMs),
        y: this.filters[i * 3 + 1].filter(p.y, tMs),
        z: this.filters[i * 3 + 2].filter(p.z, tMs),
      };
    }
    return out;
  }
}
