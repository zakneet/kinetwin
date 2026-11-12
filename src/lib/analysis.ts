/**
 * Per-frame biomechanical analysis: everything the UI and recorder need,
 * computed from one (smoothed) hand frame.
 */
import { computeJointAngles, computePalmFrame, emptyAngles, type JointAngles, type PalmFrame } from './angles';
import { FINGERS, isValidLandmarkSet, type FingerName, type HandFrame } from './landmarks';
import { fingerFlexionSum, fingerSpread, handOpenness, palmDimensions, thumbOpposition, type FingerSpread, type PalmDimensions, type ThumbOpposition } from './metrics';

export interface FrameAnalysis {
  angles: JointAngles;
  palm: PalmFrame | null;
  dims: PalmDimensions | null;
  openness: number | null;
  opposition: ThumbOpposition;
  spread: FingerSpread;
  /** Total estimated flexion per finger (deg). */
  flexion: Record<FingerName, number | null>;
}

export function emptyAnalysis(): FrameAnalysis {
  return {
    angles: emptyAngles(),
    palm: null,
    dims: null,
    openness: null,
    opposition: { index: null, middle: null, ring: null, little: null },
    spread: { indexMiddle: null, middleRing: null, ringLittle: null, thumbIndex: null, totalLong: null, tipSpreadRatio: null },
    flexion: { thumb: null, index: null, middle: null, ring: null, little: null },
  };
}

export function analyzeFrame(frame: Pick<HandFrame, 'world' | 'handedness'> | null | undefined): FrameAnalysis {
  if (!frame || !isValidLandmarkSet(frame.world)) return emptyAnalysis();
  const palm = computePalmFrame(frame.world, frame.handedness);
  const angles = computeJointAngles(frame.world, frame.handedness, palm);
  const flexion = {} as Record<FingerName, number | null>;
  for (const f of FINGERS) flexion[f] = fingerFlexionSum(angles, f);
  return {
    angles,
    palm,
    dims: palmDimensions(frame.world),
    openness: handOpenness(frame.world, angles).value,
    opposition: thumbOpposition(frame.world),
    spread: fingerSpread(frame.world, palm),
    flexion,
  };
}
