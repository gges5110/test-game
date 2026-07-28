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

/** One hotkey per grid slot, in the same row-major order as the grid itself.
 * Avoids WASD/arrows (camera pan), Shift (queue placement), Enter/Esc, and
 * B/M (build-page jumps) — everything else already bound elsewhere. */
const GRID_HOTKEY_CODES = [
  "Digit1", "Digit2", "Digit3", "Digit4", "Digit5",
  "Digit6", "Digit7", "Digit8", "Digit9", "Digit0",
  "KeyQ", "KeyE", "KeyR", "KeyT", "KeyY",
];
const GRID_HOTKEY_LABELS = [
  "1", "2", "3", "4", "5",
  "6", "7", "8", "9", "0",
  "Q", "E", "R", "T", "Y",
];

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
  /** Shown in the unit-attribute panel while this button is hovered — lets
   * browsing the Build ▸ Economic/Military page preview a building's cost,
   * HP and attack stats before placing it. */
  previewInfo?: SelectionInfo;
}

export interface SelectionInfo {
  /** Identifies *what* is selected (e.g. the selected object itself), so the
   * panel can tell "same selection, refreshed this frame" from "selection
   * changed" — only rebuilding DOM nodes in the latter case. Rebuilding
   * every frame would destroy button elements underneath the user's mouse
   * every ~16ms, which defeats CSS :hover/:active (they need a persistent
   * node) even though click still worked via delegation. */
  key: unknown;
  /** Distinguishes states of the *same* key that need a full re-render, e.g.
   * a building switching from construction site to finished. */
  variant?: string;
  title: string;
  /** Emoji shown in the framed portrait box, AoE2-style. */
  portrait?: string;
  description: string;
  hp?: number;
  maxHp?: number;
  stats?: [string, string][];
  /** For a multi-unit selection: one icon per selected unit, shown instead
   * of a portrait and per-unit attributes (which only describe one unit). */
  unitGrid?: { icon: string; tooltip: string }[];
  /** Clicking a unit icon narrows the selection to just that unit. */
  onPickUnit?: (index: number) => void;
  /** Contextual commands for this selection, filling the command grid. */
  commands?: CommandButton[];
  /** Pending unit production, shown as a clickable icon strip. */
  queue?: {
    items: { icon: string; tooltip: string }[];
    /** 0..1 training progress of the unit at the head of the queue. */
    progress: number;
    /** e.g. "Training Villager… 4.2s", or null when the queue is empty. */
    status: string | null;
    onCancel: (index: number) => void;
  };
}

export class Hud {
  private inventoryEl: HTMLElement;
  private settingsMenuEl: HTMLElement;
  private defeatOverlayEl: HTMLElement;
  private victoryOverlayEl: HTMLElement;
  private promptEl: HTMLElement;
  private cmdGridEl: HTMLElement;
  private commandsWrapEl: HTMLElement;
  private placementButtonsEl: HTMLElement;
  private selectBoxEl: HTMLElement;
  private infoEl: HTMLElement;
  private minimapCanvas: HTMLCanvasElement;
  private minimapCtx: CanvasRenderingContext2D;
  private onMinimapClick: (x: number, z: number) => void = () => {};
  private lastInfoKeyRef: unknown = undefined;
  private lastInfoVariant: string | undefined = undefined;
  private statValueEls: HTMLElement[] = [];
  private hpFillEl: HTMLElement | null = null;
  private hpTextEl: HTMLElement | null = null;
  private queueStripEl: HTMLElement | null = null;
  private queueFillEl: HTMLElement | null = null;
  private queueStatusEl: HTMLElement | null = null;
  private lastQueueSig = "";
  private onCancelQueued: (index: number) => void = () => {};
  private onPickUnit: (index: number) => void = () => {};
  /** The real selection's info, kept even while a hover preview is showing
   * instead of it, so leaving the hovered button restores it exactly. */
  private liveInfo: SelectionInfo | null = null;
  /** Set while hovering a command with `previewInfo`; null the rest of the
   * time. Takes over the panel display without touching the command grid,
   * so browsing Build ▸ Economic/Military doesn't get kicked back a page. */
  private previewInfo: SelectionInfo | null = null;
  /** Root commands for the current selection, plus which sub-page (by index
   * path) is drilled into — AoE2's Build → Economic/Military pages. */
  private rootCommands: CommandButton[] = [];
  private commandPath: number[] = [];
  private currentPageCommands: CommandButton[] = [];
  private cmdButtonEls: HTMLButtonElement[] = [];
  private settingsMenuOpen = false;
  private placementActive = false;
  private onConfirmPlacement: () => void = () => {};
  private onCancelPlacement: () => void = () => {};
  private onReset: () => void = () => {};
  private onCloseInfo: () => void = () => {};
  private population = { used: 0, cap: 0 };

  constructor(
    root: HTMLElement,
    private inventory: Inventory,
  ) {
    root.innerHTML = `
      <div class="inventory"></div>
      <button class="settings-btn" id="settingsBtn" title="Settings">⚙️</button>
      <div class="settings-menu" hidden>
        <h2>Settings <button class="menu-close">✕</button></h2>
        <button class="settings-action" id="resetBtn">🔄 Reset Town</button>
      </div>
      <div class="defeat-overlay" hidden>
        <div class="defeat-panel">
          <h1>💀 Your Town Has Fallen</h1>
          <p>Every villager, soldier, and building is gone.</p>
          <button class="defeat-restart">🔄 Start Over</button>
        </div>
      </div>
      <div class="victory-overlay" hidden>
        <div class="victory-panel">
          <h1>🎉 Enemy Camp Destroyed</h1>
          <p>Every enemy villager, guard, and building is gone. Your town stands.</p>
          <button class="victory-continue">Keep Playing</button>
        </div>
      </div>
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
    this.settingsMenuEl = root.querySelector(".settings-menu")!;
    this.defeatOverlayEl = root.querySelector(".defeat-overlay")!;
    this.victoryOverlayEl = root.querySelector(".victory-overlay")!;
    this.promptEl = root.querySelector(".prompt")!;
    this.cmdGridEl = root.querySelector(".cmd-grid")!;
    this.commandsWrapEl = root.querySelector(".aoe-commands")!;
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

    // pointerover/out (not mouseenter/leave — those don't bubble, and this
    // is delegated on the grid since buttons get redrawn under it).
    this.cmdGridEl.addEventListener("pointerover", (e) => {
      const btn = (e.target as HTMLElement).closest<HTMLButtonElement>(".cmd-btn");
      if (!btn) return;
      const cmd = this.currentPageCommands[Number(btn.dataset.i)];
      // Resolve unconditionally (preview or back-to-live) so moving from a
      // previewable button to a plain one (e.g. Back) within the same grid
      // reverts immediately, rather than leaving the old preview stuck.
      this.setPreviewInfo(cmd?.previewInfo ?? null);
    });
    this.cmdGridEl.addEventListener("pointerout", (e) => {
      const stillInGrid = (e.relatedTarget as HTMLElement | null)?.closest(".cmd-grid");
      if (!stillInGrid) this.setPreviewInfo(null);
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
      const queued = target.closest<HTMLElement>(".queue-item");
      if (queued) {
        this.onCancelQueued(Number(queued.dataset.i));
        return;
      }
      const unit = target.closest<HTMLElement>(".unit-chip");
      if (unit) this.onPickUnit(Number(unit.dataset.i));
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
    this.defeatOverlayEl
      .querySelector(".defeat-restart")!
      .addEventListener("click", () => this.onReset());
    this.victoryOverlayEl
      .querySelector(".victory-continue")!
      .addEventListener("click", () => this.setVictory(false));
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
      } else if (e.code === "KeyB") {
        this.jumpToBuildPage("Economic");
      } else if (e.code === "KeyM") {
        this.jumpToBuildPage("Military");
      } else {
        this.activateGridHotkey(e.code);
      }
    });
  }

  setOnConfirmPlacement(handler: () => void) {
    this.onConfirmPlacement = handler;
  }

  setOnReset(handler: () => void) {
    this.onReset = handler;
  }

  /** Shows (or hides) the full-screen defeat overlay — its own restart
   * button reuses the same reset handler as the settings menu's. */
  setDefeated(defeated: boolean) {
    this.defeatOverlayEl.hidden = !defeated;
  }

  /** Shows (or dismisses) the victory overlay — dismissing just hides it and
   * lets the player keep playing, no reset involved. */
  setVictory(victory: boolean) {
    this.victoryOverlayEl.hidden = !victory;
  }

  setOnCancelPlacement(handler: () => void) {
    this.onCancelPlacement = handler;
  }

  setPlacementMode(active: boolean) {
    // Placement takes over the command zone (AoE2 shows only a cancel
    // affordance while a foundation is being positioned).
    this.placementActive = active;
    this.placementButtonsEl.hidden = !active;
    this.cmdGridEl.hidden = active;
    this.updateBarZones();
  }

  /** The command grid and attributes panel only exist while they have
   * something to show — with nothing selected the bar is just the minimap.
   * The minimap is pinned right in CSS so collapsing these doesn't move it. */
  private updateBarZones() {
    const hasSelection = this.lastInfoKeyRef !== null;
    this.infoEl.hidden = !hasSelection;
    this.commandsWrapEl.hidden = !hasSelection && !this.placementActive;
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
    view: { width: number; depth: number },
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

    // Viewport box sized from the camera's actual ground coverage, so it
    // grows and shrinks as the player zooms out and in.
    const [fx, fz] = toPx(focus.x, focus.z);
    const boxW = (view.width / worldSize) * size;
    const boxH = (view.depth / worldSize) * size;
    ctx.strokeStyle = "rgba(255, 255, 255, 0.85)";
    ctx.lineWidth = 1.5;
    ctx.strokeRect(fx - boxW / 2, fz - boxH / 2, boxW, boxH);
  }

  setSelectionInfo(info: SelectionInfo | null) {
    this.liveInfo = info;
    // A hovered build option is showing instead — don't let this frame's
    // real-selection update (main.ts calls this every frame) clobber it.
    if (this.previewInfo) return;
    this.applySelectionInfo(info);
  }

  /** Shows a build option's stats in place of the real selection's, without
   * touching the command grid — so hovering a button in Build ▸ Economic/
   * Military doesn't reset you back out of that page. Pass null to restore
   * whatever the real selection was showing. */
  private setPreviewInfo(info: SelectionInfo | null) {
    this.previewInfo = info;
    const shown = info ?? this.liveInfo;
    if (!shown) return;
    // Always a full rebuild: hover enter/exit are human-paced events, not a
    // per-frame path, so there's no cost concern that would call for the
    // key/variant-diffed patch path applySelectionInfo uses.
    this.lastInfoKeyRef = shown.key;
    this.lastInfoVariant = shown.variant;
    this.renderSelectionSkeleton(shown);
    this.updateBarZones();
  }

  private applySelectionInfo(info: SelectionInfo | null) {
    if (!info) {
      this.showDefaultSelectionInfo();
      return;
    }

    if (info.key !== this.lastInfoKeyRef || info.variant !== this.lastInfoVariant) {
      // Selection changed — rebuild the panel and reset the command grid
      // back to its root page (AoE2 drops you out of Build sub-pages when
      // you select something else).
      this.lastInfoKeyRef = info.key;
      this.lastInfoVariant = info.variant;
      this.commandPath = [];
      this.renderSelectionSkeleton(info);
      this.rootCommands = info.commands ?? [];
      this.renderCommandGrid();
      this.updateBarZones();
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
    this.lastInfoVariant = undefined;
    this.infoEl.innerHTML = "";
    this.infoEl.classList.add("empty");
    this.hpFillEl = null;
    this.hpTextEl = null;
    this.rootCommands = [];
    this.commandPath = [];
    this.renderCommandGrid();
    this.updateBarZones();
  }

  private renderSelectionSkeleton(info: SelectionInfo) {
    const statsRows = (info.stats ?? [])
      .map(
        ([label, value]) =>
          `<div class="stat-row"><span>${label}</span><span class="stat-value">${value}</span></div>`,
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
    const queueBlock = info.queue
      ? `
        <div class="queue-block">
          <div class="queue-status"></div>
          <div class="queue-progress"><div class="queue-fill"></div></div>
          <div class="queue-strip"></div>
        </div>
      `
      : "";

    this.onPickUnit = info.onPickUnit ?? (() => {});
    const body = info.unitGrid
      ? `<div class="unit-grid">${info.unitGrid
          .map(
            (u, i) =>
              `<button class="unit-chip" data-i="${i}" title="${u.tooltip}">${u.icon}</button>`,
          )
          .join("")}</div>`
      : `
        <div class="info-body">
          <div class="portrait">${info.portrait ?? "❔"}</div>
          <div class="info-stats">
            ${hpBlock}
            ${statsRows}
          </div>
        </div>
      `;

    this.infoEl.innerHTML = `
      <div class="info-name">${info.title}<button class="menu-close">✕</button></div>
      ${body}
      ${queueBlock}
      <div class="desc">${info.description}</div>
    `;

    this.hpFillEl = this.infoEl.querySelector(".hp-fill");
    this.hpTextEl = this.infoEl.querySelector(".hp-text");
    this.statValueEls = [
      ...this.infoEl.querySelectorAll<HTMLElement>(".stat-row .stat-value"),
    ];
    this.queueStripEl = this.infoEl.querySelector(".queue-strip");
    this.queueFillEl = this.infoEl.querySelector(".queue-fill");
    this.queueStatusEl = this.infoEl.querySelector(".queue-status");
    this.lastQueueSig = "";
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
    // Stat values can change while the same thing stays selected (build
    // progress, builder count), so refresh them rather than baking them in.
    (info.stats ?? []).forEach(([, value], i) => {
      const el = this.statValueEls[i];
      if (el && el.textContent !== value) el.textContent = value;
    });
    this.updateQueue(info);
  }

  private updateQueue(info: SelectionInfo) {
    if (!info.queue || !this.queueStripEl || !this.queueFillEl) return;
    this.onCancelQueued = info.queue.onCancel;

    // Only rebuild the icons when the queue's contents actually change —
    // this runs every frame otherwise.
    const sig = info.queue.items.map((i) => i.icon).join("");
    if (sig !== this.lastQueueSig) {
      this.lastQueueSig = sig;
      this.queueStripEl.innerHTML = info.queue.items
        .map(
          (item, i) =>
            `<button class="queue-item" data-i="${i}" title="${item.tooltip}">${item.icon}</button>`,
        )
        .join("");
    }

    const active = info.queue.items.length > 0;
    this.queueFillEl.style.width = active
      ? `${Math.max(0, Math.min(1, info.queue.progress)) * 100}%`
      : "0%";
    if (this.queueStatusEl) {
      this.queueStatusEl.textContent = info.queue.status ?? "";
      this.queueStatusEl.hidden = !info.queue.status;
    }
  }

  /** B / M hotkeys: jump straight into the villager's Build ▸ Economic or
   * Build ▸ Military page, skipping the click-to-drill-in step. Looks the
   * button up by its label/sub rather than a fixed index, so it's a no-op
   * (not a wrong-page jump) whenever the current selection doesn't offer
   * that page — e.g. a building or a soldier is selected instead. */
  private jumpToBuildPage(sub: "Economic" | "Military") {
    if (this.placementActive) return;
    const index = this.rootCommands.findIndex(
      (cmd) => cmd.label === "Build" && cmd.sub === sub && cmd.children,
    );
    if (index === -1) return;
    this.commandPath = [index];
    this.renderCommandGrid();
  }

  /** Presses whichever command-grid button occupies the slot for this key
   * code, exactly as if it had been clicked — mirrors the on-button badges. */
  private activateGridHotkey(code: string) {
    if (this.placementActive) return;
    const index = GRID_HOTKEY_CODES.indexOf(code);
    if (index === -1) return;
    const cmd = this.currentPageCommands[index];
    if (!cmd || cmd.disabled) return;
    if (cmd.children) {
      this.commandPath.push(index);
      this.renderCommandGrid();
    } else {
      cmd.onClick?.();
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
        <button class="cmd-btn" data-i="${i}" title="${cmd.tooltip ?? cmd.label} (${GRID_HOTKEY_LABELS[i]})">
          <span class="cmd-hotkey">${GRID_HOTKEY_LABELS[i]}</span>
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
    const resourceSlots = (Object.keys(RESOURCE_LABEL) as ResourceType[])
      .map(
        (type) =>
          `<div class="slot">${RESOURCE_LABEL[type]}: ${this.inventory.get(type)}</div>`,
      )
      .join("");
    const popFull = this.population.used >= this.population.cap;
    this.inventoryEl.innerHTML =
      resourceSlots +
      `<div class="slot${popFull ? " pop-full" : ""}">👥 Population: ${this.population.used}/${this.population.cap}</div>`;
  }

  /** Population is shown alongside wood/stone/food — it's just as much a
   * resource players must manage (via Houses) as anything storable. */
  setPopulation(used: number, cap: number) {
    if (this.population.used === used && this.population.cap === cap) return;
    this.population = { used, cap };
    this.renderInventory();
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
