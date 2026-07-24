import type { Inventory } from "./inventory";
import type { ResourceType } from "../world/resources";

export interface BuildingDef {
  id: string;
  name: string;
  cost: Partial<Record<ResourceType, number>>;
  description: string;
  /** If true, at least one Town Center must exist before this can be placed. */
  requiresTownCenter?: boolean;
  /** Caps how many of this building can ever be placed. */
  maxBuilt?: number;
}

export const BUILDINGS: BuildingDef[] = [
  {
    id: "town_center",
    name: "Town Center",
    cost: { wood: 10, stone: 6 },
    description: "Founds your town — build this first",
    maxBuilt: 1,
  },
  {
    id: "house",
    name: "House",
    cost: { wood: 6, stone: 2 },
    description: "Spawns a villager who gathers nearby resources",
    requiresTownCenter: true,
  },
  {
    id: "storage",
    name: "Storage",
    cost: { wood: 4, stone: 4 },
    description: "+20 resource capacity",
    requiresTownCenter: true,
  },
  {
    id: "farm",
    name: "Farm",
    cost: { wood: 3, fiber: 3 },
    description: "+1 food every 8s",
    requiresTownCenter: true,
  },
  {
    id: "blacksmith",
    name: "Blacksmith",
    cost: { wood: 5, stone: 6 },
    description: "Unlocks Iron Tool crafting",
    requiresTownCenter: true,
    maxBuilt: 1,
  },
  {
    id: "wall",
    name: "Wall",
    cost: { stone: 3 },
    description: "Defensive wall segment",
    requiresTownCenter: true,
  },
];

export class BuildManager {
  private built: Record<string, number> = {};

  constructor(private inventory: Inventory) {}

  countBuilt(id: string): number {
    return this.built[id] ?? 0;
  }

  canBuild(building: BuildingDef): boolean {
    if (building.requiresTownCenter && this.countBuilt("town_center") === 0) {
      return false;
    }
    if (
      building.maxBuilt !== undefined &&
      this.countBuilt(building.id) >= building.maxBuilt
    ) {
      return false;
    }
    return Object.entries(building.cost).every(([type, amount]) =>
      this.inventory.has(type as ResourceType, amount ?? 0),
    );
  }

  build(building: BuildingDef): boolean {
    if (!this.canBuild(building)) return false;
    for (const [type, amount] of Object.entries(building.cost)) {
      this.inventory.spend(type as ResourceType, amount ?? 0);
    }
    this.built[building.id] = (this.built[building.id] ?? 0) + 1;
    return true;
  }
}
