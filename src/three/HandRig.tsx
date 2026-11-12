import { useEffect, useMemo, useRef } from 'react';
import { useFrame, useThree, type ThreeEvent } from '@react-three/fiber';
import * as THREE from 'three';
import { computePalmFrame, JOINT_BY_ID, type JointAngles, type JointId } from '../lib/angles';
import { HAND_CONNECTIONS, type Handedness } from '../lib/landmarks';
import { palmAlignmentBasis, SCENE_SCALE } from '../lib/transforms';
import { appStore } from '../state/appStore';
import type { FrameHub } from '../state/frameHub';
import { FingerTube, Forearm, PalmSurface, type TubeStyle } from './handMesh';
import { createNailMaterial, createRimMaterial, createSkinMaterial, flexionColor, LOW_CONFIDENCE, SKIN } from './materials';

/** Landmark index → measurable joint (for picking and colouring). */
const LANDMARK_JOINT: Partial<Record<number, JointId>> = {
  1: 'thumb_cmc', 2: 'thumb_mcp', 3: 'thumb_ip',
  5: 'index_mcp', 6: 'index_pip', 7: 'index_dip',
  9: 'middle_mcp', 10: 'middle_pip', 11: 'middle_dip',
  13: 'ring_mcp', 14: 'ring_pip', 15: 'ring_dip',
  17: 'little_mcp', 18: 'little_pip', 19: 'little_dip',
};
const JOINT_LANDMARK = Object.fromEntries(Object.entries(LANDMARK_JOINT).map(([k, v]) => [v, Number(k)])) as Record<JointId, number>;

type FingerKey = 'thumb' | 'index' | 'middle' | 'ring' | 'little';
const FINGER_KEYS: FingerKey[] = ['thumb', 'index', 'middle', 'ring', 'little'];
const CHAIN: Record<FingerKey, number[]> = { thumb: [1, 2, 3, 4], index: [5, 6, 7, 8], middle: [9, 10, 11, 12], ring: [13, 14, 15, 16], little: [17, 18, 19, 20] };
/** Radii (fraction of palm width) at [base, joint1, joint2, joint3, tip]. */
const RADII: Record<FingerKey, number[]> = {
  thumb: [0.25, 0.235, 0.2, 0.172, 0.142],
  index: [0.17, 0.165, 0.145, 0.126, 0.112],
  middle: [0.176, 0.171, 0.151, 0.131, 0.115],
  ring: [0.166, 0.161, 0.141, 0.122, 0.108],
  little: [0.146, 0.141, 0.121, 0.105, 0.095],
};
const BULGE: Record<FingerKey, number[]> = {
  thumb: [0, 0.02, 0.07, 0.06, 0],
  index: [0, 0.05, 0.085, 0.065, 0],
  middle: [0, 0.05, 0.085, 0.065, 0],
  ring: [0, 0.05, 0.085, 0.065, 0],
  little: [0, 0.05, 0.08, 0.06, 0],
};
const SEGMENT_JOINTS: Record<FingerKey, (JointId | null)[]> = {
  thumb: [null, 'thumb_cmc', 'thumb_mcp', 'thumb_ip'],
  index: [null, 'index_mcp', 'index_pip', 'index_dip'],
  middle: [null, 'middle_mcp', 'middle_pip', 'middle_dip'],
  ring: [null, 'ring_mcp', 'ring_pip', 'ring_dip'],
  little: [null, 'little_mcp', 'little_pip', 'little_dip'],
};
const TIPS = [4, 8, 12, 16, 20];
const LANDMARK_FINGER: (FingerKey | null)[] = Array.from({ length: 21 }, (_, i) => FINGER_KEYS.find((f) => CHAIN[f].includes(i)) ?? null);
const BONES: [number, number][] = [...HAND_CONNECTIONS.map(([a, b]) => [a, b] as [number, number]), [1, 5]];
const TRAIL_LEN = 46;

interface Props {
  hub: FrameHub;
  /** Hide everything until the first real sample arrives (never shows a fabricated pose). */
  interactive?: boolean;
}

export function HandRig({ hub, interactive = true }: Props) {
  const group = useRef<THREE.Group>(null);
  const camera = useThree((s) => s.camera);

  const parts = useMemo(() => {
    const fingers = Object.fromEntries(FINGER_KEYS.map((f) => [f, new FingerTube(5)])) as Record<FingerKey, FingerTube>;
    const palm = new PalmSurface();
    const forearm = new Forearm();
    const skin = createSkinMaterial();
    const forearmMat = createSkinMaterial(true);
    const nail = createNailMaterial();
    const rim = createRimMaterial();
    const markerGeo = new THREE.SphereGeometry(1, 20, 14);
    const markerMat = new THREE.MeshBasicMaterial({ toneMapped: false, transparent: true });
    const markers = new THREE.InstancedMesh(markerGeo, markerMat, 21);
    markers.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    markers.frustumCulled = false;
    for (let i = 0; i < 21; i++) markers.setColorAt(i, new THREE.Color('#ffffff'));
    const boneGeo = new THREE.CylinderGeometry(1, 1, 1, 12, 1, false);
    const boneMat = new THREE.MeshStandardMaterial({ color: '#9ff4ea', emissive: new THREE.Color('#1fb8aa'), emissiveIntensity: 0.9, roughness: 0.35, metalness: 0.1, transparent: true });
    const bones = new THREE.InstancedMesh(boneGeo, boneMat, BONES.length);
    bones.instanceMatrix.setUsage(THREE.DynamicDrawUsage);
    bones.frustumCulled = false;
    const trails = TIPS.map(() => {
      const g = new THREE.BufferGeometry();
      g.setAttribute('position', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 3), 3).setUsage(THREE.DynamicDrawUsage));
      g.setAttribute('color', new THREE.BufferAttribute(new Float32Array(TRAIL_LEN * 4), 4).setUsage(THREE.DynamicDrawUsage));
      const line = new THREE.Line(g, new THREE.LineBasicMaterial({ vertexColors: true, transparent: true, depthWrite: false, toneMapped: false }));
      line.frustumCulled = false;
      return { line, count: 0 };
    });
    const halo = new THREE.Mesh(
      new THREE.TorusGeometry(1, 0.08, 10, 48),
      new THREE.MeshBasicMaterial({ color: '#ffffff', toneMapped: false, transparent: true, depthTest: false }),
    );
    halo.renderOrder = 10;
    return { fingers, palm, forearm, skin, forearmMat, nail, rim, markers, bones, trails, halo };
  }, []);

  useEffect(
    () => () => {
      FINGER_KEYS.forEach((f) => parts.fingers[f].dispose());
      parts.palm.dispose();
      parts.forearm.dispose();
      [parts.skin, parts.forearmMat, parts.nail, parts.rim].forEach((m) => m.dispose());
      parts.markers.geometry.dispose();
      (parts.markers.material as THREE.Material).dispose();
      parts.bones.geometry.dispose();
      (parts.bones.material as THREE.Material).dispose();
      parts.trails.forEach((t) => {
        t.line.geometry.dispose();
        (t.line.material as THREE.Material).dispose();
      });
    },
    [parts],
  );

  // Per-frame working state (no allocations inside the loop).
  const st = useMemo(
    () => ({
      target: Array.from({ length: 21 }, () => new THREE.Vector3()),
      disp: Array.from({ length: 21 }, () => new THREE.Vector3()),
      P: Array.from({ length: 21 }, () => new THREE.Vector3()),
      marker: Array.from({ length: 21 }, () => new THREE.Vector3()),
      ctrl: Array.from({ length: 5 }, () => new THREE.Vector3()),
      centroid: new THREE.Vector3(),
      distal: new THREE.Vector3(),
      radial: new THREE.Vector3(),
      dorsal: new THREE.Vector3(),
      thumbRef: new THREE.Vector3(),
      tmp: new THREE.Vector3(),
      tmp2: new THREE.Vector3(),
      localCam: new THREE.Vector3(),
      color: new THREE.Color(),
      color2: new THREE.Color(),
      quat: new THREE.Quaternion(),
      quatTarget: new THREE.Quaternion(),
      mat: new THREE.Matrix4(),
      mat2: new THREE.Matrix4(),
      scaleV: new THREE.Vector3(),
      up: new THREE.Vector3(0, 1, 0),
      qIdentity: new THREE.Quaternion(),
      qBone: new THREE.Quaternion(),
      hasPose: false,
      visibility: 0,
      palmWidth: 0,
      angles: null as JointAngles | null,
      handedness: 'Right' as Handedness,
      score: 0,
      lastVersion: -1,
      trailTick: 0,
      style: { radii: [0, 0, 0, 0, 0], bulge: [0, 0, 0, 0, 0], width: 1.08 } as TubeStyle,
    }),
    [],
  );

  // Selected-joint label: a plain DOM element positioned by projecting the joint each frame
  // (avoids creating a nested React root per label).
  const gl = useThree((s) => s.gl);
  const labelEl = useMemo(() => {
    const d = document.createElement('div');
    d.className = 'joint-label';
    Object.assign(d.style, { position: 'absolute', left: '0', top: '0', pointerEvents: 'none', display: 'none', zIndex: '5' });
    return d;
  }, []);
  useEffect(() => {
    const host = gl.domElement.parentElement?.parentElement ?? gl.domElement.parentElement;
    host?.appendChild(labelEl);
    return () => labelEl.remove();
  }, [gl, labelEl]);

  useFrame((state, delta) => {
    const g = group.current;
    if (!g) return;
    const settings = appStore.get();
    const sample = hub.current;
    const dt = Math.min(0.1, delta);

    if (sample) {
      const w = sample.frame.world;
      for (let i = 0; i < 21; i++) st.target[i].set(w[i].x * SCENE_SCALE, -w[i].y * SCENE_SCALE, -w[i].z * SCENE_SCALE);
      st.angles = sample.analysis.angles;
      st.handedness = sample.frame.handedness;
      st.score = sample.frame.handednessScore;
      if (!st.hasPose) {
        for (let i = 0; i < 21; i++) st.disp[i].copy(st.target[i]);
        st.hasPose = true;
        st.trailTick = 0;
        parts.trails.forEach((t) => (t.count = 0));
      }
    }
    if (!st.hasPose) {
      g.visible = false;
      return;
    }
    g.visible = true;

    // Display interpolation toward the latest measured pose (render runs faster than tracking).
    const k = 1 - Math.exp(-dt * 30);
    for (let i = 0; i < 21; i++) st.disp[i].lerp(st.target[i], k);
    const targetVis = sample ? 1 : 0.16;
    st.visibility += (targetVis - st.visibility) * (1 - Math.exp(-dt * 6));

    // Orientation: camera view, or palm-aligned "anatomical" view.
    st.centroid.set(0, 0, 0);
    for (let i = 0; i < 21; i++) st.centroid.add(st.disp[i]);
    st.centroid.multiplyScalar(1 / 21);
    if (settings.orientation === 'anatomical') {
      const pf = computePalmFrame(st.disp, st.handedness);
      const basis = pf ? palmAlignmentBasis(pf.distal, pf.radial, st.handedness) : null;
      if (basis) {
        st.mat.set(basis[0], basis[1], basis[2], 0, basis[3], basis[4], basis[5], 0, basis[6], basis[7], basis[8], 0, 0, 0, 0, 1);
        st.quatTarget.setFromRotationMatrix(st.mat);
      }
    } else {
      st.quatTarget.identity();
    }
    st.quat.slerp(st.quatTarget, 1 - Math.exp(-dt * 8));
    for (let i = 0; i < 21; i++) st.P[i].copy(st.disp[i]).sub(st.centroid).applyQuaternion(st.quat);

    g.scale.set(settings.mirror ? -1 : 1, 1, 1);

    // Palm frame in scene space.
    const pf = computePalmFrame(st.P, st.handedness);
    if (pf) {
      st.distal.set(pf.distal.x, pf.distal.y, pf.distal.z);
      st.radial.set(pf.radial.x, pf.radial.y, pf.radial.z);
      st.dorsal.set(-pf.palmar.x, -pf.palmar.y, -pf.palmar.z);
    }
    const pwNow = st.P[5].distanceTo(st.P[17]);
    st.palmWidth = st.palmWidth === 0 ? pwNow : st.palmWidth + (pwNow - st.palmWidth) * 0.08;
    const pw = Math.max(0.05, st.palmWidth);
    const lowConf = st.score < 0.7 || !sample;
    const flexMap = settings.flexionMap;
    const angles = st.angles;

    // Fingers
    st.thumbRef.copy(st.radial).multiplyScalar(0.8).addScaledVector(st.dorsal, 0.6).normalize();
    for (const f of FINGER_KEYS) {
      const chain = CHAIN[f];
      const c = st.ctrl;
      if (f === 'thumb') {
        st.tmp.copy(st.P[2]).sub(st.P[1]).normalize();
        c[0].copy(st.P[1]).addScaledVector(st.tmp, -0.32 * pw);
      } else {
        st.tmp.copy(st.P[chain[0]]).sub(st.P[0]).normalize();
        c[0].copy(st.P[chain[0]]).addScaledVector(st.tmp, -0.3 * pw);
      }
      for (let j = 0; j < 4; j++) c[j + 1].copy(st.P[chain[j]]);
      const r = RADII[f];
      for (let j = 0; j < 5; j++) st.style.radii[j] = r[j] * pw;
      st.style.bulge = BULGE[f];
      st.style.width = f === 'thumb' ? 1.04 : 1.1;
      const segJoints = SEGMENT_JOINTS[f];
      parts.fingers[f].update(c, st.style, f === 'thumb' ? st.thumbRef : st.dorsal, (seg, t, out) => {
        if (!flexMap) {
          out.copy(SKIN);
          return;
        }
        const id = segJoints[Math.min(seg, segJoints.length - 1)];
        const prevId = seg > 0 ? segJoints[seg - 1] : null;
        if (!id || !angles) {
          out.copy(SKIN);
          return;
        }
        flexionColor(angles[id], out);
        if (prevId && t < 0.3) {
          flexionColor(angles[prevId], st.color2);
          out.lerp(st.color2, 0.5 * (1 - t / 0.3));
        } else if (!prevId && t < 0.5) {
          out.lerp(SKIN, 1 - t / 0.5);
        }
      });
    }

    // Palm + forearm
    parts.palm.update(
      {
        p: st.P,
        distal: st.distal,
        radial: st.radial,
        dorsal: st.dorsal,
        palmWidth: pw,
        baseRadius: [RADII.index[1] * pw, RADII.middle[1] * pw, RADII.ring[1] * pw, RADII.little[1] * pw],
      },
      SKIN,
    );
    parts.forearm.update(st.P[0], st.distal, st.radial, st.dorsal, parts.palm, pw, SKIN);

    // Materials per mode
    const skeleton = settings.renderMode === 'skeleton';
    const vis = st.visibility;
    parts.skin.opacity = (skeleton ? 0.07 : 1) * vis;
    parts.skin.depthWrite = !skeleton && vis > 0.9;
    parts.forearmMat.opacity = (skeleton ? 0.05 : 0.9) * vis;
    parts.nail.opacity = (skeleton ? 0 : 1) * vis;
    parts.rim.uniforms.uIntensity.value = skeleton ? 1.1 : 0.5;
    parts.rim.uniforms.uOpacity.value = vis;

    // Joint markers: on the skin facing the camera (surface mode) or at joint centres (skeleton mode).
    st.localCam.copy(camera.position);
    g.worldToLocal(st.localCam);
    const markerSize = (skeleton ? 0.075 : 0.05) * pw;
    for (let i = 0; i < 21; i++) {
      const m = st.marker[i];
      m.copy(st.P[i]);
      if (!skeleton && !TIPS.includes(i)) {
        // tangent of the chain at this landmark
        const prev = i === 0 ? 9 : i === 1 || i === 5 || i === 9 || i === 13 || i === 17 ? 0 : i - 1;
        const next = i === 0 ? 9 : i + 1;
        st.tmp.copy(st.P[next]).sub(st.P[prev]).normalize();
        st.tmp2.copy(st.localCam).sub(st.P[i]);
        st.tmp2.addScaledVector(st.tmp, -st.tmp2.dot(st.tmp)).normalize();
        const finger = LANDMARK_FINGER[i];
        const idx = finger ? CHAIN[finger].indexOf(i) + 1 : 0;
        const rad = finger ? RADII[finger][idx] * pw * 1.02 : 0.24 * pw;
        m.addScaledVector(st.tmp2, rad);
      }
      const isSelected = settings.selectedJoint !== null && JOINT_LANDMARK[settings.selectedJoint] === i;
      const sz = markerSize * (isSelected ? 1.6 : TIPS.includes(i) ? 0.75 : i === 0 ? 1.1 : 1);
      st.mat.compose(m, st.qIdentity, st.scaleV.set(sz, sz, sz));
      parts.markers.setMatrixAt(i, st.mat);
      const jid = LANDMARK_JOINT[i];
      if (lowConf) st.color.copy(LOW_CONFIDENCE);
      else if (isSelected) st.color.set('#ffffff');
      else if (jid && angles) flexionColor(angles[jid], st.color);
      else st.color.set('#dce7f5');
      parts.markers.setColorAt(i, st.color);
    }
    parts.markers.instanceMatrix.needsUpdate = true;
    if (parts.markers.instanceColor) parts.markers.instanceColor.needsUpdate = true;
    (parts.markers.material as THREE.MeshBasicMaterial).opacity = vis;

    // Bones (skeleton mode)
    parts.bones.visible = skeleton;
    if (skeleton) {
      const br = 0.03 * pw;
      BONES.forEach(([a, b], i) => {
        st.tmp.copy(st.P[b]).sub(st.P[a]);
        const len = st.tmp.length();
        st.tmp2.copy(st.P[a]).add(st.P[b]).multiplyScalar(0.5);
        st.qBone.setFromUnitVectors(st.up, st.tmp.normalize());
        st.mat.compose(st.tmp2, st.qBone, st.scaleV.set(br, len, br));
        parts.bones.setMatrixAt(i, st.mat);
      });
      parts.bones.instanceMatrix.needsUpdate = true;
      (parts.bones.material as THREE.MeshStandardMaterial).opacity = vis;
    }

    // Fingertip motion trails (hand-relative paths).
    const showTrails = settings.showTrails && !!sample;
    st.trailTick++;
    parts.trails.forEach((tr, ti) => {
      tr.line.visible = settings.showTrails;
      const pos = tr.line.geometry.attributes.position as THREE.BufferAttribute;
      const col = tr.line.geometry.attributes.color as THREE.BufferAttribute;
      const pa = pos.array as Float32Array;
      const ca = col.array as Float32Array;
      if (showTrails && st.trailTick % 2 === 0) {
        pa.copyWithin(3, 0, (TRAIL_LEN - 1) * 3);
        const tip = st.P[TIPS[ti]];
        pa[0] = tip.x;
        pa[1] = tip.y;
        pa[2] = tip.z;
        tr.count = Math.min(TRAIL_LEN, tr.count + 1);
      } else if (!sample) {
        tr.count = Math.max(0, tr.count - 1);
      }
      flexionColor(ti === 0 ? 0 : 50, st.color);
      for (let i = 0; i < TRAIL_LEN; i++) {
        const a = i < tr.count ? Math.pow(1 - i / TRAIL_LEN, 1.6) * 0.85 * vis : 0;
        ca[i * 4] = st.color.r;
        ca[i * 4 + 1] = st.color.g;
        ca[i * 4 + 2] = st.color.b;
        ca[i * 4 + 3] = a;
      }
      tr.line.geometry.setDrawRange(0, Math.max(0, tr.count));
      pos.needsUpdate = true;
      col.needsUpdate = true;
    });

    // Selected joint halo + label
    const sel = settings.selectedJoint;
    if (sel) {
      const li = JOINT_LANDMARK[sel];
      parts.halo.position.copy(st.marker[li]);
      parts.halo.visible = true;
      // halo faces the camera (in the group's local frame)
      g.getWorldQuaternion(st.qBone).invert();
      parts.halo.quaternion.copy(st.qBone).multiply(camera.quaternion);
      const s = markerSize * (2.4 + 0.25 * Math.sin(performance.now() / 260));
      parts.halo.scale.set(s, s, s);
      st.tmp.copy(st.marker[li]).applyMatrix4(g.matrixWorld).project(camera);
      const x = (st.tmp.x * 0.5 + 0.5) * state.size.width;
      const y = (-st.tmp.y * 0.5 + 0.5) * state.size.height;
      labelEl.style.display = st.tmp.z < 1 ? 'block' : 'none';
      labelEl.style.transform = `translate(${x.toFixed(1)}px, ${(y - 22).toFixed(1)}px) translate(-50%, -100%)`;
      // Never show a stale value: while the hand is not tracked the label says so.
      const v = sample ? angles?.[sel] : null;
      const def = JOINT_BY_ID[sel];
      const txt = `${def.label}${def.approximate ? ' ≈' : ''}  ${sample ? (v === null || v === undefined ? '—' : `${v.toFixed(0)}°`) : 'not tracked'}`;
      if (labelEl.textContent !== txt) labelEl.textContent = txt;
    } else {
      parts.halo.visible = false;
      labelEl.style.display = 'none';
    }
  });

  const onPick = (e: ThreeEvent<MouseEvent>) => {
    if (!interactive || e.instanceId === undefined) return;
    e.stopPropagation();
    const jid = LANDMARK_JOINT[e.instanceId];
    if (!jid) return;
    const cur = appStore.get().selectedJoint;
    appStore.set({ selectedJoint: cur === jid ? null : jid });
  };

  return (
    <group ref={group} visible={false}>
      {FINGER_KEYS.map((f) => (
        <group key={f}>
          <mesh geometry={parts.fingers[f].geometry} material={parts.skin} frustumCulled={false} />
          <mesh geometry={parts.fingers[f].geometry} material={parts.rim} frustumCulled={false} renderOrder={2} />
          <mesh geometry={parts.fingers[f].nailGeometry} material={parts.nail} frustumCulled={false} renderOrder={1} />
        </group>
      ))}
      <mesh geometry={parts.palm.geometry} material={parts.skin} frustumCulled={false} />
      <mesh geometry={parts.palm.geometry} material={parts.rim} frustumCulled={false} renderOrder={2} />
      <mesh geometry={parts.forearm.geometry} material={parts.forearmMat} frustumCulled={false} renderOrder={1} />
      <primitive object={parts.bones} />
      <primitive
        object={parts.markers}
        onClick={onPick}
        onPointerOver={(e: ThreeEvent<PointerEvent>) => {
          if (interactive && e.instanceId !== undefined && LANDMARK_JOINT[e.instanceId]) document.body.style.cursor = 'pointer';
        }}
        onPointerOut={() => (document.body.style.cursor = '')}
      />
      {parts.trails.map((t, i) => (
        <primitive key={i} object={t.line} />
      ))}
      <primitive object={parts.halo} />
    </group>
  );
}
