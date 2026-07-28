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
  /** If set, this building auto-attacks the nearest wolf in range. */
  attack?: { range: number; damage: number; cooldown: number };
  /** Height (above the building's base) the attack beam is drawn from. Defaults to 2. */
  attackOriginY?: number;
  /** Max villagers that can hide inside for protection — AoE2's garrison. */
  garrisonCapacity?: number;
  /** If set, having villagers garrisoned grants an auto-attack (a Town
   * Center has none of its own otherwise), scaled by how many are inside. */
  garrisonAttack?: { range: number; damagePerVillager: number; cooldown: number };
  /** Villager-seconds of work needed to construct it. Two villagers halve
   * the wall-clock time. */
  buildTime: number;
  /** If set, villagers carrying this resource (or anything, for "any") drop
   * it off here instead of needing to walk all the way back to wherever they
   * started — AoE2's Town Center / Mill / Lumber Camp / Mining Camp role.
   * Nothing here produces resources on its own; a villager still has to
   * gather and carry every load. */
  dropOff?: ResourceType | "any";
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
    cost: { wood: 30, stone: 15 },
    description:
      "Trains Villagers and adds +5 population capacity. Also a drop-off point for any resource. Villagers can garrison inside for safety, which arms it with an auto-attack. Your town starts with one; building more expands where you can grow.",
    maxHp: 400,
    buildTime: 30,
    maxBuilt: 3,
    requiresTownCenter: true,
    dropOff: "any",
    trains: { unit: "villager", foodCost: 3, time: 8 },
    garrisonCapacity: 10,
    garrisonAttack: { range: 8, damagePerVillager: 3, cooldown: 1.5 },
    attackOriginY: 2.4,
  },
  {
    id: "house",
    name: "House",
    cost: { wood: 5 },
    description: "+5 population capacity",
    maxHp: 100,
    buildTime: 12,
    requiresTownCenter: true,
  },
  {
    id: "farm",
    name: "Farm",
    cost: { wood: 5 },
    description: "A plantable food patch — villagers gather it like any resource, then carry it to a Mill or Town Center",
    maxHp: 70,
    buildTime: 10,
    requiresTownCenter: true,
  },
  {
    id: "mill",
    name: "Mill",
    cost: { wood: 8 },
    description: "Food drop-off point — build it near farms and berries so villagers don't have to walk as far",
    maxHp: 90,
    buildTime: 16,
    requiresTownCenter: true,
    dropOff: "food",
  },
  {
    id: "lumber_camp",
    name: "Lumber Camp",
    cost: { wood: 8 },
    description: "Wood drop-off point — build it near trees so villagers don't have to walk as far",
    maxHp: 90,
    buildTime: 16,
    requiresTownCenter: true,
    dropOff: "wood",
  },
  {
    id: "mining_camp",
    name: "Mining Camp",
    cost: { wood: 8 },
    description: "Stone drop-off point — build it near rocks so villagers don't have to walk as far",
    maxHp: 90,
    buildTime: 16,
    requiresTownCenter: true,
    dropOff: "stone",
  },
  {
    id: "blacksmith",
    name: "Blacksmith",
    cost: { wood: 9 },
    description: "Unlocks Iron Tool (better gather rate)",
    maxHp: 100,
    buildTime: 20,
    requiresTownCenter: true,
    maxBuilt: 1,
  },
  {
    id: "barracks",
    name: "Barracks",
    cost: { wood: 10 },
    description: "Select it to train Soldiers, paid for in food",
    maxHp: 110,
    buildTime: 22,
    requiresTownCenter: true,
    trains: { unit: "soldier", foodCost: 4, time: 14 },
  },
  {
    id: "archery_range",
    name: "Archery Range",
    cost: { wood: 10 },
    description: "Select it to train Archers, paid for in food",
    maxHp: 100,
    buildTime: 22,
    requiresTownCenter: true,
    trains: { unit: "archer", foodCost: 4, time: 14 },
  },
  {
    id: "stable",
    name: "Stable",
    cost: { wood: 10 },
    description: "Select it to train Scouts, paid for in food",
    maxHp: 100,
    buildTime: 22,
    requiresTownCenter: true,
    trains: { unit: "scout", foodCost: 4, time: 14 },
  },
  {
    id: "outpost",
    name: "Outpost",
    cost: { wood: 3, stone: 2 },
    description: "Cheap early watchtower — light auto-attack on wolves",
    maxHp: 60,
    buildTime: 14,
    requiresTownCenter: true,
    attack: { range: 6, damage: 8, cooldown: 1.3 },
    attackOriginY: 2.2,
  },
  {
    id: "castle",
    name: "Castle",
    cost: { stone: 22 },
    description: "Your strongest structure — stone-only, huge HP, heavy attack. Villagers can garrison inside for safety.",
    maxHp: 300,
    buildTime: 40,
    requiresTownCenter: true,
    maxBuilt: 2,
    attack: { range: 15, damage: 35, cooldown: 2 },
    attackOriginY: 3.2,
    garrisonCapacity: 15,
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
