import * as THREE from "three";
import { heightAt } from "./terrain";
import type { Wolf } from "./enemy";
import { createHealthBar, type HealthBar } from "./healthBar";

export type UnitKind = "soldier" | "archer" | "scout";

interface UnitPreset {
  label: string;
  maxHp: number;
  speed: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  leashRange: number;
  armorColor: number;
}

// Won't chase wolves farther than this from home, so units stay near town
// instead of running off across the map — except Scouts, who roam farther.
const UNIT_PRESETS: Record<UnitKind, UnitPreset> = {
  soldier: {
    label: "Soldier",
    maxHp: 60,
    speed: 2.1,
    attackRange: 1.4,
    attackDamage: 14,
    attackCooldown: 0.8,
    leashRange: 18,
    armorColor: 0x556478,
  },
  archer: {
    label: "Archer",
    maxHp: 40,
    speed: 2.0,
    attackRange: 6,
    attackDamage: 9,
    attackCooldown: 1.1,
    leashRange: 20,
    armorColor: 0x3e6b3f,
  },
  scout: {
    label: "Scout",
    maxHp: 70,
    speed: 3.4,
    attackRange: 1.4,
    attackDamage: 10,
    attackCooldown: 0.9,
    leashRange: 26,
    armorColor: 0x8a5a2a,
  },
};

export function getUnitStats(kind: UnitKind): UnitPreset {
  return UNIT_PRESETS[kind];
}

const WANDER_RADIUS = 2.5;

/** An autonomous defender trained by Barracks/Archery Range/Stable: patrols
 * near home and engages any wolf within leash range — no player commands. */
export class Soldier {
  readonly model: THREE.Group;
  readonly kind: UnitKind;
  hp: number;
  alive = true;

  private stats: UnitPreset;
  private home: THREE.Vector3;
  private healthBar: HealthBar;
  private attackReadyAt = 0;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;
  private selectionRing: THREE.Mesh;
  /** Player-issued move order; cleared on arrival. */
  private moveOrder: THREE.Vector3 | null = null;
  /** Player-issued attack target, chased regardless of leash range. */
  private orderedTarget: Wolf | null = null;

  constructor(scene: THREE.Scene, home: THREE.Vector3, kind: UnitKind = "soldier") {
    this.kind = kind;
    this.stats = UNIT_PRESETS[kind];
    this.hp = this.stats.maxHp;
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = createUnitModel(this.stats);
    this.model.position.copy(home);
    this.model.userData.soldier = this;
    scene.add(this.model);

    this.selectionRing = createSelectionRing();
    this.selectionRing.visible = false;
    this.model.add(this.selectionRing);

    this.healthBar = createHealthBar(0.7, 0.1);
    scene.add(this.healthBar.group);
    this.syncHealthBarPosition();
  }

  getHome(): THREE.Vector3 {
    return this.home.clone();
  }

  setSelected(selected: boolean) {
    this.selectionRing.visible = selected;
  }

  /** Player-issued: march to a point and hold that area. The soldier's home
   * moves with it, so afterwards it patrols and defends the new position
   * instead of walking back to where it was trained. */
  commandMoveTo(point: THREE.Vector3) {
    this.orderedTarget = null;
    this.moveOrder = point.clone();
    this.home.copy(point);
    this.wanderTarget.copy(point);
  }

  /** Player-issued: hunt a specific wolf, ignoring the usual leash. */
  commandAttack(wolf: Wolf) {
    this.moveOrder = null;
    this.orderedTarget = wolf;
  }

  update(delta: number, now: number, wolves: Wolf[]) {
    if (!this.alive) return;

    // An explicit move order takes priority over engaging anything.
    if (this.moveOrder) {
      if (this.model.position.distanceTo(this.moveOrder) > 0.3) {
        this.moveToward(this.moveOrder, delta);
        this.syncHealthBarPosition();
        return;
      }
      this.moveOrder = null;
    }

    if (this.orderedTarget && !this.orderedTarget.alive) this.orderedTarget = null;
    const target = this.orderedTarget ?? this.findTarget(wolves);
    if (target) {
      const dist = this.model.position.distanceTo(target.model.position);
      if (dist > this.stats.attackRange) {
        this.moveToward(target.model.position, delta);
      } else if (now >= this.attackReadyAt) {
        target.takeDamage(this.stats.attackDamage);
        this.attackReadyAt = now + this.stats.attackCooldown;
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

  /** Returns true if this hit killed the soldier. */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.healthBar.setFraction(this.hp / this.stats.maxHp);
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

  private findTarget(wolves: Wolf[]): Wolf | null {
    let nearest: Wolf | null = null;
    let nearestDist = Infinity;
    for (const wolf of wolves) {
      if (!wolf.alive) continue;
      if (this.home.distanceTo(wolf.model.position) > this.stats.leashRange) continue;
      const dist = this.model.position.distanceTo(wolf.model.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = wolf;
      }
    }
    return nearest;
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
    const radius = Math.random() * WANDER_RADIUS;
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
    toTarget.normalize().multiplyScalar(Math.min(this.stats.speed * delta, dist));
    this.model.position.x += toTarget.x;
    this.model.position.z += toTarget.z;
    this.model.position.y = heightAt(this.model.position.x, this.model.position.z);
    this.model.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }
}

function createSelectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x6fe3ff, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
}

function createUnitModel(stats: UnitPreset): THREE.Group {
  const group = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: stats.armorColor });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a888 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), armorMat);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skinMat);
  head.position.y = 1.28;
  head.castShadow = true;
  group.add(head);

  const weaponMat = new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.4, roughness: 0.4 });
  const weapon = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.65, 0.06), weaponMat);
  weapon.position.set(0.34, 0.85, 0);
  weapon.rotation.z = -0.35;
  weapon.castShadow = true;
  group.add(weapon);

  return group;
}
