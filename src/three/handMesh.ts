/**
 * Procedural anatomical hand surface, rebuilt every frame from the 21 tracked
 * landmarks (CPU-side, preallocated buffers, no per-frame allocation).
 *
 * - Fingers: one continuous tube per finger along a centripetal Catmull-Rom
 *   curve through the landmark chain. Elliptical cross-section (wider than
 *   thick), tapered radius, soft bulges at the joints, flattened nail bed,
 *   palmar pad and a hemispherical fingertip that ends exactly at the tip
 *   landmark. Frames are parallel-transported from the palm's dorsal normal so
 *   the nail always faces the back of the hand as the finger curls.
 * - Palm: a Coons patch bounded by the wrist line, the knuckle line (pushed
 *   along each proximal phalanx so it follows MCP flexion), the hypothenar
 *   edge and the thenar edge (through the thumb metacarpal). It is inflated
 *   along the palm normal with thenar / hypothenar volume.
 * - Forearm: short elliptical tube that fades out proximally.
 *
 * Proportions are derived from the live palm width, so the model scales with
 * the tracked hand. They are visual approximations, not anatomical measurements.
 */
import * as THREE from 'three';

const TAU = Math.PI * 2;

function smoothstep(t: number): number {
  return t * t * (3 - 2 * t);
}

// Scratch storage for the spline evaluator (avoids per-call allocations in the frame loop).
const _A1 = { x: 0, y: 0, z: 0 };
const _A2 = { x: 0, y: 0, z: 0 };
const _A3 = { x: 0, y: 0, z: 0 };
const _B1 = { x: 0, y: 0, z: 0 };
const _B2 = { x: 0, y: 0, z: 0 };

function lerpKnot(a: THREE.Vector3, b: THREE.Vector3, ta: number, tb: number, tt: number, o: { x: number; y: number; z: number }): void {
  const k = (tt - ta) / (tb - ta);
  o.x = a.x + (b.x - a.x) * k;
  o.y = a.y + (b.y - a.y) * k;
  o.z = a.z + (b.z - a.z) * k;
}

/** Centripetal Catmull-Rom between p1 and p2 (alpha = 0.5, Barry–Goldman form), written into `out`. */
function catmullRom(p0: THREE.Vector3, p1: THREE.Vector3, p2: THREE.Vector3, p3: THREE.Vector3, t: number, out: THREE.Vector3): THREE.Vector3 {
  const d01 = Math.max(1e-6, Math.pow(p0.distanceToSquared(p1), 0.25));
  const d12 = Math.max(1e-6, Math.pow(p1.distanceToSquared(p2), 0.25));
  const d23 = Math.max(1e-6, Math.pow(p2.distanceToSquared(p3), 0.25));
  const t1 = d01;
  const t2 = t1 + d12;
  const t3 = t2 + d23;
  const tt = t1 + d12 * t;
  lerpKnot(p0, p1, 0, t1, tt, _A1);
  lerpKnot(p1, p2, t1, t2, tt, _A2);
  lerpKnot(p2, p3, t2, t3, tt, _A3);
  const k1 = tt / t2;
  const k2 = (tt - t1) / (t3 - t1);
  _B1.x = _A1.x + (_A2.x - _A1.x) * k1;
  _B1.y = _A1.y + (_A2.y - _A1.y) * k1;
  _B1.z = _A1.z + (_A2.z - _A1.z) * k1;
  _B2.x = _A2.x + (_A3.x - _A2.x) * k2;
  _B2.y = _A2.y + (_A3.y - _A2.y) * k2;
  _B2.z = _A2.z + (_A3.z - _A2.z) * k2;
  const k3 = (tt - t1) / d12;
  out.set(_B1.x + (_B2.x - _B1.x) * k3, _B1.y + (_B2.y - _B1.y) * k3, _B1.z + (_B2.z - _B1.z) * k3);
  if (!Number.isFinite(out.x + out.y + out.z)) out.copy(p1).lerp(p2, t);
  return out;
}

export interface TubeStyle {
  /** Radius at each control point (scene units). */
  radii: number[];
  /** Relative joint bulge at each control point (0 = none). */
  bulge: number[];
  /** Lateral / dorso-palmar ratio of the cross-section. */
  width: number;
}

/** Colour callback: ring position along the finger → colour (linear RGB). */
export type RingColorFn = (segment: number, segT: number, out: THREE.Color) => void;

export class FingerTube {
  readonly geometry = new THREE.BufferGeometry();
  readonly nailGeometry = new THREE.BufferGeometry();
  private readonly nCtrl: number;
  private readonly radial: number;
  private readonly bodyRings: number;
  private readonly capRings: number;
  private readonly sps: number; // dense samples per segment
  private readonly dense: THREE.Vector3[];
  private readonly denseS: Float32Array;
  private readonly denseSeg: Int16Array;
  private readonly denseT: Float32Array;
  private readonly ctrlS: Float32Array;
  private readonly rings: number;
  private readonly ringC: THREE.Vector3[];
  private readonly ringD: THREE.Vector3[];
  private readonly ringL: THREE.Vector3[];
  private readonly ringR: Float32Array;
  private readonly ringS: Float32Array;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly nailPos: Float32Array;
  private readonly nailS = 7;
  private readonly nailT = 7;
  private readonly tmpA = new THREE.Vector3();
  private readonly tmpB = new THREE.Vector3();
  private readonly tmpT = new THREE.Vector3();
  private readonly color = new THREE.Color();

  constructor(nCtrl: number, radial = 22, bodyRings = 44, capRings = 8, samplesPerSegment = 16) {
    this.nCtrl = nCtrl;
    this.radial = radial;
    this.bodyRings = bodyRings;
    this.capRings = capRings;
    this.sps = samplesPerSegment;
    const nd = (nCtrl - 1) * samplesPerSegment + 1;
    this.dense = Array.from({ length: nd }, () => new THREE.Vector3());
    this.denseS = new Float32Array(nd);
    this.denseSeg = new Int16Array(nd);
    this.denseT = new Float32Array(nd);
    this.ctrlS = new Float32Array(nCtrl);
    this.rings = bodyRings + capRings - 1; // last cap ring replaced by the tip pole
    this.ringC = Array.from({ length: this.rings }, () => new THREE.Vector3());
    this.ringD = Array.from({ length: this.rings }, () => new THREE.Vector3());
    this.ringL = Array.from({ length: this.rings }, () => new THREE.Vector3());
    this.ringR = new Float32Array(this.rings);
    this.ringS = new Float32Array(this.rings);

    const vertCount = this.rings * radial + 2; // + base pole + tip pole
    this.pos = new Float32Array(vertCount * 3);
    this.col = new Float32Array(vertCount * 3).fill(1);
    const idx: number[] = [];
    for (let r = 0; r < this.rings - 1; r++) {
      for (let k = 0; k < radial; k++) {
        const a = r * radial + k;
        const b = r * radial + ((k + 1) % radial);
        const c = (r + 1) * radial + k;
        const d = (r + 1) * radial + ((k + 1) % radial);
        idx.push(a, c, b, b, c, d);
      }
    }
    const basePole = this.rings * radial;
    const tipPole = basePole + 1;
    const last = (this.rings - 1) * radial;
    for (let k = 0; k < radial; k++) {
      idx.push(basePole, k, (k + 1) % radial);
      idx.push(last + k, tipPole, last + ((k + 1) % radial));
    }
    this.geometry.setIndex(idx);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vertCount * 3), 3).setUsage(THREE.DynamicDrawUsage));

    // Nail plate grid
    this.nailPos = new Float32Array(this.nailS * this.nailT * 3);
    const nidx: number[] = [];
    for (let i = 0; i < this.nailS - 1; i++) {
      for (let j = 0; j < this.nailT - 1; j++) {
        const a = i * this.nailT + j;
        const b = a + 1;
        const c = a + this.nailT;
        const d = c + 1;
        nidx.push(a, c, b, b, c, d);
      }
    }
    this.nailGeometry.setIndex(nidx);
    this.nailGeometry.setAttribute('position', new THREE.BufferAttribute(this.nailPos, 3).setUsage(THREE.DynamicDrawUsage));
    this.nailGeometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(this.nailS * this.nailT * 3), 3));
  }

  /** Index of the dense sample at or before arc length s. */
  private denseIndex(s: number): number {
    const S = this.denseS;
    let lo = 0;
    let hi = S.length - 1;
    while (lo < hi) {
      const mid = (lo + hi + 1) >> 1;
      if (S[mid] <= s) lo = mid;
      else hi = mid - 1;
    }
    return Math.min(lo, S.length - 2);
  }

  private radiusAt(s: number, style: TubeStyle, segOut: { seg: number; t: number }): number {
    const i = this.denseIndex(s);
    const span = this.denseS[i + 1] - this.denseS[i];
    const k = span > 0 ? (s - this.denseS[i]) / span : 0;
    const seg = this.denseSeg[i];
    let t = this.denseT[i] + (this.denseT[i + 1] - this.denseT[i]) * k;
    if (this.denseSeg[i + 1] !== seg) t = this.denseT[i] + (1 - this.denseT[i]) * k;
    if (t > 1) t = 1;
    segOut.seg = seg;
    segOut.t = t;
    let r = style.radii[seg] + (style.radii[seg + 1] - style.radii[seg]) * smoothstep(t);
    for (let c = 1; c < this.nCtrl - 1; c++) {
      const b = style.bulge[c];
      if (!b) continue;
      const w = 0.55 * style.radii[c];
      const d = (s - this.ctrlS[c]) / w;
      r *= 1 + b * Math.exp(-d * d);
    }
    return r;
  }

  update(ctrl: THREE.Vector3[], style: TubeStyle, dorsalRef: THREE.Vector3, colorFn: RingColorFn): void {
    const n = this.nCtrl;
    const sps = this.sps;
    // 1. Dense centreline.
    const phantomA = this.tmpA.copy(ctrl[0]).multiplyScalar(2).sub(ctrl[1]);
    const phantomB = this.tmpB.copy(ctrl[n - 1]).multiplyScalar(2).sub(ctrl[n - 2]);
    let di = 0;
    for (let j = 0; j < n - 1; j++) {
      const p0 = j === 0 ? phantomA : ctrl[j - 1];
      const p3 = j + 2 >= n ? phantomB : ctrl[j + 2];
      for (let k = 0; k < sps; k++) {
        const t = k / sps;
        catmullRom(p0, ctrl[j], ctrl[j + 1], p3, t, this.dense[di]);
        this.denseSeg[di] = j;
        this.denseT[di] = t;
        di++;
      }
    }
    this.dense[di].copy(ctrl[n - 1]);
    this.denseSeg[di] = n - 2;
    this.denseT[di] = 1;
    this.denseS[0] = 0;
    for (let i = 1; i < this.dense.length; i++) this.denseS[i] = this.denseS[i - 1] + this.dense[i].distanceTo(this.dense[i - 1]);
    for (let c = 0; c < n; c++) this.ctrlS[c] = this.denseS[Math.min(c * sps, this.dense.length - 1)];
    const L = Math.max(1e-4, this.denseS[this.dense.length - 1]);

    // 2. Ring placement: uniform body + hemispherical cap ending at the tip landmark.
    const segInfo = { seg: 0, t: 0 };
    const rTipRaw = style.radii[n - 1];
    const rTip = Math.min(rTipRaw, L * 0.3);
    const capStart = L - rTip;
    const rAtCap = this.radiusAt(capStart, style, segInfo);
    for (let r = 0; r < this.rings; r++) {
      let s: number;
      let rad: number;
      if (r < this.bodyRings) {
        s = (capStart * r) / (this.bodyRings - 1);
        rad = this.radiusAt(s, style, segInfo);
      } else {
        const j = r - this.bodyRings + 1;
        const phi = (j / this.capRings) * (Math.PI / 2);
        s = capStart + rTip * Math.sin(phi);
        rad = rAtCap * Math.cos(phi);
        this.radiusAt(s, style, segInfo);
      }
      this.ringS[r] = s;
      this.ringR[r] = rad;
      // centre + tangent
      const i = this.denseIndex(s);
      const span = this.denseS[i + 1] - this.denseS[i];
      const k = span > 0 ? Math.min(1, Math.max(0, (s - this.denseS[i]) / span)) : 0;
      this.ringC[r].copy(this.dense[i]).lerp(this.dense[i + 1], k);
      this.tmpT.copy(this.dense[i + 1]).sub(this.dense[i]);
      if (this.tmpT.lengthSq() < 1e-12) this.tmpT.set(0, 1, 0);
      this.tmpT.normalize();
      // 3. Parallel-transported dorsal axis.
      const D = this.ringD[r];
      D.copy(r === 0 ? dorsalRef : this.ringD[r - 1]);
      D.addScaledVector(this.tmpT, -D.dot(this.tmpT));
      if (D.lengthSq() < 1e-10) {
        D.set(0, 0, 1).addScaledVector(this.tmpT, -this.tmpT.z);
        if (D.lengthSq() < 1e-10) D.set(1, 0, 0);
      }
      D.normalize();
      this.ringL[r].crossVectors(this.tmpT, D).normalize();

      // 4. Cross-section.
      const seg = segInfo.seg;
      const lastSeg = seg === n - 2;
      const nailK = lastSeg ? smoothstep(Math.min(1, segInfo.t / 0.5)) : 0;
      const dorsal = 1 - 0.13 * nailK;
      const palmar = 1 + 0.07 * nailK;
      const rx = rad * style.width;
      colorFn(seg, segInfo.t, this.color);
      const C = this.ringC[r];
      const Lx = this.ringL[r];
      for (let q = 0; q < this.radial; q++) {
        const th = (q / this.radial) * TAU;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        const ry = rad * (sn >= 0 ? dorsal : palmar);
        const o = (r * this.radial + q) * 3;
        this.pos[o] = C.x + Lx.x * rx * c + D.x * ry * sn;
        this.pos[o + 1] = C.y + Lx.y * rx * c + D.y * ry * sn;
        this.pos[o + 2] = C.z + Lx.z * rx * c + D.z * ry * sn;
        this.col[o] = this.color.r;
        this.col[o + 1] = this.color.g;
        this.col[o + 2] = this.color.b;
      }
    }
    // Poles
    const base = this.rings * this.radial * 3;
    const c0 = this.ringC[0];
    this.pos[base] = c0.x;
    this.pos[base + 1] = c0.y;
    this.pos[base + 2] = c0.z;
    const tip = ctrl[n - 1];
    this.pos[base + 3] = tip.x;
    this.pos[base + 4] = tip.y;
    this.pos[base + 5] = tip.z;
    colorFn(0, 0, this.color);
    this.col.set([this.color.r, this.color.g, this.color.b], base);
    colorFn(n - 2, 1, this.color);
    this.col.set([this.color.r, this.color.g, this.color.b], base + 3);

    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();

    this.updateNail(capStart, rTip, n);
  }

  private updateNail(capStart: number, rTip: number, n: number): void {
    const s0 = this.ctrlS[n - 2] + (capStart - this.ctrlS[n - 2]) * 0.38;
    const s1 = capStart + rTip * 0.45;
    const half = 0.78;
    for (let i = 0; i < this.nailS; i++) {
      const u = i / (this.nailS - 1);
      const s = s0 + (s1 - s0) * u;
      // locate bracketing rings
      let r = 0;
      while (r < this.rings - 2 && this.ringS[r + 1] < s) r++;
      const span = this.ringS[r + 1] - this.ringS[r];
      const k = span > 0 ? Math.min(1, Math.max(0, (s - this.ringS[r]) / span)) : 0;
      const C = this.tmpA.copy(this.ringC[r]).lerp(this.ringC[r + 1], k);
      const rad = this.ringR[r] + (this.ringR[r + 1] - this.ringR[r]) * k;
      const D = this.ringD[r];
      const Lx = this.ringL[r];
      const capK = s > capStart ? Math.sqrt(Math.max(0, 1 - ((s - capStart) / rTip) ** 2)) : 1;
      for (let j = 0; j < this.nailT; j++) {
        const v = j / (this.nailT - 1);
        const th = Math.PI / 2 + (v * 2 - 1) * half;
        const edge = Math.sin(v * Math.PI) * Math.sin(Math.min(1, u * 1.6) * (Math.PI / 2));
        const lift = rad * (0.004 + 0.05 * edge);
        const rx = rad * 1.0 * capK;
        const ry = rad * 0.87;
        const c = Math.cos(th);
        const sn = Math.sin(th);
        const o = (i * this.nailT + j) * 3;
        const nx = Lx.x * c + D.x * sn;
        const ny = Lx.y * c + D.y * sn;
        const nz = Lx.z * c + D.z * sn;
        this.nailPos[o] = C.x + Lx.x * rx * c + D.x * ry * sn + nx * lift;
        this.nailPos[o + 1] = C.y + Lx.y * rx * c + D.y * ry * sn + ny * lift;
        this.nailPos[o + 2] = C.z + Lx.z * rx * c + D.z * ry * sn + nz * lift;
      }
    }
    this.nailGeometry.attributes.position.needsUpdate = true;
    this.nailGeometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
    this.nailGeometry.dispose();
  }
}

/** Samples a centripetal Catmull-Rom spline through `pts` at `count` evenly spaced parameters. */
function sampleSpline(pts: THREE.Vector3[], count: number, out: THREE.Vector3[], tmpA: THREE.Vector3, tmpB: THREE.Vector3): void {
  const n = pts.length;
  for (let i = 0; i < count; i++) {
    const g = (i / (count - 1)) * (n - 1);
    const j = Math.min(n - 2, Math.floor(g));
    const t = g - j;
    const p0 = j === 0 ? tmpA.copy(pts[0]).multiplyScalar(2).sub(pts[1]) : pts[j - 1];
    const p3 = j + 2 >= n ? tmpB.copy(pts[n - 1]).multiplyScalar(2).sub(pts[n - 2]) : pts[j + 2];
    catmullRom(p0, pts[j], pts[j + 1], p3, t, out[i]);
  }
}

export interface PalmInput {
  /** All 21 landmarks in scene space. */
  p: THREE.Vector3[];
  distal: THREE.Vector3;
  radial: THREE.Vector3;
  /** Unit normal toward the back of the hand. */
  dorsal: THREE.Vector3;
  palmWidth: number;
  /** Radius of each long finger at its base (index, middle, ring, little). */
  baseRadius: [number, number, number, number];
}

/** Superellipse falloff used for the rounded palm edges. */
const SUPER_P = 2.4;
export function superFalloff(x: number): number {
  const a = Math.min(1, Math.abs(x));
  return Math.pow(1 - Math.pow(a, SUPER_P), 1 / SUPER_P);
}

export class PalmSurface {
  readonly geometry = new THREE.BufferGeometry();
  private readonly U: number;
  private readonly V: number;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly bottom: THREE.Vector3[];
  private readonly top: THREE.Vector3[];
  private readonly left: THREE.Vector3[];
  private readonly right: THREE.Vector3[];
  private readonly uParam: Float32Array;
  private readonly vParam: Float32Array;
  private readonly ctrlTop = Array.from({ length: 6 }, () => new THREE.Vector3());
  private readonly ctrlBottom = Array.from({ length: 3 }, () => new THREE.Vector3());
  private readonly ctrlLeft = Array.from({ length: 3 }, () => new THREE.Vector3());
  private readonly ctrlRight = Array.from({ length: 5 }, () => new THREE.Vector3());
  private readonly tA = new THREE.Vector3();
  private readonly tB = new THREE.Vector3();
  private readonly S = new THREE.Vector3();
  /** Wrist half-thickness exposed for the forearm to match. */
  wristHalfThickness = 0.2;
  wristHalfWidth = 0.4;

  constructor(U = 22, V = 20) {
    this.U = U;
    this.V = V;
    const per = (U + 1) * (V + 1);
    this.pos = new Float32Array(per * 2 * 3);
    this.col = new Float32Array(per * 2 * 3).fill(1);
    this.bottom = Array.from({ length: V + 1 }, () => new THREE.Vector3());
    this.top = Array.from({ length: V + 1 }, () => new THREE.Vector3());
    this.left = Array.from({ length: U + 1 }, () => new THREE.Vector3());
    this.right = Array.from({ length: U + 1 }, () => new THREE.Vector3());
    // Denser sampling near the rounded edges (cosine spacing), wrist end kept uniform.
    this.uParam = new Float32Array(U + 1);
    for (let i = 0; i <= U; i++) {
      const x = i / U;
      this.uParam[i] = Math.sin((x * Math.PI) / 2); // dense toward the knuckle edge (u=1)
    }
    this.vParam = new Float32Array(V + 1);
    for (let j = 0; j <= V; j++) this.vParam[j] = 0.5 - 0.5 * Math.cos((j / V) * Math.PI);

    const idx: number[] = [];
    for (let side = 0; side < 2; side++) {
      const off = side * per;
      for (let i = 0; i < U; i++) {
        for (let j = 0; j < V; j++) {
          const a = off + i * (V + 1) + j;
          const b = a + 1;
          const c = a + (V + 1);
          const d = c + 1;
          if (side === 0) idx.push(a, c, b, b, c, d);
          else idx.push(a, b, c, b, d, c);
        }
      }
    }
    this.geometry.setIndex(idx);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(per * 2 * 3), 3));
  }

  update(input: PalmInput, skin: THREE.Color): void {
    const { p, distal: A, radial: R, dorsal: N, palmWidth: pw, baseRadius } = input;
    const w = p[0];
    // Knuckle edge: pushed along each proximal phalanx so it follows MCP flexion.
    const along = (mcp: number, pip: number, amount: number, out: THREE.Vector3) => {
      this.tA.copy(p[pip]).sub(p[mcp]);
      const l = this.tA.length();
      if (l > 1e-6) this.tA.multiplyScalar(amount / l);
      return out.copy(p[mcp]).add(this.tA);
    };
    const push = 0.17 * pw;
    along(17, 18, push, this.ctrlTop[1]);
    along(13, 14, push * 1.1, this.ctrlTop[2]);
    along(9, 10, push * 1.1, this.ctrlTop[3]);
    along(5, 6, push, this.ctrlTop[4]);
    this.ctrlTop[0].copy(this.ctrlTop[1]).addScaledVector(R, -baseRadius[3] * 1.05).addScaledVector(A, -0.1 * pw);
    this.ctrlTop[5].copy(this.ctrlTop[4]).addScaledVector(R, baseRadius[0] * 1.0).addScaledVector(A, -0.12 * pw);

    // Wrist edge
    const halfW = 0.43 * pw;
    this.wristHalfWidth = halfW;
    this.ctrlBottom[0].copy(w).addScaledVector(R, -halfW);
    this.ctrlBottom[1].copy(w).addScaledVector(A, -0.03 * pw);
    this.ctrlBottom[2].copy(w).addScaledVector(R, halfW);

    // Ulnar (hypothenar) edge: bulges outward.
    this.ctrlLeft[0].copy(this.ctrlBottom[0]);
    this.ctrlLeft[1].copy(this.ctrlBottom[0]).lerp(this.ctrlTop[0], 0.5).addScaledVector(R, -0.07 * pw);
    this.ctrlLeft[2].copy(this.ctrlTop[0]);

    // Radial (thenar) edge: through the thumb metacarpal to the first web space.
    this.ctrlRight[0].copy(this.ctrlBottom[2]);
    this.ctrlRight[1].copy(p[1]).addScaledVector(R, 0.06 * pw);
    this.ctrlRight[2].copy(p[1]).lerp(p[2], 0.6);
    this.ctrlRight[3].copy(p[2]).lerp(p[5], 0.55).addScaledVector(A, -0.04 * pw);
    this.ctrlRight[4].copy(this.ctrlTop[5]);

    sampleSpline(this.ctrlBottom, this.V + 1, this.bottom, this.tA, this.tB);
    sampleSpline(this.ctrlTop, this.V + 1, this.top, this.tA, this.tB);
    sampleSpline(this.ctrlLeft, this.U + 1, this.left, this.tA, this.tB);
    sampleSpline(this.ctrlRight, this.U + 1, this.right, this.tA, this.tB);

    const per = (this.U + 1) * (this.V + 1);
    const B0 = this.bottom[0];
    const B1 = this.bottom[this.V];
    const T0 = this.top[0];
    const T1 = this.top[this.V];
    const thick = 0.2 * pw;
    this.wristHalfThickness = thick * 0.95;
    for (let i = 0; i <= this.U; i++) {
      const u = this.uParam[i];
      for (let j = 0; j <= this.V; j++) {
        const v = this.vParam[j];
        // Coons patch (bilinearly blended)
        const S = this.S;
        S.set(0, 0, 0)
          .addScaledVector(this.bottom[j], 1 - u)
          .addScaledVector(this.top[j], u)
          .addScaledVector(this.left[i], 1 - v)
          .addScaledVector(this.right[i], v)
          .addScaledVector(B0, -(1 - u) * (1 - v))
          .addScaledVector(B1, -(1 - u) * v)
          .addScaledVector(T0, -u * (1 - v))
          .addScaledVector(T1, -u * v);
        // Thickness: full at the wrist (open, matched by the forearm), rounded at the sides,
        // tapering to a thin web at the knuckle edge.
        const ev = superFalloff(2 * v - 1);
        const eu = superFalloff(Math.max(0, (u - 0.25) / 0.75));
        const base = thick * ev * (0.32 + 0.68 * eu);
        const g = (du: number, dv: number, su: number, sv: number) => Math.exp(-((du * du) / (su * su) + (dv * dv) / (sv * sv)));
        const thenar = 0.55 * g(u - 0.3, v - 0.86, 0.26, 0.17);
        const hypothenar = 0.3 * g(u - 0.42, v - 0.1, 0.3, 0.12);
        const knuckleRidge = 0.18 * g(u - 0.93, 0, 0.08, 10);
        const hp = base * (0.95 + thenar + hypothenar);
        const hd = base * (0.92 + knuckleRidge) - base * 0.12 * g(u - 0.55, v - 0.5, 0.35, 0.35); // gentle dorsal concavity
        const oD = (i * (this.V + 1) + j) * 3;
        const oP = (per + i * (this.V + 1) + j) * 3;
        this.pos[oD] = S.x + N.x * hd;
        this.pos[oD + 1] = S.y + N.y * hd;
        this.pos[oD + 2] = S.z + N.z * hd;
        this.pos[oP] = S.x - N.x * hp;
        this.pos[oP + 1] = S.y - N.y * hp;
        this.pos[oP + 2] = S.z - N.z * hp;
        // Slightly warmer tone in the palm creases region for depth cues.
        const shade = 1 - 0.06 * g(u - 0.55, v - 0.5, 0.3, 0.35);
        this.col[oD] = skin.r;
        this.col[oD + 1] = skin.g;
        this.col[oD + 2] = skin.b;
        this.col[oP] = skin.r * shade;
        this.col[oP + 1] = skin.g * shade;
        this.col[oP + 2] = skin.b * shade;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}

/** Short forearm segment with a superelliptic section that fades out proximally (RGBA vertex colours). */
export class Forearm {
  readonly geometry = new THREE.BufferGeometry();
  private readonly rings = 14;
  private readonly radial = 28;
  private readonly pos: Float32Array;
  private readonly col: Float32Array;
  private readonly C = new THREE.Vector3();

  constructor() {
    const vc = this.rings * this.radial;
    this.pos = new Float32Array(vc * 3);
    this.col = new Float32Array(vc * 4).fill(1);
    const idx: number[] = [];
    for (let r = 0; r < this.rings - 1; r++) {
      for (let k = 0; k < this.radial; k++) {
        const a = r * this.radial + k;
        const b = r * this.radial + ((k + 1) % this.radial);
        const c = a + this.radial;
        const d = b + this.radial;
        idx.push(a, b, c, b, d, c);
      }
    }
    this.geometry.setIndex(idx);
    this.geometry.setAttribute('position', new THREE.BufferAttribute(this.pos, 3).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('color', new THREE.BufferAttribute(this.col, 4).setUsage(THREE.DynamicDrawUsage));
    this.geometry.setAttribute('normal', new THREE.BufferAttribute(new Float32Array(vc * 3), 3));
  }

  update(wrist: THREE.Vector3, A: THREE.Vector3, R: THREE.Vector3, N: THREE.Vector3, palm: PalmSurface, palmWidth: number, skin: THREE.Color): void {
    const len = 1.25 * palmWidth;
    const e = 2 / SUPER_P;
    for (let r = 0; r < this.rings; r++) {
      const k = r / (this.rings - 1);
      const along = 0.02 * palmWidth - len * k;
      this.C.copy(wrist).addScaledVector(A, along);
      const hw = palm.wristHalfWidth * (1 - 0.1 * k);
      const ht = palm.wristHalfThickness * (1 + 0.15 * smoothstep(k));
      const alpha = 1 - smoothstep(Math.max(0, (k - 0.15) / 0.85));
      for (let q = 0; q < this.radial; q++) {
        const th = (q / this.radial) * TAU;
        const c = Math.cos(th);
        const s = Math.sin(th);
        const x = hw * Math.sign(c) * Math.pow(Math.abs(c), e);
        const y = ht * Math.sign(s) * Math.pow(Math.abs(s), e);
        const o = (r * this.radial + q) * 3;
        this.pos[o] = this.C.x + R.x * x + N.x * y;
        this.pos[o + 1] = this.C.y + R.y * x + N.y * y;
        this.pos[o + 2] = this.C.z + R.z * x + N.z * y;
        const oc = (r * this.radial + q) * 4;
        this.col[oc] = skin.r;
        this.col[oc + 1] = skin.g;
        this.col[oc + 2] = skin.b;
        this.col[oc + 3] = alpha;
      }
    }
    this.geometry.attributes.position.needsUpdate = true;
    this.geometry.attributes.color.needsUpdate = true;
    this.geometry.computeVertexNormals();
  }

  dispose(): void {
    this.geometry.dispose();
  }
}
