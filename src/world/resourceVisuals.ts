import * as THREE from "three";
import type { ResourceType } from "./resources";

/**
 * Geometry/material factories for resource-node visuals — trees, rocks,
 * bushes, gold nuggets. ResourceManager (in resources.ts) owns node
 * gameplay (stock, reservation, extraction) and just asks this file for
 * `partsFor(type)` when it needs to build the InstancedMeshes; nothing here
 * reads or mutates a ResourceNode.
 */

/** A part appears once (or a few fixed times) per node of its type, always at
 * the same local offset — trees, rocks and bushes are procedural but not
 * randomized per-instance, so one InstancedMesh per part can stand in for
 * every node of that type instead of a unique Mesh each. */
export interface PartTemplate {
  geometry: THREE.BufferGeometry;
  material: THREE.Material;
  /** Local offsets relative to the node origin — one entry per repetition
   * of this part within a single node (e.g. a bush has several lumps). */
  locals: THREE.Matrix4[];
}

function localMatrix(x: number, y: number, z: number, scaleY = 1): THREE.Matrix4 {
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

/** A small cluster of rounded nuggets, glinting slightly — reads as
 * "precious ore" next to the plain gray rock pile stone uses. */
function goldParts(): PartTemplate[] {
  const nuggetSpots: [number, number, number, number][] = [
    [0, 0.16, 0, 0.22],
    [0.16, 0.12, 0.08, 0.15],
    [-0.14, 0.11, -0.1, 0.14],
    [0.04, 0.13, -0.17, 0.13],
  ];
  return [
    {
      geometry: new THREE.DodecahedronGeometry(1, 0),
      material: new THREE.MeshStandardMaterial({
        color: 0xe8c34a,
        emissive: 0x6a4f0a,
        emissiveIntensity: 0.25,
        metalness: 0.6,
        roughness: 0.35,
      }),
      locals: nuggetSpots.map(([x, y, z, radius]) =>
        localMatrix(x, y, z).multiply(new THREE.Matrix4().makeScale(radius, radius, radius)),
      ),
    },
  ];
}

export function partsFor(type: ResourceType): PartTemplate[] {
  if (type === "wood") return treeParts();
  if (type === "stone") return rockParts();
  if (type === "gold") return goldParts();
  return bushParts();
}
