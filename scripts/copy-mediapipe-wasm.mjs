// Copies the MediaPipe Tasks Vision WASM runtime from node_modules into
// public/ so the app can load it from the local dev/prod server instead of
// a CDN. Camera frames never leave the browser either way.
import { cpSync, existsSync, mkdirSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = join(dirname(fileURLToPath(import.meta.url)), '..');
const src = join(root, 'node_modules', '@mediapipe', 'tasks-vision', 'wasm');
const dest = join(root, 'public', 'mediapipe', 'wasm');

if (!existsSync(src)) {
  console.warn('[kinetwin] @mediapipe/tasks-vision wasm folder not found; the app will fall back to the CDN copy.');
  process.exit(0);
}

mkdirSync(dest, { recursive: true });
for (const file of readdirSync(src)) {
  cpSync(join(src, file), join(dest, file));
}
console.log(`[kinetwin] MediaPipe WASM runtime copied to public/mediapipe/wasm (${readdirSync(dest).length} files)`);
