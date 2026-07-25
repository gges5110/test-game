import * as THREE from "three";
import { heightAt } from "./terrain";
import type { ResourceManager, ResourceNode, ResourceType } from "./resources";
import type { Inventory } from "../systems/inventory";

/** Matches the minimap's resource-node colors, so a carried resource reads
 * as the same "thing" whether you're looking at the node or the villager. */
const CARRY_COLOR: Record<ResourceType, number> = {
  wood: 0x4a7c3f,
  stone: 0x9a9086,
  food: 0xd6335c,
};

const WANDER_RADIUS = 4;
const JOB_SEARCH_RADIUS = 25;
const SPEED = 1.6;
const ARRIVE_DIST = 0.3;
const GATHER_DURATION = 1.2;
const BUILD_RANGE = 1.8;

type State =
  | "idle"
  | "toResource"
  | "gathering"
  | "toHome"
  | "moving"
  | "toBuild"
  | "building";

/** What a villager needs to know about a construction site. PlacedBuilding
 * satisfies this structurally, without villager.ts depending on it. */
export interface ConstructionSite {
  position: THREE.Vector3;
  underConstruction: boolean;
}

export class Villager {
  readonly model: THREE.Group;
  private home: THREE.Vector3;
  private wanderTarget: THREE.Vector3;
  private wanderWaitUntil = 0;
  private moveTarget = new THREE.Vector3();
  private selectionRing: THREE.Mesh;
  private workIndicator: THREE.Mesh;
  private carryIndicator: THREE.Mesh;

  private state: State = "idle";
  private targetNode: ResourceNode | null = null;
  private buildSite: ConstructionSite | null = null;
  private gatherEndsAt = 0;
  private carrying: ResourceType | null = null;

  constructor(
    scene: THREE.Scene,
    home: THREE.Vector3,
    private resources: ResourceManager,
    private inventory: Inventory,
    private getGatherBonus: (type: ResourceType) => number,
    private onBuildTick: (site: ConstructionSite, delta: number) => void = () => {},
  ) {
    this.home = home.clone();
    this.wanderTarget = home.clone();
    this.model = createVillagerModel();
    this.model.position.copy(home);
    this.model.userData.villager = this;
    scene.add(this.model);

    this.selectionRing = createSelectionRing();
    this.selectionRing.visible = false;
    this.model.add(this.selectionRing);

    this.workIndicator = createWorkIndicator();
    this.workIndicator.visible = false;
    this.model.add(this.workIndicator);

    this.carryIndicator = createCarryIndicator();
    this.carryIndicator.visible = false;
    this.model.add(this.carryIndicator);
  }

  setSelected(selected: boolean) {
    this.selectionRing.visible = selected;
  }

  getHome(): THREE.Vector3 {
    return this.home.clone();
  }

  /** Player-issued: walk to a point, then resume normal idle behavior. */
  commandMoveTo(point: THREE.Vector3) {
    this.releaseJob();
    this.moveTarget.copy(point);
    this.state = "moving";
  }

  /** True if this villager is heading to or working on the given site. */
  isBuilding(site: ConstructionSite): boolean {
    return this.buildSite === site;
  }

  /** Player-issued: walk to a construction site and work on it until done. */
  commandBuild(site: ConstructionSite) {
    this.releaseJob();
    this.buildSite = site;
    this.state = "toBuild";
  }

  /** Player-issued: go gather a specific node, overriding auto job search. */
  commandGather(node: ResourceNode) {
    if (node.depleted) return;
    this.releaseJob();
    this.resources.reserve(node);
    this.targetNode = node;
    this.state = "toResource";
  }

  update(delta: number, now: number) {
    this.workIndicator.visible =
      this.state === "gathering" || this.state === "building";
    this.carryIndicator.visible = this.carrying !== null;
    switch (this.state) {
      case "toBuild":
        this.updateToBuild(delta);
        return;
      case "building":
        this.updateBuilding(delta, now);
        return;
      case "toResource":
        this.updateToResource(delta, now);
        return;
      case "gathering":
        this.updateGathering(now);
        return;
      case "toHome":
        this.updateToHome(delta);
        return;
      case "moving":
        this.updateMoving(delta);
        return;
      default:
        this.updateIdle(delta, now);
    }
  }

  private updateToBuild(delta: number) {
    const site = this.buildSite;
    if (!site || !site.underConstruction) {
      this.buildSite = null;
      this.state = "idle";
      return;
    }
    this.moveToward(site.position, delta);
    // Stop at the edge rather than walking into the footprint.
    if (this.model.position.distanceTo(site.position) <= BUILD_RANGE) {
      this.state = "building";
    }
  }

  private updateBuilding(delta: number, now: number) {
    const site = this.buildSite;
    if (!site || !site.underConstruction) {
      this.buildSite = null;
      this.state = "idle";
      return;
    }
    this.workIndicator.position.y = 1.55 + Math.sin(now * 9) * 0.1;
    this.workIndicator.rotation.y = now * 4;
    this.onBuildTick(site, delta);
  }

  private updateMoving(delta: number) {
    this.moveToward(this.moveTarget, delta);
    if (this.model.position.distanceTo(this.moveTarget) <= ARRIVE_DIST) {
      this.state = "idle";
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
    this.workIndicator.position.y = 1.55 + Math.sin(now * 9) * 0.1;
    this.workIndicator.rotation.y = now * 4;

    if (now < this.gatherEndsAt) return;
    if (this.targetNode && !this.targetNode.depleted) {
      this.carrying = this.resources.gather(this.targetNode);
      const material = this.carryIndicator.material as THREE.MeshStandardMaterial;
      material.color.setHex(CARRY_COLOR[this.carrying]);
    }
    this.targetNode = null;
    this.state = "toHome";
  }

  private updateToHome(delta: number) {
    this.moveToward(this.home, delta);
    if (this.model.position.distanceTo(this.home) <= ARRIVE_DIST) {
      if (this.carrying) {
        const bonus = this.getGatherBonus(this.carrying);
        this.inventory.add(this.carrying, 1 + bonus);
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
    this.releaseJob();
    this.state = "idle";
  }

  private releaseJob() {
    if (this.targetNode) this.resources.release(this.targetNode);
    this.targetNode = null;
    this.buildSite = null;
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

function createWorkIndicator(): THREE.Mesh {
  return new THREE.Mesh(
    new THREE.OctahedronGeometry(0.14, 0),
    new THREE.MeshStandardMaterial({
      color: 0xffd23f,
      emissive: 0xffaa00,
      emissiveIntensity: 1.2,
    }),
  );
}

/** A small bundle worn on the villager's back, shown only while returning
 * with a resource — color set per-type in updateGathering(). */
function createCarryIndicator(): THREE.Mesh {
  const mesh = new THREE.Mesh(
    new THREE.BoxGeometry(0.24, 0.22, 0.2),
    new THREE.MeshStandardMaterial({ color: 0xffffff }),
  );
  mesh.position.set(0, 0.95, -0.24);
  mesh.castShadow = true;
  return mesh;
}

function createSelectionRing(): THREE.Mesh {
  const ring = new THREE.Mesh(
    new THREE.RingGeometry(0.4, 0.5, 24),
    new THREE.MeshBasicMaterial({ color: 0x6fe3ff, side: THREE.DoubleSide }),
  );
  ring.rotation.x = -Math.PI / 2;
  ring.position.y = 0.05;
  return ring;
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
