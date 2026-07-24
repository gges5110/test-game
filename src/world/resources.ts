import * as THREE from "three";
import { heightAt, WORLD_SIZE } from "./terrain";

export type ResourceType = "wood" | "stone" | "fiber";

export interface ResourceNode {
  type: ResourceType;
  position: THREE.Vector3;
  mesh: THREE.Object3D;
  depleted: boolean;
  respawnAt: number;
}

const GATHER_RANGE = 2.5;
const RESPAWN_SECONDS = 20;
const NODE_COUNT_PER_TYPE = 40;
const PLACEMENT_SEED = 9001;

function mulberry32(seed: number) {
  let a = seed;
  return () => {
    a |= 0;
    a = (a + 0x6d2b79f5) | 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

function createTreeMesh(): THREE.Object3D {
  const group = new THREE.Group();
  const trunk = new THREE.Mesh(
    new THREE.CylinderGeometry(0.15, 0.2, 1.4, 6),
    new THREE.MeshStandardMaterial({ color: 0x5c4326 }),
  );
  trunk.position.y = 0.7;
  trunk.castShadow = true;
  group.add(trunk);

  const foliage = new THREE.Mesh(
    new THREE.ConeGeometry(0.9, 1.8, 8),
    new THREE.MeshStandardMaterial({ color: 0x2f6b3a }),
  );
  foliage.position.y = 2.1;
  foliage.castShadow = true;
  group.add(foliage);

  return group;
}

function createRockMesh(): THREE.Object3D {
  const rock = new THREE.Mesh(
    new THREE.DodecahedronGeometry(0.5, 0),
    new THREE.MeshStandardMaterial({ color: 0x8a8378, flatShading: true }),
  );
  rock.position.y = 0.35;
  rock.castShadow = true;
  return rock;
}

function createBushMesh(): THREE.Object3D {
  const bush = new THREE.Mesh(
    new THREE.SphereGeometry(0.45, 8, 6),
    new THREE.MeshStandardMaterial({ color: 0x4a7c3f, flatShading: true }),
  );
  bush.position.y = 0.35;
  bush.scale.y = 0.7;
  bush.castShadow = true;
  return bush;
}

function meshFactory(type: ResourceType): THREE.Object3D {
  if (type === "wood") return createTreeMesh();
  if (type === "stone") return createRockMesh();
  return createBushMesh();
}

export class ResourceManager {
  readonly nodes: ResourceNode[] = [];
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.placeNodes();
  }

  private placeNodes() {
    const rng = mulberry32(PLACEMENT_SEED);
    const types: ResourceType[] = ["wood", "stone", "fiber"];

    for (const type of types) {
      let placed = 0;
      let attempts = 0;
      while (placed < NODE_COUNT_PER_TYPE && attempts < NODE_COUNT_PER_TYPE * 20) {
        attempts++;
        const x = (rng() - 0.5) * WORLD_SIZE * 0.9;
        const z = (rng() - 0.5) * WORLD_SIZE * 0.9;
        const distFromSpawn = Math.sqrt(x * x + z * z);
        if (distFromSpawn < 12) continue; // keep spawn clear

        const y = heightAt(x, z);
        const slope =
          Math.abs(heightAt(x + 1, z) - y) + Math.abs(heightAt(x, z + 1) - y);
        if (slope > 0.5) continue; // avoid steep terrain

        const mesh = meshFactory(type);
        mesh.position.set(x, y, z);
        this.scene.add(mesh);

        this.nodes.push({
          type,
          position: new THREE.Vector3(x, y, z),
          mesh,
          depleted: false,
          respawnAt: 0,
        });
        placed++;
      }
    }
  }

  findGatherable(playerPosition: THREE.Vector3): ResourceNode | null {
    let nearest: ResourceNode | null = null;
    let nearestDist = GATHER_RANGE;
    for (const node of this.nodes) {
      if (node.depleted) continue;
      const dist = playerPosition.distanceTo(node.position);
      if (dist < nearestDist) {
        nearest = node;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  gather(node: ResourceNode): ResourceType {
    node.depleted = true;
    node.mesh.visible = false;
    node.respawnAt = performance.now() / 1000 + RESPAWN_SECONDS;
    return node.type;
  }

  update() {
    const now = performance.now() / 1000;
    for (const node of this.nodes) {
      if (node.depleted && now >= node.respawnAt) {
        node.depleted = false;
        node.mesh.visible = true;
      }
    }
  }
}
