import { CheckCircle2, Crosshair, RefreshCw, Trash2, TriangleAlert } from 'lucide-react';
import { useEffect } from 'react';
import type { Handedness } from '../lib/landmarks';
import { appStore, clearBaseline } from '../state/appStore';
import { calibrationStore, cancelCalibration, startCalibration, swapHandednessLabels } from '../state/calibration';
import { useStore } from '../state/store';
import { trackingStore } from '../tracking/engine';
import { Button, Section, Segmented } from './ui';

export function CalibrationPanel() {
  const phase = useStore(calibrationStore, (s) => s.phase);
  const countdown = useStore(calibrationStore, (s) => s.countdown);
  const progress = useStore(calibrationStore, (s) => s.progress);
  const message = useStore(calibrationStore, (s) => s.message);
  const hand = useStore(calibrationStore, (s) => s.hand);
  const detected = useStore(trackingStore, (s) => s.handedness);
  const running = useStore(trackingStore, (s) => s.status === 'running');
  const baselines = useStore(appStore, (s) => s.baselines);
  const swapped = useStore(appStore, (s) => s.swapHandedness);

  useEffect(() => {
    if (phase === 'idle' && detected) calibrationStore.set({ hand: detected });
  }, [detected, phase]);

  useEffect(() => () => cancelCalibration(), []);

  const b = baselines[hand];
  const busy = phase === 'countdown' || phase === 'capturing';

  return (
    <Section title="Personal calibration" aside={b ? `saved ${new Date(b.createdAt).toLocaleDateString()}` : 'not calibrated'}>
      <div className="flex items-center justify-between gap-3">
        <Segmented<Handedness>
          size="sm"
          label="Hand to calibrate"
          value={hand}
          onChange={(h) => !busy && calibrationStore.set({ hand: h, phase: 'idle', message: '' })}
          options={[
            { value: 'Left', label: `Left${baselines.Left ? ' ✓' : ''}` },
            { value: 'Right', label: `Right${baselines.Right ? ' ✓' : ''}` },
          ]}
        />
        {busy ? (
          <Button onClick={cancelCalibration}>Cancel</Button>
        ) : (
          <Button variant="primary" disabled={!running} onClick={() => startCalibration(hand)} title={running ? undefined : 'Start the camera first'}>
            {b ? <RefreshCw size={14} /> : <Crosshair size={14} />}
            {b ? 'Recalibrate' : 'Calibrate'}
          </Button>
        )}
      </div>

      {phase === 'idle' && !b && (
        <p className="mt-3 text-[12.5px] text-muted">
          Hold your {hand.toLowerCase()} hand open and relaxed, palm toward the camera, fingers together. KineTwin averages ~2.5 s of steady frames into your
          personal neutral baseline; later values show the change from it.
        </p>
      )}
      {phase === 'countdown' && (
        <div className="mt-3 flex items-center gap-3">
          <span key={countdown} className="count-in num grid h-10 w-10 place-items-center rounded-full border border-turq/50 font-display text-[18px] font-semibold text-turq">
            {countdown}
          </span>
          <span className="text-[13px]">Open your hand and hold it still…</span>
        </div>
      )}
      {phase === 'capturing' && (
        <div className="mt-3">
          <div className="mb-1.5 text-[13px]">Capturing — keep still</div>
          <div className="h-1.5 rounded-full bg-violet/20">
            <div className="h-full rounded-full bg-violet transition-[width] duration-100" style={{ width: `${progress * 100}%` }} />
          </div>
        </div>
      )}
      {phase === 'done' && (
        <p className="mt-3 flex items-start gap-2 text-[12.5px] text-turq">
          <CheckCircle2 size={15} className="mt-0.5 shrink-0" /> {message} Joint values now show the change from this baseline in violet.
        </p>
      )}
      {(phase === 'failed' || phase === 'mismatch') && (
        <div className="mt-3 flex items-start gap-2 text-[12.5px] text-amber">
          <TriangleAlert size={15} className="mt-0.5 shrink-0" />
          <div>
            {message}
            {phase === 'mismatch' && (
              <div className="mt-2">
                <Button onClick={swapHandednessLabels}>Swap handedness labels</Button>
              </div>
            )}
          </div>
        </div>
      )}
      {b && phase === 'idle' && (
        <div className="mt-3 flex items-center justify-between text-[12px] text-muted">
          <span className="num">
            Palm length {b.palmLength ? `${(b.palmLength * 100).toFixed(1)} cm` : '—'} · {b.frameCount} frames
          </span>
          <button className="inline-flex items-center gap-1 hover:text-coral" onClick={() => clearBaseline(hand)}>
            <Trash2 size={12} /> Remove
          </button>
        </div>
      )}
      <label className="mt-3 flex items-center gap-2 text-[12px] text-faint">
        <input type="checkbox" checked={swapped} onChange={() => appStore.set({ swapHandedness: !swapped })} />
        Swap MediaPipe handedness labels
      </label>
    </Section>
  );
}
