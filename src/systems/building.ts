import type { Inventory } from "./inventory";
import type { ResourceType } from "../world/resources";
import type { UnitKind } from "../world/soldier";

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
  /** If set, this building auto-attacks the nearest wolf in range. */
  attack?: { range: number; damage: number; cooldown: number };
  /** Height (above the building's base) the attack beam is drawn from. Defaults to 2. */
  attackOriginY?: number;
  /** If set, this building passively produces a resource over time. */
  produces?: { type: ResourceType; amount: number; interval: number };
  /** If set, selecting this building offers a "Train" action that spends
   * food and produces a unit after `time` seconds. */
  trains?: { unit: UnitKind | "villager"; foodCost: number; time: number };
}

// Building roster and wood/stone cost ratios mirror Age of Empires II: economy
// buildings (House, Farm, camps, unit producers) cost wood only, while stone
// is reserved for defense (Outpost, Castle) — so turtling trades off against
// expansion instead of just gating everything behind the same resource.
export const BUILDINGS: BuildingDef[] = [
  {
    id: "town_center",
    name: "Town Center",
    cost: {},
    description: "Your town's founding building — select it to train Villagers",
    maxHp: 400,
    maxBuilt: 1,
    hidden: true,
    trains: { unit: "villager", foodCost: 3, time: 8 },
  },
  {
    id: "house",
    name: "House",
    cost: { wood: 5 },
    description: "Spawns a villager who gathers nearby resources",
    maxHp: 100,
    requiresTownCenter: true,
  },
  {
    id: "farm",
    name: "Farm",
    cost: { wood: 5 },
    description: "+1 food every 8s",
    maxHp: 70,
    requiresTownCenter: true,
    produces: { type: "food", amount: 1, interval: 8 },
  },
  {
    id: "mill",
    name: "Mill",
    cost: { wood: 8 },
    description: "+1 food every 6s — a sturdier food producer than a Farm",
    maxHp: 90,
    requiresTownCenter: true,
    produces: { type: "food", amount: 1, interval: 6 },
  },
  {
    id: "lumber_camp",
    name: "Lumber Camp",
    cost: { wood: 8 },
    description: "+1 wood every 6s",
    maxHp: 90,
    requiresTownCenter: true,
    produces: { type: "wood", amount: 1, interval: 6 },
  },
  {
    id: "mining_camp",
    name: "Mining Camp",
    cost: { wood: 8 },
    description: "+1 stone every 6s",
    maxHp: 90,
    requiresTownCenter: true,
    produces: { type: "stone", amount: 1, interval: 6 },
  },
  {
    id: "blacksmith",
    name: "Blacksmith",
    cost: { wood: 9 },
    description: "Unlocks Iron Tool (better gather rate)",
    maxHp: 100,
    requiresTownCenter: true,
    maxBuilt: 1,
  },
  {
    id: "barracks",
    name: "Barracks",
    cost: { wood: 10 },
    description: "Select it to train Soldiers, paid for in food",
    maxHp: 110,
    requiresTownCenter: true,
    trains: { unit: "soldier", foodCost: 4, time: 14 },
  },
  {
    id: "archery_range",
    name: "Archery Range",
    cost: { wood: 10 },
    description: "Select it to train Archers, paid for in food",
    maxHp: 100,
    requiresTownCenter: true,
    trains: { unit: "archer", foodCost: 4, time: 14 },
  },
  {
    id: "stable",
    name: "Stable",
    cost: { wood: 10 },
    description: "Select it to train Scouts, paid for in food",
    maxHp: 100,
    requiresTownCenter: true,
    trains: { unit: "scout", foodCost: 4, time: 14 },
  },
  {
    id: "outpost",
    name: "Outpost",
    cost: { wood: 3, stone: 2 },
    description: "Cheap early watchtower — light auto-attack on wolves",
    maxHp: 60,
    requiresTownCenter: true,
    attack: { range: 6, damage: 8, cooldown: 1.3 },
    attackOriginY: 2.2,
  },
  {
    id: "castle",
    name: "Castle",
    cost: { stone: 22 },
    description: "Your strongest structure — stone-only, huge HP, heavy attack",
    maxHp: 300,
    requiresTownCenter: true,
    maxBuilt: 2,
    attack: { range: 15, damage: 35, cooldown: 2 },
    attackOriginY: 3.2,
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

  getAllBuilt(): Record<string, number> {
    return { ...this.built };
  }

  /** Replaces all state at once (e.g. restoring a save). */
  restore(built: Record<string, number>) {
    this.built = { ...built };
  }
}
