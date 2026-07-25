import * as THREE from "three";
import { heightAt } from "./terrain";
import { createBuildingMesh } from "./buildings";
import { createHealthBar, type HealthBar } from "./healthBar";
import type { Soldier } from "./soldier";
import type { Combatant } from "./combatant";
import type { ResourceType } from "./resources";

const GUARD_MAX_HP = 50;
const GUARD_SPEED = 2.2;
const GUARD_ATTACK_RANGE = 1.4;
const GUARD_ATTACK_DAMAGE = 12;
const GUARD_ATTACK_COOLDOWN = 1.0;
const GUARD_LEASH_RANGE = 16;
const GUARD_WANDER_RADIUS = 3;
const ATTACK_ANIM_TIME = 0.35;

/**
 * A hostile melee unit defending an enemy camp: patrols near home and
 * engages the nearest player soldier that strays within leash range —
 * the mirror image of Soldier's own wolf-engagement logic, seen from the
 * other side. Satisfies Combatant structurally, so player soldiers can
 * target it without any special-casing.
 */
export class EnemyGuard implements Combatant {
  readonly model: THREE.Group;
  hp = GUARD_MAX_HP;
  alive = true;
  /** Fired when an attack lands, so main can draw a slash effect. */
  onAttack: ((from: THREE.Vector3, to: THREE.Vector3) => void) | null = null;

  private visual: THREE.Group;
  private weapon: THREE.Mesh;
  private attackAnim = 0;
  private home: THREE.Vector3;
  private healthBar: HealthBar;
  private attackReadyAt = 0;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;

  constructor(scene: THREE.Scene, home: THREE.Vector3) {
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = new THREE.Group();
    this.visual = createGuardModel();
    this.weapon = this.visual.userData.weapon as THREE.Mesh;
    this.model.add(this.visual);
    this.model.position.copy(home);
    this.model.userData.enemyGuard = this;
    scene.add(this.model);

    this.healthBar = createHealthBar(0.7, 0.1);
    scene.add(this.healthBar.group);
    this.syncHealthBarPosition();
  }

  update(delta: number, now: number, soldiers: Soldier[]) {
    if (!this.alive) return;
    this.updateAttackAnim(delta);

    const target = this.findTarget(soldiers);
    if (target) {
      const dist = this.model.position.distanceTo(target.model.position);
      if (dist > GUARD_ATTACK_RANGE) {
        this.moveToward(target.model.position, delta);
      } else if (now >= this.attackReadyAt) {
        target.takeDamage(GUARD_ATTACK_DAMAGE);
        this.attackReadyAt = now + GUARD_ATTACK_COOLDOWN;
        this.attackAnim = 1;
        this.model.rotation.y = Math.atan2(
          target.model.position.x - this.model.position.x,
          target.model.position.z - this.model.position.z,
        );
        this.onAttack?.(
          this.model.position.clone().add(new THREE.Vector3(0, 1, 0)),
          target.model.position.clone().add(new THREE.Vector3(0, 0.4, 0)),
        );
      }
      this.syncHealthBarPosition();
      return;
    }

    if (this.model.position.distanceTo(this.wanderTarget) > 0.3) {
      this.moveToward(this.wanderTarget, delta);
    } else if (now > this.wanderWaitUntil) {
      this.pickWanderTarget(now);
    }
    this.syncHealthBarPosition();
  }

  /** Returns true if this hit killed the guard. */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.healthBar.setFraction(this.hp / GUARD_MAX_HP);
    if (this.hp <= 0) {
      this.alive = false;
      this.model.visible = false;
      this.healthBar.group.visible = false;
      return true;
    }
    return false;
  }

  dispose(scene: THREE.Scene) {
    scene.remove(this.model);
    scene.remove(this.healthBar.group);
  }

  private findTarget(soldiers: Soldier[]): Soldier | null {
    let nearest: Soldier | null = null;
    let nearestDist = Infinity;
    for (const soldier of soldiers) {
      if (!soldier.alive) continue;
      if (this.home.distanceTo(soldier.model.position) > GUARD_LEASH_RANGE) continue;
      const dist = this.model.position.distanceTo(soldier.model.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = soldier;
      }
    }
    return nearest;
  }

  private updateAttackAnim(delta: number) {
    if (this.attackAnim <= 0) return;
    this.attackAnim = Math.max(0, this.attackAnim - delta / ATTACK_ANIM_TIME);
    const swing = Math.sin(this.attackAnim * Math.PI);
    this.weapon.rotation.z = -0.35 - swing * 1.9;
    this.visual.position.z = swing * 0.28;
  }

  private syncHealthBarPosition() {
    this.healthBar.group.position.set(
      this.model.position.x,
      this.model.position.y + 1.6,
      this.model.position.z,
    );
  }

  private pickWanderTarget(now: number) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * GUARD_WANDER_RADIUS;
    const x = this.home.x + Math.cos(angle) * radius;
    const z = this.home.z + Math.sin(angle) * radius;
    this.wanderTarget.set(x, heightAt(x, z), z);
    this.wanderWaitUntil = now + 2 + Math.random() * 3;
  }

  private moveToward(point: THREE.Vector3, delta: number) {
    const toTarget = point.clone().sub(this.model.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-4) return;
    toTarget.normalize().multiplyScalar(Math.min(GUARD_SPEED * delta, dist));
    this.model.position.x += toTarget.x;
    this.model.position.z += toTarget.z;
    this.model.position.y = heightAt(this.model.position.x, this.model.position.z);
    this.model.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }
}

function createGuardModel(): THREE.Group {
  const group = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x6b2a2a });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xc48a5a });

  const body = new THREE.Mesh(new THREE.CylinderGeometry(0.22, 0.26, 0.7, 8), armorMat);
  body.position.y = 0.55;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.18, 8, 8), skinMat);
  head.position.y = 1.0;
  head.castShadow = true;
  group.add(head);

  const weapon = new THREE.Mesh(
    new THREE.BoxGeometry(0.08, 0.6, 0.08),
    new THREE.MeshStandardMaterial({ color: 0x888888 }),
  );
  weapon.position.set(0.28, 0.75, 0);
  weapon.castShadow = true;
  group.add(weapon);
  group.userData.weapon = weapon;

  return group;
}

// --- Enemy buildings --------------------------------------------------------

/**
 * A destructible camp structure. Deliberately a plain object (not a class)
 * built by `createEnemyCamp` — the shape alone satisfies Combatant, so no
 * base class or adapter is needed for soldiers to target it.
 */
export interface EnemyBuilding extends Combatant {
  position: THREE.Vector3;
  hp: number;
  maxHp: number;
  /** Resources granted to the player's inventory once destroyed. */
  loot: Partial<Record<ResourceType, number>>;
  attack?: { range: number; damage: number; cooldown: number };
  attackReadyAt: number;
}

interface CampBuildingSpec {
  id: string;
  offset: [number, number];
  maxHp: number;
  loot: Partial<Record<ResourceType, number>>;
  attack?: { range: number; damage: number; cooldown: number };
}

/** Reuses the player's own building visuals — an Outpost as the camp's one
 * defensive tower, two Houses as huts worth looting — rather than modeling
 * a whole second art set for one small camp. */
const CAMP_LAYOUT: CampBuildingSpec[] = [
  {
    id: "outpost",
    offset: [0, 0],
    maxHp: 60,
    loot: { wood: 6, stone: 6 },
    attack: { range: 6, damage: 8, cooldown: 1.3 },
  },
  { id: "house", offset: [-3.2, 2.6], maxHp: 80, loot: { wood: 10 } },
  { id: "house", offset: [3.2, 2.6], maxHp: 80, loot: { food: 10 } },
];

const GUARD_COUNT = 3;
const GUARD_RING_RADIUS = 2.6;

/** Tints a building's structure meshes a dusty red, so an enemy camp reads
 * as hostile at a glance instead of looking like one of the player's own. */
function tintHostile(mesh: THREE.Group) {
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    if (!material.color) return;
    material.color.multiply(new THREE.Color(1, 0.6, 0.56));
  });
}

export interface EnemyCamp {
  buildings: EnemyBuilding[];
  guards: EnemyGuard[];
}

/** Builds one fixed hostile camp: a tower and two huts guarded by a few
 * melee guards, all placed around `center`. */
export function createEnemyCamp(scene: THREE.Scene, center: THREE.Vector3): EnemyCamp {
  const buildings: EnemyBuilding[] = [];

  for (const spec of CAMP_LAYOUT) {
    const x = center.x + spec.offset[0];
    const z = center.z + spec.offset[1];
    const position = new THREE.Vector3(x, heightAt(x, z), z);
    const mesh = createBuildingMesh(spec.id);
    mesh.position.copy(position);
    tintHostile(mesh);
    scene.add(mesh);

    const building: EnemyBuilding = {
      model: mesh,
      position,
      hp: spec.maxHp,
      maxHp: spec.maxHp,
      alive: true,
      loot: spec.loot,
      attack: spec.attack,
      attackReadyAt: 0,
      takeDamage(amount: number): boolean {
        if (!this.alive) return false;
        this.hp = Math.max(0, this.hp - amount);
        if (this.hp <= 0) {
          this.alive = false;
          return true;
        }
        return false;
      },
    };
    mesh.userData.enemyBuilding = building;
    buildings.push(building);
  }

  const guards: EnemyGuard[] = [];
  for (let i = 0; i < GUARD_COUNT; i++) {
    const angle = (i / GUARD_COUNT) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * GUARD_RING_RADIUS;
    const z = center.z + Math.sin(angle) * GUARD_RING_RADIUS;
    guards.push(new EnemyGuard(scene, new THREE.Vector3(x, heightAt(x, z), z)));
  }

  return { buildings, guards };
}
