import { Inventory } from "../systems/inventory";
import { Crafting, RECIPES } from "../systems/crafting";
import { BUILDINGS, BuildManager, type BuildingDef } from "../systems/building";
import type { ResourceType } from "../world/resources";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: "🪵 Wood",
  stone: "🪨 Stone",
  food: "🍞 Food",
};

export interface SelectionInfo {
  title: string;
  description: string;
  hp?: number;
  maxHp?: number;
  stats?: [string, string][];
}

export class Hud {
  private inventoryEl: HTMLElement;
  private townStatsEl: HTMLElement;
  private promptEl: HTMLElement;
  private craftMenuEl: HTMLElement;
  private buildMenuEl: HTMLElement;
  private placementButtonsEl: HTMLElement;
  private selectBoxEl: HTMLElement;
  private infoEl: HTMLElement;
  private craftMenuOpen = false;
  private buildMenuOpen = false;
  private onSelectBuilding: (building: BuildingDef) => void = () => {};
  private onConfirmPlacement: () => void = () => {};
  private onCancelPlacement: () => void = () => {};
  private onReset: () => void = () => {};
  private onCloseInfo: () => void = () => {};

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
      <div class="hint">WASD pan (drag pans on touch) · scroll/pinch zoom · left-click select · left-drag box-select · right-click command (tap on mobile), or right-drag pan when nothing's selected · Esc deselect</div>
      <div class="quick-buttons">
        <button class="qbtn" id="craftBtn" title="Crafting (C)">🛠️</button>
        <button class="qbtn" id="buildBtn" title="Build (B)">🏗️</button>
        <button class="qbtn" id="resetBtn" title="Reset Town">🔄</button>
      </div>
      <div class="placement-buttons" hidden>
        <button class="pbtn pbtn-confirm">✓ Place</button>
        <button class="pbtn pbtn-cancel">✕ Cancel</button>
      </div>
      <div class="craft-menu" hidden></div>
      <div class="craft-menu" id="buildMenu" hidden></div>
      <div class="select-box" hidden></div>
      <div class="building-info" hidden></div>
    `;
    this.inventoryEl = root.querySelector(".inventory")!;
    this.townStatsEl = root.querySelector(".townstats")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.craftMenuEl = root.querySelector(".craft-menu")!;
    this.buildMenuEl = root.querySelector("#buildMenu")!;
    this.placementButtonsEl = root.querySelector(".placement-buttons")!;
    this.selectBoxEl = root.querySelector(".select-box")!;
    this.infoEl = root.querySelector(".building-info")!;

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
    root.querySelector("#resetBtn")!.addEventListener("click", () => {
      if (confirm("Reset your town? This clears your save and starts a new game.")) {
        this.onReset();
      }
    });

    document.addEventListener("pointerdown", (e) => {
      if (!(this.craftMenuOpen || this.buildMenuOpen)) return;
      const target = e.target as HTMLElement;
      if (target.closest(".qbtn") || target.closest(".craft-menu")) return;
      this.closeMenus();
    });

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

  setOnReset(handler: () => void) {
    this.onReset = handler;
  }

  setOnCancelPlacement(handler: () => void) {
    this.onCancelPlacement = handler;
  }

  setPlacementMode(active: boolean) {
    this.placementButtonsEl.hidden = !active;
  }

  setOnCloseInfo(handler: () => void) {
    this.onCloseInfo = handler;
  }

  setSelectionInfo(info: SelectionInfo | null) {
    if (!info) {
      this.infoEl.hidden = true;
      return;
    }
    this.infoEl.hidden = false;
    const statsRows = (info.stats ?? [])
      .map(([label, value]) => `<span>${label}</span><span>${value}</span>`)
      .join("");
    let hpBlock = "";
    if (info.hp !== undefined && info.maxHp !== undefined) {
      const pct = Math.max(0, Math.min(1, info.hp / info.maxHp)) * 100;
      const hpColor = pct > 50 ? "#3fae54" : pct > 25 ? "#d4a72c" : "#c0392b";
      hpBlock = `
        <div class="hp-row"><span>HP</span><span>${Math.ceil(info.hp)}/${info.maxHp}</span></div>
        <div class="hp-track"><div class="hp-fill" style="width:${pct}%;background:${hpColor}"></div></div>
      `;
    }
    this.infoEl.innerHTML = `
      <h2>${info.title}<button class="menu-close">✕</button></h2>
      <div class="desc">${info.description}</div>
      ${hpBlock}
      ${statsRows ? `<div class="stats">${statsRows}</div>` : ""}
    `;
    this.infoEl.querySelector(".menu-close")!.addEventListener("click", () => this.onCloseInfo());
  }

  setSelectionBox(rect: { x1: number; y1: number; x2: number; y2: number } | null) {
    if (!rect) {
      this.selectBoxEl.hidden = true;
      return;
    }
    const left = Math.min(rect.x1, rect.x2);
    const top = Math.min(rect.y1, rect.y2);
    const width = Math.abs(rect.x2 - rect.x1);
    const height = Math.abs(rect.y2 - rect.y1);
    this.selectBoxEl.hidden = false;
    this.selectBoxEl.style.left = `${left}px`;
    this.selectBoxEl.style.top = `${top}px`;
    this.selectBoxEl.style.width = `${width}px`;
    this.selectBoxEl.style.height = `${height}px`;
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

  setTownStats(population: number, buildingCount: number, soldierCount: number) {
    const soldierLine = soldierCount > 0 ? `<br><small>⚔️ ${soldierCount} soldiers</small>` : "";
    this.townStatsEl.innerHTML = `👥 ${population}<br><small>🏘️ ${buildingCount} buildings</small>${soldierLine}`;
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
