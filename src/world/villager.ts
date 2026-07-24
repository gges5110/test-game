import * as THREE from "three";
import { heightAt } from "./terrain";

const WANDER_RADIUS = 4;
const SPEED = 1.2;
const ARRIVE_DIST = 0.2;

export class Villager {
  readonly model: THREE.Group;
  private home: THREE.Vector3;
  private target: THREE.Vector3;
  private waitUntil = 0;

  constructor(scene: THREE.Scene, home: THREE.Vector3) {
    this.home = home.clone();
    this.target = home.clone();
    this.model = createVillagerModel();
    this.model.position.copy(home);
    scene.add(this.model);
  }

  update(delta: number, now: number) {
    const toTarget = this.target.clone().sub(this.model.position);
    toTarget.y = 0;
    const dist = toTarget.length();

    if (dist > ARRIVE_DIST) {
      toTarget.normalize().multiplyScalar(Math.min(SPEED * delta, dist));
      this.model.position.x += toTarget.x;
      this.model.position.z += toTarget.z;
      this.model.position.y = heightAt(
        this.model.position.x,
        this.model.position.z,
      );
      this.model.rotation.y = Math.atan2(toTarget.x, toTarget.z);
    } else if (now > this.waitUntil) {
      this.pickNewTarget(now);
    }
  }

  private pickNewTarget(now: number) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * WANDER_RADIUS;
    const x = this.home.x + Math.cos(angle) * radius;
    const z = this.home.z + Math.sin(angle) * radius;
    this.target.set(x, heightAt(x, z), z);
    this.waitUntil = now + 2 + Math.random() * 3;
  }
}

function createVillagerModel(): THREE.Group {
  const group = new THREE.Group();
  const skin = new THREE.MeshStandardMaterial({ color: 0xd8a888 });
  const tunic = new THREE.MeshStandardMaterial({ color: 0x8a6a3a });

  const body = new THREE.Mesh(new THREE.CapsuleGeometry(0.26, 0.5, 4, 8), tunic);
  body.position.y = 0.75;
  body.castShadow = true;
  group.add(body);

  const head = new THREE.Mesh(new THREE.SphereGeometry(0.2, 10, 10), skin);
  head.position.y = 1.28;
  head.castShadow = true;
  group.add(head);

  return group;
}
