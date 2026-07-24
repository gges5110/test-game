import * as THREE from "three";
import { createTerrain, heightAt } from "./world/terrain";
import { ResourceManager } from "./world/resources";
import { createCampfire } from "./world/props";
import { createBuildingMesh, makeGhost } from "./world/buildings";
import { Villager } from "./world/villager";
import { PlayerController } from "./player/controller";
import { Inventory } from "./systems/inventory";
import { Crafting } from "./systems/crafting";
import { BuildManager, type BuildingDef } from "./systems/building";
import { createLighting } from "./systems/lighting";
import { Hud } from "./ui/hud";

const canvas = document.getElementById("view") as HTMLCanvasElement;
const hudRoot = document.getElementById("hud") as HTMLElement;

const scene = new THREE.Scene();

const camera = new THREE.PerspectiveCamera(
  60,
  window.innerWidth / window.innerHeight,
  0.1,
  1000,
);

const renderer = new THREE.WebGLRenderer({ canvas, antialias: true });
renderer.setSize(window.innerWidth, window.innerHeight);
renderer.setPixelRatio(Math.min(window.devicePixelRatio, 2));
renderer.shadowMap.enabled = true;
renderer.toneMapping = THREE.ACESFilmicToneMapping;
renderer.toneMappingExposure = 1.1;

window.addEventListener("resize", () => {
  camera.aspect = window.innerWidth / window.innerHeight;
  camera.updateProjectionMatrix();
  renderer.setSize(window.innerWidth, window.innerHeight);
});

const terrain = createTerrain();
scene.add(terrain);

createLighting(scene);
const resources = new ResourceManager(scene);
const player = new PlayerController(camera, canvas, scene);

const inventory = new Inventory();
const buildManager = new BuildManager(inventory);
const crafting = new Crafting(inventory, buildManager);
const hud = new Hud(hudRoot, inventory, crafting, buildManager);

// Starting kit so new players can try crafting/building immediately.
crafting.grant("torch", 1);
crafting.grant("campfire", 1);
inventory.add("wood", 12);
inventory.add("stone", 8);
inventory.add("fiber", 3);

// Torch: press T to toggle a light attached to the player, if owned.
let torchOn = false;
const torchLight = new THREE.PointLight(0xffcc88, 0, 9, 2);
torchLight.position.set(0.35, 1.6, 0.3);
player.model.add(torchLight);

// Campfires placed in the world (press F), animated with a flicker.
const campfires: ReturnType<typeof createCampfire>[] = [];

// Villagers spawned by Houses: they seek nearby resources, gather, and
// haul them home to the shared inventory; idle otherwise wandering nearby.
const villagers: Villager[] = [];

// Farms tick out food passively over time.
const FARM_INTERVAL = 8;
const farms: { timer: number }[] = [];

// Building placement: pick a building in the build menu, a translucent
// ghost follows the player, Enter confirms and Escape cancels.
let selectedBuilding: BuildingDef | null = null;
let ghost: THREE.Group | null = null;
const PLACEMENT_DISTANCE = 5;

hud.setOnSelectBuilding((building) => {
  if (ghost) scene.remove(ghost);
  selectedBuilding = building;
  ghost = makeGhost(createBuildingMesh(building.id));
  scene.add(ghost);
});

function cancelPlacement() {
  if (ghost) scene.remove(ghost);
  ghost = null;
  selectedBuilding = null;
}

function confirmPlacement() {
  if (!selectedBuilding || !ghost) return;
  if (!buildManager.build(selectedBuilding)) return;

  const building = createBuildingMesh(selectedBuilding.id);
  building.position.copy(ghost.position);
  building.rotation.y = ghost.rotation.y;
  scene.add(building);

  if (selectedBuilding.id === "house") {
    villagers.push(new Villager(scene, building.position, resources, inventory));
  } else if (selectedBuilding.id === "storage") {
    inventory.addCapacity(20);
  } else if (selectedBuilding.id === "farm") {
    farms.push({ timer: 0 });
  }

  cancelPlacement();
}

window.addEventListener("keydown", (e) => {
  if (e.code === "KeyE") {
    const node = resources.findGatherable(player.position);
    if (node) {
      const type = resources.gather(node);
      inventory.add(type, 1 + crafting.gatherBonus(type));
    }
  } else if (e.code === "KeyT") {
    if (crafting.countOf("torch") <= 0) return;
    torchOn = !torchOn;
    torchLight.intensity = torchOn ? 2.5 : 0;
  } else if (e.code === "KeyF") {
    if (!crafting.consumeCrafted("campfire")) return;
    const fire = createCampfire();
    fire.group.position.copy(player.position);
    scene.add(fire.group);
    campfires.push(fire);
  } else if (e.code === "Enter") {
    confirmPlacement();
  } else if (e.code === "Escape") {
    cancelPlacement();
  }
});

const clock = new THREE.Clock();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.1);
  const time = clock.getElapsedTime();

  player.update(delta);
  resources.update();

  for (const fire of campfires) {
    const flicker = 0.85 + Math.sin(time * 11) * 0.1 + Math.sin(time * 23) * 0.05;
    fire.light.intensity = 3.5 * flicker;
    fire.flame.scale.setScalar(0.9 + Math.sin(time * 17) * 0.08);
  }

  for (const villager of villagers) {
    villager.update(delta, time);
  }

  for (const farm of farms) {
    farm.timer += delta;
    if (farm.timer >= FARM_INTERVAL) {
      farm.timer -= FARM_INTERVAL;
      inventory.add("food", 1);
    }
  }

  if (selectedBuilding && ghost) {
    const facing = player.model.rotation.y;
    const x = player.position.x + Math.sin(facing) * PLACEMENT_DISTANCE;
    const z = player.position.z + Math.cos(facing) * PLACEMENT_DISTANCE;
    ghost.position.set(x, heightAt(x, z), z);
    ghost.rotation.y = facing;
  }

  const placementPrompt = selectedBuilding
    ? `Enter to place ${selectedBuilding.name} · Esc to cancel`
    : null;
  const nearest = resources.findGatherable(player.position);
  const gatherPrompt = nearest ? `Press E to gather ${nearest.type}` : null;
  hud.setPrompt(placementPrompt ?? gatherPrompt);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
