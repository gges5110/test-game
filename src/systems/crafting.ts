import type { Inventory } from "./inventory";
import type { ResourceType } from "../world/resources";

export interface Recipe {
  id: string;
  name: string;
  cost: Partial<Record<ResourceType, number>>;
}

export const RECIPES: Recipe[] = [
  { id: "torch", name: "Torch", cost: { wood: 2, fiber: 1 } },
  { id: "basic_tool", name: "Basic Tool", cost: { wood: 2, stone: 2 } },
  { id: "campfire", name: "Campfire", cost: { wood: 4, stone: 3 } },
];

export class Crafting {
  private crafted: Record<string, number> = {};
  private inventory: Inventory;

  constructor(inventory: Inventory) {
    this.inventory = inventory;
  }

  canCraft(recipe: Recipe): boolean {
    return Object.entries(recipe.cost).every(([type, amount]) =>
      this.inventory.has(type as ResourceType, amount ?? 0),
    );
  }

  craft(recipe: Recipe): boolean {
    if (!this.canCraft(recipe)) return false;
    for (const [type, amount] of Object.entries(recipe.cost)) {
      this.inventory.spend(type as ResourceType, amount ?? 0);
    }
    this.crafted[recipe.id] = (this.crafted[recipe.id] ?? 0) + 1;
    return true;
  }

  countOf(recipeId: string): number {
    return this.crafted[recipeId] ?? 0;
  }
}
