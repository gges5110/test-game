import * as THREE from "three";
import {
  BloomEffect,
  EffectComposer,
  EffectPass,
  OutlineEffect,
  RenderPass,
} from "postprocessing";

/**
 * Post-processing stack, built on pmndrs `postprocessing` rather than three's
 * own EffectComposer. Two reasons: it merges effects into a single fullscreen
 * pass (three runs one pass each), and it ships an outline effect three has no
 * equivalent for — which is what selection highlighting actually wants.
 *
 * - Bloom: a soft glow on bright emissives (lanterns, forge, wolf eyes,
 *   arrows) so light sources read as light rather than flat bright triangles.
 * - Outline: draws a rim around whatever is currently selected, the way an
 *   RTS marks its units, instead of relying only on the ground ring.
 */
export interface PostFx {
  composer: EffectComposer;
  setSize: (width: number, height: number) => void;
  /** Replaces the set of objects drawn with a selection outline. */
  setOutlined: (objects: THREE.Object3D[]) => void;
}

export function createComposer(
  renderer: THREE.WebGLRenderer,
  scene: THREE.Scene,
  camera: THREE.Camera,
): PostFx {
  const composer = new EffectComposer(renderer);
  composer.addPass(new RenderPass(scene, camera));

  const bloom = new BloomEffect({
    intensity: 0.7,
    luminanceThreshold: 0.75,
    luminanceSmoothing: 0.3,
    mipmapBlur: true,
  });

  const outline = new OutlineEffect(scene, camera, {
    edgeStrength: 6,
    pulseSpeed: 0,
    visibleEdgeColor: 0xffe9a6,
    hiddenEdgeColor: 0x7a6a3a,
    blur: false,
    xRay: true,
  });

  composer.addPass(new EffectPass(camera, bloom, outline));

  return {
    composer,
    setSize: (width, height) => composer.setSize(width, height),
    setOutlined: (objects) => {
      // Selection.add() only flags the exact object passed, not its
      // descendants — a unit's outer Group carries no geometry of its own,
      // so passing the group directly outlines nothing. Traverse down to
      // the actual meshes.
      const meshes: THREE.Object3D[] = [];
      for (const object of objects) {
        object.traverse((child) => {
          if ((child as THREE.Mesh).isMesh) meshes.push(child);
        });
      }
      outline.selection.set(meshes);
    },
  };
}
