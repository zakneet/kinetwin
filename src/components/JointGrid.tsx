import { FINGER_JOINTS, JOINT_BY_ID, type JointAngles, type JointId } from '../lib/angles';
import type { Baseline } from '../lib/calibration';
import { FINGERS, FINGER_LABEL } from '../lib/landmarks';
import { appStore } from '../state/appStore';
import { useStore } from '../state/store';
import { cx, fmtSigned } from './ui';

const MAX_DEG = 110;

function Arc({ value, baseline }: { value: number | null; baseline: number | null }) {
  // 200° arc gauge, 0° at the left end.
  const R = 17;
  const cx0 = 22;
  const cy0 = 21;
  const start = 190;
  const sweep = 200;
  const pt = (frac: number) => {
    const a = ((start - sweep * frac) * Math.PI) / 180;
    return [cx0 + R * Math.cos(a), cy0 - R * Math.sin(a)];
  };
  const arcPath = (f0: number, f1: number) => {
    const [x0, y0] = pt(f0);
    const [x1, y1] = pt(f1);
    const large = (f1 - f0) * sweep > 180 ? 1 : 0;
    return `M ${x0} ${y0} A ${R} ${R} 0 ${large} 1 ${x1} ${y1}`;
  };
  const f = value === null ? 0 : Math.max(0, Math.min(1, Math.abs(value) / MAX_DEG));
  const b = baseline === null ? null : Math.max(0, Math.min(1, Math.abs(baseline) / MAX_DEG));
  const [bx, by] = b === null ? [0, 0] : pt(b);
  const [bx2, by2] = b === null ? [0, 0] : [cx0 + (bx - cx0) * 0.72, cy0 + (by - cy0) * 0.72];
  return (
    <svg width="44" height="30" viewBox="0 0 44 30" aria-hidden>
      <path d={arcPath(0, 1)} stroke="rgb(62 230 210 / 0.14)" strokeWidth="3.5" fill="none" strokeLinecap="round" />
      {value !== null && f > 0.004 && <path d={arcPath(0, f)} stroke={value < 0 ? '#58a6ff' : '#3ee6d2'} strokeWidth="3.5" fill="none" strokeLinecap="round" />}
      {b !== null && <line x1={bx} y1={by} x2={bx2} y2={by2} stroke="#8f7cff" strokeWidth="2" strokeLinecap="round" />}
    </svg>
  );
}

const ROW_LABEL = ['Distal', 'Middle', 'Proximal'];

/**
 * Anatomical readout: one column per finger, joints stacked tip → base like
 * the hand itself. Values are webcam estimates; "≈" marks approximated joints.
 */
export function JointGrid({ angles, baseline }: { angles: JointAngles | null; baseline: Baseline | null }) {
  const selected = useStore(appStore, (s) => s.selectedJoint);
  return (
    <div>
      <div className="grid grid-cols-5 gap-1.5">
        {FINGERS.map((f) => (
          <div key={f} className="pb-1 text-center text-[11.5px] font-medium text-muted">
            {FINGER_LABEL[f]}
          </div>
        ))}
        {[2, 1, 0].map((row) =>
          FINGERS.map((f) => {
            const id = FINGER_JOINTS[f][row] as JointId;
            const def = JOINT_BY_ID[id];
            const v = angles?.[id] ?? null;
            const base = baseline?.jointAngles[id] ?? null;
            const delta = v !== null && base !== null ? v - base : null;
            const isSel = selected === id;
            return (
              <button
                key={id}
                onClick={() => appStore.set({ selectedJoint: isSel ? null : id })}
                title={`${def.label}${def.approximate ? ' — approximate definition' : ''}${def.signed ? ' (negative = hyperextension)' : ' (unsigned magnitude)'}`}
                aria-label={`${def.label} ${v === null ? 'not measured' : `${v.toFixed(0)} degrees`}`}
                aria-pressed={isSel}
                className={cx(
                  'flex flex-col items-center rounded-lg px-0.5 pb-1.5 pt-1 transition-colors',
                  isSel ? 'bg-turq/10 shadow-[inset_0_0_0_1px_rgb(62_230_210/0.55)]' : 'hover:bg-white/[0.04]',
                )}
              >
                <Arc value={v} baseline={base} />
                <span className="num -mt-2.5 font-display text-[15px] font-semibold leading-none text-ink">
                  {v === null ? '—' : `${v.toFixed(0)}°`}
                </span>
                <span className="mt-1 text-[10px] leading-none text-faint">
                  {def.kind}
                  {def.approximate ? ' ≈' : ''}
                </span>
                {baseline && <span className="num mt-0.5 text-[10px] leading-none text-violet">{fmtSigned(delta, 0, '°')}</span>}
              </button>
            );
          }),
        )}
      </div>
      <div className="sr-only">Rows from top: {ROW_LABEL.join(', ')}</div>
    </div>
  );
}
