/**
 * Guided assessment runner. Collects real tracked samples for each step of a
 * test and computes results from them. If the hand is not tracked, the step
 * is reported as invalid — nothing is filled in.
 */
import {
  computeIsolationStep,
  computeOpenClose,
  computeOppositionStep,
  computeSpread,
  toAssessmentSample,
  type AssessmentSample,
  type IsolationStepResult,
  type OpenCloseResult,
  type OppositionStepResult,
  type SpreadResult,
} from '../lib/assessment';
import { FINGER_LABEL, type FingerName, type Handedness, type LongFingerName } from '../lib/landmarks';
import { EXERCISE_LABEL } from '../lib/recording';
import { loadPref, storePref } from '../lib/storage';
import { liveHub } from './frameHub';
import { attachTestResult, markRecording, recorderStore, startRecording, stopRecording } from './sessions';
import { createStore } from './store';

export type TestId = 'open-close' | 'finger-isolation' | 'thumb-opposition' | 'finger-spread';

export interface StepDef {
  title: string;
  instruction: string;
  durationMs: number;
  finger?: FingerName;
}

export interface TestDef {
  id: TestId;
  name: string;
  summary: string;
  measures: string[];
  steps: StepDef[];
}

const ISO: FingerName[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const OPP: LongFingerName[] = ['index', 'middle', 'ring', 'little'];

export const TESTS: TestDef[] = [
  {
    id: 'open-close',
    name: EXERCISE_LABEL['open-close'],
    summary: 'Open the hand fully, then close it into a fist, repeatedly.',
    measures: ['Finger flexion and extension range', 'Movement amplitude', 'Cycle duration', 'Consistency', 'Speed and smoothness'],
    steps: [{ title: 'Open and close', instruction: 'Open your hand fully, then make a fist. Repeat at a comfortable pace until the timer ends.', durationMs: 12000 }],
  },
  {
    id: 'finger-isolation',
    name: EXERCISE_LABEL['finger-isolation'],
    summary: 'Bend and straighten one finger at a time while the others stay still.',
    measures: ['Target finger amplitude', 'Movement of the other fingers', 'Independence index'],
    steps: ISO.map((f) => ({
      title: `${FINGER_LABEL[f]} only`,
      instruction: `Bend and straighten only your ${FINGER_LABEL[f].toLowerCase()}${f === 'thumb' ? '' : ' finger'}. Keep the other fingers still.`,
      durationMs: 6000,
      finger: f,
    })),
  },
  {
    id: 'thumb-opposition',
    name: EXERCISE_LABEL['thumb-opposition'],
    summary: 'Touch the thumb tip to each fingertip in turn.',
    measures: ['Closest normalised thumb–fingertip distance', 'Time to closest approach'],
    steps: OPP.map((f) => ({
      title: `Thumb to ${FINGER_LABEL[f].toLowerCase()}`,
      instruction: `Touch your thumb tip to your ${FINGER_LABEL[f].toLowerCase()} fingertip, then open again.`,
      durationMs: 5000,
      finger: f,
    })),
  },
  {
    id: 'finger-spread',
    name: EXERCISE_LABEL['finger-spread'],
    summary: 'Spread the fingers wide apart, then bring them together.',
    measures: ['Finger separation range', 'Fingertip spread ratio', 'Thumb–index angle'],
    steps: [{ title: 'Spread and close', instruction: 'Keep the hand flat. Spread your fingers apart as far as is comfortable, then bring them together. Repeat.', durationMs: 10000 }],
  },
];

export type TestResult =
  | { kind: 'open-close'; result: OpenCloseResult; series: { t: number; o: number | null }[] }
  | { kind: 'finger-isolation'; steps: IsolationStepResult[] }
  | { kind: 'thumb-opposition'; steps: OppositionStepResult[] }
  | { kind: 'finger-spread'; result: SpreadResult; series: { t: number; s: number | null }[] };

export interface StoredResult {
  test: TestId;
  completedAt: string;
  handedness: Handedness | null;
  data: TestResult;
  recorded: boolean;
}

export type RunPhase = 'idle' | 'countdown' | 'step' | 'between' | 'done';

export interface AssessmentState {
  selected: TestId;
  running: TestId | null;
  phase: RunPhase;
  stepIndex: number;
  countdown: number;
  stepProgress: number;
  stepSamples: number;
  results: Partial<Record<TestId, StoredResult>>;
  record: boolean;
}

export const assessmentStore = createStore<AssessmentState>({
  selected: 'open-close',
  running: null,
  phase: 'idle',
  stepIndex: 0,
  countdown: 0,
  stepProgress: 0,
  stepSamples: 0,
  results: {},
  record: loadPref('assessmentRecord', false),
});

let timer = 0;
let unsub: (() => void) | null = null;
let stepSamples: AssessmentSample[] = [];
let allSteps: AssessmentSample[][] = [];
let stepStart = 0;
let lastHand: Handedness | null = null;

function clearTimers() {
  window.clearInterval(timer);
  unsub?.();
  unsub = null;
}

export function setRecordTests(v: boolean): void {
  storePref('assessmentRecord', v);
  assessmentStore.set({ record: v });
}

export function startTest(id: TestId): void {
  if (assessmentStore.get().running) return;
  if (recorderStore.get().state !== 'idle') return;
  clearTimers();
  allSteps = [];
  lastHand = null;
  assessmentStore.set({ running: id, selected: id, phase: 'countdown', stepIndex: 0, countdown: 3, stepProgress: 0, stepSamples: 0 });
  let n = 3;
  timer = window.setInterval(() => {
    n--;
    if (n > 0) return assessmentStore.set({ countdown: n });
    window.clearInterval(timer);
    const def = TESTS.find((t) => t.id === id)!;
    if (assessmentStore.get().record) startRecording(id, `${def.name} · ${new Date().toLocaleString()}`);
    runStep(def, 0);
  }, 1000);
}

function runStep(def: TestDef, index: number) {
  const step = def.steps[index];
  stepSamples = [];
  stepStart = performance.now();
  assessmentStore.set({ phase: 'step', stepIndex: index, stepProgress: 0, stepSamples: 0 });
  markRecording(`step:${step.title}`);
  unsub = liveHub.subscribe((s) => {
    if (!s) return;
    lastHand = s.frame.handedness;
    stepSamples.push(toAssessmentSample(s.at - stepStart, s.frame.handednessScore, s.analysis));
  });
  timer = window.setInterval(() => {
    const p = (performance.now() - stepStart) / step.durationMs;
    assessmentStore.set({ stepProgress: Math.min(1, p), stepSamples: stepSamples.length });
    if (p < 1) return;
    clearTimers();
    allSteps[index] = stepSamples;
    if (index + 1 < def.steps.length) {
      assessmentStore.set({ phase: 'between', stepIndex: index + 1, countdown: 2 });
      let n = 2;
      timer = window.setInterval(() => {
        n--;
        if (n > 0) return assessmentStore.set({ countdown: n });
        window.clearInterval(timer);
        runStep(def, index + 1);
      }, 1000);
    } else {
      void finish(def);
    }
  }, 100);
}

function compute(def: TestDef): TestResult {
  switch (def.id) {
    case 'open-close': {
      const s = allSteps[0] ?? [];
      return { kind: 'open-close', result: computeOpenClose(s, def.steps[0].durationMs), series: s.map((x) => ({ t: x.t, o: x.openness })) };
    }
    case 'finger-isolation':
      return { kind: 'finger-isolation', steps: def.steps.map((st, i) => computeIsolationStep(st.finger!, allSteps[i] ?? [], st.durationMs)) };
    case 'thumb-opposition':
      return { kind: 'thumb-opposition', steps: def.steps.map((st, i) => computeOppositionStep(st.finger as LongFingerName, allSteps[i] ?? [], st.durationMs)) };
    case 'finger-spread': {
      const s = allSteps[0] ?? [];
      return { kind: 'finger-spread', result: computeSpread(s, def.steps[0].durationMs), series: s.map((x) => ({ t: x.t, s: x.spreadTotal })) };
    }
  }
}

async function finish(def: TestDef) {
  const data = compute(def);
  let recorded = false;
  if (recorderStore.get().state !== 'idle') {
    attachTestResult(data);
    // stopRecording() returns null (and saves nothing) when no hand was tracked.
    recorded = (await stopRecording()) !== null;
  }
  const stored: StoredResult = { test: def.id, completedAt: new Date().toISOString(), handedness: lastHand, data, recorded };
  assessmentStore.set((s) => ({ running: null, phase: 'done', results: { ...s.results, [def.id]: stored } }));
}

export function abortTest(): void {
  clearTimers();
  if (recorderStore.get().state !== 'idle' && assessmentStore.get().running) {
    // Keep whatever was recorded so far; it is still real data, labelled with its exercise type.
    void stopRecording();
  }
  assessmentStore.set({ running: null, phase: 'idle', stepProgress: 0 });
}
