import * as THREE from "three";
import { heightAt } from "./terrain";
import type { Wolf } from "./enemy";
import { createHealthBar, type HealthBar } from "./healthBar";

const SPEED = 2.1;
const CONTACT_RANGE = 1.4;
const ATTACK_COOLDOWN = 0.8;
const ATTACK_DAMAGE = 14;
export const SOLDIER_MAX_HP = 60;
// Won't chase wolves farther than this from its home barracks, so soldiers
// stay near the town instead of running off across the map.
const LEASH_RANGE = 18;
const WANDER_RADIUS = 2.5;

export const SOLDIER_STATS = {
  maxHp: SOLDIER_MAX_HP,
  attackRange: CONTACT_RANGE,
  attackDamage: ATTACK_DAMAGE,
  attackCooldown: ATTACK_COOLDOWN,
  leashRange: LEASH_RANGE,
};

/** An autonomous defender trained by a Barracks: patrols near home and
 * engages any wolf that wanders within leash range — no player commands. */
export class Soldier {
  readonly model: THREE.Group;
  hp = SOLDIER_MAX_HP;
  alive = true;

  private home: THREE.Vector3;
  private healthBar: HealthBar;
  private attackReadyAt = 0;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;
  private selectionRing: THREE.Mesh;

  constructor(scene: THREE.Scene, home: THREE.Vector3) {
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = createSoldierModel();
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

  update(delta: number, now: number, wolves: Wolf[]) {
    if (!this.alive) return;

    const target = this.findTarget(wolves);
    if (target) {
      const dist = this.model.position.distanceTo(target.model.position);
      if (dist > CONTACT_RANGE) {
        this.moveToward(target.model.position, delta);
      } else if (now >= this.attackReadyAt) {
        target.takeDamage(ATTACK_DAMAGE);
        this.attackReadyAt = now + ATTACK_COOLDOWN;
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
    this.healthBar.setFraction(this.hp / SOLDIER_MAX_HP);
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
      if (this.home.distanceTo(wolf.model.position) > LEASH_RANGE) continue;
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
    toTarget.normalize().multiplyScalar(Math.min(SPEED * delta, dist));
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

function createSoldierModel(): THREE.Group {
  const group = new THREE.Group();
  const armorMat = new THREE.MeshStandardMaterial({ color: 0x556478 });
  const skinMat = new THREE.MeshStandardMaterial({ color: 0xd8a888 });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), armorMat);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skinMat);
  head.position.y = 1.28;
  head.castShadow = true;
  group.add(head);

  const swordMat = new THREE.MeshStandardMaterial({ color: 0xcfcfd6, metalness: 0.4, roughness: 0.4 });
  const sword = new THREE.Mesh(new THREE.BoxGeometry(0.06, 0.65, 0.06), swordMat);
  sword.position.set(0.34, 0.85, 0);
  sword.rotation.z = -0.35;
  sword.castShadow = true;
  group.add(sword);

  return group;
}
