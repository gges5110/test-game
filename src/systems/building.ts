import type { Inventory } from "./inventory";
import type { ResourceType } from "../world/resources";

export interface BuildingDef {
  id: string;
  name: string;
  cost: Partial<Record<ResourceType, number>>;
  description: string;
}

export const BUILDINGS: BuildingDef[] = [
  {
    id: "house",
    name: "House",
    cost: { wood: 6, stone: 2 },
    description: "Spawns a villager",
  },
  {
    id: "storage",
    name: "Storage",
    cost: { wood: 4, stone: 4 },
    description: "+20 resource capacity",
  },
  {
    id: "wall",
    name: "Wall",
    cost: { stone: 3 },
    description: "Defensive wall segment",
  },
];

export class BuildManager {
  constructor(private inventory: Inventory) {}

  canAfford(building: BuildingDef): boolean {
    return Object.entries(building.cost).every(([type, amount]) =>
      this.inventory.has(type as ResourceType, amount ?? 0),
    );
  }

  pay(building: BuildingDef) {
    for (const [type, amount] of Object.entries(building.cost)) {
      this.inventory.spend(type as ResourceType, amount ?? 0);
    }
  }
}
