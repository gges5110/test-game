import * as THREE from "three";
import { heightAt } from "./terrain";

export type ResourceType = "wood" | "stone" | "food";

export interface ResourceNode {
  type: ResourceType;
  position: THREE.Vector3;
  /** Invisible pick target — never added to the scene, used only for
   * raycasting. The actual visuals are drawn by shared InstancedMeshes. */
  mesh: THREE.Object3D;
  depleted: boolean;
  respawnAt: number;
  /** Claimed by a villager en route, so others don't also target it. */
  reserved: boolean;
}

/**
 * What a Villager needs from wherever it gathers — satisfied by
 * ResourceManager (the shared map-wide node field) and equally by a small
 * standalone patch, e.g. the enemy camp's own local resources. Keeping
 * Villager coded against this instead of the concrete class is what lets
 * both economies reuse the exact same unit.
 */
export interface GatherSource {
  findNearestAvailable(from: THREE.Vector3, maxDist: number): ResourceNode | null;
  reserve(node: ResourceNode): void;
  release(node: ResourceNode): void;
  gather(node: ResourceNode): ResourceType;
  /** Ticks respawn timers; called once per frame. */
  update(): void;
}

const GATHER_RANGE = 2.5;
const RESPAWN_SECONDS = 20;
const NODE_COUNT_PER_TYPE = 140;
const PLACEMENT_SEED = 9001;
const CLUSTERS_PER_TYPE = 8;
const CLUSTER_RADIUS = 12;
const MIN_CLUSTER_DIST_FROM_SPAWN = 12;
const MAX_CLUSTER_DIST_FROM_SPAWN = 42;

/** Radius of the invisible pick target for each resource type. */
const PICK_RADIUS: Record<ResourceType, number> = {
  wood: 1,
  stone: 0.55,
  food: 0.55,
};

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

/** A part appears once (or a few fixed times) per node of its type, always at
 * the same local offset — trees, rocks and bushes are procedural but not
 * randomized per-instance, so one InstancedMesh per part can stand in for
 * every node of that type instead of a unique Mesh each. */
interface PartTemplate {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Local offsets relative to the node origin — one entry per repetition
   * of this part within a single node (e.g. a bush has several lumps). */
  locals: THREE.Matrix4[];
}

function localMatrix(
  x: number,
  y: number,
  z: number,
  scaleY = 1,
): THREE.Matrix4 {
  return new THREE.Matrix4().compose(
    new THREE.Vector3(x, y, z),
    new THREE.Quaternion(),
    new THREE.Vector3(1, scaleY, 1),
  );
}

function treeParts(): PartTemplate[] {
  return [
    {
      geometry: new THREE.CylinderGeometry(0.15, 0.2, 1.4, 6),
      material: new THREE.MeshStandardMaterial({ color: 0x5c4326 }),
      locals: [localMatrix(0, 0.7, 0)],
    },
    {
      geometry: new THREE.ConeGeometry(0.9, 1.8, 8),
      material: new THREE.MeshStandardMaterial({ color: 0x2f6b3a }),
      locals: [localMatrix(0, 2.1, 0)],
    },
  ];
}

function rockParts(): PartTemplate[] {
  return [
    {
      geometry: new THREE.DodecahedronGeometry(0.5, 0),
      material: new THREE.MeshStandardMaterial({ color: 0x8a8378 }),
      locals: [localMatrix(0, 0.35, 0)],
    },
  ];
}

/** Several overlapping lumps read as a fuller bush than one sphere; bright
 * berries dotted across the foliage make it read as "food" at a glance. */
function bushParts(): PartTemplate[] {
  const lumpSpots: [number, number, number, number][] = [
    [0, 0.32, 0, 0.42],
    [0.28, 0.24, 0.1, 0.3],
    [-0.26, 0.22, -0.14, 0.28],
    [0.05, 0.24, -0.28, 0.27],
  ];
  const berrySpots: [number, number, number][] = [
    [0.15, 0.5, 0.18],
    [-0.18, 0.46, 0.08],
    [0.32, 0.36, -0.05],
    [-0.3, 0.34, -0.2],
    [0.02, 0.4, -0.32],
    [0.1, 0.3, 0.3],
  ];
  return [
    {
      // All lumps share one radius-0.42 sphere geometry scaled per-instance
      // via the matrix, so differing lump sizes don't need separate geometries.
      geometry: new THREE.SphereGeometry(1, 8, 6),
      material: new THREE.MeshStandardMaterial({ color: 0x4a7c3f }),
      // Bake each lump's radius and the shared vertical squash (0.75) into
      // its instance scale, since they all share one unit-radius geometry.
      locals: lumpSpots.map(([x, y, z, radius]) =>
        localMatrix(x, y, z).multiply(
          new THREE.Matrix4().makeScale(radius, radius * 0.75, radius),
        ),
      ),
    },
    {
      geometry: new THREE.SphereGeometry(0.06, 6, 6),
      material: new THREE.MeshStandardMaterial({
        color: 0xd6335c,
        emissive: 0x8a0f2c,
        emissiveIntensity: 0.3,
      }),
      locals: berrySpots.map(([x, y, z]) => localMatrix(x, y, z)),
    },
  ];
}

function partsFor(type: ResourceType): PartTemplate[] {
  if (type === "wood") return treeParts();
  if (type === "stone") return rockParts();
  return bushParts();
}

/** One instance slot within one part's InstancedMesh, bound to a node. */
interface InstanceRef {
  instancedMesh: THREE.InstancedMesh;
  index: number;
  baseMatrix: THREE.Matrix4;
}

const HIDDEN_MATRIX = new THREE.Matrix4().makeScale(0, 0, 0);

export class ResourceManager {
  readonly nodes: ResourceNode[] = [];
  /** Every instanced-mesh slot that a given node's visuals occupy. */
  private instanceRefs = new Map<ResourceNode, InstanceRef[]>();
  private scene: THREE.Scene;

  constructor(scene: THREE.Scene) {
    this.scene = scene;
    this.placeNodes();
  }

  private placeNodes() {
    const rng = mulberry32(PLACEMENT_SEED);
    const types: ResourceType[] = ["wood", "stone", "food"];

    // Positions first, so each type's InstancedMeshes can be sized exactly.
    const positionsByType: Record<ResourceType, THREE.Vector3[]> = {
      wood: [],
      stone: [],
      food: [],
    };

    for (const type of types) {
      const nodesPerCluster = Math.ceil(NODE_COUNT_PER_TYPE / CLUSTERS_PER_TYPE);
      let placed = 0;

      for (let c = 0; c < CLUSTERS_PER_TYPE && placed < NODE_COUNT_PER_TYPE; c++) {
        const centerAngle = rng() * Math.PI * 2;
        const centerDist =
          MIN_CLUSTER_DIST_FROM_SPAWN +
          rng() * (MAX_CLUSTER_DIST_FROM_SPAWN - MIN_CLUSTER_DIST_FROM_SPAWN);
        const cx = Math.cos(centerAngle) * centerDist;
        const cz = Math.sin(centerAngle) * centerDist;

        let clusterPlaced = 0;
        let clusterAttempts = 0;
        while (
          clusterPlaced < nodesPerCluster &&
          placed < NODE_COUNT_PER_TYPE &&
          clusterAttempts < nodesPerCluster * 15
        ) {
          clusterAttempts++;
          const angle = rng() * Math.PI * 2;
          const radius = rng() * CLUSTER_RADIUS;
          const x = cx + Math.cos(angle) * radius;
          const z = cz + Math.sin(angle) * radius;
          const distFromSpawn = Math.sqrt(x * x + z * z);
          if (distFromSpawn < 8) continue; // keep spawn clear

          const y = heightAt(x, z);
          const slope =
            Math.abs(heightAt(x + 1, z) - y) + Math.abs(heightAt(x, z + 1) - y);
          if (slope > 0.5) continue; // avoid steep terrain

          positionsByType[type].push(new THREE.Vector3(x, y, z));
          clusterPlaced++;
          placed++;
        }
      }
    }

    for (const type of types) {
      this.buildType(type, positionsByType[type]);
    }
  }

  /** Builds one InstancedMesh per part for `type` and registers each node. */
  private buildType(type: ResourceType, positions: THREE.Vector3[]) {
    const parts = partsFor(type);
    const instancedByPart = parts.map((part) => {
      const totalInstances = positions.length * part.locals.length;
      const instanced = new THREE.InstancedMesh(
        part.geometry,
        part.material,
        Math.max(totalInstances, 1),
      );
      instanced.count = totalInstances;
      instanced.castShadow = true;
      instanced.frustumCulled = false; // instances span the whole map
      this.scene.add(instanced);
      return instanced;
    });

    const nodeWorld = new THREE.Matrix4();
    let cursor = parts.map(() => 0);

    for (const position of positions) {
      nodeWorld.makeTranslation(position.x, position.y, position.z);
      const refs: InstanceRef[] = [];

      parts.forEach((part, partIndex) => {
        const instancedMesh = instancedByPart[partIndex];
        for (const local of part.locals) {
          const index = cursor[partIndex]++;
          const baseMatrix = nodeWorld.clone().multiply(local);
          instancedMesh.setMatrixAt(index, baseMatrix);
          refs.push({ instancedMesh, index, baseMatrix });
        }
      });

      // A single small invisible box stands in for the whole node; never
      // added to the scene, so it costs nothing to render — only used so
      // raycasting/gather commands can still resolve back to this node.
      const pickMesh = new THREE.Mesh(
        new THREE.SphereGeometry(PICK_RADIUS[type], 6, 4),
      );
      pickMesh.position.copy(position);
      pickMesh.updateMatrixWorld(true);

      const node: ResourceNode = {
        type,
        position,
        mesh: pickMesh,
        depleted: false,
        respawnAt: 0,
        reserved: false,
      };
      pickMesh.userData.resourceNode = node;
      this.nodes.push(node);
      this.instanceRefs.set(node, refs);
    }

    for (const instanced of instancedByPart) instanced.instanceMatrix.needsUpdate = true;
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

  /** Nearest non-depleted, unreserved node within range of a point (e.g. a villager's home). */
  findNearestAvailable(from: THREE.Vector3, maxDist: number): ResourceNode | null {
    let nearest: ResourceNode | null = null;
    let nearestDist = maxDist;
    for (const node of this.nodes) {
      if (node.depleted || node.reserved) continue;
      const dist = from.distanceTo(node.position);
      if (dist < nearestDist) {
        nearest = node;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  reserve(node: ResourceNode) {
    node.reserved = true;
  }

  release(node: ResourceNode) {
    node.reserved = false;
  }

  gather(node: ResourceNode): ResourceType {
    node.depleted = true;
    node.reserved = false;
    node.respawnAt = performance.now() / 1000 + RESPAWN_SECONDS;
    this.setInstancesVisible(node, false);
    return node.type;
  }

  update() {
    const now = performance.now() / 1000;
    for (const node of this.nodes) {
      if (node.depleted && now >= node.respawnAt) {
        node.depleted = false;
        this.setInstancesVisible(node, true);
      }
    }
  }

  /** Toggles a depleted node's visuals by zero-scaling its instance slots,
   * rather than changing per-mesh `count` (which would require the node's
   * slots to stay contiguous — zero-scale works regardless of ordering). */
  private setInstancesVisible(node: ResourceNode, visible: boolean) {
    const refs = this.instanceRefs.get(node);
    if (!refs) return;
    const touched = new Set<THREE.InstancedMesh>();
    for (const ref of refs) {
      ref.instancedMesh.setMatrixAt(ref.index, visible ? ref.baseMatrix : HIDDEN_MATRIX);
      touched.add(ref.instancedMesh);
    }
    for (const instancedMesh of touched) instancedMesh.instanceMatrix.needsUpdate = true;
  }
}
