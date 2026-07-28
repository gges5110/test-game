import * as THREE from "three";
import type { BuildingDef } from "./building";
import type { UnitKind } from "../world/soldier";
import type { ResourceType } from "../world/resources";
import type { Villager, GarrisonSite } from "../world/villager";

export interface PlacedBuilding {
  id: number;
  type: string;
  def: BuildingDef;
  mesh: THREE.Group;
  position: THREE.Vector3;
  hp: number;
  maxHp: number;
  /** Tower attack cooldown timestamp; unused by other building types. */
  attackReadyAt: number;
  /** True until villagers finish constructing it. An unfinished building
   * doesn't produce, train or attack. */
  underConstruction: boolean;
  /** 0..1 construction progress while underConstruction. */
  buildProgress: number;
  /** Units queued for production, in order; index 0 is the one currently
   * training. Their cost is already paid — AoE2 deducts at queue time, so
   * cancelling refunds. */
  queue: (UnitKind | "villager")[];
  /** Timestamp the unit at the head of the queue finishes at, if training. */
  producingUntil?: number;
  /** Called once when this building is destroyed (e.g. a House removing its villager). */
  onDestroyed?: () => void;
  /** Where newly trained units head off to, if set — a training building only. */
  rallyPoint?: THREE.Vector3;
  /** Villagers currently hiding inside, if this is a Town Center or Castle. */
  garrison: Villager[];
}

let nextId = 1;

export class TownBuildings {
  readonly list: PlacedBuilding[] = [];

  add(
    type: string,
    def: BuildingDef,
    mesh: THREE.Group,
    position: THREE.Vector3,
  ): PlacedBuilding {
    const building: PlacedBuilding = {
      id: nextId++,
      type,
      def,
      mesh,
      position: position.clone(),
      hp: def.maxHp,
      maxHp: def.maxHp,
      attackReadyAt: 0,
      underConstruction: false,
      buildProgress: 1,
      queue: [],
      garrison: [],
    };
    this.list.push(building);
    return building;
  }

  remove(building: PlacedBuilding, scene: THREE.Scene) {
    scene.remove(building.mesh);
    const idx = this.list.indexOf(building);
    if (idx >= 0) this.list.splice(idx, 1);
    // Garrisoned villagers don't die with the building — they pop back out
    // where they were hiding, same as any other interrupted job.
    for (const v of building.garrison) v.forceIdle();
    building.garrison = [];
    building.onDestroyed?.();
  }

  /** Structural GarrisonSite for a specific building, so Villager can command
   * itself in/out without knowing about PlacedBuilding or TownBuildings. */
  garrisonSiteFor(building: PlacedBuilding): GarrisonSite {
    return {
      position: building.position,
      canGarrison: () =>
        !building.underConstruction &&
        !!building.def.garrisonCapacity &&
        building.garrison.length < building.def.garrisonCapacity,
      occupy: (villager) => building.garrison.push(villager),
      release: (villager) => {
        building.garrison = building.garrison.filter((v) => v !== villager);
      },
    };
  }

  /** Returns true if this hit destroyed the building. */
  damage(building: PlacedBuilding, amount: number): boolean {
    building.hp = Math.max(0, building.hp - amount);
    return building.hp <= 0;
  }

  findNearest(position: THREE.Vector3, maxDist = Infinity): PlacedBuilding | null {
    let nearest: PlacedBuilding | null = null;
    let nearestDist = maxDist;
    for (const b of this.list) {
      const dist = position.distanceTo(b.position);
      if (dist < nearestDist) {
        nearest = b;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  findInRange(position: THREE.Vector3, range: number): PlacedBuilding[] {
    return this.list.filter((b) => position.distanceTo(b.position) <= range);
  }

  /** Nearest finished building a villager carrying `type` can drop it off at
   * — a Town Center (any resource) or the matching specialized building.
   * Satisfies DropOffFinder structurally. */
  nearestDropOff(type: ResourceType, from: THREE.Vector3): THREE.Vector3 | null {
    let nearest: THREE.Vector3 | null = null;
    let nearestDist = Infinity;
    for (const b of this.list) {
      if (b.underConstruction) continue;
      if (b.def.dropOff !== "any" && b.def.dropOff !== type) continue;
      const dist = from.distanceTo(b.position);
      if (dist < nearestDist) {
        nearestDist = dist;
        nearest = b.position;
      }
    }
    return nearest;
  }

  isTooCloseToAny(position: THREE.Vector3, minSpacing: number): boolean {
    return this.list.some((b) => b.position.distanceTo(position) < minSpacing);
  }
}
