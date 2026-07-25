import { Inventory } from "../systems/inventory";
import { Crafting, RECIPES } from "../systems/crafting";
import { BUILDINGS, BuildManager, type BuildingDef } from "../systems/building";
import type { ResourceType } from "../world/resources";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: "🪵 Wood",
  stone: "🪨 Stone",
  food: "🍞 Food",
};

export class Hud {
  private inventoryEl: HTMLElement;
  private townStatsEl: HTMLElement;
  private promptEl: HTMLElement;
  private craftMenuEl: HTMLElement;
  private buildMenuEl: HTMLElement;
  private placementButtonsEl: HTMLElement;
  private craftMenuOpen = false;
  private buildMenuOpen = false;
  private onSelectBuilding: (building: BuildingDef) => void = () => {};
  private onConfirmPlacement: () => void = () => {};
  private onCancelPlacement: () => void = () => {};

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
    private crafting: Crafting,
    private buildManager: BuildManager,
  ) {
    root.innerHTML = `
      <div class="inventory"></div>
      <div class="townstats"></div>
      <div class="prompt" hidden></div>
      <div class="hint">WASD/drag pan · scroll/pinch zoom · left-click select · right-click command (tap on mobile) · Esc deselect</div>
      <div class="quick-buttons">
        <button class="qbtn" id="craftBtn" title="Crafting (C)">🛠️</button>
        <button class="qbtn" id="buildBtn" title="Build (B)">🏗️</button>
      </div>
      <div class="placement-buttons" hidden>
        <button class="pbtn pbtn-confirm">✓ Place</button>
        <button class="pbtn pbtn-cancel">✕ Cancel</button>
      </div>
      <div class="craft-menu" hidden></div>
      <div class="craft-menu" id="buildMenu" hidden></div>
    `;
    this.inventoryEl = root.querySelector(".inventory")!;
    this.townStatsEl = root.querySelector(".townstats")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.craftMenuEl = root.querySelector(".craft-menu")!;
    this.buildMenuEl = root.querySelector("#buildMenu")!;
    this.placementButtonsEl = root.querySelector(".placement-buttons")!;

    this.inventory.onChange(() => this.renderInventory());
    this.renderInventory();

    root.querySelector("#craftBtn")!.addEventListener("click", () => {
      this.buildMenuOpen = false;
      this.buildMenuEl.hidden = true;
      this.toggleCraftMenu();
    });
    root.querySelector("#buildBtn")!.addEventListener("click", () => {
      this.craftMenuOpen = false;
      this.craftMenuEl.hidden = true;
      this.toggleBuildMenu();
    });
    this.placementButtonsEl
      .querySelector(".pbtn-confirm")!
      .addEventListener("click", () => this.onConfirmPlacement());
    this.placementButtonsEl
      .querySelector(".pbtn-cancel")!
      .addEventListener("click", () => this.onCancelPlacement());

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") {
        this.buildMenuOpen = false;
        this.buildMenuEl.hidden = true;
        this.toggleCraftMenu();
      } else if (e.code === "KeyB") {
        this.craftMenuOpen = false;
        this.craftMenuEl.hidden = true;
        this.toggleBuildMenu();
      } else if (e.code === "Enter") {
        this.onConfirmPlacement();
      } else if (e.code === "Escape") {
        if (this.craftMenuOpen || this.buildMenuOpen) {
          this.closeMenus();
        } else {
          this.onCancelPlacement();
        }
      }
    });
  }

  /** Called when the player picks a building to place from the build menu. */
  setOnSelectBuilding(handler: (building: BuildingDef) => void) {
    this.onSelectBuilding = handler;
  }

  setOnConfirmPlacement(handler: () => void) {
    this.onConfirmPlacement = handler;
  }

  setOnCancelPlacement(handler: () => void) {
    this.onCancelPlacement = handler;
  }

  setPlacementMode(active: boolean) {
    this.placementButtonsEl.hidden = !active;
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

  closeMenus() {
    this.craftMenuOpen = false;
    this.craftMenuEl.hidden = true;
    this.buildMenuOpen = false;
    this.buildMenuEl.hidden = true;
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

    this.craftMenuEl.innerHTML = `<h2>Crafting <button class="menu-close">✕</button></h2>${rows}`;
    this.craftMenuEl.querySelector(".menu-close")!.addEventListener("click", () => this.toggleCraftMenu());
    this.craftMenuEl.querySelectorAll<HTMLButtonElement>(".recipe button").forEach((btn) => {
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
    const rows = BUILDINGS.filter((b) => !b.hidden)
      .map((building) => {
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
      })
      .join("");

    this.buildMenuEl.innerHTML = `<h2>Build <button class="menu-close">✕</button></h2>${rows}`;
    this.buildMenuEl.querySelector(".menu-close")!.addEventListener("click", () => this.toggleBuildMenu());
    this.buildMenuEl.querySelectorAll<HTMLButtonElement>(".recipe button").forEach((btn) => {
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
