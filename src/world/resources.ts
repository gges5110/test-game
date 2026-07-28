import * as THREE from "three";
import { heightAt } from "./terrain";
import { partsFor } from "./resourceVisuals";

export type ResourceType = "wood" | "stone" | "food" | "gold";

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
  /** Remaining stock — AoE2-style, a node holds many trips' worth and gets
   * ground down over time rather than vanishing after one visit. */
  amount: number;
}

/**
 * What a Villager needs from wherever it gathers — satisfied by
 * ResourceManager (the shared map-wide node field) and equally by a small
 * standalone patch, e.g. the enemy camp's own local resources. Keeping
 * Villager coded against this instead of the concrete class is what lets
 * both economies reuse the exact same unit.
 */
export interface GatherSource {
  findNearestAvailable(
    from: THREE.Vector3,
    maxDist: number,
    type?: ResourceType,
  ): ResourceNode | null;
  reserve(node: ResourceNode): void;
  release(node: ResourceNode): void;
  /** Pulls up to `amount` out of a node's remaining stock, at whatever rate
   * the caller is gathering at. Returns how much was actually taken (capped
   * by what's left), and depletes/hides the node once it hits zero. */
  extract(node: ResourceNode, amount: number): number;
  /** Ticks respawn timers; called once per frame. */
  update(): void;
}

/** Where a villager carrying `type` should walk to drop it off — AoE2's Town
 * Center / Mill / Lumber Camp / Mining Camp role. TownBuildings satisfies
 * this structurally via its own nearestDropOff method. */
export interface DropOffFinder {
  nearestDropOff(type: ResourceType, from: THREE.Vector3): THREE.Vector3 | null;
}

const GATHER_RANGE = 2.5;
const RESPAWN_SECONDS = 20;
/** Total stock a single node holds before it's exhausted — AoE2-scale, not
 * the old "one visit and it's gone." A villager gathers at GATHER_RATE
 * (see villager.ts) per second, so a stone node takes a while to work down. */
export const NODE_CAPACITY: Record<ResourceType, number> = {
  wood: 150,
  stone: 200,
  food: 125,
  gold: 200,
};
const PLACEMENT_SEED = 9001;
/** Gold is deliberately scarcer than the others — fewer clusters, fewer
 * nodes per cluster, matching its usual "precious" role even though nothing
 * costs it yet. */
const NODE_COUNT_PER_TYPE: Record<ResourceType, number> = {
  wood: 140,
  stone: 140,
  food: 140,
  gold: 70,
};
const CLUSTERS_PER_TYPE: Record<ResourceType, number> = {
  wood: 8,
  stone: 8,
  food: 8,
  gold: 5,
};
const CLUSTER_RADIUS = 12;
const MIN_CLUSTER_DIST_FROM_SPAWN = 12;
const MAX_CLUSTER_DIST_FROM_SPAWN = 42;

/** Radius of the invisible pick target for each resource type. */
const PICK_RADIUS: Record<ResourceType, number> = {
  wood: 1,
  stone: 0.55,
  food: 0.55,
  gold: 0.55,
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

  /**
   * `bases` are the points clusters get built around — the player's spawn
   * and (symmetrically) the enemy camp, by default just the player. Splitting
   * the same per-type cluster/node budget evenly across every base means
   * each side gets an equal, equivalent resource field instead of the AI
   * economy running on a separate, smaller patch.
   */
  constructor(scene: THREE.Scene, bases: THREE.Vector3[] = [new THREE.Vector3(0, 0, 0)]) {
    this.scene = scene;
    this.placeNodes(bases);
  }

  private placeNodes(bases: THREE.Vector3[]) {
    const rng = mulberry32(PLACEMENT_SEED);
    const types: ResourceType[] = ["wood", "stone", "food", "gold"];

    // Positions first, so each type's InstancedMeshes can be sized exactly.
    const positionsByType: Record<ResourceType, THREE.Vector3[]> = {
      wood: [],
      stone: [],
      food: [],
      gold: [],
    };

    for (const type of types) {
      const clustersPerBase = Math.max(1, Math.round(CLUSTERS_PER_TYPE[type] / bases.length));
      const nodesPerBase = Math.round(NODE_COUNT_PER_TYPE[type] / bases.length);
      const nodesPerCluster = Math.ceil(nodesPerBase / clustersPerBase);

      for (const base of bases) {
        let placed = 0;

        for (let c = 0; c < clustersPerBase && placed < nodesPerBase; c++) {
          const centerAngle = rng() * Math.PI * 2;
          const centerDist =
            MIN_CLUSTER_DIST_FROM_SPAWN +
            rng() * (MAX_CLUSTER_DIST_FROM_SPAWN - MIN_CLUSTER_DIST_FROM_SPAWN);
          const cx = base.x + Math.cos(centerAngle) * centerDist;
          const cz = base.z + Math.sin(centerAngle) * centerDist;

          let clusterPlaced = 0;
          let clusterAttempts = 0;
          while (
            clusterPlaced < nodesPerCluster &&
            placed < nodesPerBase &&
            clusterAttempts < nodesPerCluster * 15
          ) {
            clusterAttempts++;
            const angle = rng() * Math.PI * 2;
            const radius = rng() * CLUSTER_RADIUS;
            const x = cx + Math.cos(angle) * radius;
            const z = cz + Math.sin(angle) * radius;
            // Keep every base's own footprint clear, not just the player's.
            const tooCloseToABase = bases.some((b) => Math.hypot(x - b.x, z - b.z) < 8);
            if (tooCloseToABase) continue;

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
        amount: NODE_CAPACITY[type],
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
  findNearestAvailable(
    from: THREE.Vector3,
    maxDist: number,
    type?: ResourceType,
  ): ResourceNode | null {
    let nearest: ResourceNode | null = null;
    let nearestDist = maxDist;
    for (const node of this.nodes) {
      if (node.depleted || node.reserved) continue;
      if (type && node.type !== type) continue;
      const dist = from.distanceTo(node.position);
      if (dist < nearestDist) {
        nearest = node;
        nearestDist = dist;
      }
    }
    return nearest;
  }

  /** Registers a gatherable node with no instanced visuals of its own — used
   * for Farms, whose "resource" is the building itself. Villagers find,
   * reserve and deplete it exactly like a wild node; it just has nothing to
   * hide when depleted (setInstancesVisible no-ops for an unknown node). */
  addNode(type: ResourceType, position: THREE.Vector3): ResourceNode {
    const pickMesh = new THREE.Mesh(new THREE.SphereGeometry(PICK_RADIUS[type], 6, 4));
    pickMesh.position.copy(position);
    pickMesh.updateMatrixWorld(true);
    const node: ResourceNode = {
      type,
      position: position.clone(),
      mesh: pickMesh,
      depleted: false,
      respawnAt: 0,
      reserved: false,
      amount: NODE_CAPACITY[type],
    };
    pickMesh.userData.resourceNode = node;
    this.nodes.push(node);
    return node;
  }

  /** Un-registers a node added via addNode — e.g. when its Farm is destroyed. */
  removeNode(node: ResourceNode) {
    const idx = this.nodes.indexOf(node);
    if (idx >= 0) this.nodes.splice(idx, 1);
  }

  reserve(node: ResourceNode) {
    node.reserved = true;
  }

  release(node: ResourceNode) {
    node.reserved = false;
  }

  extract(node: ResourceNode, amount: number): number {
    const taken = Math.min(amount, node.amount);
    node.amount -= taken;
    if (node.amount <= 0 && !node.depleted) {
      node.depleted = true;
      node.reserved = false;
      node.respawnAt = performance.now() / 1000 + RESPAWN_SECONDS;
      this.setInstancesVisible(node, false);
    }
    return taken;
  }

  update() {
    const now = performance.now() / 1000;
    for (const node of this.nodes) {
      if (node.depleted && now >= node.respawnAt) {
        node.depleted = false;
        node.amount = NODE_CAPACITY[node.type];
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
