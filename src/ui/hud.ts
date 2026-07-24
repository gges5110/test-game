import { Inventory } from "../systems/inventory";
import { Crafting, RECIPES } from "../systems/crafting";
import type { ResourceType } from "../world/resources";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: "🪵 Wood",
  stone: "🪨 Stone",
  fiber: "🌿 Fiber",
};

export class Hud {
  private inventoryEl: HTMLElement;
  private promptEl: HTMLElement;
  private craftMenuEl: HTMLElement;
  private craftMenuOpen = false;

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
    private crafting: Crafting,
  ) {
    root.innerHTML = `
      <div class="inventory"></div>
      <div class="prompt" hidden></div>
      <div class="hint">WASD move · drag to look · space jump · E gather · C craft</div>
      <div class="craft-menu" hidden></div>
    `;
    this.inventoryEl = root.querySelector(".inventory")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.craftMenuEl = root.querySelector(".craft-menu")!;

    this.inventory.onChange(() => this.renderInventory());
    this.renderInventory();

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") this.toggleCraftMenu();
    });
  }

  private renderInventory() {
    this.inventoryEl.innerHTML = (
      Object.keys(RESOURCE_LABEL) as ResourceType[]
    )
      .map(
        (type) =>
          `<div class="slot">${RESOURCE_LABEL[type]}: ${this.inventory.get(type)}</div>`,
      )
      .join("");
  }

  setPrompt(text: string | null) {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.hidden = false;
    } else {
      this.promptEl.hidden = true;
    }
  }

  toggleCraftMenu() {
    this.craftMenuOpen = !this.craftMenuOpen;
    this.craftMenuEl.hidden = !this.craftMenuOpen;
    if (this.craftMenuOpen) this.renderCraftMenu();
  }

  private renderCraftMenu() {
    const rows = RECIPES.map((recipe) => {
      const costText = Object.entries(recipe.cost)
        .map(([type, amt]) => `${amt} ${RESOURCE_LABEL[type as ResourceType]}`)
        .join(", ");
      const canCraft = this.crafting.canCraft(recipe);
      return `
        <div class="recipe">
          <span>${recipe.name}<br><small>${costText}</small></span>
          <button data-id="${recipe.id}" ${canCraft ? "" : "disabled"}>Craft (${this.crafting.countOf(recipe.id)})</button>
        </div>
      `;
    }).join("");

    this.craftMenuEl.innerHTML = `<h2>Crafting</h2>${rows}`;
    this.craftMenuEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const recipe = RECIPES.find((r) => r.id === btn.dataset.id);
        if (recipe) {
          this.crafting.craft(recipe);
          this.renderCraftMenu();
        }
      });
    });
  }
}
