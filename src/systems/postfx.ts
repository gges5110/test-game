import * as THREE from "three";
import { EffectComposer } from "three/examples/jsm/postprocessing/EffectComposer.js";
import { RenderPass } from "three/examples/jsm/postprocessing/RenderPass.js";
import { UnrealBloomPass } from "three/examples/jsm/postprocessing/UnrealBloomPass.js";
import { OutputPass } from "three/examples/jsm/postprocessing/OutputPass.js";

/** A soft, subtle bloom on bright emissives (lanterns, forge glow, wolf
 * eyes, attack beams) — the finishing touch for a painterly look, where
 * light sources glow instead of just being flat-colored triangles. */
export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): { composer: EffectComposer; setSize: (width: number, height: number) => void } {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new UnrealBloomPass(new THREE.Vector2(window.innerWidth, window.innerHeight), 0.35, 0.6, 0.82);
  composer.addPass(bloom);
  composer.addPass(new OutputPass());

  const setSize = (width: number, height: number) => {
    composer.setSize(width, height);
    bloom.setSize(width, height);
  };

  return { composer, setSize };
}
