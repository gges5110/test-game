import * as THREE from "three";

const SKY_DAY = new THREE.Color(0x87ceeb);
const SUN_DAY = new THREE.Color(0xfff4e0);

/** Static daytime lighting (no day/night cycle). */
export function createLighting(scene: THREE.Scene) {
  const sun = new THREE.DirectionalLight(SUN_DAY, 3);
  sun.position.set(60, 90, 40);
  sun.castShadow = true;
  sun.shadow.mapSize.set(1024, 1024);
  sun.shadow.camera.left = -100;
  sun.shadow.camera.right = 100;
  sun.shadow.camera.top = 100;
  sun.shadow.camera.bottom = -100;
  scene.add(sun);
  scene.add(sun.target);

  const ambient = new THREE.AmbientLight(0x8899aa, 1.2);
  scene.add(ambient);

  scene.background = SKY_DAY.clone();
}
