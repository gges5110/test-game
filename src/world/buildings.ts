import * as THREE from "three";
import { createHealthBar, type HealthBar } from "./healthBar";

function createHouseMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallMat = new THREE.MeshStandardMaterial({ color: 0xd9c19a });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x8a4a3a });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.2, 1.6, 2.2), wallMat);
  walls.position.y = 0.8;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(1.7, 1.1, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.position.y = 2.15;
  roof.castShadow = true;
  group.add(roof);

  return group;
}

function createStorageMesh(): THREE.Group {
  const group = new THREE.Group();
  const baseMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
  const base = new THREE.Mesh(new THREE.BoxGeometry(1.4, 1, 1.4), baseMat);
  base.position.y = 0.5;
  base.castShadow = true;
  group.add(base);

  const barrelMat = new THREE.MeshStandardMaterial({ color: 0x8a6238 });
  for (const dx of [-0.5, 0.5]) {
    const barrel = new THREE.Mesh(
      new THREE.CylinderGeometry(0.25, 0.25, 0.7, 8),
      barrelMat,
    );
    barrel.position.set(dx, 1.35, 0);
    barrel.castShadow = true;
    group.add(barrel);
  }

  return group;
}

function createTownCenterMesh(): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0xb0a898 });
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x6a3a3a });
  const flagMat = new THREE.MeshStandardMaterial({ color: 0xc0392b });

  const base = new THREE.Mesh(new THREE.CylinderGeometry(1.6, 1.8, 2.2, 8), stoneMat);
  base.position.y = 1.1;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const roof = new THREE.Mesh(new THREE.ConeGeometry(2, 1.6, 8), roofMat);
  roof.position.y = 3;
  roof.castShadow = true;
  group.add(roof);

  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a3025 }),
  );
  pole.position.y = 4.5;
  group.add(pole);

  const flag = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.35), flagMat);
  flag.position.set(0.28, 4.9, 0);
  flag.material.side = THREE.DoubleSide;
  group.add(flag);

  return group;
}

function createFarmMesh(): THREE.Group {
  const group = new THREE.Group();
  const soilMat = new THREE.MeshStandardMaterial({ color: 0x5a4530 });
  const soil = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.1, 2.6), soilMat);
  soil.position.y = 0.05;
  soil.receiveShadow = true;
  group.add(soil);

  const cropMat = new THREE.MeshStandardMaterial({ color: 0x8fbf4a, flatShading: true });
  for (let x = -0.8; x <= 0.8; x += 0.8) {
    for (let z = -0.8; z <= 0.8; z += 0.8) {
      const crop = new THREE.Mesh(new THREE.ConeGeometry(0.12, 0.35, 5), cropMat);
      crop.position.set(x, 0.28, z);
      crop.castShadow = true;
      group.add(crop);
    }
  }

  return group;
}

function createBlacksmithMesh(): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x8a8378 });
  const walls = new THREE.Mesh(new THREE.BoxGeometry(2, 1.4, 1.8), stoneMat);
  walls.position.y = 0.7;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const chimney = new THREE.Mesh(
    new THREE.CylinderGeometry(0.18, 0.2, 0.9, 6),
    stoneMat,
  );
  chimney.position.set(0.6, 1.85, 0);
  chimney.castShadow = true;
  group.add(chimney);

  const forgeGlow = new THREE.Mesh(
    new THREE.BoxGeometry(0.4, 0.3, 0.1),
    new THREE.MeshStandardMaterial({
      color: 0xff6a2a,
      emissive: 0xff4500,
      emissiveIntensity: 1.8,
    }),
  );
  forgeGlow.position.set(0, 0.5, 0.91);
  group.add(forgeGlow);

  return group;
}

function createWallMesh(): THREE.Group {
  const group = new THREE.Group();
  const mat = new THREE.MeshStandardMaterial({ color: 0x9a9086, flatShading: true });
  const segment = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.2, 0.3), mat);
  segment.position.y = 0.6;
  segment.castShadow = true;
  group.add(segment);
  return group;
}

function createTowerMesh(): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = new THREE.MeshStandardMaterial({ color: 0x9a9086 });

  const shaft = new THREE.Mesh(new THREE.CylinderGeometry(0.7, 0.9, 2.6, 8), stoneMat);
  shaft.position.y = 1.3;
  shaft.castShadow = true;
  shaft.receiveShadow = true;
  group.add(shaft);

  const crownMat = new THREE.MeshStandardMaterial({ color: 0x7a746a });
  for (let i = 0; i < 8; i++) {
    const angle = (i / 8) * Math.PI * 2;
    const battlement = new THREE.Mesh(new THREE.BoxGeometry(0.25, 0.3, 0.25), crownMat);
    battlement.position.set(Math.cos(angle) * 0.72, 2.75, Math.sin(angle) * 0.72);
    battlement.castShadow = true;
    group.add(battlement);
  }

  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.2, 8, 8),
    new THREE.MeshStandardMaterial({
      color: 0xffcc66,
      emissive: 0xff9922,
      emissiveIntensity: 1.2,
    }),
  );
  lantern.position.y = 2.9;
  group.add(lantern);

  return group;
}

function createCampfireMesh(): THREE.Group {
  const group = new THREE.Group();
  const logMat = new THREE.MeshStandardMaterial({ color: 0x4a3323 });
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 0.9, 5), logMat);
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

  group.userData.flame = flame;
  group.userData.light = light;
  return group;
}

export function createBuildingMesh(id: string): THREE.Group {
  if (id === "house") return createHouseMesh();
  if (id === "storage") return createStorageMesh();
  if (id === "town_center") return createTownCenterMesh();
  if (id === "farm") return createFarmMesh();
  if (id === "blacksmith") return createBlacksmithMesh();
  if (id === "tower") return createTowerMesh();
  if (id === "campfire") return createCampfireMesh();
  return createWallMesh();
}

/** Adds a hidden selection ring to a building mesh; toggle `.visible` on it. */
export function attachSelectionRing(mesh: THREE.Group): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(1.95, 2.15, 28),
    new THREE.MeshBasicMaterial({ color: 0xffcc44, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.04;
  ring.visible = false;
  mesh.add(ring);
  mesh.userData.selectionRing = ring;
  return ring;
}

/** Adds a health bar above a building mesh, sized to clear its bounding box. */
export function attachHealthBar(mesh: THREE.Group): HealthBar {
  const box = new THREE.Box3().setFromObject(mesh);
  const bar = createHealthBar();
  bar.group.position.y = box.max.y - mesh.position.y + 0.4;
  mesh.add(bar.group);
  mesh.userData.healthBar = bar;
  return bar;
}

/** Makes a mesh translucent for use as a placement preview ("ghost"). */
export function makeGhost(mesh: THREE.Group): THREE.Group {
  mesh.traverse((child) => {
    if (child instanceof THREE.Mesh) {
      const material = (child.material as THREE.MeshStandardMaterial).clone();
      material.transparent = true;
      material.opacity = 0.5;
      child.material = material;
      child.castShadow = false;
    }
  });
  return mesh;
}
