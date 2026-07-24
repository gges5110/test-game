import * as THREE from "three";

export interface Campfire {
  group: THREE.Group;
  flame: THREE.Mesh;
  light: THREE.PointLight;
}

export function createCampfire(): Campfire {
  const group = new THREE.Group();

  const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3323 });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(
      new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5),
      logMat,
    );
    log.rotation.z = Math.PI / 2;
    log.rotation.y = (i / 4) * Math.PI * 2;
    log.position.y = 0.12;
    log.castShadow = true;
    group.add(log);
  }

  const flame = new THREE.Mesh(
    new THREE.ConeGeometry(0.18, 0.5, 8),
    new THREE.MeshStandardMaterial({
      color: 0xff8c30,
      emissive: 0xff5500,
      emissiveIntensity: 1.5,
    }),
  );
  flame.position.y = 0.4;
  group.add(flame);

  const light = new THREE.PointLight(0xff9a4a, 3.5, 12, 2);
  light.position.y = 0.6;
  group.add(light);

  return { group, flame, light };
}
