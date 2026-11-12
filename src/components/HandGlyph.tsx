import type { FingerName } from '../lib/landmarks';

export type GlyphPose = 'open' | 'fist' | 'spread' | 'pinch' | 'bend';

/** Simple line-art hand used for exercise instructions (palm view). */
export function HandGlyph({ pose, highlight, size = 72 }: { pose: GlyphPose; highlight?: FingerName; size?: number }) {
  // finger base x positions and lengths (index..little), thumb separately
  const fingers: { f: FingerName; x: number; len: number }[] = [
    { f: 'index', x: 30, len: 30 },
    { f: 'middle', x: 39, len: 33 },
    { f: 'ring', x: 48, len: 30 },
    { f: 'little', x: 56, len: 24 },
  ];
  const baseY = 46;
  const spreadAngle: Record<string, number> = { index: -12, middle: -3, ring: 6, little: 15 };
  const stroke = (f: FingerName) => (highlight === f ? '#3ee6d2' : 'rgb(230 238 248 / 0.75)');
  const width = (f: FingerName) => (highlight === f ? 6.5 : 6);

  const fingerPath = (f: FingerName, x: number, len: number) => {
    const bent = pose === 'fist' || (pose === 'bend' && highlight === f) || (pose === 'pinch' && highlight === f);
    if (bent) {
      const curl = pose === 'pinch' ? 0.65 : 1;
      return `M ${x} ${baseY} q 0 ${-len * 0.45} ${-6 * curl} ${-len * 0.45} q ${-5 * curl} 0 ${-4 * curl} ${len * 0.25 * curl}`;
    }
    const a = ((pose === 'spread' ? spreadAngle[f] : spreadAngle[f] * 0.25) * Math.PI) / 180;
    return `M ${x} ${baseY} l ${Math.sin(a) * len} ${-Math.cos(a) * len}`;
  };

  const thumbPath = () => {
    if (pose === 'fist') return 'M 24 62 q -4 -8 4 -12 l 14 -2';
    if (pose === 'pinch' && highlight) {
      const target = fingers.find((x) => x.f === highlight)!;
      return `M 24 64 q -6 -12 ${target.x - 26} -24`;
    }
    if (pose === 'bend' && highlight === 'thumb') return 'M 24 64 q -4 -10 10 -12';
    if (pose === 'spread') return 'M 24 64 l -14 -18';
    return 'M 24 64 l -9 -15';
  };

  return (
    <svg width={size} height={size} viewBox="0 0 80 84" aria-hidden>
      <path d="M 22 66 C 20 52 24 44 30 44 L 58 44 C 62 46 63 56 60 68 C 57 78 30 80 22 66 Z" fill="rgb(143 124 255 / 0.10)" stroke="rgb(230 238 248 / 0.55)" strokeWidth="2" />
      {fingers.map(({ f, x, len }) => (
        <path key={f} d={fingerPath(f, x, len)} stroke={stroke(f)} strokeWidth={width(f)} strokeLinecap="round" fill="none" />
      ))}
      <path d={thumbPath()} stroke={stroke('thumb')} strokeWidth={width('thumb') + 0.5} strokeLinecap="round" fill="none" />
    </svg>
  );
}
