import * as THREE from "three";
import { createTerrain, heightAt } from "./world/terrain";
import { ResourceManager } from "./world/resources";
import { createBuildingMesh, makeGhost, attachSelectionRing, attachHealthBar } from "./world/buildings";
import type { HealthBar } from "./world/healthBar";
import { Villager } from "./world/villager";
import { Wolf } from "./world/enemy";
import { Inventory } from "./systems/inventory";
import { Crafting } from "./systems/crafting";
import { BuildManager, getBuildingDef, type BuildingDef } from "./systems/building";
import { TownBuildings, type PlacedBuilding } from "./systems/townBuildings";
import { createLighting } from "./systems/lighting";
import { RtsCamera } from "./systems/rtsCamera";
import { Hud } from "./ui/hud";

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

// The town starts with a free Town Center and three villagers already
// working — mirrors classic RTS onboarding (no manual gathering needed
// to bootstrap the economy).
const townCenterDef = getBuildingDef("town_center");
const townCenterMesh = createBuildingMesh("town_center");
townCenterMesh.position.set(0, heightAt(0, 0), 0);
attachSelectionRing(townCenterMesh);
attachHealthBar(townCenterMesh);
scene.add(townCenterMesh);
townBuildings.add("town_center", townCenterDef, townCenterMesh, townCenterMesh.position);
buildManager.grant("town_center");

let villagers: Villager[] = [];
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

rtsCamera.focus.set(0, heightAt(0, 0), 0);

let selectedVillager: Villager | null = null;
let selectedBuildingInfo: PlacedBuilding | null = null;

function selectVillager(villager: Villager) {
  deselectBuilding();
  if (selectedVillager) selectedVillager.setSelected(false);
  selectedVillager = villager;
  villager.setSelected(true);
}

function deselectVillager() {
  if (selectedVillager) selectedVillager.setSelected(false);
  selectedVillager = null;
}

function selectBuilding(building: PlacedBuilding) {
  deselectVillager();
  deselectBuilding();
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

function deselectAll() {
  deselectVillager();
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

  const mesh = createBuildingMesh(selectedBuildingType.id);
  mesh.position.copy(ghost.position);
  attachSelectionRing(mesh);
  attachHealthBar(mesh);
  scene.add(mesh);
  const placed = townBuildings.add(selectedBuildingType.id, selectedBuildingType, mesh, mesh.position);

  if (selectedBuildingType.id === "house") {
    const villager = new Villager(scene, placed.position, resources, inventory, gatherBonus);
    villagers.push(villager);
    placed.onDestroyed = () => {
      scene.remove(villager.model);
      villagers = villagers.filter((v) => v !== villager);
      if (selectedVillager === villager) selectedVillager = null;
    };
  } else if (selectedBuildingType.id === "storage") {
    inventory.addCapacity(20);
  } else if (selectedBuildingType.id === "farm") {
    const farmEntry = { building: placed, timer: 0 };
    farms.push(farmEntry);
    placed.onDestroyed = () => {
      farms = farms.filter((f) => f !== farmEntry);
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

function commandSelectedVillager(sx: number, sy: number) {
  if (!selectedVillager) return;
  const nodeMeshes = resources.nodes.filter((n) => !n.depleted).map((n) => n.mesh);
  const nodeHit = rtsCamera.raycastObjects(sx, sy, nodeMeshes);
  if (nodeHit) {
    const node = resolveResourceNodeFromHit(nodeHit);
    if (node) {
      selectedVillager.commandGather(node);
      return;
    }
  }
  const point = rtsCamera.raycastGround(sx, sy);
  if (point) {
    selectedVillager.commandMoveTo(new THREE.Vector3(point.x, heightAt(point.x, point.z), point.z));
  }
}

// Desktop: left-click selects (villager, building, or deselects on empty
// ground), right-click issues a command to the selected villager — the
// classic RTS split. Touch has no second button, so a tap on a villager
// selects it and a following tap commands it (merged into one gesture).
rtsCamera.setOnTap((sx, sy, button, isTouch) => {
  if (selectedBuildingType && ghost) {
    const point = rtsCamera.raycastGround(sx, sy);
    if (point) ghost.position.set(point.x, heightAt(point.x, point.z), point.z);
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
      selectVillager(villager);
      return;
    }
  }

  if (isTouch && selectedVillager) {
    commandSelectedVillager(sx, sy);
    return;
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

// Farms tick out food passively over time.
const FARM_INTERVAL = 8;
let farms: { building: PlacedBuilding; timer: number }[] = [];

// Towers auto-attack any wolf within range.
const TOWER_RANGE = 8;
const TOWER_DAMAGE = 12;
const TOWER_COOLDOWN = 1;
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
let waveNumber = 0;
let nextWaveAt = 30;
const WAVE_INTERVAL = 45;

function spawnWave() {
  waveNumber++;
  const count = 2 + waveNumber;
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

function animate() {
  const delta = Math.min(clock.getDelta(), 0.1);
  const time = clock.getElapsedTime();

  rtsCamera.updateKeyboardPan(delta);

  resources.update();
  for (const villager of villagers) villager.update(delta, time);

  for (const farm of farms) {
    farm.timer += delta;
    if (farm.timer >= FARM_INTERVAL) {
      farm.timer -= FARM_INTERVAL;
      inventory.add("food", 1);
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
    } else if (building.type === "tower" && time >= building.attackReadyAt) {
      const target = wolves.find(
        (w) => w.alive && w.model.position.distanceTo(building.position) <= TOWER_RANGE,
      );
      if (target) {
        target.takeDamage(TOWER_DAMAGE);
        building.attackReadyAt = time + TOWER_COOLDOWN;
        spawnAttackBeam(
          building.position.clone().add(new THREE.Vector3(0, 2.9, 0)),
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
      scene.remove(w.model);
      return false;
    }
    return true;
  });

  hud.setTownStats(villagers.length, townBuildings.list.length);

  let placementPrompt: string | null = null;
  if (selectedBuildingType && ghost) {
    placementPrompt = townBuildings.isTooCloseToAny(ghost.position, MIN_BUILDING_SPACING)
      ? "Too close to another building — tap elsewhere"
      : `Tap ✓ to place ${selectedBuildingType.name}`;
  }
  const buildingInfoPrompt = selectedBuildingInfo
    ? `${selectedBuildingInfo.def.name} — HP ${Math.ceil(selectedBuildingInfo.hp)}/${selectedBuildingInfo.maxHp}`
    : null;
  const selectionPrompt = selectedVillager
    ? "Villager selected — right-click (or tap) ground to move, resource to gather"
    : null;
  hud.setPrompt(placementPrompt ?? buildingInfoPrompt ?? selectionPrompt);

  renderer.render(scene, rtsCamera.camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
