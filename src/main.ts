import * as THREE from "three";
import { createTerrain } from "./world/terrain";
import { ResourceManager } from "./world/resources";
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

window.addEventListener("keydown", (e) => {
  if (e.code !== "KeyE") return;
  const node = resources.findGatherable(player.position);
  if (node) {
    const type = resources.gather(node);
    inventory.add(type, 1);
  }
});

const clock = new THREE.Clock();

function animate() {
  const delta = Math.min(clock.getDelta(), 0.1);

  player.update(delta);
  resources.update();

  const nearest = resources.findGatherable(player.position);
  hud.setPrompt(nearest ? `Press E to gather ${nearest.type}` : null);

  renderer.render(scene, camera);
  requestAnimationFrame(animate);
}

requestAnimationFrame(animate);
