import * as THREE from "three";
import { CAMERA_PITCH } from "../systems/rtsCamera";

export interface HealthBar {
  group: THREE.Group;
  setFraction(fraction: number): void;
}

/** A small billboard-style bar tilted to face the RTS camera's fixed
 * viewing angle (cheap: no per-frame lookAt needed since the camera
 * never rotates in yaw/pitch). */
export function createHealthBar(width = 1.2, height = 0.16): HealthBar {
  const group = new THREE.Group();
  group.rotation.x = -CAMERA_PITCH;

  const bg = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height),
    new THREE.MeshBasicMaterial({ color: 0x000000, transparent: true, opacity: 0.55 }),
  );
  group.add(bg);

  const fill = new THREE.Mesh(
    new THREE.PlaneGeometry(width, height * 0.7),
    new THREE.MeshBasicMaterial({ color: 0x4ade5a }),
  );
  fill.position.z = 0.001;
  group.add(fill);

  function setFraction(fraction: number) {
    const f = THREE.MathUtils.clamp(fraction, 0, 1);
    fill.scale.x = Math.max(f, 0.001);
    fill.position.x = -width / 2 + (f * width) / 2;
    const color = f > 0.5 ? 0x4ade5a : f > 0.25 ? 0xe0b13a : 0xe0473a;
    (fill.material as THREE.MeshBasicMaterial).color.setHex(color);
  }

  setFraction(1);
  return { group, setFraction };
}
