import * as THREE from "three";

const SKY_TOP = new THREE.Color(0x8ec9e8);
const SKY_HORIZON = new THREE.Color(0xfbe3c2);
const FOG_COLOR = new THREE.Color(0xf3dcc0);
const SUN_COLOR = new THREE.Color(0xffe9c7);
const GROUND_BOUNCE = new THREE.Color(0x6a7a4a);

/** A soft vertical gradient sky (rendered as a large inverted sphere), the
 * backbone of a painterly look — a flat background color reads flat/gamey,
 * a gradient reads atmospheric. */
function createSkyDome(): THREE.Mesh {
  const geometry = new THREE.SphereGeometry(300, 24, 16);
  const material = new THREE.ShaderMaterial({
    side: THREE.BackSide,
    depthWrite: false,
    fog: false,
    uniforms: {
      topColor: { value: SKY_TOP },
      horizonColor: { value: SKY_HORIZON },
    },
    vertexShader: `
      varying vec3 vWorldPosition;
      void main() {
        vec4 worldPosition = modelMatrix * vec4(position, 1.0);
        vWorldPosition = worldPosition.xyz;
        gl_Position = projectionMatrix * modelViewMatrix * vec4(position, 1.0);
      }
    `,
    fragmentShader: `
      varying vec3 vWorldPosition;
      uniform vec3 topColor;
      uniform vec3 horizonColor;
      void main() {
        float h = normalize(vWorldPosition).y;
        float t = smoothstep(-0.05, 0.55, h);
        gl_FragColor = vec4(mix(horizonColor, topColor, t), 1.0);
      }
    `,
  });
  return new THREE.Mesh(geometry, material);
}

/** Static daytime lighting (no day/night cycle), tuned soft and warm for a
 * painterly look: gentle sun, hemisphere bounce light instead of flat
 * ambient, and distance fog to fade the horizon into the sky. */
export function createLighting(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(SUN_COLOR, 2.4);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  sun.shadow.radius = 3;
  scene.add(sun);
  scene.add(sun.target);

  // Hemisphere light gives soft, evenly-lit sky/ground bounce instead of a
  // flat ambient wash — the single biggest lever for a "painted" look.
  const hemi = new THREE.HemisphereLight(SKY_TOP, GROUND_BOUNCE, 1.1);
  scene.add(hemi);

  scene.add(createSkyDome());
  scene.fog = new THREE.Fog(FOG_COLOR, 90, 320);
}
