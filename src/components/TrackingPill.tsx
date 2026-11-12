import { useStore } from '../state/store';
import { trackingStore } from '../tracking/engine';
import { cx } from './ui';

/** Compact tracking state: colour reflects measurement state, always paired with a word. */
export function TrackingPill() {
  const status = useStore(trackingStore, (s) => s.status);
  const hand = useStore(trackingStore, (s) => s.handState);
  const handedness = useStore(trackingStore, (s) => s.handedness);

  let tone = 'bg-faint';
  let text = 'Camera off';
  let pulse = false;
  if (status === 'requesting-camera') {
    tone = 'bg-azure';
    text = 'Waiting for permission';
    pulse = true;
  } else if (status === 'loading-model') {
    tone = 'bg-azure';
    text = 'Loading model';
    pulse = true;
  } else if (status === 'error') {
    tone = 'bg-coral';
    text = 'Error';
  } else if (status === 'running') {
    if (hand === 'tracking') {
      tone = 'bg-turq';
      text = `Tracking ${handedness ? handedness.toLowerCase() + ' hand' : 'hand'}`;
    } else if (hand === 'recovered') {
      tone = 'bg-turq';
      text = 'Tracking recovered';
      pulse = true;
    } else if (hand === 'lost') {
      tone = 'bg-coral';
      text = 'Tracking lost';
      pulse = true;
    } else {
      tone = 'bg-amber';
      text = 'Searching for a hand';
      pulse = true;
    }
  }
  return (
    <span role="status" aria-live="polite" className="inline-flex items-center gap-2 rounded-full border border-line bg-black/25 px-3 py-1.5 text-[12px] text-ink">
      <span className={cx('h-2 w-2 rounded-full', tone, pulse && 'pulse-dot')} />
      {text}
    </span>
  );
}
