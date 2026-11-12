import { FilesetResolver, HandLandmarker } from '@mediapipe/tasks-vision';

const BASE = import.meta.env.BASE_URL;
const MP_VERSION = '1.2.3';

export const MODEL_SOURCES = [
  { label: 'local', url: `${BASE}models/hand_landmarker.task` },
  { label: 'Google model storage', url: 'https://storage.googleapis.com/mediapipe-models/hand_landmarker/hand_landmarker/float16/1/hand_landmarker.task' },
] as const;

export const WASM_SOURCES = [
  { label: 'local', url: `${BASE}mediapipe/wasm` },
  { label: 'jsDelivr CDN', url: `https://cdn.jsdelivr.net/npm/@mediapipe/tasks-vision@${MP_VERSION}/wasm` },
] as const;

export type Delegate = 'GPU' | 'CPU';

export interface LandmarkerHandle {
  landmarker: HandLandmarker;
  delegate: Delegate;
  modelSource: string;
  wasmSource: string;
}

async function isReachable(url: string): Promise<boolean> {
  try {
    const r = await fetch(url, { method: 'HEAD' });
    const type = r.headers.get('content-type') ?? '';
    // Vite's SPA fallback answers unknown paths with index.html — that is not the model.
    return r.ok && !type.includes('text/html');
  } catch {
    return false;
  }
}

/**
 * Creates the official MediaPipe Hand Landmarker in VIDEO mode for one hand.
 * Tries the GPU delegate first and falls back to CPU. Model/WASM are loaded
 * from this app's own server when present, otherwise from Google's official
 * hosting. Only the model and runtime are downloaded — camera frames never
 * leave the browser.
 */
export async function createHandLandmarker(onProgress?: (msg: string) => void, preferCpu = false): Promise<LandmarkerHandle> {
  let wasm: string = WASM_SOURCES[1].url;
  let wasmLabel: string = WASM_SOURCES[1].label;
  if (await isReachable(`${WASM_SOURCES[0].url}/vision_wasm_internal.wasm`)) {
    wasm = WASM_SOURCES[0].url;
    wasmLabel = WASM_SOURCES[0].label;
  }
  onProgress?.('Loading the vision runtime');
  const fileset = await FilesetResolver.forVisionTasks(wasm);

  let modelUrl: string = MODEL_SOURCES[1].url;
  let modelLabel: string = MODEL_SOURCES[1].label;
  if (await isReachable(MODEL_SOURCES[0].url)) {
    modelUrl = MODEL_SOURCES[0].url;
    modelLabel = MODEL_SOURCES[0].label;
  }

  const delegates: Delegate[] = preferCpu ? ['CPU'] : ['GPU', 'CPU'];
  let lastError: unknown = null;
  for (const delegate of delegates) {
    try {
      onProgress?.(`Loading hand model (${delegate})`);
      const landmarker = await HandLandmarker.createFromOptions(fileset, {
        baseOptions: { modelAssetPath: modelUrl, delegate },
        runningMode: 'VIDEO',
        numHands: 1,
        minHandDetectionConfidence: 0.6,
        minHandPresenceConfidence: 0.6,
        minTrackingConfidence: 0.5,
      });
      return { landmarker, delegate, modelSource: modelLabel, wasmSource: wasmLabel };
    } catch (e) {
      lastError = e;
      console.warn(`[KineTwin] ${delegate} delegate failed`, e);
    }
  }
  throw lastError instanceof Error ? lastError : new Error('Hand Landmarker could not be created');
}
