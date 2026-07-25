import * as THREE from "three";
import { createTerrain, heightAt } from "./world/terrain";
import { ResourceManager } from "./world/resources";
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
import { Crafting } from "./systems/crafting";
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
  TRADE_GIVE,
  TRADE_GET,
  type SelectionInfo,
  type SelectionAction,
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
const hud = new Hud(hudRoot, inventory, crafting, buildManager);
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
let selectedSoldier: Soldier | null = null;

function selectVillagers(list: Villager[]) {
  deselectBuilding();
  deselectSoldier();
  for (const v of selectedVillagers) v.setSelected(false);
  selectedVillagers = list;
  for (const v of selectedVillagers) v.setSelected(true);
}

function deselectVillager() {
  for (const v of selectedVillagers) v.setSelected(false);
  selectedVillagers = [];
}

function selectBuilding(building: PlacedBuilding) {
  deselectVillager();
  deselectBuilding();
  deselectSoldier();
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

function selectSoldier(soldier: Soldier) {
  deselectVillager();
  deselectBuilding();
  deselectSoldier();
  selectedSoldier = soldier;
  soldier.setSelected(true);
}

function deselectSoldier() {
  if (selectedSoldier) selectedSoldier.setSelected(false);
  selectedSoldier = null;
}

function deselectAll() {
  deselectVillager();
  deselectBuilding();
  deselectSoldier();
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

/** Spends food and starts a building's queued unit production, if it can. */
function startProduction(building: PlacedBuilding) {
  const trains = building.def.trains;
  if (!trains || building.producingUntil !== undefined) return;
  if (!inventory.has("food", trains.foodCost)) return;
  inventory.spend("food", trains.foodCost);
  building.producingUntil = clock.getElapsedTime() + trains.time;
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

function buildSelectionInfo(): SelectionInfo | null {
  if (selectedBuildingInfo) {
    const building = selectedBuildingInfo;
    const def = building.def;
    const stats: [string, string][] = def.attack
      ? [
          ["Range", `${def.attack.range}`],
          ["Damage", `${def.attack.damage}`],
          ["Cooldown", `${def.attack.cooldown}s`],
        ]
      : [];

    const actions: SelectionAction[] = [];
    if (def.trains) {
      if (building.producingUntil !== undefined) {
        const remaining = Math.max(
          0,
          building.producingUntil - clock.getElapsedTime(),
        );
        actions.push({
          label: `Training ${unitLabel(def.trains.unit)}… ${remaining.toFixed(1)}s`,
          disabled: true,
          onClick: () => {},
        });
      } else {
        const affordable = inventory.has("food", def.trains.foodCost);
        actions.push({
          label: `Train ${unitLabel(def.trains.unit)} (${def.trains.foodCost} food)`,
          disabled: !affordable,
          onClick: () => startProduction(building),
        });
      }
    }
    if (building.hp < building.maxHp) {
      const fullCost = Math.max(
        1,
        Math.ceil((building.maxHp - building.hp) * REPAIR_WOOD_PER_HP),
      );
      const spend = Math.min(fullCost, inventory.get("wood"));
      const label =
        spend >= fullCost
          ? `Repair (${fullCost} wood)`
          : `Repair (${spend}/${fullCost} wood — partial)`;
      actions.push({
        label,
        disabled: spend <= 0,
        onClick: () => repairBuilding(building),
      });
    }

    return {
      key: building,
      title: def.name,
      description: def.description,
      hp: building.hp,
      maxHp: building.maxHp,
      stats,
      actions,
    };
  }

  if (selectedSoldier) {
    const stats = getUnitStats(selectedSoldier.kind);
    return {
      key: selectedSoldier,
      title: stats.label,
      description:
        "Trained by a Barracks/Archery Range/Stable. Patrols near home and auto-attacks any wolf within range.",
      hp: selectedSoldier.hp,
      maxHp: stats.maxHp,
      stats: [
        ["Damage", `${stats.attackDamage}`],
        ["Attack range", `${stats.attackRange}`],
        ["Cooldown", `${stats.attackCooldown}s`],
        ["Leash range", `${stats.leashRange}`],
      ],
    };
  }

  if (selectedVillagers.length === 1) {
    return {
      key: selectedVillagers,
      title: "Villager",
      description:
        "Gathers wood, stone, and food. Right-click ground to move, or a resource to gather.",
    };
  }

  if (selectedVillagers.length > 1) {
    return {
      key: selectedVillagers,
      title: `${selectedVillagers.length} Villagers`,
      description:
        "Right-click ground to move as a group, or a resource for all to gather.",
    };
  }

  return null;
}

// Building placement: pick a building from the build menu, a translucent
// ghost follows subsequent taps, and on-screen Confirm/Cancel buttons
// finalize it. Buildings can't be placed too close to each other.
let selectedBuildingType: BuildingDef | null = null;
let ghost: THREE.Group | null = null;
const MIN_BUILDING_SPACING = 3;

hud.setOnSelectBuilding((building) => {
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
});

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
hud.setOnTrade((give, get) => {
  if (!inventory.has(give, TRADE_GIVE)) return;
  inventory.spend(give, TRADE_GIVE);
  inventory.add(get, TRADE_GET);
});
hud.setOnReset(() => {
  resetting = true;
  clearSave();
  window.location.reload();
});

function commandSelectedVillager(sx: number, sy: number) {
  if (selectedVillagers.length === 0) return;
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
  const point = rtsCamera.raycastGround(sx, sy);
  if (!point) return;
  // Scatter a multi-villager group in a small ring around the target point
  // so they don't all path onto the exact same spot.
  const spread = selectedVillagers.length > 1 ? 0.8 : 0;
  selectedVillagers.forEach((v, i) => {
    const angle = (i / selectedVillagers.length) * Math.PI * 2;
    const ox = Math.cos(angle) * spread;
    const oz = Math.sin(angle) * spread;
    const x = point.x + ox;
    const z = point.z + oz;
    v.commandMoveTo(new THREE.Vector3(x, heightAt(x, z), z));
  });
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
    commandSelectedVillager(sx, sy);
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
      selectVillagers([villager]);
      return;
    }
  }

  if (isTouch && selectedVillagers.length > 0) {
    commandSelectedVillager(sx, sy);
    return;
  }

  const soldierHit = rtsCamera.raycastObjects(
    sx,
    sy,
    soldiers.map((s) => s.model),
  );
  if (soldierHit) {
    const soldier = resolveSoldierFromHit(soldierHit);
    if (soldier) {
      selectSoldier(soldier);
      return;
    }
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

// Left-mouse drag box-selects every villager whose screen position falls
// inside the rectangle (desktop only — touch has no spare gesture for it).
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
  const hits = villagers.filter((v) => {
    const p = rtsCamera.worldToScreen(v.model.position);
    return p !== null && p.x >= x1 && p.x <= x2 && p.y >= y1 && p.y <= y2;
  });
  hud.setSelectionBox(null);
  if (hits.length > 0) {
    selectVillagers(hits);
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
  rtsCamera.setRightDragPanEnabled(selectedVillagers.length === 0);

  resources.update();
  for (const villager of villagers) villager.update(delta, time);
  for (const soldier of soldiers) soldier.update(delta, time, wolves);
  soldiers = soldiers.filter((s) => {
    if (!s.alive) {
      s.dispose(scene);
      if (selectedSoldier === s) selectedSoldier = null;
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
    if (
      building.producingUntil !== undefined &&
      time >= building.producingUntil
    ) {
      building.producingUntil = undefined;
      const unit = building.def.trains!.unit;
      if (unit === "villager") {
        const villager = new Villager(
          scene,
          building.position,
          resources,
          inventory,
          gatherBonus,
        );
        villagers.push(villager);
      } else {
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
