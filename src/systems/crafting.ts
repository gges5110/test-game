import type { Inventory } from "./inventory";
import type { ResourceType } from "../world/resources";

export interface Recipe {
  id: string;
  name: string;
  cost: Partial<Record<ResourceType, number>>;
  description: string;
  /** If set, the recipe is capped at this many owned (e.g. a permanent upgrade). */
  maxOwned?: number;
}

export const RECIPES: Recipe[] = [
  {
    id: "basic_tool",
    name: "Basic Tool",
    cost: { wood: 2, stone: 2 },
    description: "+1 wood/stone per gather",
    maxOwned: 1,
  },
  {
    id: "torch",
    name: "Torch",
    cost: { wood: 2, fiber: 1 },
    description: "Press T to equip/unequip a light",
  },
  {
    id: "campfire",
    name: "Campfire",
    cost: { wood: 4, stone: 3 },
    description: "Press F to place a light + landmark",
  },
];

export class Crafting {
  private crafted: Record<string, number> = {};
  private inventory: Inventory;

  constructor(inventory: Inventory) {
    this.inventory = inventory;
  }

  canCraft(recipe: Recipe): boolean {
    if (recipe.maxOwned !== undefined && this.countOf(recipe.id) >= recipe.maxOwned) {
      return false;
    }
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

  /** Grants an already-crafted item for free (e.g. starting kit). */
  grant(recipeId: string, amount = 1) {
    this.crafted[recipeId] = (this.crafted[recipeId] ?? 0) + amount;
  }

  /** Consumes one crafted+owned unit (e.g. placing a campfire). */
  consumeCrafted(recipeId: string): boolean {
    if ((this.crafted[recipeId] ?? 0) <= 0) return false;
    this.crafted[recipeId] -= 1;
    return true;
  }

  countOf(recipeId: string): number {
    return this.crafted[recipeId] ?? 0;
  }

  /** Owning the basic tool boosts wood/stone yield per gather. */
  gatherBonus(type: ResourceType): number {
    return type !== "fiber" && this.countOf("basic_tool") > 0 ? 1 : 0;
  }
}
