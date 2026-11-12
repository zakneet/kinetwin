import { CalibrationPanel } from '../components/CalibrationPanel';
import { JointGrid } from '../components/JointGrid';
import { FingerTimeline, OpennessReadout, OppositionReadout, RomPanel, SpreadReadout } from '../components/LivePanels';
import { RecordDock } from '../components/RecordDock';
import { Stage } from '../components/Stage';
import { EstimateNote, Section, Segmented } from '../components/ui';
import { appStore, type SmoothingLevel } from '../state/appStore';
import { liveHub, useHubSample } from '../state/frameHub';
import { useStore } from '../state/store';

export function LiveView() {
  const sample = useHubSample(liveHub, 12);
  const baselines = useStore(appStore, (s) => s.baselines);
  const smoothing = useStore(appStore, (s) => s.smoothing);
  const handedness = sample?.frame.handedness ?? null;
  const baseline = handedness ? baselines[handedness] : null;
  const analysis = sample?.analysis ?? null;

  return (
    <div className="grid h-full min-h-0 grid-cols-[minmax(0,1fr)_400px]">
      <Stage hub={liveHub}>
        <RecordDock />
      </Stage>
      <aside className="scroll-thin min-h-0 overflow-y-auto border-l border-line bg-[rgb(8_13_26/0.6)]" aria-label="Live measurements">
        <OpennessReadout analysis={analysis} baseline={baseline} handedness={handedness} />
        <Section title="Estimated joint angles" aside={baseline ? 'violet: change from baseline' : 'degrees'}>
          <JointGrid angles={analysis?.angles ?? null} baseline={baseline} />
          <EstimateNote>
            3D vector estimates from webcam landmarks, not goniometry. ≈ marks approximations: MCP uses the wrist→knuckle line as the metacarpal axis; thumb CMC
            is a separation proxy. PIP/DIP/IP are unsigned. Select a joint to highlight it on the twin.
          </EstimateNote>
        </Section>
        <FingerTimeline />
        <OppositionReadout analysis={analysis} />
        <SpreadReadout analysis={analysis} />
        <RomPanel baseline={baseline} />
        <CalibrationPanel />
        <Section title="Landmark smoothing" aside="One Euro filter">
          <Segmented<SmoothingLevel>
            size="sm"
            label="Smoothing"
            value={smoothing}
            onChange={(v) => appStore.set({ smoothing: v })}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'medium', label: 'Medium' },
              { value: 'high', label: 'High' },
            ]}
          />
          <EstimateNote>More smoothing reduces landmark jitter but adds lag. All measurements use the smoothed landmarks.</EstimateNote>
        </Section>
      </aside>
    </div>
  );
}
