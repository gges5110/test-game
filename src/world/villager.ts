import * as THREE from "three";
import { heightAt } from "./terrain";
import type { ResourceManager, ResourceNode, ResourceType } from "./resources";
import type { Inventory } from "../systems/inventory";

const WANDER_RADIUS = 4;
const JOB_SEARCH_RADIUS = 25;
const SPEED = 1.6;
const ARRIVE_DIST = 0.3;
const GATHER_DURATION = 1.2;

type State = "idle" | "toResource" | "gathering" | "toHome";

export class Villager {
  readonly model: THREE.Group;
  private home: THREE.Vector3;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;

  private state: State = "idle";
  private targetNode: ResourceNode | null = null;
  private gatherEndsAt = 0;
  private carrying: ResourceType | null = null;

  constructor(
    scene: THREE.Scene,
    home: THREE.Vector3,
    private resources: ResourceManager,
    private inventory: Inventory,
  ) {
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = createVillagerModel();
    this.model.position.copy(home);
    scene.add(this.model);
  }

  update(delta: number, now: number) {
    switch (this.state) {
      case "toResource":
        this.updateToResource(delta, now);
        return;
      case "gathering":
        this.updateGathering(now);
        return;
      case "toHome":
        this.updateToHome(delta);
        return;
      default:
        this.updateIdle(delta, now);
    }
  }

  private updateToResource(delta: number, now: number) {
    if (!this.targetNode || this.targetNode.depleted) {
      this.abandonJob();
      return;
    }
    this.moveToward(this.targetNode.position, delta);
    if (this.model.position.distanceTo(this.targetNode.position) <= ARRIVE_DIST) {
      this.state = "gathering";
      this.gatherEndsAt = now + GATHER_DURATION;
    }
  }

  private updateGathering(now: number) {
    if (now < this.gatherEndsAt) return;
    if (this.targetNode && !this.targetNode.depleted) {
      this.carrying = this.resources.gather(this.targetNode);
    }
    this.targetNode = null;
    this.state = "toHome";
  }

  private updateToHome(delta: number) {
    this.moveToward(this.home, delta);
    if (this.model.position.distanceTo(this.home) <= ARRIVE_DIST) {
      if (this.carrying) {
        this.inventory.add(this.carrying, 1);
        this.carrying = null;
      }
      this.state = "idle";
    }
  }

  private updateIdle(delta: number, now: number) {
    const node = this.resources.findNearestAvailable(this.home, JOB_SEARCH_RADIUS);
    if (node) {
      this.resources.reserve(node);
      this.targetNode = node;
      this.state = "toResource";
      return;
    }

    // No job available nearby — wander near home for atmosphere.
    if (this.model.position.distanceTo(this.wanderTarget) > ARRIVE_DIST) {
      this.moveToward(this.wanderTarget, delta);
    } else if (now > this.wanderWaitUntil) {
      this.pickWanderTarget(now);
    }
  }

  private abandonJob() {
    if (this.targetNode) this.resources.release(this.targetNode);
    this.targetNode = null;
    this.state = "idle";
  }

  private moveToward(point: THREE.Vector3, delta: number) {
    const toTarget = point.clone().sub(this.model.position);
    toTarget.y = 0;
    const dist = toTarget.length();
    if (dist < 1e-4) return;
    toTarget.normalize().multiplyScalar(Math.min(SPEED * delta, dist));
    this.model.position.x += toTarget.x;
    this.model.position.z += toTarget.z;
    this.model.position.y = heightAt(this.model.position.x, this.model.position.z);
    this.model.rotation.y = Math.atan2(toTarget.x, toTarget.z);
  }

  private pickWanderTarget(now: number) {
    const angle = Math.random() * Math.PI * 2;
    const radius = Math.random() * WANDER_RADIUS;
    const x = this.home.x + Math.cos(angle) * radius;
    const z = this.home.z + Math.sin(angle) * radius;
    this.wanderTarget.set(x, heightAt(x, z), z);
    this.wanderWaitUntil = now + 2 + Math.random() * 3;
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
