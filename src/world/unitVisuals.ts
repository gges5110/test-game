import * as THREE from "three";
import type { CombatRole } from "./combatant";

/**
 * Mesh/material factories for units — Soldier, Villager, and EnemyGuard all
 * pull their THREE.js models from here instead of building geometry inline,
 * so visual work (silhouettes, materials, props) never touches the same
 * lines as gameplay work (stats, state machines, combat) in soldier.ts /
 * villager.ts / enemyCamp.ts. Nothing in this file reads or mutates game
 * state — every function takes plain values in and returns a THREE.Object3D.
 */

/** The cyan ring shown under a selected unit — shared by Soldier and Villager. */
export function createSelectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x6fe3ff, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
}

/** Beyond this reach a unit's model gets a bow instead of a melee weapon —
 * mirrors soldier.ts's own RANGED_THRESHOLD; passed in as `ranged` instead
 * of a range number so this file never needs to know the actual cutoff. */

/** Body proportions per kind, so a soldier, archer and scout read as
 * different silhouettes at normal play zoom instead of recolored copies of
 * the same capsule — a bulkier brawler, a slim shooter, a mounted skirmisher.
 * Takes plain values (not a UnitPreset) so this file has no dependency on
 * soldier.ts's gameplay types. */
export function createUnitModel(kind: CombatRole, armorColor: number, ranged: boolean): THREE.Group {
  const group = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: armorColor });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a888 });
  const metalMat = new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.4, roughness: 0.4 });

  const bodyRadius = kind === "archer" ? 0.21 : kind === "scout" ? 0.23 : 0.28;
  const bodyLength = 0.5;
  // Scout rides a mount, so its rider sits well above the ground — everyone
  // else's bodyY is the torso's own resting height.
  const bodyY = 0.75 + (kind === "scout" ? 0.6 : 0);
  const body = new THREE.Mesh(new THREE.CapsuleGeometry(bodyRadius, bodyLength, 4, 8), armorMat);
  body.position.y = bodyY;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skinMat);
  head.position.y = bodyY + 0.53;
  head.castShadow = true;
  group.add(head);

  if (kind === "scout") {
    // A low-poly horse beneath the rider — body, neck/head, mane, tail and
    // four legs — so a scout reads as mounted cavalry instead of a fast
    // infantry unit with a plume.
    const horseMat = new THREE.MeshStandardMaterial({ color: 0x6b4a2a });
    const maneMat = new THREE.MeshStandardMaterial({ color: 0x2e2018 });

    const horseBody = new THREE.Mesh(new THREE.CapsuleGeometry(0.22, 0.55, 4, 8), horseMat);
    horseBody.rotation.x = Math.PI / 2;
    horseBody.position.y = 0.62;
    horseBody.castShadow = true;
    group.add(horseBody);

    const neck = new THREE.Mesh(new THREE.CapsuleGeometry(0.12, 0.3, 4, 8), horseMat);
    neck.position.set(0, 0.86, 0.42);
    neck.rotation.x = -0.9;
    neck.castShadow = true;
    group.add(neck);

    const horseHead = new THREE.Mesh(new THREE.BoxGeometry(0.14, 0.22, 0.32), horseMat);
    horseHead.position.set(0, 1.04, 0.62);
    horseHead.rotation.x = -0.3;
    horseHead.castShadow = true;
    group.add(horseHead);

    const mane = new THREE.Mesh(new THREE.BoxGeometry(0.04, 0.2, 0.32), maneMat);
    mane.position.set(0, 0.96, 0.4);
    mane.rotation.x = -0.9;
    group.add(mane);

    const tail = new THREE.Mesh(new THREE.CapsuleGeometry(0.05, 0.35, 4, 6), maneMat);
    tail.position.set(0, 0.42, -0.42);
    tail.rotation.x = 1.1;
    tail.castShadow = true;
    group.add(tail);

    const legOffsets: [number, number][] = [
      [0.13, 0.32],
      [-0.13, 0.32],
      [0.13, -0.28],
      [-0.13, -0.28],
    ];
    for (const [lx, lz] of legOffsets) {
      const leg = new THREE.Mesh(new THREE.CylinderGeometry(0.045, 0.045, 0.62, 6), horseMat);
      leg.position.set(lx, 0.31, lz);
      leg.castShadow = true;
      group.add(leg);
    }
  }

  if (kind === "soldier") {
    // A rounded helmet crest and a shield on the off arm — the bulky
    // front-line brawler.
    const helmet = new THREE.Mesh(new THREE.ConeGeometry(0.15, 0.22, 8), metalMat);
    helmet.position.set(0, head.position.y + 0.18, 0);
    helmet.castShadow = true;
    group.add(helmet);

    const shield = new THREE.Mesh(
      new THREE.CylinderGeometry(0.18, 0.18, 0.04, 12),
      new THREE.MeshStandardMaterial({ color: 0x7a5638 }),
    );
    shield.rotation.x = Math.PI / 2;
    shield.position.set(-0.32, bodyY, 0);
    shield.castShadow = true;
    group.add(shield);
  } else if (kind === "archer") {
    // A quiver on the back — the slim shooter, no shield or helm to slow it.
    const quiver = new THREE.Mesh(
      new THREE.CylinderGeometry(0.07, 0.09, 0.4, 8),
      new THREE.MeshStandardMaterial({ color: 0x5a4530 }),
    );
    quiver.position.set(-0.1, bodyY + 0.1, -0.18);
    quiver.rotation.x = 0.3;
    quiver.rotation.z = 0.15;
    quiver.castShadow = true;
    group.add(quiver);
  } else {
    // A plume and a longer reach — the lean, fast skirmisher.
    const plume = new THREE.Mesh(
      new THREE.ConeGeometry(0.05, 0.28, 6),
      new THREE.MeshStandardMaterial({ color: 0xd6335c }),
    );
    plume.position.set(0, head.position.y + 0.22, -0.03);
    plume.rotation.x = -0.3;
    plume.castShadow = true;
    group.add(plume);
  }

  const weaponMat = new THREE.MeshStandardMaterial({
    color: ranged ? 0x8a6a3a : 0xcfcfd6,
    metalness: ranged ? 0 : 0.4,
    roughness: ranged ? 0.8 : 0.4,
  });
  let weapon: THREE.Mesh;
  if (ranged) {
    weapon = new THREE.Mesh(new THREE.TorusGeometry(0.28, 0.03, 6, 10, Math.PI * 1.1), weaponMat);
    weapon.rotation.z = Math.PI / 2;
  } else if (kind === "scout") {
    // A spear reads as a distinctly different melee weapon from the
    // soldier's short sword, without needing a new attack-anim path.
    weapon = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.95, 6), weaponMat);
    weapon.rotation.z = -0.35;
  } else {
    weapon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.65, 0.06), weaponMat);
    weapon.rotation.z = -0.35;
  }
  weapon.position.set(0.34, bodyY + 0.1, 0);
  weapon.castShadow = true;
  group.add(weapon);
  group.userData.weapon = weapon;

  return group;
}

/** Unarmed, in a straw hat, carrying a hoe instead of a weapon — reads as
 * "worker" at a glance even next to a soldier's sword-and-shield silhouette. */
export function createVillagerModel(): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a888 });
  const tunic = new THREE.MeshStandardMaterial({ color: 0x8a6a3a });
  const strawMat = new THREE.MeshStandardMaterial({ color: 0xd6b35c });
  const toolMat = new THREE.MeshStandardMaterial({ color: 0x5a4530 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), tunic);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skin);
  head.position.y = 1.28;
  head.castShadow = true;
  group.add(head);

  const hat = new THREE.Mesh(new THREE.ConeGeometry(0.26, 0.14, 12), strawMat);
  hat.position.y = head.position.y + 0.15;
  hat.castShadow = true;
  group.add(hat);

  const hoeHandle = new THREE.Mesh(new THREE.CylinderGeometry(0.02, 0.02, 0.7, 6), toolMat);
  hoeHandle.position.set(0.3, 0.75, 0);
  hoeHandle.rotation.z = -0.3;
  hoeHandle.castShadow = true;
  group.add(hoeHandle);

  const hoeBlade = new THREE.Mesh(new THREE.BoxGeometry(0.16, 0.05, 0.02), toolMat);
  hoeBlade.position.set(0.44, 0.42, 0);
  hoeBlade.rotation.z = -0.3;
  hoeBlade.castShadow = true;
  group.add(hoeBlade);

  return group;
}

/** The glowing octahedron shown over a villager's head while gathering or
 * building. */
export function createWorkIndicator(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.OctahedronGeometry(0.14, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffd23f,
      emissive: 0xffaa00,
      emissiveIntensity: 1.2,
    }),
  );
}

/** A small bundle worn on the villager's back, shown only while returning
 * with a resource — its color is set per-type by the caller. */
export function createCarryIndicator(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.22, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  mesh.position.set(0, 0.95, -0.24);
  mesh.castShadow = true;
  return mesh;
}

/** A stockier, horned brute wielding an axe — distinct from the player's
 * rounded-helmet-and-sword Soldier even before the hostile-red tint. */
export function createGuardModel(): THREE.Group {
  const group = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x6b2a2a });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc48a5a });
  const hornMat = new THREE.MeshStandardMaterial({ color: 0xe8dcc0 });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 8), armorMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);

  for (const side of [-1, 1]) {
    const horn = new THREE.Mesh(new THREE.ConeGeometry(0.04, 0.18, 6), hornMat);
    horn.position.set(side * 0.13, 1.13, 0);
    horn.rotation.z = side * -0.4;
    horn.castShadow = true;
    group.add(horn);
  }

  // Haft + axe head grouped so both swing together as one "weapon" during
  // the attack animation, the same way a single mesh would.
  const axeMat = new THREE.MeshStandardMaterial({ color: 0x888888 });
  const haft = new THREE.Mesh(new THREE.CylinderGeometry(0.025, 0.025, 0.6, 6), axeMat);
  haft.castShadow = true;
  const axeHead = new THREE.Mesh(new THREE.BoxGeometry(0.05, 0.22, 0.16), axeMat);
  axeHead.position.y = 0.25;
  axeHead.castShadow = true;

  const weapon = new THREE.Group();
  weapon.add(haft, axeHead);
  weapon.position.set(0.28, 0.75, 0);
  group.add(weapon);
  group.userData.weapon = weapon;

  return group;
}

/** Tints a mesh's structure a dusty red, so an enemy camp (or its villagers/
 * guards/buildings) reads as hostile at a glance instead of looking like the
 * player's own. */
export function tintHostile(mesh: THREE.Group) {
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    if (!material.color) return;
    material.color.multiply(new THREE.Color(1, 0.6, 0.56));
  });
}
