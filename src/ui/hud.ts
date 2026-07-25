import { Inventory } from "../systems/inventory";
import type { ResourceType } from "../world/resources";

const RESOURCE_LABEL: Record<ResourceType, string> = {
  wood: "🪵 Wood",
  stone: "🪨 Stone",
  food: "🍞 Food",
};

export const RESOURCE_ICON: Record<ResourceType, string> = {
  wood: "🪵",
  stone: "🪨",
  food: "🍞",
};

export const BUILDING_ICON: Record<string, string> = {
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

export const RECIPE_ICON: Record<string, string> = {
  basic_tool: "🔧",
  iron_tool: "⚒️",
};

/** Fixed 5x3 command grid, matching AoE2's command panel footprint. */
const COMMAND_SLOTS = 15;

/** One slot in the AoE2-style command grid. A button either performs an
 * action (`onClick`) or drills into a sub-page of more commands
 * (`children`) — mirroring AoE2's villager Build → Economic/Military pages. */
export interface CommandButton {
  icon: string;
  label: string;
  /** Small second line, e.g. a cost summary. */
  sub?: string;
  disabled?: boolean;
  tooltip?: string;
  onClick?: () => void;
  children?: CommandButton[];
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
  /** Emoji shown in the framed portrait box, AoE2-style. */
  portrait?: string;
  description: string;
  hp?: number;
  maxHp?: number;
  stats?: [string, string][];
  /** Contextual commands for this selection, filling the command grid. */
  commands?: CommandButton[];
}

export class Hud {
  private inventoryEl: HTMLElement;
  private townStatsEl: HTMLElement;
  private settingsMenuEl: HTMLElement;
  private waveWarningEl: HTMLElement;
  private promptEl: HTMLElement;
  private cmdGridEl: HTMLElement;
  private placementButtonsEl: HTMLElement;
  private selectBoxEl: HTMLElement;
  private infoEl: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private onMinimapClick: (x: number, z: number) => void = () => {};
  private lastInfoKeyRef: unknown = undefined;
  private hpFillEl: HTMLElement | null = null;
  private hpTextEl: HTMLElement | null = null;
  /** Root commands for the current selection, plus which sub-page (by index
   * path) is drilled into — AoE2's Build → Economic/Military pages. */
  private rootCommands: CommandButton[] = [];
  private commandPath: number[] = [];
  private currentPageCommands: CommandButton[] = [];
  private cmdButtonEls: HTMLButtonElement[] = [];
  private settingsMenuOpen = false;
  private onConfirmPlacement: () => void = () => {};
  private onCancelPlacement: () => void = () => {};
  private onReset: () => void = () => {};
  private onCloseInfo: () => void = () => {};

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
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
        <div class="aoe-commands">
          <div class="cmd-grid"></div>
          <div class="placement-buttons" hidden>
            <button class="pbtn pbtn-confirm">✓ Place</button>
            <button class="pbtn pbtn-cancel">✕ Cancel</button>
          </div>
        </div>

        <div class="building-info"></div>

        <div class="aoe-minimap-wrap">
          <canvas class="minimap-canvas" width="150" height="150"></canvas>
          <div class="hint">Click minimap to jump · WASD pan · right-click to command</div>
        </div>
      </div>
    `;
    this.inventoryEl = root.querySelector(".inventory")!;
    this.townStatsEl = root.querySelector(".townstats")!;
    this.settingsMenuEl = root.querySelector(".settings-menu")!;
    this.waveWarningEl = root.querySelector(".wave-warning")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.cmdGridEl = root.querySelector(".cmd-grid")!;
    this.placementButtonsEl = root.querySelector(".placement-buttons")!;
    this.selectBoxEl = root.querySelector(".select-box")!;
    this.infoEl = root.querySelector(".building-info")!;
    this.minimapCanvas = root.querySelector(".minimap-canvas")!;
    this.minimapCtx = this.minimapCanvas.getContext("2d")!;
    this.showDefaultSelectionInfo();
    this.renderCommandGrid();

    // Delegated on the grid (persists across re-renders) rather than
    // rebound per-button, since the grid can be redrawn every frame.
    this.cmdGridEl.addEventListener("click", (e) => {
      const target = e.target as HTMLElement;
      if (target.closest(".cmd-back")) {
        this.commandPath.pop();
        this.renderCommandGrid();
        return;
      }
      const btn = target.closest<HTMLButtonElement>(".cmd-btn");
      if (!btn || btn.disabled) return;
      const cmd = this.currentPageCommands[Number(btn.dataset.i)];
      if (!cmd) return;
      if (cmd.children) {
        this.commandPath.push(Number(btn.dataset.i));
        this.renderCommandGrid();
      } else {
        cmd.onClick?.();
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
    });

    this.inventory.onChange(() => this.renderInventory());
    this.renderInventory();

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
      if (e.code === "Enter") {
        this.onConfirmPlacement();
      } else if (e.code === "Escape") {
        if (this.commandPath.length > 0) {
          this.commandPath.pop();
          this.renderCommandGrid();
        } else if (this.settingsMenuOpen) {
          this.settingsMenuOpen = false;
          this.settingsMenuEl.hidden = true;
        } else {
          this.onCancelPlacement();
        }
      }
    });
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
    // Placement takes over the command zone (AoE2 shows only a cancel
    // affordance while a foundation is being positioned).
    this.placementButtonsEl.hidden = !active;
    this.cmdGridEl.hidden = active;
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

    if (info.key !== this.lastInfoKeyRef) {
      // Selection changed — rebuild the panel and reset the command grid
      // back to its root page (AoE2 drops you out of Build sub-pages when
      // you select something else).
      this.lastInfoKeyRef = info.key;
      this.commandPath = [];
      this.renderSelectionSkeleton(info);
      this.rootCommands = info.commands ?? [];
      this.renderCommandGrid();
    } else {
      // Same selection refreshed this frame — update values in place so
      // the button/HP nodes stay alive (preserves :hover/:active, and
      // avoids needless DOM churn 60x/sec).
      this.updateSelectionDynamic(info);
      this.rootCommands = info.commands ?? [];
      this.updateCommandGridDynamic();
    }
  }

  /** Nothing selected: blank the panel out entirely (no filler text), but
   * keep its element in the flex layout via CSS visibility rather than
   * `hidden`/display:none — collapsing it would reflow the minimap and
   * commands beside it every time selection changes. */
  private showDefaultSelectionInfo() {
    if (this.lastInfoKeyRef === null) return; // already blank
    this.lastInfoKeyRef = null;
    this.infoEl.innerHTML = "";
    this.infoEl.classList.add("empty");
    this.hpFillEl = null;
    this.hpTextEl = null;
    this.rootCommands = [];
    this.commandPath = [];
    this.renderCommandGrid();
  }

  private renderSelectionSkeleton(info: SelectionInfo) {
    const statsRows = (info.stats ?? [])
      .map(
        ([label, value]) =>
          `<div class="stat-row"><span>${label}</span><span>${value}</span></div>`,
      )
      .join("");
    const hasHp = info.hp !== undefined && info.maxHp !== undefined;
    const hpBlock = hasHp
      ? `
        <div class="hp-track"><div class="hp-fill"></div></div>
        <div class="hp-text"></div>
      `
      : "";

    this.infoEl.classList.remove("empty");
    this.infoEl.innerHTML = `
      <div class="info-name">${info.title}<button class="menu-close">✕</button></div>
      <div class="info-body">
        <div class="portrait">${info.portrait ?? "❔"}</div>
        <div class="info-stats">
          ${hpBlock}
          ${statsRows}
        </div>
      </div>
      <div class="desc">${info.description}</div>
    `;

    this.hpFillEl = this.infoEl.querySelector(".hp-fill");
    this.hpTextEl = this.infoEl.querySelector(".hp-text");
    this.updateSelectionDynamic(info);
  }

  private updateSelectionDynamic(info: SelectionInfo) {
    if (info.hp !== undefined && info.maxHp !== undefined && this.hpFillEl && this.hpTextEl) {
      const pct = Math.max(0, Math.min(1, info.hp / info.maxHp)) * 100;
      const hpColor = pct > 50 ? "#3fae54" : pct > 25 ? "#d4a72c" : "#c0392b";
      this.hpFillEl.style.width = `${pct}%`;
      this.hpFillEl.style.background = hpColor;
      this.hpTextEl.textContent = `${Math.ceil(info.hp)} / ${info.maxHp}`;
    }
  }

  /** Resolves the command list for the page the player has drilled into. */
  private resolveCurrentPage(): CommandButton[] {
    let page = this.rootCommands;
    for (const idx of this.commandPath) {
      const next = page[idx]?.children;
      if (!next) return page;
      page = next;
    }
    return page;
  }

  /** Draws the fixed-slot command grid. Empty slots render as recessed
   * frames so the grid keeps a constant footprint regardless of how many
   * commands the current selection offers — same as AoE2. */
  private renderCommandGrid() {
    this.currentPageCommands = this.resolveCurrentPage();
    const cells: string[] = this.currentPageCommands.map(
      (cmd, i) => `
        <button class="cmd-btn" data-i="${i}" title="${cmd.tooltip ?? cmd.label}">
          <span class="cmd-icon">${cmd.icon}</span>
          <span class="cmd-name">${cmd.label}</span>
          ${cmd.sub ? `<span class="cmd-sub">${cmd.sub}</span>` : ""}
        </button>
      `,
    );

    if (this.commandPath.length > 0) {
      cells.push(`
        <button class="cmd-btn cmd-back" title="Back (Esc)">
          <span class="cmd-icon">↩</span>
          <span class="cmd-name">Back</span>
        </button>
      `);
    }

    while (cells.length < COMMAND_SLOTS) cells.push(`<div class="cmd-slot-empty"></div>`);

    this.cmdGridEl.innerHTML = cells.join("");
    this.cmdButtonEls = [...this.cmdGridEl.querySelectorAll<HTMLButtonElement>(".cmd-btn")];
    this.updateCommandGridDynamic();
  }

  private updateCommandGridDynamic() {
    const page = this.resolveCurrentPage();
    // Structure changed under us (e.g. an action appeared/disappeared) —
    // rebuild rather than trying to patch mismatched slots.
    if (page.length !== this.currentPageCommands.length) {
      this.renderCommandGrid();
      return;
    }
    this.currentPageCommands = page;
    page.forEach((cmd, i) => {
      const btn = this.cmdButtonEls[i];
      if (!btn) return;
      const disabled = cmd.disabled ?? false;
      if (btn.disabled !== disabled) btn.disabled = disabled;
      const sub = btn.querySelector(".cmd-sub");
      if (sub && cmd.sub !== undefined && sub.textContent !== cmd.sub) {
        sub.textContent = cmd.sub;
      }
      const name = btn.querySelector(".cmd-name");
      if (name && name.textContent !== cmd.label) name.textContent = cmd.label;
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

}
