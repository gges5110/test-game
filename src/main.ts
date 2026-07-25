import * as THREE from "three";
import { createTerrain, heightAt } from "./world/terrain";
import { ResourceManager } from "./world/resources";
import { createBuildingMesh, makeGhost, attachSelectionRing, attachHealthBar } from "./world/buildings";
import type { HealthBar } from "./world/healthBar";
import { Villager } from "./world/villager";
import { Soldier, SOLDIER_STATS } from "./world/soldier";
import { Wolf } from "./world/enemy";
import { Inventory } from "./systems/inventory";
import { Crafting } from "./systems/crafting";
import { BuildManager, getBuildingDef, type BuildingDef } from "./systems/building";
import { TownBuildings, type PlacedBuilding } from "./systems/townBuildings";
import { createLighting } from "./systems/lighting";
import { RtsCamera } from "./systems/rtsCamera";
import { saveGame, loadGame, clearSave, type SaveData } from "./systems/save";
import { Hud, type SelectionInfo } from "./ui/hud";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;

const scene = new THREE.Scene();

const rtsCamera = new RtsCamera(canvas, window.innerWidth / window.innerHeight);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

window.addEventListener("resize", () => {
  rtsCamera.setAspect(window.innerWidth / window.innerHeight);
  renderer.setSize(window.innerWidth, window.innerHeight);
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

function spawnBuilding(id: string, x: number, z: number, hp?: number): PlacedBuilding {
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
let farms: { building: PlacedBuilding; timer: number }[] = [];
let barracksList: { building: PlacedBuilding; timer: number }[] = [];
let waveNumber = 0;

const savedGame = loadGame();
if (savedGame) {
  // Reload a previous session instead of resetting the town.
  for (const b of savedGame.buildings) {
    const placed = spawnBuilding(b.type, b.x, b.z, b.hp);
    if (b.type === "farm") farms.push({ building: placed, timer: 0 });
    if (b.type === "barracks") {
      const entry = { building: placed, timer: 0 };
      barracksList.push(entry);
      placed.onDestroyed = () => {
        barracksList = barracksList.filter((e) => e !== entry);
      };
    }
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
    const soldier = new Soldier(scene, new THREE.Vector3(s.homeX, heightAt(s.homeX, s.homeZ), s.homeZ));
    soldier.model.position.set(s.x, heightAt(s.x, s.z), s.z);
    soldiers.push(soldier);
  }
  for (const placed of townBuildings.list) {
    if (placed.type !== "house") continue;
    const villager = villagers.find((v) => v.getHome().distanceTo(placed.position) < 0.01);
    if (!villager) continue;
    placed.onDestroyed = () => {
      scene.remove(villager.model);
      villagers = villagers.filter((v) => v !== villager);
      selectedVillagers = selectedVillagers.filter((v) => v !== villager);
    };
  }
  inventory.restore(savedGame.inventory, savedGame.capacityBonus);
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
      new Villager(scene, new THREE.Vector3(x, heightAt(x, z), z), resources, inventory, gatherBonus),
    );
  }

  inventory.add("wood", 8);
  inventory.add("stone", 4);
  inventory.add("food", 2);
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
    const ring = selectedBuildingInfo.mesh.userData.selectionRing as THREE.Mesh | undefined;
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
function buildSelectionInfo(): SelectionInfo | null {
  if (selectedBuildingInfo) {
    const def = selectedBuildingInfo.def;
    const stats: [string, string][] = def.attack
      ? [
          ["Range", `${def.attack.range}`],
          ["Damage", `${def.attack.damage}`],
          ["Cooldown", `${def.attack.cooldown}s`],
        ]
      : [];
    return {
      title: def.name,
      description: def.description,
      hp: selectedBuildingInfo.hp,
      maxHp: selectedBuildingInfo.maxHp,
      stats,
    };
  }

  if (selectedSoldier) {
    return {
      title: "Soldier",
      description: "Trained by a Barracks. Patrols near home and auto-attacks any wolf within range.",
      hp: selectedSoldier.hp,
      maxHp: SOLDIER_STATS.maxHp,
      stats: [
        ["Damage", `${SOLDIER_STATS.attackDamage}`],
        ["Attack range", `${SOLDIER_STATS.attackRange}`],
        ["Cooldown", `${SOLDIER_STATS.attackCooldown}s`],
        ["Leash range", `${SOLDIER_STATS.leashRange}`],
      ],
    };
  }

  if (selectedVillagers.length === 1) {
    return {
      title: "Villager",
      description: "Gathers wood, stone, and food. Right-click ground to move, or a resource to gather.",
    };
  }

  if (selectedVillagers.length > 1) {
    return {
      title: `${selectedVillagers.length} Villagers`,
      description: "Right-click ground to move as a group, or a resource for all to gather.",
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
  ghost.position.set(rtsCamera.focus.x, heightAt(rtsCamera.focus.x, rtsCamera.focus.z), rtsCamera.focus.z);
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
  if (townBuildings.isTooCloseToAny(ghost.position, MIN_BUILDING_SPACING)) return;
  if (!buildManager.build(selectedBuildingType)) return;

  const placed = spawnBuilding(selectedBuildingType.id, ghost.position.x, ghost.position.z);

  if (selectedBuildingType.id === "house") {
    const villager = new Villager(scene, placed.position, resources, inventory, gatherBonus);
    villagers.push(villager);
    placed.onDestroyed = () => {
      scene.remove(villager.model);
      villagers = villagers.filter((v) => v !== villager);
      selectedVillagers = selectedVillagers.filter((v) => v !== villager);
    };
  } else if (selectedBuildingType.id === "storage") {
    inventory.addCapacity(20);
  } else if (selectedBuildingType.id === "farm") {
    const farmEntry = { building: placed, timer: 0 };
    farms.push(farmEntry);
    placed.onDestroyed = () => {
      farms = farms.filter((f) => f !== farmEntry);
    };
  } else if (selectedBuildingType.id === "barracks") {
    const barracksEntry = { building: placed, timer: 0 };
    barracksList.push(barracksEntry);
    placed.onDestroyed = () => {
      barracksList = barracksList.filter((e) => e !== barracksEntry);
    };
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
hud.setOnReset(() => {
  clearSave();
  window.location.reload();
});

function commandSelectedVillager(sx: number, sy: number) {
  if (selectedVillagers.length === 0) return;
  const nodeMeshes = resources.nodes.filter((n) => !n.depleted).map((n) => n.mesh);
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
      if (point) ghost.position.set(point.x, heightAt(point.x, point.z), point.z);
    } else {
      confirmPlacement();
    }
    return;
  }

  if (button === 2) {
    commandSelectedVillager(sx, sy);
    return;
  }

  const villagerHit = rtsCamera.raycastObjects(sx, sy, villagers.map((v) => v.model));
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

  const soldierHit = rtsCamera.raycastObjects(sx, sy, soldiers.map((s) => s.model));
  if (soldierHit) {
    const soldier = resolveSoldierFromHit(soldierHit);
    if (soldier) {
      selectSoldier(soldier);
      return;
    }
  }

  const buildingHit = rtsCamera.raycastObjects(sx, sy, townBuildings.list.map((b) => b.mesh));
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

// Farms tick out food passively over time.
const FARM_INTERVAL = 8;

// Barracks spend food to train an autonomous soldier defender.
const BARRACKS_INTERVAL = 14;
const SOLDIER_FOOD_COST = 4;

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
  beam.quaternion.setFromUnitVectors(new THREE.Vector3(0, 1, 0), dir.normalize());
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
    capacityBonus: inventory.getCapacityBonus(),
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
    })),
    waveNumber,
  };
}

const AUTOSAVE_INTERVAL_MS = 5000;
setInterval(() => saveGame(collectSaveData()), AUTOSAVE_INTERVAL_MS);
window.addEventListener("beforeunload", () => saveGame(collectSaveData()));
document.addEventListener("visibilitychange", () => {
  if (document.visibilityState === "hidden") saveGame(collectSaveData());
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

  for (const farm of farms) {
    farm.timer += delta;
    if (farm.timer >= FARM_INTERVAL) {
      farm.timer -= FARM_INTERVAL;
      inventory.add("food", 1);
    }
  }

  for (const barracks of barracksList) {
    barracks.timer += delta;
    if (barracks.timer >= BARRACKS_INTERVAL) {
      if (inventory.has("food", SOLDIER_FOOD_COST)) {
        barracks.timer -= BARRACKS_INTERVAL;
        inventory.spend("food", SOLDIER_FOOD_COST);
        soldiers.push(new Soldier(scene, barracks.building.position));
      } else {
        // Not enough food yet — hold at the threshold instead of stalling forever mid-cycle.
        barracks.timer = BARRACKS_INTERVAL;
      }
    }
  }

  for (const building of townBuildings.list) {
    const bar = building.mesh.userData.healthBar as HealthBar | undefined;
    bar?.setFraction(building.hp / building.maxHp);

    if (building.type === "campfire") {
      const flame = building.mesh.userData.flame as THREE.Mesh;
      const light = building.mesh.userData.light as THREE.PointLight;
      const flicker = 0.85 + Math.sin(time * 11) * 0.1 + Math.sin(time * 23) * 0.05;
      light.intensity = 3.5 * flicker;
      flame.scale.setScalar(0.9 + Math.sin(time * 17) * 0.08);
    } else if (building.def.attack && time >= building.attackReadyAt) {
      const { range, damage, cooldown } = building.def.attack;
      const target = wolves.find(
        (w) => w.alive && w.model.position.distanceTo(building.position) <= range,
      );
      if (target) {
        target.takeDamage(damage);
        building.attackReadyAt = time + cooldown;
        spawnAttackBeam(
          building.position.clone().add(new THREE.Vector3(0, building.def.attackOriginY ?? 2, 0)),
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
    (effect.mesh.material as THREE.MeshBasicMaterial).opacity = Math.min(1, remaining / 0.15) * 0.9;
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

  hud.setTownStats(villagers.length, townBuildings.list.length, soldiers.length);

  let placementPrompt: string | null = null;
  if (selectedBuildingType && ghost) {
    placementPrompt = townBuildings.isTooCloseToAny(ghost.position, MIN_BUILDING_SPACING)
      ? "Too close to another building — move elsewhere"
      : `Click (or tap ✓) to place ${selectedBuildingType.name}`;
  }
  hud.setPrompt(placementPrompt);
  hud.setSelectionInfo(buildSelectionInfo());

  renderer.render(scene, rtsCamera.camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
