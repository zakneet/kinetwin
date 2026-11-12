import * as THREE from 'three';

/** Additive Fresnel rim used for the "digital twin" edge glow and the skeleton-mode shell. */
export function createRimMaterial(): THREE.ShaderMaterial {
  return new THREE.ShaderMaterial({
    uniforms: {
      uColorA: { value: new THREE.Color('#3ee6d2') },
      uColorB: { value: new THREE.Color('#8f7cff') },
      uIntensity: { value: 0.55 },
      uPower: { value: 2.6 },
      uOpacity: { value: 1 },
    },
    vertexShader: /* glsl */ `
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying float vHeight;
      void main() {
        vec4 mv = modelViewMatrix * vec4(position, 1.0);
        vNormalV = normalize(normalMatrix * normal);
        vViewDir = normalize(-mv.xyz);
        vHeight = (modelMatrix * vec4(position, 1.0)).y;
        gl_Position = projectionMatrix * mv;
      }
    `,
    fragmentShader: /* glsl */ `
      uniform vec3 uColorA;
      uniform vec3 uColorB;
      uniform float uIntensity;
      uniform float uPower;
      uniform float uOpacity;
      varying vec3 vNormalV;
      varying vec3 vViewDir;
      varying float vHeight;
      void main() {
        float f = pow(1.0 - abs(dot(normalize(vNormalV), normalize(vViewDir))), uPower);
        vec3 col = mix(uColorA, uColorB, smoothstep(-1.6, 2.2, vHeight));
        gl_FragColor = vec4(col * f * uIntensity * uOpacity, 1.0);
      }
    `,
    transparent: true,
    depthWrite: false,
    blending: THREE.AdditiveBlending,
    side: THREE.DoubleSide,
    toneMapped: false,
  });
}

export function createSkinMaterial(alphaVertex = false): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#ffffff',
    vertexColors: true,
    roughness: 0.46,
    metalness: 0,
    sheen: 0.7,
    sheenRoughness: 0.5,
    sheenColor: new THREE.Color('#9be8ff'),
    clearcoat: 0.3,
    clearcoatRoughness: 0.5,
    side: THREE.DoubleSide,
    transparent: true,
    depthWrite: !alphaVertex,
  });
}

export function createNailMaterial(): THREE.MeshPhysicalMaterial {
  return new THREE.MeshPhysicalMaterial({
    color: '#eef3fa',
    roughness: 0.16,
    metalness: 0,
    clearcoat: 1,
    clearcoatRoughness: 0.06,
    side: THREE.DoubleSide,
    transparent: true,
    polygonOffset: true,
    polygonOffsetFactor: -2,
    polygonOffsetUnits: -2,
  });
}

/** Measurement-state ramp: 0° → turquoise, ~50° → azure, ≥100° → violet. Not a diagnostic scale. */
const RAMP = [new THREE.Color('#3ee6d2'), new THREE.Color('#58a6ff'), new THREE.Color('#9b7bff')];
export function flexionColor(deg: number | null, out: THREE.Color): THREE.Color {
  if (deg === null || !Number.isFinite(deg)) return out.set('#f2b661'); // not measurable
  const t = Math.max(0, Math.min(1, Math.abs(deg) / 100));
  if (t < 0.5) return out.copy(RAMP[0]).lerp(RAMP[1], t * 2);
  return out.copy(RAMP[1]).lerp(RAMP[2], (t - 0.5) * 2);
}

export const SKIN = new THREE.Color('#cdd7e3');
export const LOW_CONFIDENCE = new THREE.Color('#f2b661');
