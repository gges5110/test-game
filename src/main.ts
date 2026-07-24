import * as THREE from "three";
import { createTerrain } from "./world/terrain";
import { ResourceManager } from "./world/resources";
import { createCampfire } from "./world/props";
import { PlayerController } from "./player/controller";
import { Inventory } from "./systems/inventory";
import { Crafting } from "./systems/crafting";
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
const crafting = new Crafting(inventory);
const hud = new Hud(hudRoot, inventory, crafting);

// Starting kit so new players can try torches/campfires immediately.
crafting.grant("torch", 1);
crafting.grant("campfire", 1);
inventory.add("wood", 3);
inventory.add("stone", 2);
inventory.add("fiber", 1);

// Torch: press T to toggle a light attached to the player, if owned.
let torchOn = false;
const torchLight = new THREE.PointLight(0xffcc88, 0, 9, 2);
torchLight.position.set(0.35, 1.6, 0.3);
player.model.add(torchLight);

// Campfires placed in the world (press F), animated with a flicker.
const campfires: ReturnType<typeof createCampfire>[] = [];

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

  const nearest = resources.findGatherable(player.position);
  hud.setPrompt(nearest ? `Press E to gather ${nearest.type}` : null);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
