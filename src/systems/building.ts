import type { Inventory } from "./inventory";
import type { ResourceType } from "../world/resources";

export interface BuildingDef {
  id: string;
  name: string;
  cost: Partial<Record<ResourceType, number>>;
  description: string;
  maxHp: number;
  /** If true, at least one Town Center must exist before this can be placed. */
  requiresTownCenter?: boolean;
  /** Caps how many of this building can ever be placed. */
  maxBuilt?: number;
  /** Excluded from the build menu (e.g. the free starting Town Center). */
  hidden?: boolean;
}

export const BUILDINGS: BuildingDef[] = [
  {
    id: "town_center",
    name: "Town Center",
    cost: {},
    description: "Your town's founding building",
    maxHp: 400,
    maxBuilt: 1,
    hidden: true,
  },
  {
    id: "house",
    name: "House",
    cost: { wood: 6, stone: 2 },
    description: "Spawns a villager who gathers nearby resources",
    maxHp: 100,
    requiresTownCenter: true,
  },
  {
    id: "storage",
    name: "Storage",
    cost: { wood: 4, stone: 4 },
    description: "+20 resource capacity",
    maxHp: 80,
    requiresTownCenter: true,
  },
  {
    id: "farm",
    name: "Farm",
    cost: { wood: 4, stone: 2 },
    description: "+1 food every 8s",
    maxHp: 70,
    requiresTownCenter: true,
  },
  {
    id: "blacksmith",
    name: "Blacksmith",
    cost: { wood: 5, stone: 6 },
    description: "Unlocks Iron Tool (better gather rate)",
    maxHp: 100,
    requiresTownCenter: true,
    maxBuilt: 1,
  },
  {
    id: "tower",
    name: "Tower",
    cost: { wood: 4, stone: 6 },
    description: "Auto-attacks nearby wolves",
    maxHp: 120,
    requiresTownCenter: true,
  },
  {
    id: "wall",
    name: "Wall",
    cost: { stone: 3 },
    description: "Defensive wall segment — blocks and absorbs attacks",
    maxHp: 150,
    requiresTownCenter: true,
  },
  {
    id: "campfire",
    name: "Campfire",
    cost: { wood: 3, stone: 1 },
    description: "Light + landmark",
    maxHp: 40,
    requiresTownCenter: true,
  },
];

export function getBuildingDef(id: string): BuildingDef {
  const def = BUILDINGS.find((b) => b.id === id);
  if (!def) throw new Error(`Unknown building id: ${id}`);
  return def;
}

export class BuildManager {
  private built: Record<string, number> = {};

  constructor(private inventory: Inventory) {}

  countBuilt(id: string): number {
    return this.built[id] ?? 0;
  }

  totalBuilt(): number {
    return Object.values(this.built).reduce((sum, n) => sum + n, 0);
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

  /** Registers a building as built without paying for it (e.g. the free starting Town Center). */
  grant(id: string) {
    this.built[id] = (this.built[id] ?? 0) + 1;
  }
}
