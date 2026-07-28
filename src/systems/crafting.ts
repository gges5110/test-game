import type { Inventory } from "./inventory";
import type { BuildManager } from "./building";
import type { ResourceType } from "../world/resources";

export interface Recipe {
  id: string;
  name: string;
  cost: Partial<Record<ResourceType, number>>;
  description: string;
  /** If set, the recipe is capped at this many owned (e.g. a permanent upgrade). */
  maxOwned?: number;
  /** If set, requires at least one of this building to be built first. */
  requiresBuilding?: string;
}

export const RECIPES: Recipe[] = [
  {
    id: "basic_tool",
    name: "Basic Tool",
    cost: { wood: 2, stone: 2 },
    description: "+1 wood/stone per villager gather",
    maxOwned: 1,
  },
  {
    id: "iron_tool",
    name: "Iron Tool",
    cost: { wood: 3, stone: 4 },
    description: "+2 wood/stone per villager gather (needs Blacksmith)",
    maxOwned: 1,
    requiresBuilding: "blacksmith",
  },
];

export class Crafting {
  private crafted: Record<string, number> = {};

  constructor(
    private inventory: Inventory,
    private buildManager: BuildManager,
  ) {}

  canCraft(recipe: Recipe): boolean {
    if (recipe.maxOwned !== undefined && this.countOf(recipe.id) >= recipe.maxOwned) {
      return false;
    }
    if (
      recipe.requiresBuilding &&
      this.buildManager.countBuilt(recipe.requiresBuilding) === 0
    ) {
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

  countOf(recipeId: string): number {
    return this.crafted[recipeId] ?? 0;
  }

  getAllCrafted(): Record<string, number> {
    return { ...this.crafted };
  }

  /** Replaces all state at once (e.g. restoring a save). */
  restore(crafted: Record<string, number>) {
    this.crafted = { ...crafted };
  }

  /** Owning a tool boosts wood/stone yield per gather; Iron Tool supersedes Basic Tool. */
  gatherBonus(type: ResourceType): number {
    if (type !== "wood" && type !== "stone") return 0;
    if (this.countOf("iron_tool") > 0) return 2;
    if (this.countOf("basic_tool") > 0) return 1;
    return 0;
  }
}
