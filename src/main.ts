import * as THREE from "three";
import { createTerrain, heightAt, WORLD_SIZE } from "./world/terrain";
import { ResourceManager, type ResourceType } from "./world/resources";
import {
  createBuildingMesh,
  makeGhost,
  attachSelectionRing,
  attachHealthBar,
} from "./world/buildings";
import type { HealthBar } from "./world/healthBar";
import { Villager } from "./world/villager";
import { Soldier, getUnitStats, type UnitKind } from "./world/soldier";
import { Wolf } from "./world/enemy";
import { Inventory } from "./systems/inventory";
import { Crafting, RECIPES } from "./systems/crafting";
import {
  BUILDINGS,
  BuildManager,
  getBuildingDef,
  type BuildingDef,
} from "./systems/building";
import { TownBuildings, type PlacedBuilding } from "./systems/townBuildings";
import { createLighting } from "./systems/lighting";
import { createComposer } from "./systems/postfx";
import { RtsCamera } from "./systems/rtsCamera";
import { saveGame, loadGame, clearSave, type SaveData } from "./systems/save";
import {
  Hud,
  BUILDING_ICON,
  RECIPE_ICON,
  RESOURCE_ICON,
  type SelectionInfo,
  type CommandButton,
} from "./ui/hud";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;

const scene = new THREE.Scene();

const rtsCamera = new RtsCamera(canvas, window.innerWidth / window.innerHeight);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.shadowMap.type = THREE.PCFSoftShadowMap;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.15;

const { composer, setSize: setComposerSize } = createComposer(
  renderer,
  scene,
  rtsCamera.camera,
);

window.addEventListener("resize", () => {
  rtsCamera.setAspect(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
  setComposerSize(window.innerWidth, window.innerHeight);
});

const clock = new THREE.Clock();

const terrain = createTerrain();
scene.add(terrain);

createLighting(scene);
const resources = new ResourceManager(scene);

const inventory = new Inventory();
const buildManager = new BuildManager(inventory);
const crafting = new Crafting(inventory, buildManager);
const hud = new Hud(hudRoot, inventory);
const townBuildings = new TownBuildings();

function gatherBonus(type: Parameters<typeof crafting.gatherBonus>[0]) {
  return crafting.gatherBonus(type);
}

function spawnBuilding(
  id: string,
  x: number,
  z: number,
  hp?: number,
): PlacedBuilding {
  const def = getBuildingDef(id);
  const mesh = createBuildingMesh(id);
  mesh.position.set(x, heightAt(x, z), z);
  attachSelectionRing(mesh);
  attachHealthBar(mesh);
  scene.add(mesh);
  const placed = townBuildings.add(id, def, mesh, mesh.position);
  if (hp !== undefined) placed.hp = hp;
  return placed;
}

let villagers: Villager[] = [];
let soldiers: Soldier[] = [];
let producers: { building: PlacedBuilding; timer: number }[] = [];
let waveNumber = 0;

/** Registers a placed building as a passive resource producer if its def
 * calls for one, wiring cleanup for when it's destroyed. Unit training is
 * player-triggered (see startProduction) rather than automatic. */
function registerBuildingBehavior(placed: PlacedBuilding) {
  if (placed.def.produces) {
    const entry = { building: placed, timer: 0 };
    producers.push(entry);
    placed.onDestroyed = () => {
      producers = producers.filter((e) => e !== entry);
    };
  }
}

const savedGame = loadGame();
if (savedGame) {
  // Reload a previous session instead of resetting the town.
  for (const b of savedGame.buildings) {
    // Skip building types from an older roster that no longer exist,
    // instead of crashing the whole load.
    if (!BUILDINGS.some((def) => def.id === b.type)) continue;
    const placed = spawnBuilding(b.type, b.x, b.z, b.hp);
    placed.queue = b.queue ? [...b.queue] : [];
    registerBuildingBehavior(placed);
  }
  for (const v of savedGame.villagers) {
    const villager = new Villager(
      scene,
      new THREE.Vector3(v.homeX, heightAt(v.homeX, v.homeZ), v.homeZ),
      resources,
      inventory,
      gatherBonus,
    );
    villager.model.position.set(v.x, heightAt(v.x, v.z), v.z);
    villagers.push(villager);
  }
  for (const s of savedGame.soldiers ?? []) {
    const soldier = new Soldier(
      scene,
      new THREE.Vector3(s.homeX, heightAt(s.homeX, s.homeZ), s.homeZ),
      s.kind,
    );
    soldier.model.position.set(s.x, heightAt(s.x, s.z), s.z);
    soldiers.push(soldier);
  }
  for (const placed of townBuildings.list) {
    if (placed.type !== "house") continue;
    const villager = villagers.find(
      (v) => v.getHome().distanceTo(placed.position) < 0.01,
    );
    if (!villager) continue;
    placed.onDestroyed = () => {
      scene.remove(villager.model);
      villagers = villagers.filter((v) => v !== villager);
      selectedVillagers = selectedVillagers.filter((v) => v !== villager);
    };
  }
  inventory.restore(savedGame.inventory);
  buildManager.restore(savedGame.built);
  crafting.restore(savedGame.crafted);
  waveNumber = savedGame.waveNumber;
} else {
  // Fresh town: a free Town Center and three villagers already working —
  // mirrors classic RTS onboarding (no manual gathering needed to
  // bootstrap the economy).
  spawnBuilding("town_center", 0, 0);
  buildManager.grant("town_center");

  for (let i = 0; i < 3; i++) {
    const angle = (i / 3) * Math.PI * 2;
    const x = Math.cos(angle) * 3;
    const z = Math.sin(angle) * 3;
    villagers.push(
      new Villager(
        scene,
        new THREE.Vector3(x, heightAt(x, z), z),
        resources,
        inventory,
        gatherBonus,
      ),
    );
  }

  inventory.add("wood", 8);
  inventory.add("stone", 4);
  inventory.add("food", 3);
}

rtsCamera.focus.set(0, heightAt(0, 0), 0);

let selectedVillagers: Villager[] = [];
let selectedBuildingInfo: PlacedBuilding | null = null;
let selectedSoldiers: Soldier[] = [];

/** Villagers and soldiers can be selected together (a box drag grabs both),
 * so selecting units only clears the building selection, not each other. */
function selectUnits(villagerList: Villager[], soldierList: Soldier[]) {
  deselectBuilding();
  for (const v of selectedVillagers) v.setSelected(false);
  for (const s of selectedSoldiers) s.setSelected(false);
  selectedVillagers = villagerList;
  selectedSoldiers = soldierList;
  for (const v of selectedVillagers) v.setSelected(true);
  for (const s of selectedSoldiers) s.setSelected(true);
}

function deselectUnits() {
  for (const v of selectedVillagers) v.setSelected(false);
  for (const s of selectedSoldiers) s.setSelected(false);
  selectedVillagers = [];
  selectedSoldiers = [];
}

function selectBuilding(building: PlacedBuilding) {
  deselectUnits();
  deselectBuilding();
  selectedBuildingInfo = building;
  const ring = building.mesh.userData.selectionRing as THREE.Mesh | undefined;
  if (ring) ring.visible = true;
}

function deselectBuilding() {
  if (selectedBuildingInfo) {
    const ring = selectedBuildingInfo.mesh.userData.selectionRing as
      | THREE.Mesh
      | undefined;
    if (ring) ring.visible = false;
  }
  selectedBuildingInfo = null;
}

function deselectAll() {
  deselectUnits();
  deselectBuilding();
}

function resolveVillagerFromHit(hit: THREE.Object3D): Villager | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    if (obj.userData.villager) return obj.userData.villager as Villager;
    obj = obj.parent;
  }
  return null;
}

function resolveSoldierFromHit(hit: THREE.Object3D): Soldier | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    if (obj.userData.soldier) return obj.userData.soldier as Soldier;
    obj = obj.parent;
  }
  return null;
}

function resolveWolfFromHit(hit: THREE.Object3D): Wolf | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    const match = wolves.find((w) => w.model === obj);
    if (match) return match;
    obj = obj.parent;
  }
  return null;
}

function resolveResourceNodeFromHit(hit: THREE.Object3D) {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    if (obj.userData.resourceNode) return obj.userData.resourceNode;
    obj = obj.parent;
  }
  return null;
}

function resolveBuildingFromHit(hit: THREE.Object3D): PlacedBuilding | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    const match = townBuildings.list.find((b) => b.mesh === obj);
    if (match) return match;
    obj = obj.parent;
  }
  return null;
}

/** Builds the info panel content for whatever is currently selected, if anything. */
const REPAIR_WOOD_PER_HP = 0.25;

function unitLabel(unit: UnitKind | "villager"): string {
  return unit === "villager" ? "Villager" : getUnitStats(unit).label;
}

function unitIcon(unit: UnitKind | "villager"): string {
  if (unit === "villager") return "🧑‍🌾";
  if (unit === "archer") return "🏹";
  if (unit === "scout") return "🐎";
  return "🛡️";
}

/** How many units a single building may have pending. */
const MAX_QUEUE = 10;

/** Adds a unit to a building's production queue. Following AoE2, the cost is
 * charged the moment it's queued rather than when training starts — so a deep
 * queue locks resources up front, and cancelling gives them back. */
function enqueueUnit(building: PlacedBuilding) {
  const trains = building.def.trains;
  if (!trains || building.queue.length >= MAX_QUEUE) return;
  if (!inventory.has("food", trains.foodCost)) return;
  inventory.spend("food", trains.foodCost);
  building.queue.push(trains.unit);
}

/** Removes a queued unit and refunds what was paid for it. Cancelling the
 * one in progress abandons its timer; the next in line starts fresh. */
function cancelQueued(building: PlacedBuilding, index: number) {
  const trains = building.def.trains;
  if (!trains || index < 0 || index >= building.queue.length) return;
  building.queue.splice(index, 1);
  inventory.add("food", trains.foodCost);
  if (index === 0) building.producingUntil = undefined;
}

/** Spends whatever wood is available (up to the full repair cost) and
 * restores a proportional amount of HP — so repairing isn't all-or-nothing;
 * players can top up a building bit by bit as wood comes in. */
function repairBuilding(building: PlacedBuilding) {
  const missing = building.maxHp - building.hp;
  if (missing <= 0) return;
  const fullCost = Math.max(1, Math.ceil(missing * REPAIR_WOOD_PER_HP));
  const spend = Math.min(fullCost, inventory.get("wood"));
  if (spend <= 0) return;
  inventory.spend("wood", spend);
  const healed = Math.min(missing, spend / REPAIR_WOOD_PER_HP);
  building.hp = Math.min(building.maxHp, building.hp + healed);
}

// AoE2 splits a villager's Build menu into economic and military pages.
const ECONOMIC_BUILDINGS = ["house", "farm", "mill", "lumber_camp", "mining_camp"];
const MILITARY_BUILDINGS = [
  "barracks",
  "archery_range",
  "stable",
  "blacksmith",
  "outpost",
  "castle",
];

function costSummary(cost: Partial<Record<ResourceType, number>>): string {
  return Object.entries(cost)
    .map(([type, amt]) => `${amt}${RESOURCE_ICON[type as ResourceType]}`)
    .join(" ");
}

function buildingCommand(def: BuildingDef): CommandButton {
  const owned = buildManager.countBuilt(def.id);
  const maxedOut = def.maxBuilt !== undefined && owned >= def.maxBuilt;
  const needsTownCenter =
    def.requiresTownCenter && buildManager.countBuilt("town_center") === 0;
  let sub = costSummary(def.cost);
  if (maxedOut) sub = "Built";
  else if (needsTownCenter) sub = "Need TC";
  return {
    icon: BUILDING_ICON[def.id] ?? "🏗️",
    label: def.name,
    sub,
    disabled: !buildManager.canBuild(def),
    tooltip: `${def.name} — ${def.description}`,
    onClick: () => startPlacement(def),
  };
}

/** Commands a villager offers: AoE2's Build ▸ Economic / Military pages. */
function villagerCommands(): CommandButton[] {
  return [
    {
      icon: "🏗️",
      label: "Build",
      sub: "Economic",
      tooltip: "Economic buildings",
      children: ECONOMIC_BUILDINGS.map((id) => buildingCommand(getBuildingDef(id))),
    },
    {
      icon: "⚔️",
      label: "Build",
      sub: "Military",
      tooltip: "Military buildings",
      children: MILITARY_BUILDINGS.map((id) => buildingCommand(getBuildingDef(id))),
    },
  ];
}

/** Commands a building offers: train its unit, research its techs, repair. */
function buildingCommands(building: PlacedBuilding): CommandButton[] {
  const commands: CommandButton[] = [];
  const def = building.def;

  if (def.trains) {
    const trains = def.trains;
    const queueFull = building.queue.length >= MAX_QUEUE;
    const affordable = inventory.has("food", trains.foodCost);
    commands.push({
      icon: unitIcon(trains.unit),
      label: unitLabel(trains.unit),
      sub: `${trains.foodCost}${RESOURCE_ICON.food}`,
      disabled: !affordable || queueFull,
      tooltip: queueFull
        ? `Queue is full (${MAX_QUEUE})`
        : `Train ${unitLabel(trains.unit)} — ${trains.foodCost} food, charged now`,
      onClick: () => enqueueUnit(building),
    });
  }

  // Blacksmith researches the tool upgrades, AoE2-style (techs live in the
  // building that unlocks them rather than a global crafting menu).
  if (building.type === "blacksmith") {
    for (const recipe of RECIPES) {
      const owned = crafting.countOf(recipe.id);
      const maxedOut = recipe.maxOwned !== undefined && owned >= recipe.maxOwned;
      commands.push({
        icon: RECIPE_ICON[recipe.id] ?? "🛠️",
        label: recipe.name,
        sub: maxedOut ? "Done" : costSummary(recipe.cost),
        disabled: !crafting.canCraft(recipe),
        tooltip: `${recipe.name} — ${recipe.description}`,
        onClick: () => crafting.craft(recipe),
      });
    }
  }

  if (building.hp < building.maxHp) {
    const fullCost = Math.max(
      1,
      Math.ceil((building.maxHp - building.hp) * REPAIR_WOOD_PER_HP),
    );
    const spend = Math.min(fullCost, inventory.get("wood"));
    commands.push({
      icon: "🔧",
      label: "Repair",
      sub: `${spend}/${fullCost}${RESOURCE_ICON.wood}`,
      disabled: spend <= 0,
      tooltip:
        spend >= fullCost
          ? `Repair fully for ${fullCost} wood`
          : `Partial repair with ${spend} of ${fullCost} wood`,
      onClick: () => repairBuilding(building),
    });
  }

  return commands;
}

function buildSelectionInfo(): SelectionInfo | null {
  if (selectedBuildingInfo) {
    const building = selectedBuildingInfo;
    const def = building.def;
    const stats: [string, string][] = def.attack
      ? [
          ["⚔️ Damage", `${def.attack.damage}`],
          ["➹ Range", `${def.attack.range}`],
          ["⏱ Cooldown", `${def.attack.cooldown}s`],
        ]
      : [];

    const trains = def.trains;
    return {
      key: building,
      title: def.name,
      portrait: BUILDING_ICON[def.id] ?? "🏗️",
      description: def.description,
      hp: building.hp,
      maxHp: building.maxHp,
      stats,
      commands: buildingCommands(building),
      queue: trains
        ? {
            items: building.queue.map((unit) => ({
              icon: unitIcon(unit),
              tooltip: `Cancel ${unitLabel(unit)} (refunds ${trains.foodCost} food)`,
            })),
            progress:
              building.producingUntil !== undefined
                ? 1 - (building.producingUntil - clock.getElapsedTime()) / trains.time
                : 0,
            status:
              building.producingUntil !== undefined
                ? `Training ${unitLabel(building.queue[0] ?? trains.unit)}… ${Math.max(
                    0,
                    building.producingUntil - clock.getElapsedTime(),
                  ).toFixed(1)}s` +
                  (building.queue.length > 1 ? ` (+${building.queue.length - 1} queued)` : "")
                : null,
            onCancel: (i: number) => cancelQueued(building, i),
          }
        : undefined,
    };
  }

  const villagerCount = selectedVillagers.length;
  const soldierCount = selectedSoldiers.length;
  const total = villagerCount + soldierCount;
  if (total === 0) return null;

  // Which distinct unit kinds are in the selection, and how many of each.
  const kinds: (UnitKind | "villager")[] = [
    ...selectedVillagers.map(() => "villager" as const),
    ...selectedSoldiers.map((s) => s.kind),
  ];
  const counts = new Map<UnitKind | "villager", number>();
  for (const k of kinds) counts.set(k, (counts.get(k) ?? 0) + 1);
  const distinctKinds = [...counts.keys()];
  const hasVillagers = villagerCount > 0;

  // Per-unit attributes only describe the selection when every unit shares a
  // kind. For a heterogeneous group they'd be one unit's numbers presented as
  // the group's, so show the composition instead.
  if (distinctKinds.length > 1) {
    return {
      key: selectedSelectionKey(),
      title: `${total} Units`,
      portrait: "👥",
      description: hasVillagers
        ? "Right-click to move; resources send villagers to gather, wolves send soldiers to attack."
        : "Right-click ground to reposition the group, or a wolf to attack it.",
      stats: distinctKinds.map(
        (k) => [`${unitIcon(k)} ${unitLabel(k)}`, `${counts.get(k)}`] as [string, string],
      ),
      commands: hasVillagers ? villagerCommands() : [],
    };
  }

  // Single kind: stats genuinely apply to every unit in the group. Current HP
  // still only makes sense for exactly one unit.
  const kind = distinctKinds[0];
  const many = total > 1;
  if (kind === "villager") {
    return {
      key: selectedSelectionKey(),
      title: many ? `${total} Villagers` : "Villager",
      portrait: "🧑‍🌾",
      description: many
        ? "Right-click ground to move as a group, or a resource for all to gather."
        : "Gathers wood, stone, and food. Right-click ground to move, or a resource to gather.",
      commands: villagerCommands(),
    };
  }

  const stats = getUnitStats(kind);
  const lead = selectedSoldiers[0];
  return {
    key: selectedSelectionKey(),
    title: many ? `${total} ${stats.label}s` : stats.label,
    portrait: unitIcon(kind),
    description: many
      ? "Right-click ground to reposition the group, or a wolf to attack it."
      : "Right-click ground to reposition it, or a wolf to attack. Holds and defends wherever you send it.",
    hp: many ? undefined : lead.hp,
    maxHp: many ? undefined : stats.maxHp,
    stats: [
      ["⚔️ Damage", `${stats.attackDamage}`],
      ["➹ Range", `${stats.attackRange}`],
      ["⏱ Cooldown", `${stats.attackCooldown}s`],
      ["⛓ Leash", `${stats.leashRange}`],
    ],
    commands: [],
  };
}

/** A stable identity for the current unit selection, so the info panel only
 * rebuilds when the selection actually changes rather than every frame. */
let lastSelectionKey: { v: Villager[]; s: Soldier[] } | null = null;
function selectedSelectionKey(): unknown {
  if (
    !lastSelectionKey ||
    lastSelectionKey.v !== selectedVillagers ||
    lastSelectionKey.s !== selectedSoldiers
  ) {
    lastSelectionKey = { v: selectedVillagers, s: selectedSoldiers };
  }
  return lastSelectionKey;
}

// Building placement: pick a building from the build menu, a translucent
// ghost follows subsequent taps, and on-screen Confirm/Cancel buttons
// finalize it. Buildings can't be placed too close to each other.
let selectedBuildingType: BuildingDef | null = null;
let ghost: THREE.Group | null = null;
const MIN_BUILDING_SPACING = 3;

function startPlacement(building: BuildingDef) {
  if (ghost) scene.remove(ghost);
  selectedBuildingType = building;
  ghost = makeGhost(createBuildingMesh(building.id));
  ghost.position.set(
    rtsCamera.focus.x,
    heightAt(rtsCamera.focus.x, rtsCamera.focus.z),
    rtsCamera.focus.z,
  );
  scene.add(ghost);
  hud.setPlacementMode(true);
}

function cancelPlacement() {
  if (ghost) scene.remove(ghost);
  ghost = null;
  selectedBuildingType = null;
  hud.setPlacementMode(false);
}

function confirmPlacement() {
  if (!selectedBuildingType || !ghost) return;
  if (townBuildings.isTooCloseToAny(ghost.position, MIN_BUILDING_SPACING))
    return;
  if (!buildManager.build(selectedBuildingType)) return;

  const placed = spawnBuilding(
    selectedBuildingType.id,
    ghost.position.x,
    ghost.position.z,
  );

  if (selectedBuildingType.id === "house") {
    const villager = new Villager(
      scene,
      placed.position,
      resources,
      inventory,
      gatherBonus,
    );
    villagers.push(villager);
    placed.onDestroyed = () => {
      scene.remove(villager.model);
      villagers = villagers.filter((v) => v !== villager);
      selectedVillagers = selectedVillagers.filter((v) => v !== villager);
    };
  } else {
    registerBuildingBehavior(placed);
  }

  cancelPlacement();
}

function handleEscape() {
  if (selectedBuildingType) {
    cancelPlacement();
  } else {
    deselectAll();
  }
}

hud.setOnConfirmPlacement(confirmPlacement);
hud.setOnCancelPlacement(handleEscape);
hud.setOnCloseInfo(deselectAll);
hud.setOnMinimapClick((u, v) => {
  const x = (u - 0.5) * WORLD_SIZE;
  const z = (v - 0.5) * WORLD_SIZE;
  rtsCamera.jumpTo(x, heightAt(x, z), z);
});
hud.setOnReset(() => {
  resetting = true;
  clearSave();
  window.location.reload();
});

function commandSelectedUnits(sx: number, sy: number) {
  const total = selectedVillagers.length + selectedSoldiers.length;
  if (total === 0) return;

  // Right-clicking a wolf is an attack order for any selected soldiers.
  if (selectedSoldiers.length > 0) {
    const wolfHit = rtsCamera.raycastObjects(
      sx,
      sy,
      wolves.filter((w) => w.alive).map((w) => w.model),
    );
    if (wolfHit) {
      const wolf = resolveWolfFromHit(wolfHit);
      if (wolf) {
        for (const s of selectedSoldiers) s.commandAttack(wolf);
        return;
      }
    }
  }

  // Right-clicking a resource is a gather order for any selected villagers.
  if (selectedVillagers.length > 0) {
    const nodeMeshes = resources.nodes
      .filter((n) => !n.depleted)
      .map((n) => n.mesh);
    const nodeHit = rtsCamera.raycastObjects(sx, sy, nodeMeshes);
    if (nodeHit) {
      const node = resolveResourceNodeFromHit(nodeHit);
      if (node) {
        for (const v of selectedVillagers) v.commandGather(node);
        return;
      }
    }
  }

  const point = rtsCamera.raycastGround(sx, sy);
  if (!point) return;
  // Scatter the group in a small ring around the target point so they don't
  // all path onto the exact same spot.
  const spread = total > 1 ? 0.8 : 0;
  let i = 0;
  const offsetFor = () => {
    const angle = (i++ / total) * Math.PI * 2;
    return new THREE.Vector3(
      point.x + Math.cos(angle) * spread,
      0,
      point.z + Math.sin(angle) * spread,
    );
  };
  for (const v of selectedVillagers) {
    const p = offsetFor();
    v.commandMoveTo(new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z));
  }
  for (const s of selectedSoldiers) {
    const p = offsetFor();
    s.commandMoveTo(new THREE.Vector3(p.x, heightAt(p.x, p.z), p.z));
  }
}

// While placing a building, the ghost continuously follows the mouse
// (hover) on desktop — touch has no hover, so it only updates on tap.
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse" || !selectedBuildingType || !ghost) return;
  const point = rtsCamera.raycastGround(e.clientX, e.clientY);
  if (point) ghost.position.set(point.x, heightAt(point.x, point.z), point.z);
});

// Desktop: left-click selects (villager, building, or deselects on empty
// ground), right-click issues a command to the selected villager — the
// classic RTS split. Touch has no second button, so a tap on a villager
// selects it and a following tap commands it (merged into one gesture).
rtsCamera.setOnTap((sx, sy, button, isTouch) => {
  if (selectedBuildingType && ghost) {
    if (isTouch) {
      const point = rtsCamera.raycastGround(sx, sy);
      if (point)
        ghost.position.set(point.x, heightAt(point.x, point.z), point.z);
    } else {
      confirmPlacement();
    }
    return;
  }

  if (button === 2) {
    commandSelectedUnits(sx, sy);
    return;
  }

  const villagerHit = rtsCamera.raycastObjects(
    sx,
    sy,
    villagers.map((v) => v.model),
  );
  if (villagerHit) {
    const villager = resolveVillagerFromHit(villagerHit);
    if (villager) {
      selectUnits([villager], []);
      return;
    }
  }

  const soldierHit = rtsCamera.raycastObjects(
    sx,
    sy,
    soldiers.map((s) => s.model),
  );
  if (soldierHit) {
    const soldier = resolveSoldierFromHit(soldierHit);
    if (soldier) {
      selectUnits([], [soldier]);
      return;
    }
  }

  if (isTouch && (selectedVillagers.length > 0 || selectedSoldiers.length > 0)) {
    commandSelectedUnits(sx, sy);
    return;
  }

  const buildingHit = rtsCamera.raycastObjects(
    sx,
    sy,
    townBuildings.list.map((b) => b.mesh),
  );
  if (buildingHit) {
    const building = resolveBuildingFromHit(buildingHit);
    if (building) {
      selectBuilding(building);
      return;
    }
  }

  deselectAll();
});

// Left-mouse drag box-selects every unit — villagers and soldiers alike —
// whose screen position falls inside the rectangle (desktop only; touch has
// no spare gesture for it).
rtsCamera.setOnBoxSelect((rect, final) => {
  if (selectedBuildingType) {
    hud.setSelectionBox(null);
    return;
  }
  if (!rect) {
    hud.setSelectionBox(null);
    return;
  }
  hud.setSelectionBox(rect);
  if (!final) return;

  const x1 = Math.min(rect.x1, rect.x2);
  const x2 = Math.max(rect.x1, rect.x2);
  const y1 = Math.min(rect.y1, rect.y2);
  const y2 = Math.max(rect.y1, rect.y2);
  const inBox = (pos: THREE.Vector3) => {
    const p = rtsCamera.worldToScreen(pos);
    return p !== null && p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  };
  const villagerHits = villagers.filter((v) => inBox(v.model.position));
  const soldierHits = soldiers.filter((s) => inBox(s.model.position));
  hud.setSelectionBox(null);
  if (villagerHits.length > 0 || soldierHits.length > 0) {
    selectUnits(villagerHits, soldierHits);
  } else {
    deselectAll();
  }
});

const BEAM_DURATION = 0.15;

let attackEffects: { mesh: THREE.Mesh; expiresAt: number }[] = [];

function spawnAttackBeam(from: THREE.Vector3, to: THREE.Vector3, now: number) {
  const dir = new THREE.Vector3().subVectors(to, from);
  const length = dir.length();
  const geometry = new THREE.CylinderGeometry(0.035, 0.035, length, 6);
  const material = new THREE.MeshBasicMaterial({
    color: 0xffdd55,
    transparent: true,
    opacity: 0.9,
  });
  const beam = new THREE.Mesh(geometry, material);
  beam.position.copy(from).add(to).multiplyScalar(0.5);
  beam.quaternion.setFromUnitVectors(
    new THREE.Vector3(0, 1, 0),
    dir.normalize(),
  );
  scene.add(beam);
  attackEffects.push({ mesh: beam, expiresAt: now + BEAM_DURATION });
}

// Wolves spawn in escalating waves and beeline for the nearest building —
// walls and towers are the town's only defense (no player avatar to fight).
let wolves: Wolf[] = [];
// Give a fresh town time to gather a first tower/wall before anything
// attacks — previously the first wave hit at 30s, often before players
// even understood defenses existed, which could end the run outright.
let nextWaveAt = 75;
const WAVE_INTERVAL = 45;

function spawnWave() {
  waveNumber++;
  const count = 1 + waveNumber;
  for (let i = 0; i < count; i++) {
    const angle = Math.random() * Math.PI * 2;
    const dist = 60 + Math.random() * 40;
    const x = Math.cos(angle) * dist;
    const z = Math.sin(angle) * dist;
    wolves.push(new Wolf(scene, new THREE.Vector3(x, heightAt(x, z), z)));
  }
}

function damageBuilding(building: PlacedBuilding, amount: number) {
  const destroyed = townBuildings.damage(building, amount);
  if (destroyed) {
    townBuildings.remove(building, scene);
    if (selectedBuildingInfo === building) selectedBuildingInfo = null;
  }
}

// Persist progress so a reload resumes the town instead of resetting it.
function collectSaveData(): SaveData {
  return {
    version: 1,
    inventory: inventory.getAll(),
    built: buildManager.getAllBuilt(),
    crafted: crafting.getAllCrafted(),
    buildings: townBuildings.list.map((b) => ({
      type: b.type,
      x: b.position.x,
      z: b.position.z,
      hp: b.hp,
      queue: [...b.queue],
    })),
    villagers: villagers.map((v) => ({
      x: v.model.position.x,
      z: v.model.position.z,
      homeX: v.getHome().x,
      homeZ: v.getHome().z,
    })),
    soldiers: soldiers.map((s) => ({
      x: s.model.position.x,
      z: s.model.position.z,
      homeX: s.getHome().x,
      homeZ: s.getHome().z,
      kind: s.kind,
    })),
    waveNumber,
  };
}

// Set once the player resets their town, so a stray autosave (e.g. the
// beforeunload fired by the reload below) can't silently restore the
// just-cleared save before the fresh page load reads it.
let resetting = false;

const AUTOSAVE_INTERVAL_MS = 5000;
setInterval(() => {
  if (!resetting) saveGame(collectSaveData());
}, AUTOSAVE_INTERVAL_MS);
window.addEventListener("beforeunload", () => {
  if (!resetting) saveGame(collectSaveData());
});
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden" && !resetting)
    saveGame(collectSaveData());
});

function animate() {
  const delta = Math.min(clock.getDelta(), 0.1);
  const time = clock.getElapsedTime();

  rtsCamera.updateKeyboardPan(delta);
  rtsCamera.setRightDragPanEnabled(
    selectedVillagers.length === 0 && selectedSoldiers.length === 0,
  );

  resources.update();
  for (const villager of villagers) villager.update(delta, time);
  for (const soldier of soldiers) soldier.update(delta, time, wolves);
  soldiers = soldiers.filter((s) => {
    if (!s.alive) {
      s.dispose(scene);
      if (selectedSoldiers.includes(s)) {
        selectedSoldiers = selectedSoldiers.filter((sel) => sel !== s);
      }
      return false;
    }
    return true;
  });

  for (const producer of producers) {
    const { type, amount, interval } = producer.building.def.produces!;
    producer.timer += delta;
    if (producer.timer >= interval) {
      producer.timer -= interval;
      inventory.add(type, amount);
    }
  }

  for (const building of townBuildings.list) {
    const trains = building.def.trains;
    if (!trains) continue;
    // Start the next queued unit whenever the building is idle.
    if (building.producingUntil === undefined && building.queue.length > 0) {
      building.producingUntil = time + trains.time;
    }
    if (
      building.producingUntil !== undefined &&
      time >= building.producingUntil
    ) {
      const unit = building.queue.shift();
      building.producingUntil = undefined;
      if (unit === "villager") {
        const villager = new Villager(
          scene,
          building.position,
          resources,
          inventory,
          gatherBonus,
        );
        villagers.push(villager);
      } else if (unit) {
        soldiers.push(new Soldier(scene, building.position, unit));
      }
    }
  }

  for (const building of townBuildings.list) {
    const bar = building.mesh.userData.healthBar as HealthBar | undefined;
    bar?.setFraction(building.hp / building.maxHp);

    if (building.def.attack && time >= building.attackReadyAt) {
      const { range, damage, cooldown } = building.def.attack;
      const target = wolves.find(
        (w) =>
          w.alive && w.model.position.distanceTo(building.position) <= range,
      );
      if (target) {
        target.takeDamage(damage);
        building.attackReadyAt = time + cooldown;
        spawnAttackBeam(
          building.position
            .clone()
            .add(new THREE.Vector3(0, building.def.attackOriginY ?? 2, 0)),
          target.model.position.clone().add(new THREE.Vector3(0, 0.3, 0)),
          time,
        );
      }
    }
  }

  attackEffects = attackEffects.filter((effect) => {
    const remaining = effect.expiresAt - time;
    if (remaining <= 0) {
      scene.remove(effect.mesh);
      return false;
    }
    (effect.mesh.material as THREE.MeshBasicMaterial).opacity =
      Math.min(1, remaining / 0.15) * 0.9;
    return true;
  });

  if (time >= nextWaveAt) {
    spawnWave();
    nextWaveAt = time + WAVE_INTERVAL;
  }
  for (const wolf of wolves) {
    wolf.update(delta, time, townBuildings, damageBuilding);
  }
  wolves = wolves.filter((w) => {
    if (!w.alive) {
      w.dispose(scene);
      return false;
    }
    return true;
  });

  hud.setTownStats(
    villagers.length,
    townBuildings.list.length,
    soldiers.length,
  );
  hud.setWaveWarning(nextWaveAt - time, 1 + (waveNumber + 1));

  const minimapPoints: { x: number; z: number; color: string; size?: number }[] = [];
  for (const node of resources.nodes) {
    if (node.depleted) continue;
    const color = node.type === "wood" ? "#4a7c3f" : node.type === "stone" ? "#9a9086" : "#d6335c";
    minimapPoints.push({ x: node.position.x, z: node.position.z, color, size: 2 });
  }
  for (const b of townBuildings.list) {
    minimapPoints.push({ x: b.position.x, z: b.position.z, color: "#e8dcc0", size: 6 });
  }
  for (const v of villagers) {
    minimapPoints.push({ x: v.model.position.x, z: v.model.position.z, color: "#6fe3ff", size: 3 });
  }
  for (const s of soldiers) {
    minimapPoints.push({ x: s.model.position.x, z: s.model.position.z, color: "#ffcc55", size: 3 });
  }
  for (const w of wolves) {
    minimapPoints.push({ x: w.model.position.x, z: w.model.position.z, color: "#e05a5a", size: 3 });
  }
  hud.updateMinimap(
    minimapPoints,
    WORLD_SIZE,
    rtsCamera.focus,
    rtsCamera.getViewExtent(),
  );

  let placementPrompt: string | null = null;
  if (selectedBuildingType && ghost) {
    placementPrompt = townBuildings.isTooCloseToAny(
      ghost.position,
      MIN_BUILDING_SPACING,
    )
      ? "Too close to another building — move elsewhere"
      : `Click (or tap ✓) to place ${selectedBuildingType.name}`;
  }
  hud.setPrompt(placementPrompt);
  hud.setSelectionInfo(buildSelectionInfo());

  composer.render();
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
