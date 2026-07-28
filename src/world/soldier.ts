import * as THREE from "three";
import { heightAt, avoidObstacleDirection } from "./terrain";
import { counterMultiplier, type Combatant, type CombatRole } from "./combatant";
import { createHealthBar, type HealthBar } from "./healthBar";
import { createSelectionRing, createUnitModel } from "./unitVisuals";

/** A UnitKind *is* a CombatRole here — every trainable unit participates in
 * the counter triangle. Kept as its own alias since "UnitKind" is the name
 * used everywhere else in the game (training, HUD labels, save data). */
export type UnitKind = CombatRole;

interface UnitPreset {
  label: string;
  maxHp: number;
  speed: number;
  attackRange: number;
  attackDamage: number;
  attackCooldown: number;
  /** How far the unit notices threats from *its own current position* —
   * not from home. Replaces the old home-tethered leash: a patrolling or
   * moved unit still picks fights with whatever wanders near it, but won't
   * spot (let alone chase) something on the other side of the map. */
  awarenessRange: number;
  armorColor: number;
}

const UNIT_PRESETS: Record<UnitKind, UnitPreset> = {
  soldier: {
    label: "Soldier",
    maxHp: 60,
    speed: 2.1,
    attackRange: 1.4,
    attackDamage: 14,
    attackCooldown: 0.8,
    awarenessRange: 18,
    armorColor: 0x556478,
  },
  archer: {
    label: "Archer",
    maxHp: 40,
    speed: 2.0,
    attackRange: 6,
    attackDamage: 9,
    attackCooldown: 1.1,
    awarenessRange: 20,
    armorColor: 0x3e6b3f,
  },
  scout: {
    label: "Scout",
    maxHp: 70,
    speed: 3.4,
    attackRange: 1.4,
    attackDamage: 10,
    attackCooldown: 0.9,
    awarenessRange: 26,
    armorColor: 0x8a5a2a,
  },
};

export function getUnitStats(kind: UnitKind): UnitPreset {
  return UNIT_PRESETS[kind];
}

const WANDER_RADIUS = 2.5;
const ATTACK_ANIM_TIME = 0.35;
/** Beyond this reach a unit shoots rather than swings. */
const RANGED_THRESHOLD = 2;

/** An autonomous defender trained by Barracks/Archery Range/Stable: patrols
 * near home and engages the nearest wolf, enemy guard, or enemy building
 * anywhere on the map — no leash, so a standing army actually clears threats
 * instead of only reacting to whatever wanders home. */
export class Soldier {
  readonly model: THREE.Group;
  readonly kind: UnitKind;
  /** Fired when an attack lands: (from, to, ranged). Lets main draw an arrow
   * for shooters or a slash for melee, without world code owning effects. */
  onAttack: ((from: THREE.Vector3, to: THREE.Vector3, ranged: boolean) => void) | null =
    null;
  hp: number;
  alive = true;

  private stats: UnitPreset;
  private home: THREE.Vector3;
  private healthBar: HealthBar;
  private attackReadyAt = 0;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;
  private selectionRing: THREE.Mesh;
  private visual: THREE.Group;
  private weapon: THREE.Mesh;
  private attackAnim = 0;
  /** Player-issued move order; cleared on arrival. */
  private moveOrder: THREE.Vector3 | null = null;
  /** Player-issued attack target, chased until dead or recalled. */
  private orderedTarget: Combatant | null = null;

  constructor(scene: THREE.Scene, home: THREE.Vector3, kind: UnitKind = "soldier") {
    this.kind = kind;
    this.stats = UNIT_PRESETS[kind];
    this.hp = this.stats.maxHp;
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = new THREE.Group();
    this.visual = createUnitModel(kind, this.stats.armorColor, this.stats.attackRange > RANGED_THRESHOLD);
    this.weapon = this.visual.userData.weapon as THREE.Mesh;
    this.model.add(this.visual);
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

  /** Player-issued: hunt a specific target until it dies or is recalled. */
  commandAttack(target: Combatant) {
    this.moveOrder = null;
    this.orderedTarget = target;
  }

  get isRanged(): boolean {
    return this.stats.attackRange > RANGED_THRESHOLD;
  }

  /** What this counts as for the counter triangle — a Soldier's own kind. */
  get combatRole(): CombatRole {
    return this.kind;
  }

  update(delta: number, now: number, targets: Combatant[]) {
    if (!this.alive) return;
    this.updateAttackAnim(delta);

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
    const target = this.orderedTarget ?? this.findTarget(targets);
    if (target) {
      const dist = this.model.position.distanceTo(target.model.position);
      if (dist > this.stats.attackRange) {
        this.moveToward(target.model.position, delta);
      } else if (now >= this.attackReadyAt) {
        const damage =
          this.stats.attackDamage * counterMultiplier(this.kind, target.combatRole);
        target.takeDamage(damage);
        this.attackReadyAt = now + this.stats.attackCooldown;
        this.attackAnim = 1;
        this.model.rotation.y = Math.atan2(
          target.model.position.x - this.model.position.x,
          target.model.position.z - this.model.position.z,
        );
        this.onAttack?.(
          this.model.position.clone().add(new THREE.Vector3(0, 1.1, 0)),
          target.model.position.clone().add(new THREE.Vector3(0, 0.4, 0)),
          this.isRanged,
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

  private findTarget(targets: Combatant[]): Combatant | null {
    let nearest: Combatant | null = null;
    let nearestDist = this.stats.awarenessRange;
    for (const candidate of targets) {
      if (!candidate.alive) continue;
      const dist = this.model.position.distanceTo(candidate.model.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = candidate;
      }
    }
    return nearest;
  }

  /** Melee units wind up and swing their weapon; shooters draw and release. */
  private updateAttackAnim(delta: number) {
    if (this.attackAnim <= 0) return;
    this.attackAnim = Math.max(0, this.attackAnim - delta / ATTACK_ANIM_TIME);
    const swing = Math.sin(this.attackAnim * Math.PI);
    if (this.isRanged) {
      // Bow arm punches forward on release.
      this.weapon.position.z = swing * 0.3;
      this.visual.position.z = swing * 0.08;
    } else {
      // Overhead chop, with a small step into the blow.
      this.weapon.rotation.z = -0.35 - swing * 1.9;
      this.visual.position.z = swing * 0.28;
    }
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
    const step = Math.min(this.stats.speed * delta, dist);
    const dir = toTarget.normalize();
    const steered = avoidObstacleDirection(
      this.model.position.x,
      this.model.position.z,
      dir.x,
      dir.z,
      step + 0.5,
      { x: point.x, z: point.z },
    );
    this.model.position.x += steered.x * step;
    this.model.position.z += steered.z * step;
    this.model.position.y = heightAt(this.model.position.x, this.model.position.z);
    this.model.rotation.y = Math.atan2(steered.x, steered.z);
  }
}
