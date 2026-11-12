import { Suspense, useEffect, useMemo, useRef, type RefObject } from 'react';
import { Canvas, useFrame } from '@react-three/fiber';
import { ContactShadows, Environment, Lightformer, OrbitControls } from '@react-three/drei';
import type { OrbitControls as OrbitControlsImpl } from 'three-stdlib';
import * as THREE from 'three';
import { appStore } from '../state/appStore';
import { useStore } from '../state/store';
import type { FrameHub } from '../state/frameHub';
import { HandRig } from './HandRig';

/** Concentric "scanner bed" under the hand: purely decorative depth reference. */
function Platform() {
  const mat = useMemo(
    () =>
      new THREE.ShaderMaterial({
        transparent: true,
        depthWrite: false,
        toneMapped: false,
        uniforms: { uTime: { value: 0 } },
        vertexShader: /* glsl */ `
          varying vec2 vUv;
          void main() { vUv = uv; gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0); }
        `,
        fragmentShader: /* glsl */ `
          varying vec2 vUv;
          uniform float uTime;
          void main() {
            vec2 p = vUv * 2.0 - 1.0;
            float r = length(p);
            if (r > 1.0) discard;
            float rings = smoothstep(0.035, 0.0, abs(fract(r * 7.0 - uTime * 0.05) - 0.5) - 0.46);
            float edge = smoothstep(1.0, 0.92, r) * smoothstep(0.86, 0.9, r);
            float fade = pow(1.0 - r, 1.4);
            vec3 cyan = vec3(0.24, 0.9, 0.82);
            vec3 violet = vec3(0.56, 0.49, 1.0);
            vec3 col = mix(cyan, violet, smoothstep(0.2, 1.0, r));
            float a = rings * 0.16 * fade + edge * 0.22 + fade * 0.05;
            gl_FragColor = vec4(col * a, a);
          }
        `,
      }),
    [],
  );
  useFrame((_, dt) => {
    mat.uniforms.uTime.value += dt;
  });
  useEffect(() => () => mat.dispose(), [mat]);
  return (
    <mesh rotation-x={-Math.PI / 2} position={[0, -2.35, 0]} material={mat}>
      <planeGeometry args={[6.4, 6.4]} />
    </mesh>
  );
}

function CameraReset({ controls }: { controls: RefObject<OrbitControlsImpl | null> }) {
  const nonce = useStore(appStore, (s) => s.cameraResetNonce);
  useEffect(() => {
    if (nonce > 0) controls.current?.reset();
  }, [nonce, controls]);
  return null;
}

interface Props {
  hub: FrameHub;
  className?: string;
  /** Lower-cost rendering for secondary views. */
  compact?: boolean;
}

export function HandTwin({ hub, className, compact = false }: Props) {
  const controls = useRef<OrbitControlsImpl | null>(null);
  return (
    <div className={className}>
      <Canvas
        dpr={compact ? [1, 1.5] : [1, 2]}
        camera={{ position: [0, 0.4, 7.4], fov: 36, near: 0.1, far: 100 }}
        gl={{ antialias: true, alpha: true, powerPreference: 'high-performance' }}
        onCreated={({ gl }) => {
          gl.toneMapping = THREE.ACESFilmicToneMapping;
          gl.toneMappingExposure = 1.05;
        }}
        onPointerMissed={() => appStore.set({ selectedJoint: null })}
      >
        <hemisphereLight args={['#cfeeff', '#1a1236', 0.55]} />
        <directionalLight position={[3.5, 6, 5]} intensity={2.2} color="#ffffff" />
        <directionalLight position={[-5, 2, 3]} intensity={0.7} color="#7fdcff" />
        <directionalLight position={[-2, 4, -6]} intensity={1.8} color="#a28bff" />
        <Suspense fallback={null}>
          <Environment resolution={128} frames={1}>
            <Lightformer form="rect" intensity={2.2} color="#e8f6ff" position={[0, 5, 3]} scale={[8, 2, 1]} />
            <Lightformer form="rect" intensity={1.4} color="#5ee7da" position={[-6, 1, 0]} rotation-y={Math.PI / 2} scale={[6, 3, 1]} />
            <Lightformer form="rect" intensity={1.2} color="#8f7cff" position={[6, 1, -2]} rotation-y={-Math.PI / 2} scale={[6, 3, 1]} />
            <Lightformer form="ring" intensity={0.8} color="#ffffff" position={[0, -4, 4]} scale={3} />
          </Environment>
        </Suspense>
        <HandRig hub={hub} />
        <Platform />
        {!compact && <ContactShadows position={[0, -2.34, 0]} opacity={0.42} scale={7} blur={2.6} far={4.5} resolution={256} color="#02040a" />}
        <OrbitControls ref={controls} makeDefault enableDamping dampingFactor={0.08} minDistance={3.2} maxDistance={14} enablePan={false} />
        <CameraReset controls={controls} />
      </Canvas>
    </div>
  );
}
