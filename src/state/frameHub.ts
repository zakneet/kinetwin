import { useEffect, useState } from 'react';
import type { FrameAnalysis } from '../lib/analysis';
import type { HandFrame } from '../lib/landmarks';

export interface HubSample {
  frame: HandFrame;
  analysis: FrameAnalysis;
  /** performance.now() when the sample was produced. */
  at: number;
}

/**
 * Per-frame data bus. The 3D scene and the 2D preview read `current` inside
 * their own animation loops (no React re-render per frame); recorders and
 * test collectors subscribe to every sample; panels use useHubSample() which
 * re-renders at a throttled rate.
 */
export class FrameHub {
  current: HubSample | null = null;
  /** Monotonic counter, incremented on every publish (including null). */
  version = 0;
  private listeners = new Set<(s: HubSample | null) => void>();

  publish(s: HubSample | null): void {
    this.current = s;
    this.version++;
    this.listeners.forEach((l) => l(s));
  }

  subscribe(fn: (s: HubSample | null) => void): () => void {
    this.listeners.add(fn);
    return () => this.listeners.delete(fn);
  }
}

/** Live camera tracking. */
export const liveHub = new FrameHub();
/** Recorded-session replay. */
export const replayHub = new FrameHub();

/** Latest hub sample, re-rendering at most `hz` times per second. */
export function useHubSample(hub: FrameHub, hz = 12): HubSample | null {
  const [sample, setSample] = useState<HubSample | null>(hub.current);
  useEffect(() => {
    let lastVersion = -1;
    const interval = window.setInterval(() => {
      if (hub.version !== lastVersion) {
        lastVersion = hub.version;
        setSample(hub.current);
      }
    }, 1000 / hz);
    return () => window.clearInterval(interval);
  }, [hub, hz]);
  return sample;
}
