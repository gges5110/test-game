import { Inventory } from "../systems/inventory";
import { Crafting, RECIPES } from "../systems/crafting";
import { BUILDINGS, BuildManager, type BuildingDef } from "../systems/building";
import type { ResourceType } from "../world/resources";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: "🪵 Wood",
  stone: "🪨 Stone",
  fiber: "🌿 Fiber",
  food: "🍞 Food",
};

export class Hud {
  private inventoryEl: HTMLElement;
  private healthFillEl: HTMLElement;
  private townStatsEl: HTMLElement;
  private promptEl: HTMLElement;
  private craftMenuEl: HTMLElement;
  private buildMenuEl: HTMLElement;
  private craftMenuOpen = false;
  private buildMenuOpen = false;
  private onSelectBuilding: (building: BuildingDef) => void = () => {};

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
    private crafting: Crafting,
    private buildManager: BuildManager,
  ) {
    root.innerHTML = `
      <div class="inventory"></div>
      <div class="healthbar"><div class="fill" style="width:100%"></div></div>
      <div class="townstats"></div>
      <div class="prompt" hidden></div>
      <div class="hint">WASD move · drag to look · space jump · E gather/attack · C craft · B build · T torch · F campfire</div>
      <div class="craft-menu" hidden></div>
      <div class="craft-menu" id="buildMenu" hidden></div>
    `;
    this.inventoryEl = root.querySelector(".inventory")!;
    this.healthFillEl = root.querySelector(".healthbar .fill")!;
    this.townStatsEl = root.querySelector(".townstats")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.craftMenuEl = root.querySelector(".craft-menu")!;
    this.buildMenuEl = root.querySelector("#buildMenu")!;

    this.inventory.onChange(() => this.renderInventory());
    this.renderInventory();

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") {
        this.buildMenuOpen = false;
        this.buildMenuEl.hidden = true;
        this.toggleCraftMenu();
      } else if (e.code === "KeyB") {
        this.craftMenuOpen = false;
        this.craftMenuEl.hidden = true;
        this.toggleBuildMenu();
      }
    });
  }

  /** Called when the player picks a building to place from the build menu. */
  setOnSelectBuilding(handler: (building: BuildingDef) => void) {
    this.onSelectBuilding = handler;
  }

  private renderInventory() {
    this.inventoryEl.innerHTML = (
      Object.keys(RESOURCE_LABEL) as ResourceType[]
    )
      .map(
        (type) =>
          `<div class="slot">${RESOURCE_LABEL[type]}: ${this.inventory.get(type)}/${this.inventory.capacity}</div>`,
      )
      .join("");
  }

  setHealth(current: number, max: number) {
    const pct = Math.max(0, Math.min(100, (current / max) * 100));
    this.healthFillEl.style.width = `${pct}%`;
  }

  setTownStats(population: number, buildingCount: number) {
    this.townStatsEl.innerHTML = `👥 ${population}<br><small>🏘️ ${buildingCount} buildings</small>`;
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

  toggleBuildMenu() {
    this.buildMenuOpen = !this.buildMenuOpen;
    this.buildMenuEl.hidden = !this.buildMenuOpen;
    if (this.buildMenuOpen) this.renderBuildMenu();
  }

  private renderCraftMenu() {
    const rows = RECIPES.map((recipe) => {
      const costText = Object.entries(recipe.cost)
        .map(([type, amt]) => `${amt} ${RESOURCE_LABEL[type as ResourceType]}`)
        .join(", ");
      const owned = this.crafting.countOf(recipe.id);
      const maxedOut = recipe.maxOwned !== undefined && owned >= recipe.maxOwned;
      const canCraft = this.crafting.canCraft(recipe);
      const buttonLabel = maxedOut ? "Owned" : `Craft (${owned})`;
      return `
        <div class="recipe">
          <span>${recipe.name}<br><small>${recipe.description}</small><br><small>${costText}</small></span>
          <button data-id="${recipe.id}" ${canCraft ? "" : "disabled"}>${buttonLabel}</button>
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

  private renderBuildMenu() {
    const rows = BUILDINGS.map((building) => {
      const costText = Object.entries(building.cost)
        .map(([type, amt]) => `${amt} ${RESOURCE_LABEL[type as ResourceType]}`)
        .join(", ");
      const owned = this.buildManager.countBuilt(building.id);
      const maxedOut = building.maxBuilt !== undefined && owned >= building.maxBuilt;
      const townCenterMissing =
        building.requiresTownCenter && this.buildManager.countBuilt("town_center") === 0;
      const canBuild = this.buildManager.canBuild(building);

      let buttonLabel = "Place";
      if (maxedOut) buttonLabel = "Built";
      else if (townCenterMissing) buttonLabel = "Need Town Center";

      return `
        <div class="recipe">
          <span>${building.name}<br><small>${building.description}</small><br><small>${costText}</small></span>
          <button data-id="${building.id}" ${canBuild ? "" : "disabled"}>${buttonLabel}</button>
        </div>
      `;
    }).join("");

    this.buildMenuEl.innerHTML = `<h2>Build</h2>${rows}`;
    this.buildMenuEl.querySelectorAll("button").forEach((btn) => {
      btn.addEventListener("click", () => {
        const building = BUILDINGS.find((b) => b.id === btn.dataset.id);
        if (building) {
          this.onSelectBuilding(building);
          this.buildMenuOpen = false;
          this.buildMenuEl.hidden = true;
        }
      });
    });
  }
}
