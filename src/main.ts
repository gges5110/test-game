import * as THREE from "three";
import Stats from "stats.js";
import {
  createWorld,
  heightAt,
  WORLD_SIZE,
  ENEMY_CAMP_XZ,
  setBuildingObstacles,
} from "./world/terrain";
import { ResourceManager, NODE_CAPACITY, type ResourceType, type ResourceNode } from "./world/resources";
import {
  createBuildingMesh,
  makeGhost,
  attachSelectionRing,
  attachHealthBar,
  captureStructureMeshes,
  setConstructionAppearance,
  disposeBuildingMesh,
} from "./world/buildings";
import type { HealthBar } from "./world/healthBar";
import { Villager, VILLAGER_MAX_HP } from "./world/villager";
import { Soldier, getUnitStats, type UnitKind } from "./world/soldier";
import { beats, counteredBy } from "./world/combatant";
import {
  createEnemyCamp,
  updateEnemyCamp,
  wrapCampBuilding,
  EnemyGuard,
  GUARD_MAX_HP,
  GUARD_ATTACK_DAMAGE,
  GUARD_ATTACK_RANGE,
  GUARD_ATTACK_COOLDOWN,
  type EnemyCamp,
} from "./world/enemyCamp";
import { Effects } from "./world/effects";
import { Inventory } from "./systems/inventory";
import { Crafting, RECIPES } from "./systems/crafting";
import {
  BUILDINGS,
  BuildManager,
  getBuildingDef,
  type BuildingDef,
} from "./systems/building";
import { TownBuildings, type PlacedBuilding } from "./systems/townBuildings";
import {
  MAX_QUEUE,
  enqueueUnit,
  cancelQueued,
  advanceProduction,
  contributeBuild as applyBuildWork,
  fullRepairCost,
  repairBuilding as applyRepair,
} from "./systems/production";
import { populationCapacity } from "./systems/population";
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

const { composer, setSize: setComposerSize, setOutlined } = createComposer(
  renderer,
  scene,
  rtsCamera.camera,
);

window.addEventListener("resize", () => {
  rtsCamera.setAspect(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
  setComposerSize(window.innerWidth, window.innerHeight);
});

/**
 * Perf HUD, dev-only: this project keeps adding rendering cost (bloom,
 * outlines, particles, more units) with no instrumentation, which turns
 * "is this slow" into a guess. import.meta.env.DEV keeps the visible panel
 * out of the production page; begin()/end() still run but are ~free.
 */
const stats = new Stats();
if (import.meta.env.DEV) {
  stats.showPanel(0);
  // Every corner is already HUD chrome (resource pills top-left, population
  // and settings top-right, command grid bottom-left, minimap bottom-right)
  // — tuck it just under the top bar instead of stacking on top of any of it.
  stats.dom.style.top = "68px";
  stats.dom.style.left = "";
  stats.dom.style.right = "8px";
  stats.dom.style.bottom = "";
  document.body.appendChild(stats.dom);
}

const clock = new THREE.Clock();

const terrain = createWorld();
scene.add(terrain);

createLighting(scene);

const PLAYER_SPAWN = new THREE.Vector3(0, 0, 0);
// A single fixed hostile camp to attack — far enough out that reaching it
// feels like an expedition, not something you stumble into while gathering.
// Its position is terrain.ts's ENEMY_CAMP_XZ, so the valley flattening there
// and the resource-cluster placement below always agree on where it is.
const ENEMY_CAMP_CENTER = new THREE.Vector3(ENEMY_CAMP_XZ[0], 0, ENEMY_CAMP_XZ[1]);
ENEMY_CAMP_CENTER.y = heightAt(ENEMY_CAMP_CENTER.x, ENEMY_CAMP_CENTER.z);

// Both bases get an equal, symmetric share of the map's resource clusters —
// the enemy camp draws from the same field the player does, not a separate
// smaller patch of its own.
const resources = new ResourceManager(scene, [PLAYER_SPAWN, ENEMY_CAMP_CENTER]);

const inventory = new Inventory();
const buildManager = new BuildManager(inventory);
const crafting = new Crafting(inventory, buildManager);
const hud = new Hud(hudRoot, inventory);
const townBuildings = new TownBuildings();
const effects = new Effects(scene);

const enemyCamp: EnemyCamp = createEnemyCamp(scene, ENEMY_CAMP_CENTER, effects, resources);

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
  captureStructureMeshes(mesh);
  attachSelectionRing(mesh);
  attachHealthBar(mesh);
  scene.add(mesh);
  const placed = townBuildings.add(id, def, mesh, mesh.position);
  if (hp !== undefined) placed.hp = hp;
  return placed;
}

/** Puts a freshly placed building into its unfinished state: a translucent
 * shell with a sliver of HP that villagers have to work up to completion. */
function beginConstruction(placed: PlacedBuilding, progress = 0) {
  placed.underConstruction = true;
  placed.buildProgress = progress;
  placed.hp = Math.max(1, placed.maxHp * Math.max(progress, 0.05));
  setConstructionAppearance(placed.mesh, progress);
}

function finishConstruction(building: PlacedBuilding) {
  setConstructionAppearance(building.mesh, 1);
  registerBuildingBehavior(building);
}

function makeSoldier(at: THREE.Vector3, kind: UnitKind): Soldier {
  const soldier = new Soldier(scene, at, kind);
  soldier.onAttack = (from, to, ranged) => {
    if (ranged) {
      effects.fireArrow(from, to);
    } else {
      effects.slash(to, soldier.model.rotation.y);
      effects.impact(to, 0xffe6a6);
    }
  };
  return soldier;
}

function onVillagerBuildTick(
  site: { position: THREE.Vector3; underConstruction: boolean },
  delta: number,
) {
  const building = site as PlacedBuilding;
  const completed = applyBuildWork(building, delta);
  setConstructionAppearance(building.mesh, building.buildProgress);
  if (completed) finishConstruction(building);
}

function makeVillager(at: THREE.Vector3): Villager {
  return new Villager(
    scene,
    at,
    resources,
    townBuildings,
    inventory,
    gatherBonus,
    onVillagerBuildTick,
  );
}

let villagers: Villager[] = [];
let soldiers: Soldier[] = [];

/** Total pop the player currently has, and how much housing allows —
 * villagers and soldiers alike count against the cap. */
function populationUsed(): number {
  return villagers.length + soldiers.length;
}
function populationCap(): number {
  const houses = townBuildings.list.filter(
    (b) => b.type === "house" && !b.underConstruction,
  ).length;
  const townCenters = townBuildings.list.filter(
    (b) => b.type === "town_center" && !b.underConstruction,
  ).length;
  return populationCapacity(houses, townCenters);
}

/** A finished Farm is a gatherable food source, not a passive producer —
 * villagers must walk to it, harvest it, and carry the food off to a Mill or
 * Town Center like any other resource. Registers/unregisters its node
 * alongside the building's own lifecycle. */
function registerBuildingBehavior(placed: PlacedBuilding) {
  if (placed.type === "farm") {
    const node = resources.addNode("food", placed.position);
    placed.onDestroyed = () => resources.removeNode(node);
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
    if (b.underConstruction) {
      beginConstruction(placed, b.buildProgress ?? 0);
    } else {
      registerBuildingBehavior(placed);
    }
  }
  for (const v of savedGame.villagers) {
    const villager = makeVillager(
      new THREE.Vector3(v.homeX, heightAt(v.homeX, v.homeZ), v.homeZ),
    );
    villager.model.position.set(v.x, heightAt(v.x, v.z), v.z);
    villagers.push(villager);
  }
  for (const s of savedGame.soldiers ?? []) {
    const soldier = makeSoldier(
      new THREE.Vector3(s.homeX, heightAt(s.homeX, s.homeZ), s.homeZ),
      s.kind,
    );
    soldier.model.position.set(s.x, heightAt(s.x, s.z), s.z);
    soldiers.push(soldier);
  }
  inventory.restore(savedGame.inventory);
  buildManager.restore(savedGame.built);
  crafting.restore(savedGame.crafted);
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
    villagers.push(makeVillager(new THREE.Vector3(x, heightAt(x, z), z)));
  }

  inventory.add("wood", 8);
  inventory.add("stone", 4);
  inventory.add("food", 3);
}

rtsCamera.focus.set(0, heightAt(0, 0), 0);

let selectedVillagers: Villager[] = [];
let selectedBuildingInfo: PlacedBuilding | null = null;
let selectedSoldiers: Soldier[] = [];
/** A single enemy guard or villager, view-only — no commands, and never more
 * than one (a box-drag never picks these up; only a direct click does). */
let selectedEnemyUnit: EnemyGuard | Villager | null = null;
/** A single resource node, view-only — just to see how much is left. */
let selectedResourceNode: ResourceNode | null = null;

/** Tracks the last unit clicked (desktop only) so a second click on the same
 * unit within the window reads as a double-click rather than two selects. */
const DOUBLE_CLICK_MS = 350;
let lastUnitClick: { unit: Villager | Soldier; time: number } | null = null;

/** On-screen (not just in front of the camera) — a box-select-style check so
 * "select all of this kind" only grabs what's actually visible right now. */
function isOnScreen(pos: THREE.Vector3): boolean {
  const p = rtsCamera.worldToScreen(pos);
  return (
    p !== null && p.x >= 0 && p.x <= window.innerWidth && p.y >= 0 && p.y <= window.innerHeight
  );
}

/** Keeps the post-fx outline in sync with whatever is currently selected —
 * the same rim-around-the-unit treatment the AoE2 selection research called
 * for, on top of (not instead of) the existing ground rings. */
function syncSelectionOutline() {
  const objects: THREE.Object3D[] = [
    ...selectedVillagers.map((v) => v.model),
    ...selectedSoldiers.map((s) => s.model),
  ];
  if (selectedBuildingInfo) objects.push(selectedBuildingInfo.mesh);
  if (selectedEnemyUnit) objects.push(selectedEnemyUnit.model);
  setOutlined(objects);
}

/** Villagers and soldiers can be selected together (a box drag grabs both),
 * so selecting units only clears the building selection, not each other. */
function selectUnits(villagerList: Villager[], soldierList: Soldier[]) {
  deselectBuilding();
  deselectEnemyUnit();
  deselectResourceNode();
  for (const v of selectedVillagers) v.setSelected(false);
  for (const s of selectedSoldiers) s.setSelected(false);
  selectedVillagers = villagerList;
  selectedSoldiers = soldierList;
  for (const v of selectedVillagers) v.setSelected(true);
  for (const s of selectedSoldiers) s.setSelected(true);
  syncSelectionOutline();
}

function deselectUnits() {
  for (const v of selectedVillagers) v.setSelected(false);
  for (const s of selectedSoldiers) s.setSelected(false);
  selectedVillagers = [];
  selectedSoldiers = [];
  syncSelectionOutline();
}

function selectBuilding(building: PlacedBuilding) {
  deselectUnits();
  deselectBuilding();
  deselectEnemyUnit();
  deselectResourceNode();
  selectedBuildingInfo = building;
  const ring = building.mesh.userData.selectionRing as THREE.Mesh | undefined;
  if (ring) ring.visible = true;
  syncSelectionOutline();
  updateRallyMarker();
}

function deselectBuilding() {
  if (selectedBuildingInfo) {
    const ring = selectedBuildingInfo.mesh.userData.selectionRing as
      | THREE.Mesh
      | undefined;
    if (ring) ring.visible = false;
  }
  selectedBuildingInfo = null;
  syncSelectionOutline();
  updateRallyMarker();
}

/** Read-only look at a single hostile unit — never issues commands, just
 * surfaces its attributes in the info panel. */
function selectEnemyUnit(unit: EnemyGuard | Villager) {
  deselectUnits();
  deselectBuilding();
  deselectResourceNode();
  selectedEnemyUnit = unit;
  syncSelectionOutline();
}

function deselectEnemyUnit() {
  selectedEnemyUnit = null;
  syncSelectionOutline();
}

/** Read-only look at a resource node — just to see how much is left. */
function selectResourceNode(node: ResourceNode) {
  deselectUnits();
  deselectBuilding();
  deselectEnemyUnit();
  selectedResourceNode = node;
  updateResourceRing();
}

function deselectResourceNode() {
  selectedResourceNode = null;
  updateResourceRing();
}

function deselectAll() {
  deselectUnits();
  deselectBuilding();
  deselectEnemyUnit();
  deselectResourceNode();
}

/** A small flag-on-a-pole shown at a training building's rally point while
 * that building is selected — created lazily since most games won't set one. */
let rallyMarker: THREE.Group | null = null;
function ensureRallyMarker(): THREE.Group {
  if (rallyMarker) return rallyMarker;
  const group = new THREE.Group();
  const pole = new THREE.Mesh(
    new THREE.CylinderGeometry(0.03, 0.03, 1, 6),
    new THREE.MeshStandardMaterial({ color: 0xd8c48a }),
  );
  pole.position.y = 0.5;
  group.add(pole);
  const flag = new THREE.Mesh(
    new THREE.ConeGeometry(0.22, 0.36, 4),
    new THREE.MeshStandardMaterial({ color: 0xffcc55 }),
  );
  flag.position.set(0, 0.85, 0.15);
  flag.rotation.x = Math.PI / 2;
  group.add(flag);
  group.visible = false;
  scene.add(group);
  rallyMarker = group;
  return group;
}

/** Keeps the rally flag matched to the selected building's rally point (if
 * any) — hidden the moment nothing training is selected. */
function updateRallyMarker() {
  const marker = ensureRallyMarker();
  const point = selectedBuildingInfo?.rallyPoint;
  marker.visible = !!point;
  if (point) marker.position.copy(point);
}

/** Right-clicking the ground with a training building selected sets where
 * its future units head off to, instead of just standing at the doorway. */
function setRallyPoint(building: PlacedBuilding, sx: number, sy: number) {
  const point = rtsCamera.raycastGround(sx, sy);
  if (!point) return;
  building.rallyPoint = new THREE.Vector3(point.x, heightAt(point.x, point.z), point.z);
  updateRallyMarker();
}

/** A ground ring shown at a selected resource node — created lazily since
 * most sessions won't inspect one. */
let resourceRing: THREE.Mesh | null = null;
function ensureResourceRing(): THREE.Mesh {
  if (resourceRing) return resourceRing;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.6, 0.75, 24),
    new THREE.MeshBasicMaterial({ color: 0xffd23f, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  resourceRing = ring;
  return ring;
}

/** Shows the attack radius of a selected building that can auto-attack —
 * Outposts/Castles always, a Town Center only once it's finished (a
 * garrisoned TC's attack still has a fixed range regardless of occupancy). */
let rangeRing: THREE.Mesh | null = null;
function ensureRangeRing(): THREE.Mesh {
  if (rangeRing) return rangeRing;
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.97, 1, 64),
    new THREE.MeshBasicMaterial({
      color: 0xff5555,
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.55,
    }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.visible = false;
  scene.add(ring);
  rangeRing = ring;
  return ring;
}

function updateRangeRing() {
  const ring = ensureRangeRing();
  const building = selectedBuildingInfo;
  const range =
    building && !building.underConstruction
      ? (building.def.attack ?? building.def.garrisonAttack)?.range
      : undefined;
  ring.visible = !!range;
  if (range && building) {
    ring.scale.set(range, range, 1);
    ring.position.set(building.position.x, building.position.y + 0.05, building.position.z);
  }
}

function updateResourceRing() {
  const ring = ensureResourceRing();
  ring.visible = !!selectedResourceNode;
  if (selectedResourceNode) {
    ring.position.set(
      selectedResourceNode.position.x,
      selectedResourceNode.position.y + 0.05,
      selectedResourceNode.position.z,
    );
  }
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

function resolveEnemyGuardFromHit(hit: THREE.Object3D): EnemyGuard | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    if (obj.userData.enemyGuard) return obj.userData.enemyGuard as EnemyGuard;
    obj = obj.parent;
  }
  return null;
}

function resolveEnemyBuildingFromHit(hit: THREE.Object3D): PlacedBuilding | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    const match = enemyCamp.townBuildings.list.find((b) => b.mesh === obj);
    if (match) return match;
    obj = obj.parent;
  }
  return null;
}

function resolveResourceNodeFromHit(hit: THREE.Object3D): ResourceNode | null {
  let obj: THREE.Object3D | null = hit;
  while (obj) {
    if (obj.userData.resourceNode) return obj.userData.resourceNode as ResourceNode;
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
function unitLabel(unit: UnitKind | "villager"): string {
  return unit === "villager" ? "Villager" : getUnitStats(unit).label;
}

function unitIcon(unit: UnitKind | "villager"): string {
  if (unit === "villager") return "🧑‍🌾";
  if (unit === "archer") return "🏹";
  if (unit === "scout") return "🐎";
  return "🛡️";
}

/** "Beats X, weak to Y" hint for the counter triangle — Soldier > Archer >
 * Scout > Soldier, 1.5x damage in the favorable direction. */
function counterLine(kind: UnitKind): [string, string] {
  return ["🔺 Counters", `Beats ${unitLabel(beats(kind))}, weak to ${unitLabel(counteredBy(kind))}`];
}

// AoE2 splits a villager's Build menu into economic and military pages.
const ECONOMIC_BUILDINGS = [
  "house",
  "farm",
  "mill",
  "lumber_camp",
  "mining_camp",
  "town_center",
];
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

/** What the unit-attribute panel shows while a Build ▸ Economic/Military
 * option is hovered — cost, HP, attack and training stats for a building
 * that doesn't exist in the world yet, so it's built from the def alone
 * rather than reusing buildSelectionInfo's built/site variants. */
function buildingPreviewInfo(def: BuildingDef): SelectionInfo {
  const stats: [string, string][] = [];
  if (Object.keys(def.cost).length > 0) stats.push(["💰 Cost", costSummary(def.cost)]);
  stats.push(["🧱 Max HP", `${def.maxHp}`]);
  stats.push(["⏱ Build Time", `${def.buildTime}s`]);
  if (def.attack) {
    stats.push(["⚔️ Damage", `${def.attack.damage}`]);
    stats.push(["➹ Range", `${def.attack.range}`]);
    stats.push(["⏱ Cooldown", `${def.attack.cooldown}s`]);
  }
  if (def.trains) {
    stats.push([
      `${unitIcon(def.trains.unit)} Trains`,
      `${unitLabel(def.trains.unit)} (${def.trains.foodCost}${RESOURCE_ICON.food}, ${def.trains.time}s)`,
    ]);
    if (def.trains.unit !== "villager") stats.push(counterLine(def.trains.unit));
  }
  if (def.dropOff) {
    stats.push([
      "📦 Drop-off",
      def.dropOff === "any" ? "Any resource" : `${RESOURCE_ICON[def.dropOff]} ${def.dropOff}`,
    ]);
  }
  return {
    key: `preview:${def.id}`,
    title: def.name,
    portrait: BUILDING_ICON[def.id] ?? "🏗️",
    description: def.description,
    stats,
    commands: [],
  };
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
    previewInfo: buildingPreviewInfo(def),
  };
}

/** Commands a villager offers: AoE2's Build ▸ Economic / Military pages. */
const GATHER_TYPES: ResourceType[] = ["wood", "stone", "food", "gold"];

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
    ...GATHER_TYPES.map(
      (type): CommandButton => ({
        icon: RESOURCE_ICON[type],
        label: `Gather ${type[0].toUpperCase()}${type.slice(1)}`,
        tooltip: `Keep gathering ${type} whenever idle, until moved or reassigned`,
        onClick: () => {
          for (const v of selectedVillagers) v.commandGatherType(type);
        },
      }),
    ),
  ];
}

/** Commands a building offers: train its unit, research its techs, repair. */
function buildingCommands(building: PlacedBuilding): CommandButton[] {
  const commands: CommandButton[] = [];
  const def = building.def;
  if (building.underConstruction) return commands;

  if (def.trains) {
    const trains = def.trains;
    const queueFull = building.queue.length >= MAX_QUEUE;
    const affordable = inventory.has("food", trains.foodCost);
    const popFull = populationUsed() >= populationCap();
    commands.push({
      icon: unitIcon(trains.unit),
      label: unitLabel(trains.unit),
      sub: `${trains.foodCost}${RESOURCE_ICON.food}`,
      disabled: !affordable || queueFull || popFull,
      tooltip: popFull
        ? `Population full (${populationUsed()}/${populationCap()}) — build a House for more room`
        : queueFull
          ? `Queue is full (${MAX_QUEUE})`
          : `Train ${unitLabel(trains.unit)} — ${trains.foodCost} food, charged now`,
      onClick: () => enqueueUnit(building, inventory),
    });
  }

  if (def.garrisonCapacity && building.garrison.length > 0) {
    commands.push({
      icon: "🚪",
      label: "Ungarrison",
      sub: `${building.garrison.length}/${def.garrisonCapacity}`,
      tooltip: `Send all ${building.garrison.length} sheltering villagers back out`,
      onClick: () => {
        for (const v of [...building.garrison]) v.forceIdle();
      },
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
    const fullCost = fullRepairCost(building);
    const spend = Math.min(fullCost, inventory.get("wood"));
    const spendShown = Math.floor(spend);
    commands.push({
      icon: "🔧",
      label: "Repair",
      sub: `${spendShown}/${fullCost}${RESOURCE_ICON.wood}`,
      disabled: spend <= 0,
      tooltip:
        spend >= fullCost
          ? `Repair fully for ${fullCost} wood`
          : `Partial repair with ${spendShown} of ${fullCost} wood`,
      onClick: () => applyRepair(building, inventory),
    });
  }

  return commands;
}

function buildSelectionInfo(): SelectionInfo | null {
  if (selectedResourceNode) {
    const node = selectedResourceNode;
    const max = NODE_CAPACITY[node.type];
    const label = node.type[0].toUpperCase() + node.type.slice(1);
    return {
      key: node,
      title: `${label} Node`,
      portrait: RESOURCE_ICON[node.type],
      description:
        "A gatherable resource node — right-click it with villagers selected to send them gathering.",
      hp: node.amount,
      maxHp: max,
      stats: [["📦 Remaining", `${Math.ceil(node.amount)}/${max}`]],
      commands: [],
    };
  }

  if (selectedEnemyUnit) {
    const unit = selectedEnemyUnit;
    if (unit instanceof EnemyGuard) {
      return {
        key: unit,
        title: "Enemy Guard",
        portrait: "🗡️",
        description: unit.isRaiding
          ? "Hostile — currently raiding your town."
          : "Hostile — patrols and defends the enemy camp.",
        hp: unit.hp,
        maxHp: GUARD_MAX_HP,
        stats: [
          ["⚔️ Damage", `${GUARD_ATTACK_DAMAGE}`],
          ["➹ Range", `${GUARD_ATTACK_RANGE}`],
          ["⏱ Cooldown", `${GUARD_ATTACK_COOLDOWN}s`],
          counterLine("soldier"),
        ],
        commands: [],
      };
    }
    return {
      key: unit,
      title: "Enemy Villager",
      portrait: "🧑‍🌾",
      description: unit.isIdle
        ? "Hostile — idle, part of the enemy camp's economy."
        : "Hostile — gathering or building for the enemy camp.",
      hp: unit.hp,
      maxHp: VILLAGER_MAX_HP,
      commands: [],
    };
  }

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
    if (def.trains) {
      stats.push(["🚩 Rally", building.rallyPoint ? "Set — right-click ground to move it" : "Right-click ground to set"]);
    }
    if (def.dropOff) {
      stats.push([
        "📦 Drop-off",
        def.dropOff === "any" ? "Any resource" : `${RESOURCE_ICON[def.dropOff]} ${def.dropOff}`,
      ]);
    }
    if (def.garrisonCapacity) {
      stats.push(["🏠 Garrison", `${building.garrison.length}/${def.garrisonCapacity} — right-click with villagers selected`]);
      if (def.garrisonAttack) {
        stats.push([
          "⚔️ Garrison attack",
          building.garrison.length > 0
            ? `${def.garrisonAttack.damagePerVillager * building.garrison.length} dmg, range ${def.garrisonAttack.range}`
            : "None while empty",
        ]);
      }
    }

    const trains = def.trains;
    const building_ = building;
    if (building_.underConstruction) {
      const builders = villagers.filter((v) => v.isBuilding(building_)).length;
      return {
        key: building,
        variant: "site",
        title: `${def.name} (site)`,
        portrait: "🚧",
        description:
          builders > 0
            ? `Under construction — ${builders} villager${builders > 1 ? "s" : ""} working. Right-click the site with villagers selected to add more.`
            : "Construction stalled — no villagers assigned. Select villagers and right-click the site to build it.",
        hp: building.hp,
        maxHp: building.maxHp,
        stats: [
          ["🚧 Progress", `${Math.floor(building.buildProgress * 100)}%`],
          ["👷 Builders", `${builders}`],
        ],
        commands: [],
      };
    }
    return {
      key: building,
      variant: "built",
      title: def.name,
      portrait: BUILDING_ICON[def.id] ?? "🏗️",
      description: def.description,
      hp: building.hp,
      maxHp: building.maxHp,
      stats,
      commands: buildingCommands(building),
      garrisonGrid: def.garrisonCapacity
        ? building.garrison.map(() => ({
            icon: "🧑‍🌾",
            tooltip: "Garrisoned villager — click to send it back out",
          }))
        : undefined,
      onPickGarrison: (i: number) => {
        const v = building.garrison[i];
        if (v) v.forceIdle();
      },
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
            onCancel: (i: number) => cancelQueued(building, inventory, i),
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

  // Multiple units: show one icon per selected unit rather than a portrait
  // and per-unit attributes, which would only describe one of them. Clicking
  // an icon narrows the selection down to that unit.
  if (total > 1) {
    const sameKind = distinctKinds.length === 1;
    const label = sameKind
      ? `${total} ${distinctKinds[0] === "villager" ? "Villagers" : getUnitStats(distinctKinds[0] as UnitKind).label + "s"}`
      : `${total} Units`;
    return {
      key: selectedSelectionKey(),
      title: label,
      description: hasVillagers
        ? "Right-click to move; resources send villagers to gather, the enemy camp sends soldiers to attack."
        : "Right-click ground to reposition the group, or the enemy camp to attack it.",
      unitGrid: kinds.map((k) => ({
        icon: unitIcon(k),
        tooltip: `${unitLabel(k)} — click to select only this one`,
      })),
      onPickUnit: (i: number) => {
        if (i < selectedVillagers.length) {
          selectUnits([selectedVillagers[i]], []);
        } else {
          selectUnits([], [selectedSoldiers[i - selectedVillagers.length]]);
        }
      },
      commands: hasVillagers ? villagerCommands() : [],
    };
  }

  // Exactly one unit: attributes genuinely describe it.
  const kind = distinctKinds[0];
  if (kind === "villager") {
    const assignment = selectedVillagers[0].gatherAssignment;
    return {
      key: selectedSelectionKey(),
      title: "Villager",
      portrait: "🧑‍🌾",
      description:
        "Gathers wood, stone, and food. Right-click ground to move, or a resource to gather.",
      hp: selectedVillagers[0].hp,
      maxHp: VILLAGER_MAX_HP,
      stats: [
        ["🎯 Assigned", assignment ? `${RESOURCE_ICON[assignment]} ${assignment}` : "Any"],
      ],
      commands: villagerCommands(),
    };
  }

  const stats = getUnitStats(kind);
  const lead = selectedSoldiers[0];
  return {
    key: selectedSelectionKey(),
    title: stats.label,
    portrait: unitIcon(kind),
    description:
      "Right-click ground to reposition it, or the enemy camp to attack. Holds and defends wherever you send it.",
    hp: lead.hp,
    maxHp: stats.maxHp,
    stats: [
      ["⚔️ Damage", `${stats.attackDamage}`],
      ["➹ Range", `${stats.attackRange}`],
      ["⏱ Cooldown", `${stats.attackCooldown}s`],
      ["🎯 Awareness", `${stats.awarenessRange}`],
      counterLine(kind),
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
/** Fallback click tolerance for adding builders to a site once it's raycast
 * miss — generous enough to forgive a near-miss click, but tighter than
 * MIN_BUILDING_SPACING so it can't ever straddle two adjacent sites. */
const SITE_CLICK_RADIUS = 2.2;

/** Held while the Shift key is down, so confirming a placement can re-enter
 * placement mode for the same building instead of closing out — lets a
 * villager queue up several of the same building without reopening the
 * build menu each time. */
let shiftHeld = false;
window.addEventListener("keydown", (e) => {
  if (e.key === "Shift") shiftHeld = true;
});
window.addEventListener("keyup", (e) => {
  if (e.key === "Shift") shiftHeld = false;
});
window.addEventListener("blur", () => {
  shiftHeld = false;
});

function startPlacement(building: BuildingDef) {
  if (ghost) {
    scene.remove(ghost);
    disposeBuildingMesh(ghost);
  }
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
  if (ghost) {
    scene.remove(ghost);
    disposeBuildingMesh(ghost);
  }
  ghost = null;
  selectedBuildingType = null;
  hud.setPlacementMode(false);
}

function confirmPlacement() {
  if (!selectedBuildingType || !ghost) return;
  if (townBuildings.isTooCloseToAny(ghost.position, MIN_BUILDING_SPACING))
    return;
  const buildingType = selectedBuildingType;
  if (!buildManager.build(buildingType)) return;

  const placed = spawnBuilding(
    buildingType.id,
    ghost.position.x,
    ghost.position.z,
  );

  // Placing only lays a foundation — it stays inert until villagers build it.
  beginConstruction(placed);
  for (const v of selectedVillagers) v.commandBuild(placed);

  // Shift keeps the same building selected for another placement instead of
  // closing the menu — queuing up several without reopening Build each time.
  if (shiftHeld) {
    startPlacement(buildingType);
  } else {
    cancelPlacement();
  }
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

  // Right-clicking the enemy camp is an attack order for any selected
  // soldiers — its guards first, then its buildings.
  if (selectedSoldiers.length > 0) {
    const guardHit = rtsCamera.raycastObjects(
      sx,
      sy,
      enemyCamp.guards.filter((g) => g.alive).map((g) => g.model),
    );
    if (guardHit) {
      const guard = resolveEnemyGuardFromHit(guardHit);
      if (guard) {
        for (const s of selectedSoldiers) s.commandAttack(guard);
        return;
      }
    }

    const enemyVillagerHit = rtsCamera.raycastObjects(
      sx,
      sy,
      enemyCamp.villagers.filter((v) => v.alive).map((v) => v.model),
    );
    if (enemyVillagerHit) {
      const enemyVillager = resolveVillagerFromHit(enemyVillagerHit);
      if (enemyVillager) {
        for (const s of selectedSoldiers) s.commandAttack(enemyVillager);
        return;
      }
    }

    const enemyBuildingHit = rtsCamera.raycastObjects(
      sx,
      sy,
      enemyCamp.townBuildings.list.map((b) => b.mesh),
    );
    if (enemyBuildingHit) {
      const building = resolveEnemyBuildingFromHit(enemyBuildingHit);
      if (building) {
        const target = wrapCampBuilding(enemyCamp, building, inventory, scene, effects);
        for (const s of selectedSoldiers) s.commandAttack(target);
        return;
      }
    }
  }

  // Right-clicking an unfinished building sends villagers to work on it —
  // the way to add more builders to a site, or resume one whose builders
  // were killed or reassigned. Multiple villagers building the same site
  // already stack (progress accrues per villager-second), but once a couple
  // are standing on a small foundation they can visually cover it, making an
  // exact-mesh click hard to land — so this also falls back to "nearest
  // unfinished site to where you clicked," not just a precise raycast hit.
  if (selectedVillagers.length > 0) {
    const sites = townBuildings.list.filter((b) => b.underConstruction);
    const siteHit = rtsCamera.raycastObjects(sx, sy, sites.map((b) => b.mesh));
    let site = siteHit ? resolveBuildingFromHit(siteHit) : null;
    if (!site) {
      const groundPoint = rtsCamera.raycastGround(sx, sy);
      if (groundPoint) {
        let nearestDist = SITE_CLICK_RADIUS;
        for (const candidate of sites) {
          const dist = groundPoint.distanceTo(candidate.position);
          if (dist < nearestDist) {
            nearestDist = dist;
            site = candidate;
          }
        }
      }
    }
    if (site && site.underConstruction) {
      for (const v of selectedVillagers) v.commandBuild(site);
      return;
    }
  }

  // Right-clicking a Town Center/Castle sends villagers to hide inside it —
  // AoE2's garrison. A garrisoned Town Center also gains an auto-attack.
  if (selectedVillagers.length > 0) {
    const garrisonable = townBuildings.list.filter(
      (b) => !b.underConstruction && b.def.garrisonCapacity,
    );
    const garrisonHit = rtsCamera.raycastObjects(sx, sy, garrisonable.map((b) => b.mesh));
    if (garrisonHit) {
      const building = resolveBuildingFromHit(garrisonHit);
      if (building) {
        const site = townBuildings.garrisonSiteFor(building);
        for (const v of selectedVillagers) v.commandGarrison(site);
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

/** A small round badge with an emoji in it, as a cursor — previews what
 * right-clicking the hovered thing will do (attack, gather a specific
 * resource), the same way the ghost preview does for building placement.
 * Cached per icon since the data URI is the same every time it's used. */
const actionCursorCache = new Map<string, string>();
function actionCursor(icon: string, ringColor: string): string {
  const key = `${icon}|${ringColor}`;
  const cached = actionCursorCache.get(key);
  if (cached) return cached;
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<circle cx="14" cy="14" r="12" fill="rgba(20,12,5,0.75)" stroke="${ringColor}" stroke-width="2"/>` +
    `<text x="14" y="19" font-size="14" text-anchor="middle">${icon}</text>` +
    `</svg>`;
  const cursor = `url("data:image/svg+xml,${encodeURIComponent(svg)}") 14 14, pointer`;
  actionCursorCache.set(key, cursor);
  return cursor;
}
const ATTACK_CURSOR = actionCursor("⚔️", "#ff3b3b");
const GATHER_CURSOR: Record<ResourceType, string> = {
  wood: actionCursor(RESOURCE_ICON.wood, "#c9a227"),
  stone: actionCursor(RESOURCE_ICON.stone, "#c9a227"),
  food: actionCursor(RESOURCE_ICON.food, "#c9a227"),
  gold: actionCursor(RESOURCE_ICON.gold, "#c9a227"),
};

// Desktop only (touch has no hover): preview what right-clicking the
// hovered thing would do — attack for soldiers, gather-this-resource for
// villagers-only selections.
canvas.addEventListener("pointermove", (e) => {
  if (e.pointerType !== "mouse") return;
  if (selectedBuildingType) {
    canvas.style.cursor = "";
    return;
  }

  if (selectedSoldiers.length > 0) {
    const hit = rtsCamera.raycastObjects(e.clientX, e.clientY, [
      ...enemyCamp.guards.filter((g) => g.alive).map((g) => g.model),
      ...enemyCamp.villagers.filter((v) => v.alive).map((v) => v.model),
      ...enemyCamp.townBuildings.list.map((b) => b.mesh),
    ]);
    if (hit) {
      canvas.style.cursor = ATTACK_CURSOR;
      return;
    }
  }

  if (selectedVillagers.length > 0 && selectedSoldiers.length === 0) {
    const nodeHit = rtsCamera.raycastObjects(
      e.clientX,
      e.clientY,
      resources.nodes.filter((n) => !n.depleted).map((n) => n.mesh),
    );
    const node = nodeHit ? resolveResourceNodeFromHit(nodeHit) : null;
    if (node) {
      canvas.style.cursor = GATHER_CURSOR[node.type];
      return;
    }
  }

  canvas.style.cursor = "";
});
canvas.addEventListener("pointerleave", () => {
  canvas.style.cursor = "";
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
    if (selectedBuildingInfo?.def.trains && !selectedBuildingInfo.underConstruction) {
      setRallyPoint(selectedBuildingInfo, sx, sy);
    } else {
      commandSelectedUnits(sx, sy);
    }
    return;
  }

  const villagerHit = rtsCamera.raycastObjects(
    sx,
    sy,
    villagers.filter((v) => !v.isGarrisoned).map((v) => v.model),
  );
  if (villagerHit) {
    const villager = resolveVillagerFromHit(villagerHit);
    if (villager) {
      const now = performance.now();
      if (!isTouch && lastUnitClick?.unit === villager && now - lastUnitClick.time < DOUBLE_CLICK_MS) {
        lastUnitClick = null;
        selectUnits(
          villagers.filter((v) => v.alive && !v.isGarrisoned && isOnScreen(v.model.position)),
          [],
        );
      } else {
        lastUnitClick = { unit: villager, time: now };
        selectUnits([villager], []);
      }
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
      const now = performance.now();
      if (!isTouch && lastUnitClick?.unit === soldier && now - lastUnitClick.time < DOUBLE_CLICK_MS) {
        lastUnitClick = null;
        selectUnits(
          [],
          soldiers.filter((s) => s.alive && s.kind === soldier.kind && isOnScreen(s.model.position)),
        );
      } else {
        lastUnitClick = { unit: soldier, time: now };
        selectUnits([], [soldier]);
      }
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

  // Resource nodes are view-only — just a way to check how much is left.
  const resourceNodeHit = rtsCamera.raycastObjects(
    sx,
    sy,
    resources.nodes.filter((n) => !n.depleted).map((n) => n.mesh),
  );
  if (resourceNodeHit) {
    const node = resolveResourceNodeFromHit(resourceNodeHit);
    if (node) {
      selectResourceNode(node);
      return;
    }
  }

  // Enemy units are view-only: a click selects at most one, purely to show
  // its attributes — never a group, and never actionable.
  const enemyGuardHit = rtsCamera.raycastObjects(
    sx,
    sy,
    enemyCamp.guards.map((g) => g.model),
  );
  if (enemyGuardHit) {
    const guard = resolveEnemyGuardFromHit(enemyGuardHit);
    if (guard) {
      selectEnemyUnit(guard);
      return;
    }
  }

  const enemyVillagerHit = rtsCamera.raycastObjects(
    sx,
    sy,
    enemyCamp.villagers.map((v) => v.model),
  );
  if (enemyVillagerHit) {
    const enemyVillager = resolveVillagerFromHit(enemyVillagerHit);
    if (enemyVillager) {
      selectEnemyUnit(enemyVillager);
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
  const villagerHits = villagers.filter((v) => !v.isGarrisoned && inBox(v.model.position));
  const soldierHits = soldiers.filter((s) => inBox(s.model.position));
  hud.setSelectionBox(null);
  if (villagerHits.length > 0 || soldierHits.length > 0) {
    selectUnits(villagerHits, soldierHits);
  } else {
    deselectAll();
  }
});

/** Damages a player building, used both by the enemy camp's raiders and
 * (previously) wolves — kept faction-agnostic since it only touches the
 * player's own townBuildings. */
function damageBuilding(building: PlacedBuilding, amount: number) {
  const destroyed = townBuildings.damage(building, amount);
  if (destroyed) {
    townBuildings.remove(building, scene);
    disposeBuildingMesh(building.mesh);
    if (selectedBuildingInfo === building) {
      selectedBuildingInfo = null;
      syncSelectionOutline();
      updateRallyMarker();
    }
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
      underConstruction: b.underConstruction,
      buildProgress: b.buildProgress,
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
  };
}

// Set once the player resets their town, so a stray autosave (e.g. the
// beforeunload fired by the reload below) can't silently restore the
// just-cleared save before the fresh page load reads it.
let resetting = false;

/** True once the player has nothing left — no buildings, villagers, or
 * soldiers — mirroring AoE2's own defeat rule ("no units and no buildings").
 * Checked once per frame in animate(), after that frame's deaths/destructions
 * have already been applied. */
let defeated = false;

/** True once the enemy camp has nothing left — the mirror image of
 * `defeated`, checked the same way. Doesn't end the game (there's nothing to
 * reset), just flags the win and stays true even if the camp somehow gets
 * buildings back later (there's no path for that today). */
let victorious = false;

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
  stats.begin();
  const delta = Math.min(clock.getDelta(), 0.1);
  const time = clock.getElapsedTime();

  rtsCamera.updateKeyboardPan(delta);
  rtsCamera.setRightDragPanEnabled(
    selectedVillagers.length === 0 && selectedSoldiers.length === 0,
  );

  effects.update(delta);
  resources.update();
  setBuildingObstacles(
    [...townBuildings.list, ...enemyCamp.townBuildings.list]
      .filter((b) => b.def.obstacleRadius !== undefined)
      .map((b) => ({ x: b.position.x, z: b.position.z, radius: b.def.obstacleRadius! })),
  );
  for (const villager of villagers) villager.update(delta, time);
  villagers = villagers.filter((v) => {
    if (!v.alive) {
      v.dispose(scene);
      if (selectedVillagers.includes(v)) {
        selectedVillagers = selectedVillagers.filter((sel) => sel !== v);
        syncSelectionOutline();
      }
      return false;
    }
    return true;
  });
  const combatTargets = [
    ...enemyCamp.guards,
    ...enemyCamp.villagers,
    ...enemyCamp.townBuildings.list.map((b) => wrapCampBuilding(enemyCamp, b, inventory, scene, effects)),
  ];
  for (const soldier of soldiers) soldier.update(delta, time, combatTargets);
  soldiers = soldiers.filter((s) => {
    if (!s.alive) {
      s.dispose(scene);
      if (selectedSoldiers.includes(s)) {
        selectedSoldiers = selectedSoldiers.filter((sel) => sel !== s);
        syncSelectionOutline();
      }
      return false;
    }
    return true;
  });

  updateEnemyCamp(
    enemyCamp,
    scene,
    effects,
    delta,
    time,
    [...soldiers, ...villagers.filter((v) => !v.isGarrisoned)],
    townBuildings,
    damageBuilding,
  );
  if (selectedEnemyUnit && !selectedEnemyUnit.alive) {
    deselectEnemyUnit();
  }
  if (selectedResourceNode && selectedResourceNode.depleted) {
    deselectResourceNode();
  }

  const hasPopRoom = populationUsed() < populationCap();
  for (const building of townBuildings.list) {
    const finished = advanceProduction(building, time, hasPopRoom);
    if (!finished) continue;
    if (finished === "villager") {
      const villager = makeVillager(building.position);
      villagers.push(villager);
      if (building.rallyPoint) villager.commandMoveTo(building.rallyPoint);
    } else {
      const soldier = makeSoldier(building.position, finished);
      soldiers.push(soldier);
      if (building.rallyPoint) soldier.commandMoveTo(building.rallyPoint);
    }
  }

  for (const building of townBuildings.list) {
    const bar = building.mesh.userData.healthBar as HealthBar | undefined;
    bar?.setFraction(building.hp / building.maxHp);

    if (building.underConstruction || time < building.attackReadyAt) continue;

    // A Town Center has no attack of its own — garrisoned villagers arm it,
    // AoE2-style, with damage scaling by how many are sheltering inside. A
    // Castle's own `attack` always applies regardless of garrison.
    const atk = building.def.attack
      ? building.def.attack
      : building.def.garrisonAttack && building.garrison.length > 0
        ? {
            range: building.def.garrisonAttack.range,
            damage: building.def.garrisonAttack.damagePerVillager * building.garrison.length,
            cooldown: building.def.garrisonAttack.cooldown,
          }
        : null;
    if (!atk) continue;

    const target = enemyCamp.guards.find(
      (g) => g.alive && g.model.position.distanceTo(building.position) <= atk.range,
    );
    if (target) {
      target.takeDamage(atk.damage);
      building.attackReadyAt = time + atk.cooldown;
      effects.fireArrow(
        building.position
          .clone()
          .add(new THREE.Vector3(0, building.def.attackOriginY ?? 2, 0)),
        target.model.position.clone().add(new THREE.Vector3(0, 0.4, 0)),
      );
    }
  }

  hud.setPopulation(populationUsed(), populationCap());

  const minimapPoints: { x: number; z: number; color: string; size?: number }[] = [];
  for (const node of resources.nodes) {
    if (node.depleted) continue;
    const color =
      node.type === "wood"
        ? "#4a7c3f"
        : node.type === "stone"
          ? "#9a9086"
          : node.type === "gold"
            ? "#e8c34a"
            : "#d6335c";
    minimapPoints.push({ x: node.position.x, z: node.position.z, color, size: 2 });
  }
  for (const b of townBuildings.list) {
    minimapPoints.push({ x: b.position.x, z: b.position.z, color: "#e8dcc0", size: 6 });
  }
  for (const v of villagers) {
    if (v.isGarrisoned) continue;
    minimapPoints.push({ x: v.model.position.x, z: v.model.position.z, color: "#6fe3ff", size: 3 });
  }
  for (const s of soldiers) {
    minimapPoints.push({ x: s.model.position.x, z: s.model.position.z, color: "#ffcc55", size: 3 });
  }
  for (const b of enemyCamp.townBuildings.list) {
    minimapPoints.push({ x: b.position.x, z: b.position.z, color: "#7a2a2a", size: 6 });
  }
  for (const v of enemyCamp.villagers) {
    minimapPoints.push({ x: v.model.position.x, z: v.model.position.z, color: "#c47a5a", size: 3 });
  }
  for (const g of enemyCamp.guards) {
    minimapPoints.push({ x: g.model.position.x, z: g.model.position.z, color: "#c23b3b", size: 3 });
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
      : `Click (or tap ✓) to place ${selectedBuildingType.name} — hold Shift to queue another`;
  }
  hud.setPrompt(placementPrompt);
  hud.setSelectionInfo(buildSelectionInfo());
  updateRangeRing();

  if (!defeated && townBuildings.list.length === 0 && villagers.length === 0 && soldiers.length === 0) {
    defeated = true;
    cancelPlacement();
    deselectAll();
    hud.setDefeated(true);
  }

  if (
    !victorious &&
    enemyCamp.townBuildings.list.length === 0 &&
    enemyCamp.villagers.length === 0 &&
    enemyCamp.guards.length === 0
  ) {
    victorious = true;
    hud.setVictory(true);
  }

  composer.render();
  stats.end();
  requestAnimationFrame(animate);
}

/**
 * Live state handle for debugging and automated checks. Without it, the only
 * window into a running game is the autosave in localStorage — which lags by
 * up to the autosave interval and has already led to "diagnosing" stale data
 * as a bug. Nothing in the game reads from here; it's an outbound view only.
 */
declare global {
  interface Window {
    __game: unknown;
  }
}
window.__game = {
  get villagers() {
    return villagers;
  },
  get soldiers() {
    return soldiers;
  },
  get buildings() {
    return townBuildings.list;
  },
  get selection() {
    return {
      villagers: selectedVillagers,
      soldiers: selectedSoldiers,
      building: selectedBuildingInfo,
      enemyUnit: selectedEnemyUnit,
    };
  },
  get resources() {
    return inventory.getAll();
  },
  get enemyCamp() {
    return enemyCamp;
  },
  /** Compact, JSON-safe snapshot that's cheap to log and easy to assert on. */
  summary() {
    return {
      time: +clock.getElapsedTime().toFixed(1),
      resources: inventory.getAll(),
      villagers: villagers.length,
      soldiers: soldiers.length,
      enemyCamp: {
        resources: enemyCamp.inventory.getAll(),
        buildings: enemyCamp.townBuildings.list.length,
        villagers: enemyCamp.villagers.length,
        guards: enemyCamp.guards.length,
        raidingGuards: enemyCamp.guards.filter((g) => g.isRaiding).length,
        raidTimer: +enemyCamp.raidTimer.toFixed(1),
      },
      selected: {
        villagers: selectedVillagers.length,
        soldiers: selectedSoldiers.length,
        building: selectedBuildingInfo?.type ?? null,
      },
      buildings: townBuildings.list.map((b) => ({
        type: b.type,
        hp: Math.round(b.hp),
        underConstruction: b.underConstruction,
        progress: +b.buildProgress.toFixed(2),
        queue: [...b.queue],
      })),
    };
  },
};

requestAnimationFrame(animate);
