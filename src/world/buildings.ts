import * as THREE from "three";
import { createHealthBar, type HealthBar } from "./healthBar";
import { TEXTURES } from "../systems/textures";

/** A tinted MeshStandardMaterial using one of our procedural PBR texture
 * sets (diffuse + normal map) instead of a flat color. */
function texturedMaterial(kind: "wood" | "stone", color: number, repeat = 2): THREE.MeshStandardMaterial {
  const src = TEXTURES[kind];
  const map = src.map.clone();
  const normalMap = src.normalMap.clone();
  map.repeat.set(repeat, repeat);
  normalMap.repeat.set(repeat, repeat);
  map.needsUpdate = true;
  normalMap.needsUpdate = true;
  return new THREE.MeshStandardMaterial({
    color,
    map,
    normalMap,
    normalScale: new THREE.Vector2(0.6, 0.6),
  });
}

function createHouseMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallMat = texturedMaterial("wood", 0xd9c19a);
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

function createTownCenterMesh(): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = texturedMaterial("stone", 0xb0a898, 3);
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

  const cropMat = new THREE.MeshStandardMaterial({ color: 0x8fbf4a });
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
  const stoneMat = texturedMaterial("stone", 0x8a8378, 2);
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

function createBarracksMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallMat = texturedMaterial("wood", 0x8a7458, 2.5);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a });
  const trimMat = new THREE.MeshStandardMaterial({ color: 0x7a2a2a });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.6, 1.6, 2), wallMat);
  walls.position.y = 0.8;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.8, 0.3, 2.2), roofMat);
  roof.position.y = 1.75;
  roof.castShadow = true;
  group.add(roof);

  const banner = new THREE.Mesh(new THREE.PlaneGeometry(0.5, 0.9), trimMat);
  banner.material.side = THREE.DoubleSide;
  banner.position.set(0, 1.1, 1.02);
  group.add(banner);

  const swordMat = new THREE.MeshStandardMaterial({ color: 0xc9c9c9, metalness: 0.3 });
  for (const dx of [-0.9, 0.9]) {
    const sword = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.7, 0.06), swordMat);
    sword.position.set(dx, 1.9, 0);
    sword.rotation.z = dx > 0 ? -0.25 : 0.25;
    sword.castShadow = true;
    group.add(sword);
  }

  return group;
}

function createMillMesh(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = texturedMaterial("wood", 0x8a6a3a, 2);
  const base = new THREE.Mesh(new THREE.CylinderGeometry(0.9, 1.0, 1.4, 8), woodMat);
  base.position.y = 0.7;
  base.castShadow = true;
  base.receiveShadow = true;
  group.add(base);

  const hub = new THREE.Mesh(
    new THREE.SphereGeometry(0.18, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0x3a3025 }),
  );
  hub.position.set(0, 1.7, 0.85);
  group.add(hub);

  const bladeMat = new THREE.MeshStandardMaterial({ color: 0xd9c19a });
  for (let i = 0; i < 4; i++) {
    const blade = new THREE.Mesh(new THREE.BoxGeometry(0.18, 1.1, 0.06), bladeMat);
    blade.position.copy(hub.position);
    blade.rotation.z = (i / 4) * Math.PI * 2;
    blade.translateY(0.55);
    blade.castShadow = true;
    group.add(blade);
  }

  return group;
}

function createLumberCampMesh(): THREE.Group {
  const group = new THREE.Group();
  const platformMat = texturedMaterial("wood", 0x6b4a2f, 1.5);
  const platform = new THREE.Mesh(new THREE.BoxGeometry(1.6, 0.15, 1.6), platformMat);
  platform.position.y = 0.08;
  platform.receiveShadow = true;
  group.add(platform);

  const logMat = texturedMaterial("wood", 0x5c4326, 1.5);
  for (let i = 0; i < 4; i++) {
    const log = new THREE.Mesh(new THREE.CylinderGeometry(0.16, 0.16, 1.4, 8), logMat);
    log.rotation.z = Math.PI / 2;
    log.position.set(0, 0.3 + i * 0.28, -0.1);
    log.castShadow = true;
    group.add(log);
  }

  return group;
}

function createMiningCampMesh(): THREE.Group {
  const group = new THREE.Group();
  const postMat = texturedMaterial("wood", 0x6b4a2f, 1.5);
  for (const dx of [-0.7, 0.7]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.06, 0.06, 1.3, 6), postMat);
    post.position.set(dx, 0.65, -0.6);
    post.castShadow = true;
    group.add(post);
  }
  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(1.8, 0.1, 1.0),
    new THREE.MeshStandardMaterial({ color: 0x9a4a3a }),
  );
  canopy.position.set(0, 1.3, -0.6);
  canopy.rotation.x = -0.15;
  canopy.castShadow = true;
  group.add(canopy);

  const rockMat = texturedMaterial("stone", 0x8a8378, 1.5);
  const rockSpots: [number, number, number][] = [
    [0, 0.2, 0.4],
    [0.4, 0.16, 0.6],
    [-0.35, 0.18, 0.5],
  ];
  for (const [x, y, z] of rockSpots) {
    const rock = new THREE.Mesh(new THREE.BoxGeometry(0.4, 0.32, 0.4), rockMat);
    rock.position.set(x, y, z);
    rock.rotation.set(0.3, 0.6, 0.1);
    rock.castShadow = true;
    group.add(rock);
  }

  return group;
}

function createArcheryRangeMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallMat = texturedMaterial("wood", 0x8a7458, 2.5);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x3e6b3f });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.4, 1.4, 1.8), wallMat);
  walls.position.y = 0.7;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.BoxGeometry(2.6, 0.3, 2.0), roofMat);
  roof.position.y = 1.55;
  roof.castShadow = true;
  group.add(roof);

  const targetMat = new THREE.MeshStandardMaterial({ color: 0xd6335c });
  const target = new THREE.Mesh(new THREE.CylinderGeometry(0.35, 0.35, 0.08, 16), targetMat);
  target.rotation.z = Math.PI / 2;
  target.position.set(0, 1.0, 0.95);
  group.add(target);
  const ring = new THREE.Mesh(
    new THREE.CylinderGeometry(0.2, 0.2, 0.09, 16),
    new THREE.MeshStandardMaterial({ color: 0xf2e6c8 }),
  );
  ring.rotation.z = Math.PI / 2;
  ring.position.set(0.005, 1.0, 0.95);
  group.add(ring);

  return group;
}

function createStableMesh(): THREE.Group {
  const group = new THREE.Group();
  const wallMat = texturedMaterial("wood", 0x9a7a4a, 2.5);
  const roofMat = new THREE.MeshStandardMaterial({ color: 0x5a4a3a });

  const walls = new THREE.Mesh(new THREE.BoxGeometry(2.8, 1.2, 2.0), wallMat);
  walls.position.y = 0.6;
  walls.castShadow = true;
  walls.receiveShadow = true;
  group.add(walls);

  const roof = new THREE.Mesh(new THREE.CylinderGeometry(0, 1.6, 1.0, 4), roofMat);
  roof.rotation.y = Math.PI / 4;
  roof.scale.set(1.3, 1, 0.7);
  roof.position.y = 1.65;
  roof.castShadow = true;
  group.add(roof);

  const doorMat = new THREE.MeshStandardMaterial({ color: 0x2a2018 });
  const door = new THREE.Mesh(new THREE.BoxGeometry(0.8, 0.9, 0.1), doorMat);
  door.position.set(0, 0.45, 1.02);
  group.add(door);

  return group;
}

function createMarketMesh(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = texturedMaterial("wood", 0x8a6a3a, 2);
  const table = new THREE.Mesh(new THREE.BoxGeometry(1.8, 0.7, 1.4), woodMat);
  table.position.y = 0.35;
  table.castShadow = true;
  table.receiveShadow = true;
  group.add(table);

  const postMat = texturedMaterial("wood", 0x6b4a2f, 1.5);
  for (const [dx, dz] of [
    [-0.85, -0.65],
    [0.85, -0.65],
    [-0.85, 0.65],
    [0.85, 0.65],
  ]) {
    const post = new THREE.Mesh(new THREE.CylinderGeometry(0.05, 0.05, 1.6, 6), postMat);
    post.position.set(dx, 0.8, dz);
    post.castShadow = true;
    group.add(post);
  }

  const canopy = new THREE.Mesh(
    new THREE.BoxGeometry(2.1, 0.08, 1.7),
    new THREE.MeshStandardMaterial({ color: 0xc0392b }),
  );
  canopy.position.y = 1.6;
  canopy.castShadow = true;
  group.add(canopy);

  const goodsColors = [0xd9c19a, 0x8a8378, 0xd6335c];
  goodsColors.forEach((color, i) => {
    const goods = new THREE.Mesh(
      new THREE.BoxGeometry(0.35, 0.3, 0.35),
      new THREE.MeshStandardMaterial({ color }),
    );
    goods.position.set(-0.5 + i * 0.5, 0.85, 0);
    goods.castShadow = true;
    group.add(goods);
  });

  return group;
}

function createOutpostMesh(): THREE.Group {
  const group = new THREE.Group();
  const woodMat = texturedMaterial("wood", 0x6b4a2f, 1.5);
  const post = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.3, 2.2, 8), woodMat);
  post.position.y = 1.1;
  post.castShadow = true;
  post.receiveShadow = true;
  group.add(post);

  const platform = new THREE.Mesh(
    new THREE.CylinderGeometry(0.6, 0.6, 0.15, 8),
    texturedMaterial("wood", 0x8a6a3a, 1.5),
  );
  platform.position.y = 2.25;
  platform.castShadow = true;
  group.add(platform);

  const railMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2f });
  for (let i = 0; i < 6; i++) {
    const angle = (i / 6) * Math.PI * 2;
    const rail = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.5, 0.06), railMat);
    rail.position.set(Math.cos(angle) * 0.55, 2.55, Math.sin(angle) * 0.55);
    group.add(rail);
  }

  const lantern = new THREE.Mesh(
    new THREE.SphereGeometry(0.14, 8, 8),
    new THREE.MeshStandardMaterial({ color: 0xffcc66, emissive: 0xff9922, emissiveIntensity: 1.2 }),
  );
  lantern.position.y = 2.5;
  group.add(lantern);

  return group;
}

function createCastleMesh(): THREE.Group {
  const group = new THREE.Group();
  const stoneMat = texturedMaterial("stone", 0x9a9086, 3);
  const darkStoneMat = texturedMaterial("stone", 0x7a746a, 2);

  const keep = new THREE.Mesh(new THREE.CylinderGeometry(1.4, 1.6, 3.2, 8), stoneMat);
  keep.position.y = 1.6;
  keep.castShadow = true;
  keep.receiveShadow = true;
  group.add(keep);

  for (let i = 0; i < 10; i++) {
    const angle = (i / 10) * Math.PI * 2;
    const battlement = new THREE.Mesh(new THREE.BoxGeometry(0.3, 0.35, 0.3), darkStoneMat);
    battlement.position.set(Math.cos(angle) * 1.42, 3.35, Math.sin(angle) * 1.42);
    battlement.castShadow = true;
    group.add(battlement);
  }

  for (const [dx, dz] of [
    [-1.6, -1.0],
    [1.6, -1.0],
    [-1.6, 1.0],
    [1.6, 1.0],
  ]) {
    const turret = new THREE.Mesh(new THREE.CylinderGeometry(0.5, 0.6, 2.2, 8), stoneMat);
    turret.position.set(dx, 1.1, dz);
    turret.castShadow = true;
    turret.receiveShadow = true;
    group.add(turret);

    const roof = new THREE.Mesh(new THREE.ConeGeometry(0.6, 0.8, 8), darkStoneMat);
    roof.position.set(dx, 2.6, dz);
    roof.castShadow = true;
    group.add(roof);
  }

  const flagPole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.04, 0.04, 1.2, 6),
    new THREE.MeshStandardMaterial({ color: 0x3a3025 }),
  );
  flagPole.position.y = 3.8;
  group.add(flagPole);

  const flag = new THREE.Mesh(
    new THREE.PlaneGeometry(0.5, 0.35),
    new THREE.MeshStandardMaterial({ color: 0xc0392b, side: THREE.DoubleSide }),
  );
  flag.position.set(0.28, 4.2, 0);
  group.add(flag);

  return group;
}

export function createBuildingMesh(id: string): THREE.Group {
  if (id === "house") return createHouseMesh();
  if (id === "town_center") return createTownCenterMesh();
  if (id === "farm") return createFarmMesh();
  if (id === "mill") return createMillMesh();
  if (id === "lumber_camp") return createLumberCampMesh();
  if (id === "mining_camp") return createMiningCampMesh();
  if (id === "blacksmith") return createBlacksmithMesh();
  if (id === "barracks") return createBarracksMesh();
  if (id === "archery_range") return createArcheryRangeMesh();
  if (id === "stable") return createStableMesh();
  if (id === "market") return createMarketMesh();
  if (id === "outpost") return createOutpostMesh();
  return createCastleMesh();
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
