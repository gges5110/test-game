import * as THREE from "three";
import type { BuildingDef } from "./building";

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
  /** Timestamp a manually-triggered unit production finishes at, if any. */
  producingUntil?: number;
  /** Called once when this building is destroyed (e.g. a House removing its villager). */
  onDestroyed?: () => void;
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
    };
    this.list.push(building);
    return building;
  }

  remove(building: PlacedBuilding, scene: THREE.Scene) {
    scene.remove(building.mesh);
    const idx = this.list.indexOf(building);
    if (idx >= 0) this.list.splice(idx, 1);
    building.onDestroyed?.();
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

  isTooCloseToAny(position: THREE.Vector3, minSpacing: number): boolean {
    return this.list.some((b) => b.position.distanceTo(position) < minSpacing);
  }
}
