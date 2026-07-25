import { Inventory } from "../systems/inventory";
import { Crafting, RECIPES } from "../systems/crafting";
import { BUILDINGS, BuildManager, type BuildingDef } from "../systems/building";
import type { ResourceType } from "../world/resources";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: "🪵 Wood",
  stone: "🪨 Stone",
  food: "🍞 Food",
};

const RESOURCE_ICON: Record<ResourceType, string> = {
  wood: "🪵",
  stone: "🪨",
  food: "🍞",
};

const BUILDING_ICON: Record<string, string> = {
  town_center: "🏛️",
  house: "🏠",
  farm: "🌾",
  mill: "⚙️",
  lumber_camp: "🪓",
  mining_camp: "⛏️",
  blacksmith: "🔨",
  barracks: "⚔️",
  archery_range: "🏹",
  stable: "🐎",
  outpost: "🗼",
  castle: "🏰",
};

const RECIPE_ICON: Record<string, string> = {
  basic_tool: "🔧",
  iron_tool: "⚒️",
};

export interface SelectionAction {
  label: string;
  disabled: boolean;
  onClick: () => void;
}

export interface SelectionInfo {
  /** Identifies *what* is selected (e.g. the selected object itself), so the
   * panel can tell "same selection, refreshed this frame" from "selection
   * changed" — only rebuilding DOM nodes in the latter case. Rebuilding
   * every frame would destroy button elements underneath the user's mouse
   * every ~16ms, which defeats CSS :hover/:active (they need a persistent
   * node) even though click still worked via delegation. */
  key: unknown;
  title: string;
  description: string;
  hp?: number;
  maxHp?: number;
  stats?: [string, string][];
  actions?: SelectionAction[];
}

export class Hud {
  private inventoryEl: HTMLElement;
  private townStatsEl: HTMLElement;
  private settingsMenuEl: HTMLElement;
  private waveWarningEl: HTMLElement;
  private promptEl: HTMLElement;
  private commandsDefaultEl: HTMLElement;
  private commandsPanelEl: HTMLElement;
  private placementButtonsEl: HTMLElement;
  private selectBoxEl: HTMLElement;
  private infoEl: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private onMinimapClick: (x: number, z: number) => void = () => {};
  private currentSelectionActions: SelectionAction[] = [];
  private lastInfoKeyRef: unknown = undefined;
  private lastInfoActionCount = -1;
  private hpFillEl: HTMLElement | null = null;
  private hpTextEl: HTMLElement | null = null;
  private actionButtonEls: HTMLButtonElement[] = [];
  /** Which content the shared command panel is currently showing. */
  private commandsMode: "default" | "craft" | "build" = "default";
  private settingsMenuOpen = false;
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
      <button class="settings-btn" id="settingsBtn" title="Settings">⚙️</button>
      <div class="townstats"></div>
      <div class="settings-menu" hidden>
        <h2>Settings <button class="menu-close">✕</button></h2>
        <button class="settings-action" id="resetBtn">🔄 Reset Town</button>
      </div>
      <div class="wave-warning"></div>
      <div class="prompt" hidden></div>
      <div class="select-box" hidden></div>

      <div class="aoe-bar">
        <div class="building-info"></div>

        <div class="aoe-commands">
          <div class="commands-default">
            <button class="qbtn" id="craftBtn" title="Crafting (C)">🛠️<span>Craft</span></button>
            <button class="qbtn" id="buildBtn" title="Build (B)">🏗️<span>Build</span></button>
          </div>
          <div class="commands-panel" hidden></div>
          <div class="placement-buttons" hidden>
            <button class="pbtn pbtn-confirm">✓ Place</button>
            <button class="pbtn pbtn-cancel">✕ Cancel</button>
          </div>
        </div>

        <div class="aoe-minimap-wrap">
          <canvas class="minimap-canvas" width="150" height="150"></canvas>
          <div class="hint">WASD pan · scroll zoom · left-click select · left-drag box-select · right-click command · Esc deselect</div>
        </div>
      </div>
    `;
    this.inventoryEl = root.querySelector(".inventory")!;
    this.townStatsEl = root.querySelector(".townstats")!;
    this.settingsMenuEl = root.querySelector(".settings-menu")!;
    this.waveWarningEl = root.querySelector(".wave-warning")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.commandsDefaultEl = root.querySelector(".commands-default")!;
    this.commandsPanelEl = root.querySelector(".commands-panel")!;
    this.placementButtonsEl = root.querySelector(".placement-buttons")!;
    this.selectBoxEl = root.querySelector(".select-box")!;
    this.infoEl = root.querySelector(".building-info")!;
    this.minimapCanvas = root.querySelector(".minimap-canvas")!;
    this.minimapCtx = this.minimapCanvas.getContext("2d")!;
    this.showDefaultSelectionInfo();

    // Delegated on the panel itself (persists across re-renders) rather
    // than rebound per-button, since it can be redrawn every frame.
    this.commandsPanelEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".menu-close")) {
        this.showCommandsDefault();
        return;
      }
      const cmdBtn = target.closest<HTMLButtonElement>(".cmd-btn");
      if (!cmdBtn) return;
      if (this.commandsMode === "build") {
        const building = BUILDINGS.find((b) => b.id === cmdBtn.dataset.id);
        if (building) {
          this.onSelectBuilding(building);
          this.showCommandsDefault();
        }
      } else if (this.commandsMode === "craft") {
        const recipe = RECIPES.find((r) => r.id === cmdBtn.dataset.id);
        if (recipe) {
          this.crafting.craft(recipe);
          this.renderCraftPanel();
        }
      }
    });

    this.minimapCanvas.addEventListener("click", (e) => {
      const rect = this.minimapCanvas.getBoundingClientRect();
      const u = (e.clientX - rect.left) / rect.width;
      const v = (e.clientY - rect.top) / rect.height;
      this.onMinimapClick(u, v);
    });

    // Delegated on the panel itself (which persists across re-renders),
    // rather than rebound to each button — setSelectionInfo replaces the
    // panel's innerHTML every animation frame, so per-button listeners get
    // destroyed mid-click and silently never fire.
    this.infoEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".menu-close")) {
        this.onCloseInfo();
        return;
      }
      const actionBtn = target.closest<HTMLButtonElement>(".info-action");
      if (actionBtn) {
        this.currentSelectionActions[Number(actionBtn.dataset.i)]?.onClick();
      }
    });

    this.inventory.onChange(() => {
      this.renderInventory();
      // Re-render the open command panel so Craft/Place buttons reflect
      // newly available resources.
      if (this.commandsMode === "craft") this.renderCraftPanel();
      if (this.commandsMode === "build") this.renderBuildPanel();
    });
    this.renderInventory();

    root.querySelector("#craftBtn")!.addEventListener("click", () => {
      this.settingsMenuOpen = false;
      this.settingsMenuEl.hidden = true;
      this.toggleCommandsMode("craft");
    });
    root.querySelector("#buildBtn")!.addEventListener("click", () => {
      this.settingsMenuOpen = false;
      this.settingsMenuEl.hidden = true;
      this.toggleCommandsMode("build");
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
    root.querySelector("#settingsBtn")!.addEventListener("click", () => this.toggleSettingsMenu());
    this.settingsMenuEl.querySelector(".menu-close")!.addEventListener("click", () => this.toggleSettingsMenu());

    document.addEventListener("pointerdown", (e) => {
      if (!this.settingsMenuOpen) return;
      const target = e.target as HTMLElement;
      if (target.closest(".settings-btn") || target.closest(".settings-menu")) return;
      this.settingsMenuOpen = false;
      this.settingsMenuEl.hidden = true;
    });

    window.addEventListener("keydown", (e) => {
      if (e.code === "KeyC") {
        this.toggleCommandsMode("craft");
      } else if (e.code === "KeyB") {
        this.toggleCommandsMode("build");
      } else if (e.code === "Enter") {
        this.onConfirmPlacement();
      } else if (e.code === "Escape") {
        if (this.commandsMode !== "default") {
          this.showCommandsDefault();
        } else if (this.settingsMenuOpen) {
          this.settingsMenuOpen = false;
          this.settingsMenuEl.hidden = true;
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
    // Placement replaces the commands zone's content entirely, instead of
    // stacking Confirm/Cancel underneath the quick-buttons/grid.
    if (active) {
      this.commandsDefaultEl.hidden = true;
      this.commandsPanelEl.hidden = true;
    } else {
      this.commandsDefaultEl.hidden = this.commandsMode !== "default";
      this.commandsPanelEl.hidden = this.commandsMode === "default";
    }
  }

  setOnCloseInfo(handler: () => void) {
    this.onCloseInfo = handler;
  }

  /** handler receives normalized (0..1, 0..1) coordinates within the minimap. */
  setOnMinimapClick(handler: (u: number, v: number) => void) {
    this.onMinimapClick = handler;
  }

  /** Draws points (world-space, normalized against `worldSize`) and the
   * camera's current focus onto the minimap canvas. */
  updateMinimap(
    points: { x: number; z: number; color: string; size?: number }[],
    worldSize: number,
    focus: { x: number; z: number },
  ) {
    const ctx = this.minimapCtx;
    const size = this.minimapCanvas.width;
    ctx.fillStyle = "#3a4a26";
    ctx.fillRect(0, 0, size, size);

    const toPx = (x: number, z: number): [number, number] => [
      (x / worldSize + 0.5) * size,
      (z / worldSize + 0.5) * size,
    ];

    for (const p of points) {
      const [px, pz] = toPx(p.x, p.z);
      const r = p.size ?? 3;
      ctx.fillStyle = p.color;
      ctx.fillRect(px - r / 2, pz - r / 2, r, r);
    }

    const [fx, fz] = toPx(focus.x, focus.z);
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx - 14, fz - 14, 28, 28);
  }

  setSelectionInfo(info: SelectionInfo | null) {
    if (!info) {
      this.showDefaultSelectionInfo();
      return;
    }
    this.currentSelectionActions = info.actions ?? [];

    const actionCount = this.currentSelectionActions.length;
    if (info.key !== this.lastInfoKeyRef || actionCount !== this.lastInfoActionCount) {
      // Selection changed (or its action count changed, e.g. Repair
      // appearing/disappearing) — rebuild the DOM once.
      this.lastInfoKeyRef = info.key;
      this.lastInfoActionCount = actionCount;
      this.renderSelectionSkeleton(info);
    } else {
      // Same selection refreshed this frame — update values in place so
      // the button/HP nodes stay alive (preserves :hover/:active, and
      // avoids needless DOM churn 60x/sec).
      this.updateSelectionDynamic(info);
    }
  }

  /** Shown when nothing is selected — keeps the panel occupying its usual
   * space (instead of collapsing to nothing) so the minimap/commands next
   * to it don't shift position every time selection changes. */
  private showDefaultSelectionInfo() {
    if (this.lastInfoKeyRef === null) return; // already showing it
    this.lastInfoKeyRef = null;
    this.lastInfoActionCount = -1;
    this.infoEl.innerHTML = `
      <h2>🏰 Town Overview</h2>
      <div class="desc">Select a villager, soldier, or building to see details and actions here.</div>
    `;
    this.hpFillEl = null;
    this.hpTextEl = null;
    this.actionButtonEls = [];
  }

  private renderSelectionSkeleton(info: SelectionInfo) {
    const statsRows = (info.stats ?? [])
      .map(([label, value]) => `<span>${label}</span><span>${value}</span>`)
      .join("");
    const hasHp = info.hp !== undefined && info.maxHp !== undefined;
    const hpBlock = hasHp
      ? `
        <div class="hp-row"><span>HP</span><span class="hp-text"></span></div>
        <div class="hp-track"><div class="hp-fill"></div></div>
      `
      : "";
    const actionButtons = this.currentSelectionActions
      .map((a, i) => `<button class="info-action" data-i="${i}">${a.label}</button>`)
      .join("");

    this.infoEl.innerHTML = `
      <h2>${info.title}<button class="menu-close">✕</button></h2>
      <div class="desc">${info.description}</div>
      ${hpBlock}
      ${statsRows ? `<div class="stats">${statsRows}</div>` : ""}
      ${actionButtons ? `<div class="info-actions">${actionButtons}</div>` : ""}
    `;

    this.hpFillEl = this.infoEl.querySelector(".hp-fill");
    this.hpTextEl = this.infoEl.querySelector(".hp-text");
    this.actionButtonEls = [...this.infoEl.querySelectorAll<HTMLButtonElement>(".info-action")];
    this.updateSelectionDynamic(info);
  }

  private updateSelectionDynamic(info: SelectionInfo) {
    if (info.hp !== undefined && info.maxHp !== undefined && this.hpFillEl && this.hpTextEl) {
      const pct = Math.max(0, Math.min(1, info.hp / info.maxHp)) * 100;
      const hpColor = pct > 50 ? "#3fae54" : pct > 25 ? "#d4a72c" : "#c0392b";
      this.hpFillEl.style.width = `${pct}%`;
      this.hpFillEl.style.background = hpColor;
      this.hpTextEl.textContent = `${Math.ceil(info.hp)}/${info.maxHp}`;
    }
    this.actionButtonEls.forEach((btn, i) => {
      const action = this.currentSelectionActions[i];
      if (!action) return;
      if (btn.textContent !== action.label) btn.textContent = action.label;
      if (btn.disabled !== action.disabled) btn.disabled = action.disabled;
    });
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

  /** Shows a countdown to the next wolf wave and how many are coming, with
   * escalating urgency (color + pulse) as it gets close. */
  setWaveWarning(secondsLeft: number, wolfCount: number) {
    const urgent = secondsLeft <= 10;
    const soon = secondsLeft <= 20;
    this.waveWarningEl.classList.toggle("urgent", urgent);
    this.waveWarningEl.classList.toggle("soon", soon && !urgent);
    const seconds = Math.max(0, Math.ceil(secondsLeft));
    const wolfWord = wolfCount === 1 ? "wolf" : "wolves";
    this.waveWarningEl.textContent = `🐺 Wave incoming: ${seconds}s — ${wolfCount} ${wolfWord}`;
  }

  setPrompt(text: string | null) {
    if (text) {
      this.promptEl.textContent = text;
      this.promptEl.hidden = false;
    } else {
      this.promptEl.hidden = true;
    }
  }

  toggleSettingsMenu() {
    this.settingsMenuOpen = !this.settingsMenuOpen;
    this.settingsMenuEl.hidden = !this.settingsMenuOpen;
  }

  /** Switches the shared command panel between the default quick-buttons
   * and an inline Craft or Build grid — clicking the same mode again (or
   * ✕/Esc) returns to default. Nothing here is a floating popup, so
   * nothing shifts the info panel or minimap next to it. */
  toggleCommandsMode(mode: "craft" | "build") {
    if (this.commandsMode === mode) {
      this.showCommandsDefault();
      return;
    }
    this.commandsMode = mode;
    this.commandsDefaultEl.hidden = true;
    this.commandsPanelEl.hidden = false;
    if (mode === "craft") this.renderCraftPanel();
    else this.renderBuildPanel();
  }

  showCommandsDefault() {
    this.commandsMode = "default";
    this.commandsDefaultEl.hidden = false;
    this.commandsPanelEl.hidden = true;
  }

  private renderCraftPanel() {
    const items = RECIPES.map((recipe) => {
      const owned = this.crafting.countOf(recipe.id);
      const maxedOut = recipe.maxOwned !== undefined && owned >= recipe.maxOwned;
      const canCraft = this.crafting.canCraft(recipe);
      const costText = Object.entries(recipe.cost)
        .map(([type, amt]) => `${amt}${RESOURCE_ICON[type as ResourceType]}`)
        .join(" ");
      const costLine = maxedOut ? "Owned" : costText;
      return `
        <button class="cmd-btn" data-id="${recipe.id}" ${canCraft ? "" : "disabled"} title="${recipe.name} — ${recipe.description}">
          <span class="cmd-icon">${RECIPE_ICON[recipe.id] ?? "🛠️"}</span>
          <span class="cmd-name">${recipe.name}</span>
          <span class="cmd-cost${!maxedOut && !canCraft ? " insufficient" : ""}">${costLine}</span>
        </button>
      `;
    }).join("");

    this.commandsPanelEl.innerHTML = `
      <div class="cmd-panel-header"><span>🛠️ Crafting</span><button class="menu-close">✕</button></div>
      <div class="cmd-grid">${items}</div>
    `;
  }

  private renderBuildPanel() {
    const items = BUILDINGS.filter((b) => !b.hidden)
      .map((building) => {
        const costText = Object.entries(building.cost)
          .map(([type, amt]) => `${amt}${RESOURCE_ICON[type as ResourceType]}`)
          .join(" ");
        const owned = this.buildManager.countBuilt(building.id);
        const maxedOut = building.maxBuilt !== undefined && owned >= building.maxBuilt;
        const townCenterMissing =
          building.requiresTownCenter && this.buildManager.countBuilt("town_center") === 0;
        const canBuild = this.buildManager.canBuild(building);

        let costLine = costText;
        if (maxedOut) costLine = "Built";
        else if (townCenterMissing) costLine = "Need TC";

        return `
          <button class="cmd-btn" data-id="${building.id}" ${canBuild ? "" : "disabled"} title="${building.name} — ${building.description}">
            <span class="cmd-icon">${BUILDING_ICON[building.id] ?? "🏗️"}</span>
            <span class="cmd-name">${building.name}</span>
            <span class="cmd-cost${!maxedOut && !townCenterMissing && !canBuild ? " insufficient" : ""}">${costLine}</span>
          </button>
        `;
      })
      .join("");

    this.commandsPanelEl.innerHTML = `
      <div class="cmd-panel-header"><span>🏗️ Build</span><button class="menu-close">✕</button></div>
      <div class="cmd-grid">${items}</div>
    `;
  }
}
