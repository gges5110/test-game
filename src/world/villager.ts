import * as THREE from "three";
import { heightAt, avoidObstacleDirection } from "./terrain";
import type { DropOffFinder, GatherSource, ResourceNode, ResourceType } from "./resources";
import type { Inventory } from "../systems/inventory";
import type { Combatant } from "./combatant";
import { createHealthBar, type HealthBar } from "./healthBar";
import {
  createSelectionRing,
  createVillagerModel,
  createWorkIndicator,
  createCarryIndicator,
} from "./unitVisuals";

/** Unarmed — soft compared to a Soldier's lowest (Archer at 40), so a raid
 * that reaches your economy is genuinely costly, not just cosmetic. */
export const VILLAGER_MAX_HP = 25;

/** Matches the minimap's resource-node colors, so a carried resource reads
 * as the same "thing" whether you're looking at the node or the villager. */
const CARRY_COLOR: Record<ResourceType, number> = {
  wood: 0x4a7c3f,
  stone: 0x9a9086,
  food: 0xd6335c,
  gold: 0xe8c34a,
};

const WANDER_RADIUS = 4;
const JOB_SEARCH_RADIUS = 25;
const SPEED = 1.6;
const ARRIVE_DIST = 0.3;
/** Units per second pulled from whatever node is being worked — AoE2-style
 * continuous gathering instead of "stand still, then get the whole node". */
const GATHER_RATE = 2;
/** How much a villager hauls per trip before heading to a drop-off, even if
 * the node isn't exhausted yet — AoE2's per-trip carry cap. */
const CARRY_CAPACITY = 10;
const BUILD_RANGE = 1.8;

type State =
  | "idle"
  | "toResource"
  | "gathering"
  | "toHome"
  | "moving"
  | "toBuild"
  | "building"
  | "toGarrison"
  | "garrisoned";

/** What a villager needs to know about a construction site. PlacedBuilding
 * satisfies this structurally, without villager.ts depending on it. */
export interface ConstructionSite {
  position: THREE.Vector3;
  underConstruction: boolean;
}

/** A building a villager can hide inside — a Town Center or Castle.
 * TownBuildings hands out one of these per building via garrisonSiteFor(),
 * closing over its own bookkeeping so Villager never touches PlacedBuilding
 * directly. */
export interface GarrisonSite {
  position: THREE.Vector3;
  canGarrison(): boolean;
  occupy(villager: Villager): void;
  release(villager: Villager): void;
}

export class Villager implements Combatant {
  readonly model: THREE.Group;
  hp = VILLAGER_MAX_HP;
  alive = true;

  private home: THREE.Vector3;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;
  private moveTarget = new THREE.Vector3();
  private selectionRing: THREE.Mesh;
  private workIndicator: THREE.Mesh;
  private carryIndicator: THREE.Mesh;
  private healthBar: HealthBar;

  private state: State = "idle";
  private targetNode: ResourceNode | null = null;
  private buildSite: ConstructionSite | null = null;
  private carrying: ResourceType | null = null;
  /** How much of `carrying` has been extracted this trip, up to
   * CARRY_CAPACITY, not yet delivered to a drop-off. */
  private carryAmount = 0;
  /** Sticky job filter set by the player (e.g. "gather food") — once set, the
   * villager only picks up nodes of this type when idle, instead of whatever
   * is nearest, until explicitly moved or reassigned. */
  private assignedType: ResourceType | null = null;
  /** Where a load is being carried to — the nearest valid drop-off for its
   * type, resolved once on picking it up. Falls back to home if nothing
   * qualifies (shouldn't happen once a Town Center exists, but keeps a
   * villager from getting stuck instead of just walking further than ideal). */
  private dropTarget: THREE.Vector3 | null = null;
  private garrisonSite: GarrisonSite | null = null;

  constructor(
    scene: THREE.Scene,
    home: THREE.Vector3,
    private resources: GatherSource,
    private dropOffFinder: DropOffFinder,
    private inventory: Inventory,
    private getGatherBonus: (type: ResourceType) => number,
    private onBuildTick: (site: ConstructionSite, delta: number) => void = () => {},
  ) {
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = createVillagerModel();
    this.model.position.copy(home);
    this.model.userData.villager = this;
    scene.add(this.model);

    this.selectionRing = createSelectionRing();
    this.selectionRing.visible = false;
    this.model.add(this.selectionRing);

    this.workIndicator = createWorkIndicator();
    this.workIndicator.visible = false;
    this.model.add(this.workIndicator);

    this.carryIndicator = createCarryIndicator();
    this.carryIndicator.visible = false;
    this.model.add(this.carryIndicator);

    this.healthBar = createHealthBar(0.6, 0.1);
    scene.add(this.healthBar.group);
    this.syncHealthBarPosition();
  }

  setSelected(selected: boolean) {
    this.selectionRing.visible = selected;
  }

  /** Not gathering, building, or under a move order — free to be assigned. */
  get isIdle(): boolean {
    return this.state === "idle";
  }

  getHome(): THREE.Vector3 {
    return this.home.clone();
  }

  /** Player-issued: walk to a point, then resume normal idle behavior. Clears
   * any resource-type assignment — an explicit move is an override. */
  commandMoveTo(point: THREE.Vector3) {
    this.releaseJob();
    this.assignedType = null;
    this.moveTarget.copy(point);
    this.state = "moving";
  }

  /** True if this villager is heading to or working on the given site. */
  isBuilding(site: ConstructionSite): boolean {
    return this.buildSite === site;
  }

  /** Player-issued: walk to a construction site and work on it until done. */
  commandBuild(site: ConstructionSite) {
    this.releaseJob();
    this.buildSite = site;
    this.state = "toBuild";
  }

  /** Player-issued: walk into a Town Center or Castle and hide there until
   * moved, reassigned, or the building falls. No-ops if it's already full. */
  commandGarrison(site: GarrisonSite) {
    if (!site.canGarrison()) return;
    this.releaseJob();
    this.assignedType = null;
    this.garrisonSite = site;
    this.state = "toGarrison";
  }

  /** True while hidden inside a garrison site — safe from attack, but not
   * doing any work until it comes back out. */
  get isGarrisoned(): boolean {
    return this.state === "garrisoned";
  }

  /** Bails out of whatever this villager is doing — job, build, or garrison
   * — back to idle where it currently stands. Used when the site it was tied
   * to (a garrisoned building) is destroyed out from under it. */
  forceIdle() {
    this.releaseJob();
    this.state = "idle";
  }

  /** Player-issued: go gather a specific node, then keep gathering that
   * resource type afterward (see assignedType) instead of drifting to
   * whatever's nearest. */
  commandGather(node: ResourceNode) {
    if (node.depleted) return;
    this.releaseJob();
    this.assignedType = node.type;
    this.resources.reserve(node);
    this.targetNode = node;
    this.state = "toResource";
  }

  /** Player-issued: stick to gathering `type` whenever idle, until moved or
   * reassigned — the "keep gathering food" request, independent of any one
   * node. Immediately looks for a job of that type if currently idle. */
  commandGatherType(type: ResourceType) {
    this.releaseJob();
    this.assignedType = type;
    if (this.state === "idle" || this.state === "moving") {
      const node = this.resources.findNearestAvailable(this.home, JOB_SEARCH_RADIUS, type);
      if (node) {
        this.resources.reserve(node);
        this.targetNode = node;
        this.state = "toResource";
        return;
      }
    }
    this.state = "idle";
  }

  /** What this villager is currently assigned to gather, or null if it's
   * free to pick whatever's nearest — surfaced for the HUD. */
  get gatherAssignment(): ResourceType | null {
    return this.assignedType;
  }

  update(delta: number, now: number) {
    if (!this.alive) return;
    if (this.state === "garrisoned") return; // hidden inside a building; nothing to do
    this.workIndicator.visible =
      this.state === "gathering" || this.state === "building";
    this.carryIndicator.visible = this.carrying !== null;
    switch (this.state) {
      case "toBuild":
        this.updateToBuild(delta);
        break;
      case "building":
        this.updateBuilding(delta, now);
        break;
      case "toResource":
        this.updateToResource(delta);
        break;
      case "gathering":
        this.updateGathering(delta, now);
        break;
      case "toHome":
        this.updateToHome(delta);
        break;
      case "moving":
        this.updateMoving(delta);
        break;
      case "toGarrison":
        this.updateToGarrison(delta);
        break;
      default:
        this.updateIdle(delta, now);
    }
    this.syncHealthBarPosition();
  }

  /** Returns true if this hit killed the villager. */
  takeDamage(amount: number): boolean {
    if (!this.alive) return false;
    this.hp -= amount;
    this.healthBar.setFraction(this.hp / VILLAGER_MAX_HP);
    if (this.hp <= 0) {
      this.alive = false;
      this.releaseJob();
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

  private syncHealthBarPosition() {
    this.healthBar.group.position.set(
      this.model.position.x,
      this.model.position.y + 1.6,
      this.model.position.z,
    );
  }

  private updateToBuild(delta: number) {
    const site = this.buildSite;
    if (!site || !site.underConstruction) {
      this.buildSite = null;
      this.state = "idle";
      return;
    }
    this.moveToward(site.position, delta);
    // Stop at the edge rather than walking into the footprint.
    if (this.model.position.distanceTo(site.position) <= BUILD_RANGE) {
      this.state = "building";
    }
  }

  private updateBuilding(delta: number, now: number) {
    const site = this.buildSite;
    if (!site || !site.underConstruction) {
      this.buildSite = null;
      this.state = "idle";
      return;
    }
    this.workIndicator.position.y = 1.55 + Math.sin(now * 9) * 0.1;
    this.workIndicator.rotation.y = now * 4;
    this.onBuildTick(site, delta);
  }

  private updateToGarrison(delta: number) {
    const site = this.garrisonSite;
    if (!site || !site.canGarrison()) {
      this.garrisonSite = null;
      this.state = "idle";
      return;
    }
    this.moveToward(site.position, delta);
    if (this.model.position.distanceTo(site.position) <= BUILD_RANGE) {
      site.occupy(this);
      this.model.visible = false;
      this.healthBar.group.visible = false;
      this.state = "garrisoned";
    }
  }

  private updateMoving(delta: number) {
    this.moveToward(this.moveTarget, delta);
    if (this.model.position.distanceTo(this.moveTarget) <= ARRIVE_DIST) {
      this.state = "idle";
    }
  }

  private updateToResource(delta: number) {
    if (!this.targetNode || this.targetNode.depleted) {
      this.abandonJob();
      return;
    }
    this.moveToward(this.targetNode.position, delta);
    if (this.model.position.distanceTo(this.targetNode.position) <= ARRIVE_DIST) {
      this.state = "gathering";
    }
  }

  private updateGathering(delta: number, now: number) {
    this.workIndicator.position.y = 1.55 + Math.sin(now * 9) * 0.1;
    this.workIndicator.rotation.y = now * 4;

    const node = this.targetNode;
    if (!node) {
      this.state = "idle";
      return;
    }

    this.carrying = node.type;
    const material = this.carryIndicator.material as THREE.MeshStandardMaterial;
    material.color.setHex(CARRY_COLOR[node.type]);

    const want = Math.min(GATHER_RATE * delta, CARRY_CAPACITY - this.carryAmount);
    this.carryAmount += this.resources.extract(node, want);

    if (this.carryAmount >= CARRY_CAPACITY - 1e-6 || node.depleted) {
      this.dropTarget = this.dropOffFinder.nearestDropOff(node.type, this.model.position) ?? this.home;
      this.state = "toHome";
    }
  }

  private updateToHome(delta: number) {
    const target = this.dropTarget ?? this.home;
    this.moveToward(target, delta);
    // The target is a building's center, not its doorway — stop at the
    // footprint's edge (same reach used to approach a construction site)
    // instead of walking inside the building to deliver the load.
    if (this.model.position.distanceTo(target) <= BUILD_RANGE) {
      if (this.carrying && this.carryAmount > 0) {
        const bonus = this.getGatherBonus(this.carrying);
        this.inventory.add(this.carrying, this.carryAmount + bonus);
      }
      this.carrying = null;
      this.carryAmount = 0;
      // The node isn't gone, just this trip — head back for another load
      // instead of hunting for a fresh one, same as AoE2's shuttle run.
      if (this.targetNode && !this.targetNode.depleted) {
        this.state = "toResource";
      } else {
        if (this.targetNode) this.resources.release(this.targetNode);
        this.targetNode = null;
        this.state = "idle";
      }
    }
  }

  private updateIdle(delta: number, now: number) {
    const node = this.resources.findNearestAvailable(
      this.home,
      JOB_SEARCH_RADIUS,
      this.assignedType ?? undefined,
    );
    if (node) {
      this.resources.reserve(node);
      this.targetNode = node;
      this.state = "toResource";
      return;
    }

    // No job available nearby — wander near home for atmosphere.
    if (this.model.position.distanceTo(this.wanderTarget) > ARRIVE_DIST) {
      this.moveToward(this.wanderTarget, delta);
    } else if (now > this.wanderWaitUntil) {
      this.pickWanderTarget(now);
    }
  }

  private abandonJob() {
    this.releaseJob();
    this.state = "idle";
  }

  private releaseJob() {
    if (this.targetNode) this.resources.release(this.targetNode);
    this.targetNode = null;
    this.buildSite = null;
    // Any in-progress trip is abandoned along with the job — a reassigned
    // villager doesn't materialize a partial, undelivered load out of thin
    // air once it starts working a different node.
    this.carrying = null;
    this.carryAmount = 0;
    if (this.state === "garrisoned") {
      this.garrisonSite?.release(this);
      this.model.visible = true;
      this.healthBar.group.visible = true;
    }
    this.garrisonSite = null;
  }

  private moveToward(point: THREE.Vector3, delta: number) {
    const toTarget = point.clone().sub(this.model.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-4) return;
    const step = Math.min(SPEED * delta, dist);
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

  private pickWanderTarget(now: number) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * WANDER_RADIUS;
    const x = this.home.x + Math.cos(angle) * radius;
    const z = this.home.z + Math.sin(angle) * radius;
    this.wanderTarget.set(x, heightAt(x, z), z);
    this.wanderWaitUntil = now + 2 + Math.random() * 3;
  }
}
