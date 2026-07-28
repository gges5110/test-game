import * as THREE from "three";
import { heightAt, avoidObstacleDirection } from "./terrain";
import {
  createBuildingMesh,
  captureStructureMeshes,
  setConstructionAppearance,
  disposeBuildingMesh,
} from "./buildings";
import { createHealthBar, type HealthBar } from "./healthBar";
import { Villager } from "./villager";
import type { Combatant } from "./combatant";
import type { GatherSource, ResourceType } from "./resources";
import type { Effects } from "./effects";
import { Inventory } from "../systems/inventory";
import { BuildManager, getBuildingDef } from "../systems/building";
import { TownBuildings, type PlacedBuilding } from "../systems/townBuildings";
import { enqueueUnit, advanceProduction, contributeBuild } from "../systems/production";
import { populationCapacity } from "../systems/population";

export const GUARD_MAX_HP = 50;
const GUARD_SPEED = 2.2;
export const GUARD_ATTACK_RANGE = 1.4;
export const GUARD_ATTACK_DAMAGE = 12;
export const GUARD_ATTACK_COOLDOWN = 1.0;
/** How far a *patrolling* guard will chase a soldier from its home before
 * giving up — a raiding guard (deliberately far from home) ignores this. */
const GUARD_LEASH_RANGE = 16;
const GUARD_WANDER_RADIUS = 3;
const ATTACK_ANIM_TIME = 0.35;

/**
 * A hostile melee unit defending (or raiding out from) an enemy camp.
 * Patrols near home and engages the nearest player soldier within leash
 * range; once sent on a raid it marches toward the player's town instead,
 * damaging whatever building it reaches, still fighting off any soldier
 * that intercepts it along the way. Satisfies Combatant structurally, so
 * player soldiers can target it without any special-casing.
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
  private state: "patrol" | "raiding" = "patrol";
  private raidTarget: THREE.Vector3 | null = null;

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

  get isRaiding(): boolean {
    return this.state === "raiding";
  }

  /** Sent by the camp's raid dispatcher: march toward a point (ignoring the
   * usual home leash, since raiding is deliberately far from home), damaging
   * player buildings encountered along the way. Never returns home on its
   * own — the camp's economy backfills losses over time instead. */
  commandRaid(target: THREE.Vector3) {
    this.state = "raiding";
    this.raidTarget = target.clone();
  }

  update(
    delta: number,
    now: number,
    targets: Combatant[],
    playerTownBuildings: TownBuildings,
    damagePlayerBuilding: (building: PlacedBuilding, amount: number) => void,
  ) {
    if (!this.alive) return;
    this.updateAttackAnim(delta);

    const target = this.findTarget(targets);
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

    if (this.state === "raiding") {
      this.updateRaiding(delta, now, playerTownBuildings, damagePlayerBuilding);
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

  private findTarget(targets: Combatant[]): Combatant | null {
    let nearest: Combatant | null = null;
    let nearestDist = Infinity;
    for (const candidate of targets) {
      if (!candidate.alive) continue;
      if (this.state === "patrol" && this.home.distanceTo(candidate.model.position) > GUARD_LEASH_RANGE) {
        continue;
      }
      const dist = this.model.position.distanceTo(candidate.model.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = candidate;
      }
    }
    return nearest;
  }

  private updateRaiding(
    delta: number,
    now: number,
    playerTownBuildings: TownBuildings,
    damagePlayerBuilding: (building: PlacedBuilding, amount: number) => void,
  ) {
    const nearestBuilding = playerTownBuildings.findNearest(this.model.position);
    if (!nearestBuilding) {
      // Nothing left standing — keep heading for the last known town spot.
      if (this.raidTarget) this.moveToward(this.raidTarget, delta);
      return;
    }
    const dist = this.model.position.distanceTo(nearestBuilding.position);
    if (dist > GUARD_ATTACK_RANGE + 0.4) {
      this.moveToward(nearestBuilding.position, delta);
      return;
    }
    if (now >= this.attackReadyAt) {
      damagePlayerBuilding(nearestBuilding, GUARD_ATTACK_DAMAGE);
      this.attackReadyAt = now + GUARD_ATTACK_COOLDOWN;
      this.attackAnim = 1;
      this.onAttack?.(
        this.model.position.clone().add(new THREE.Vector3(0, 1, 0)),
        nearestBuilding.position.clone().add(new THREE.Vector3(0, 0.5, 0)),
      );
    }
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
    const step = Math.min(GUARD_SPEED * delta, dist);
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

/** Tints a mesh's structure a dusty red, so an enemy camp (or its villagers/
 * guards) reads as hostile at a glance instead of looking like the player's
 * own. */
function tintHostile(mesh: THREE.Group) {
  mesh.traverse((child) => {
    if (!(child instanceof THREE.Mesh)) return;
    const material = child.material as THREE.MeshStandardMaterial;
    if (!material.color) return;
    material.color.multiply(new THREE.Color(1, 0.6, 0.56));
  });
}

// --- The camp itself ---------------------------------------------------------

const STARTING_LAYOUT: { id: string; offset: [number, number] }[] = [
  { id: "town_center", offset: [0, 0] },
  { id: "outpost", offset: [0, -3.4] },
  { id: "house", offset: [-3.2, 2.6] },
  { id: "house", offset: [3.2, 2.6] },
];

/** Extra building sites used once the camp's economy affords growth, kept
 * separate from the starting layout so new construction can't overlap it. */
const GROWTH_OFFSETS: [number, number][] = [
  [-5.8, -2.5],
  [5.8, -2.5],
  [0, 5.8],
  [-5.8, 5.5],
  [5.8, 5.5],
];

/** What the camp tries to build next, in order, each capped so growth stays
 * bounded rather than sprawling forever. Reuses the player's own building
 * catalog — a barracks trains guards exactly the way it trains the player's
 * soldiers, just via a second BuildManager/Inventory/TownBuildings scoped to
 * the camp. */
const GROWTH_BUILD_ORDER: { id: string; cap: number }[] = [
  { id: "house", cap: 3 },
  { id: "barracks", cap: 1 },
  { id: "outpost", cap: 2 },
  { id: "barracks", cap: 2 },
];

const RAID_INTERVAL = 60;
/** Up to this fraction of all living guards can be sent on a single raid —
 * a camp with 2 guards still only spares 1, but a camp with 12 can mount a
 * real 6-guard push, instead of every raid being a flat, token size. */
const RAID_GUARD_FRACTION = 0.5;
const RAID_MAX_PARTY = 6;
/** Always keep at least this many (or this fraction of the total, whichever
 * is larger) patrol guards home defending the camp — a raid only launches
 * with whatever's left over. */
const RAID_MIN_HOME_GUARDS = 1;
const RAID_MIN_HOME_FRACTION = 0.25;

export interface EnemyCamp {
  townBuildings: TownBuildings;
  inventory: Inventory;
  buildManager: BuildManager;
  villagers: Villager[];
  guards: EnemyGuard[];
  center: THREE.Vector3;
  /** Seconds remaining until the next raid attempt; exposed for the HUD. */
  raidTimer: number;
  /** What camp villagers gather from — the same shared, map-wide
   * ResourceManager the player draws from (see createEnemyCamp), so both
   * economies compete for an equivalent resource field rather than the AI
   * running on its own separate, smaller patch. */
  gatherSource: GatherSource;
}

function spawnCampVillager(camp: EnemyCamp, at: THREE.Vector3, scene: THREE.Scene): Villager {
  const villager = new Villager(scene, at, camp.gatherSource, camp.townBuildings, camp.inventory, () => 0, (site, delta) => {
    const building = site as PlacedBuilding;
    const completed = contributeBuild(building, delta);
    setConstructionAppearance(building.mesh, building.buildProgress);
    if (completed) {
      setConstructionAppearance(building.mesh, 1);
      if (building.type === "house") {
        camp.villagers.push(spawnCampVillager(camp, building.position, scene));
      }
    }
  });
  tintHostile(villager.model);
  return villager;
}

function spawnCampGuard(at: THREE.Vector3, scene: THREE.Scene, effects: Effects): EnemyGuard {
  const guard = new EnemyGuard(scene, at);
  guard.onAttack = (_from, to) => {
    effects.slash(to, guard.model.rotation.y, 0xff8a8a);
    effects.impact(to, 0xd66a4a);
  };
  return guard;
}

/** Builds one fixed hostile camp: a tower and two huts guarded by a few
 * melee guards, plus its own small economy (villagers, an equal share of the
 * map's resources, inventory) that grows the camp over time by actually
 * gathering and building — not a scripted/timed expansion. */
export function createEnemyCamp(
  scene: THREE.Scene,
  center: THREE.Vector3,
  effects: Effects,
  gatherSource: GatherSource,
): EnemyCamp {
  const inventory = new Inventory();
  const buildManager = new BuildManager(inventory);
  const townBuildings = new TownBuildings();

  for (const spot of STARTING_LAYOUT) {
    const x = center.x + spot.offset[0];
    const z = center.z + spot.offset[1];
    const def = getBuildingDef(spot.id);
    const mesh = createBuildingMesh(spot.id);
    mesh.position.set(x, heightAt(x, z), z);
    captureStructureMeshes(mesh);
    tintHostile(mesh);
    scene.add(mesh);
    townBuildings.add(spot.id, def, mesh, mesh.position);
    buildManager.grant(spot.id);
  }

  const camp: EnemyCamp = {
    townBuildings,
    inventory,
    buildManager,
    villagers: [],
    guards: [],
    center: center.clone(),
    raidTimer: RAID_INTERVAL,
    gatherSource,
  };

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * 2;
    const z = center.z + Math.sin(angle) * 2;
    camp.villagers.push(
      spawnCampVillager(camp, new THREE.Vector3(x, heightAt(x, z), z), scene),
    );
  }

  const guardCount = 3;
  const guardRingRadius = 2.6;
  for (let i = 0; i < guardCount; i++) {
    const angle = (i / guardCount) * Math.PI * 2;
    const x = center.x + Math.cos(angle) * guardRingRadius;
    const z = center.z + Math.sin(angle) * guardRingRadius;
    camp.guards.push(spawnCampGuard(new THREE.Vector3(x, heightAt(x, z), z), scene, effects));
  }

  return camp;
}

/** Picks the next unclaimed growth building site, spreading them across the
 * fixed offsets before ever reusing one (never happens in practice, given
 * GROWTH_BUILD_ORDER's caps total fewer sites than offsets available). */
function nextGrowthOffset(camp: EnemyCamp): [number, number] {
  const extraIndex = Math.max(0, camp.townBuildings.list.length - STARTING_LAYOUT.length);
  return GROWTH_OFFSETS[extraIndex % GROWTH_OFFSETS.length];
}

/** Reorders GROWTH_BUILD_ORDER to react to the camp's actual situation
 * instead of always working through the same fixed list: rebuilding a lost
 * garrison takes priority over economy growth, and more housing jumps the
 * queue once population is actually capped (building it earlier would just
 * be wasted priority over whatever's next in line). */
function growthPriority(camp: EnemyCamp): { id: string; cap: number }[] {
  const order = [...GROWTH_BUILD_ORDER];
  const guardsAlive = camp.guards.filter((g) => g.alive).length;
  if (guardsAlive === 0) {
    order.sort((a, b) => (a.id === "barracks" ? -1 : b.id === "barracks" ? 1 : 0));
    return order;
  }
  const houses = camp.buildManager.countBuilt("house");
  const townCenters = camp.buildManager.countBuilt("town_center");
  const popUsed = camp.villagers.length + camp.guards.length;
  if (popUsed >= populationCapacity(houses, townCenters)) {
    order.sort((a, b) => (a.id === "house" ? -1 : b.id === "house" ? 1 : 0));
  }
  return order;
}

/** The camp's "build brain": if nothing is currently under construction and
 * an idle villager is free, starts the next affordable building in whatever
 * order growthPriority currently calls for. Entirely gated on the camp's own
 * gathered resources and villager availability — never spawns anything for
 * free. */
function tryStartGrowth(camp: EnemyCamp, scene: THREE.Scene) {
  const alreadyBuilding = camp.townBuildings.list.some((b) => b.underConstruction);
  if (alreadyBuilding) return;
  const idleVillager = camp.villagers.find((v) => v.isIdle);
  if (!idleVillager) return;

  for (const { id, cap } of growthPriority(camp)) {
    if (camp.buildManager.countBuilt(id) >= cap) continue;
    const def = getBuildingDef(id);
    if (!camp.buildManager.canBuild(def)) continue;

    camp.buildManager.build(def);
    const [ox, oz] = nextGrowthOffset(camp);
    const x = camp.center.x + ox;
    const z = camp.center.z + oz;
    const mesh = createBuildingMesh(id);
    mesh.position.set(x, heightAt(x, z), z);
    captureStructureMeshes(mesh);
    tintHostile(mesh);
    scene.add(mesh);

    const placed = camp.townBuildings.add(id, def, mesh, mesh.position);
    placed.underConstruction = true;
    placed.buildProgress = 0;
    placed.hp = Math.max(1, placed.maxHp * 0.05);
    setConstructionAppearance(mesh, 0);

    idleVillager.commandBuild(placed);
    return;
  }
}

/** Keeps a light, steady trickle of production going on any finished camp
 * building that trains something, instead of ever stockpiling a deep queue —
 * matches the "grow gradually" spirit better than instantly maxing a queue
 * the moment resources allow. */
function tryQueueTraining(camp: EnemyCamp) {
  for (const building of camp.townBuildings.list) {
    if (building.underConstruction || !building.def.trains) continue;
    if (building.queue.length >= 1) continue;
    enqueueUnit(building, camp.inventory);
  }
}

/** Picks where a raid should march toward: the player's weakest standing,
 * finished building (lowest HP fraction), tie-broken by distance from camp —
 * so raiders press an actual vulnerability instead of always making a
 * beeline for the (usually best-defended) Town Center. Guards still attack
 * whatever building is nearest once they're actually in range (see
 * updateRaiding), so this mainly steers where the party heads first. */
function pickRaidTarget(camp: EnemyCamp, playerTownBuildings: TownBuildings): THREE.Vector3 | null {
  let weakest: PlacedBuilding | null = null;
  let weakestScore = Infinity;
  for (const b of playerTownBuildings.list) {
    if (b.underConstruction) continue;
    const hpFraction = b.hp / b.maxHp;
    const dist = camp.center.distanceTo(b.position);
    // HP fraction dominates the choice; distance only breaks a near-tie.
    const score = hpFraction * 1000 + dist * 0.01;
    if (score < weakestScore) {
      weakestScore = score;
      weakest = b;
    }
  }
  return weakest ? weakest.position.clone() : null;
}

/** Every RAID_INTERVAL seconds, peels off a party of patrol guards (beyond a
 * defensive floor, scaled with how many guards the camp actually has) and
 * sends them at the player's weakest building. If the camp hasn't grown
 * enough to spare anyone, the raid simply fizzles — there's no scripted
 * fallback spawn. */
function tryDispatchRaid(camp: EnemyCamp, delta: number, playerTownBuildings: TownBuildings) {
  camp.raidTimer -= delta;
  if (camp.raidTimer > 0) return;
  camp.raidTimer = RAID_INTERVAL;

  const target = pickRaidTarget(camp, playerTownBuildings);
  if (!target) return;

  const patrolling = camp.guards.filter((g) => g.alive && !g.isRaiding);
  const totalGuards = camp.guards.filter((g) => g.alive).length;
  const minHome = Math.max(RAID_MIN_HOME_GUARDS, Math.ceil(totalGuards * RAID_MIN_HOME_FRACTION));
  const available = patrolling.length - minHome;
  if (available <= 0) return;

  const partySize = Math.max(
    1,
    Math.min(RAID_MAX_PARTY, Math.floor(totalGuards * RAID_GUARD_FRACTION), available),
  );
  for (let i = 0; i < partySize; i++) {
    patrolling[i].commandRaid(target);
  }
}

/** Advances the whole camp by one tick: villagers gather/build, guards
 * patrol/raid/fight, buildings train and (rarely) construct, and the raid
 * timer counts down. Called once per frame from main's animate loop. */
export function updateEnemyCamp(
  camp: EnemyCamp,
  scene: THREE.Scene,
  effects: Effects,
  delta: number,
  now: number,
  playerCombatants: Combatant[],
  playerTownBuildings: TownBuildings,
  damagePlayerBuilding: (building: PlacedBuilding, amount: number) => void,
) {
  // camp.gatherSource is the same ResourceManager the player uses, and
  // main.ts already ticks its respawn timers once per frame — no need to
  // do it again here.

  for (const villager of camp.villagers) villager.update(delta, now);
  camp.villagers = camp.villagers.filter((v) => {
    if (!v.alive) {
      v.dispose(scene);
      return false;
    }
    return true;
  });

  for (const guard of camp.guards) {
    guard.update(delta, now, playerCombatants, playerTownBuildings, damagePlayerBuilding);
  }
  camp.guards = camp.guards.filter((g) => {
    if (!g.alive) {
      g.dispose(scene);
      return false;
    }
    return true;
  });

  for (const building of camp.townBuildings.list) {
    const finished = advanceProduction(building, now);
    if (!finished) continue;
    if (finished === "villager") {
      camp.villagers.push(spawnCampVillager(camp, building.position, scene));
    } else {
      camp.guards.push(spawnCampGuard(building.position, scene, effects));
    }
  }

  tryStartGrowth(camp, scene);
  tryQueueTraining(camp);
  tryDispatchRaid(camp, delta, playerTownBuildings);
}

/** Wraps a camp building as a Combatant so player soldiers can target it
 * like any other hostile — destruction grants the player half the
 * building's original cost back as loot and disposes its mesh. */
export function wrapCampBuilding(
  camp: EnemyCamp,
  building: PlacedBuilding,
  playerInventory: Inventory,
  scene: THREE.Scene,
  effects: Effects,
): Combatant {
  return {
    model: building.mesh,
    get alive() {
      return camp.townBuildings.list.includes(building);
    },
    takeDamage(amount: number): boolean {
      if (!camp.townBuildings.list.includes(building)) return false;
      const destroyed = camp.townBuildings.damage(building, amount);
      if (destroyed) {
        camp.townBuildings.remove(building, scene);
        disposeBuildingMesh(building.mesh);
        for (const [type, cost] of Object.entries(building.def.cost) as [ResourceType, number][]) {
          playerInventory.add(type, Math.ceil(cost / 2));
        }
        effects.impact(building.position.clone().add(new THREE.Vector3(0, 1, 0)), 0xffaa33);
      }
      return destroyed;
    },
  };
}
