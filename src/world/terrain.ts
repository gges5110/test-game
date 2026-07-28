import * as THREE from "three";
import { createNoise2D } from "simplex-noise";
import { TEXTURES } from "../systems/textures";

export const WORLD_SIZE = 400;
const SEGMENTS = 200;
const SEED = 1337;

/** The enemy camp's map position — exported so the terrain (valley
 * flattening) and the resource field (cluster placement) both treat it as a
 * second base symmetric with the player's spawn at the origin, instead of
 * only ever flattening/clustering around (0,0). */
export const ENEMY_CAMP_XZ: [number, number] = [64, 46];

/** Lakes: real obstacles, not just scenery — no building may be placed on
 * one, and units steer around them rather than walking through. Placed just
 * outside both bases' resource-cluster rings (12-42 units out) so they don't
 * collide with wood/stone/food placement, but close enough to actually be
 * stumbled across while exploring or expanding, not hidden off in a corner. */
interface WaterFeature {
  center: [number, number];
  radius: number;
  depth: number;
}
const WATER_FEATURES: WaterFeature[] = [
  { center: [-55, -25], radius: 26, depth: 7 },
  { center: [32, -62], radius: 15, depth: 5 },
];
export const WATER_LEVEL = -3;

/** True if (x, z) sits inside any lake — used to keep building placement off
 * the water. */
export function isWater(x: number, z: number): boolean {
  return WATER_FEATURES.some(
    (lake) => Math.hypot(x - lake.center[0], z - lake.center[1]) < lake.radius,
  );
}

/**
 * Steers a movement direction around any lake the next step would enter,
 * instead of just refusing to move — units flow around the shore rather than
 * pooling at the edge. Simple circular-obstacle avoidance (deflect to the
 * tangent that best keeps the original heading) rather than full pathfinding,
 * which is enough given every water feature here is a plain circle.
 */
export function avoidWaterDirection(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  lookahead: number,
): { x: number; z: number } {
  for (const lake of WATER_FEATURES) {
    const toCenterX = lake.center[0] - x;
    const toCenterZ = lake.center[1] - z;
    const distToCenter = Math.hypot(toCenterX, toCenterZ);
    if (distToCenter > lake.radius + lookahead + 2) continue;

    const aheadX = x + dirX * lookahead;
    const aheadZ = z + dirZ * lookahead;
    const clearance = lake.radius + 0.5;
    if (Math.hypot(aheadX - lake.center[0], aheadZ - lake.center[1]) >= clearance) continue;

    const nx = toCenterX / (distToCenter || 1);
    const nz = toCenterZ / (distToCenter || 1);
    // Two tangents to the circle; keep whichever stays closer to the
    // original heading so units don't flip-flop frame to frame.
    const tangentAX = -nz, tangentAZ = nx;
    const tangentBX = nz, tangentBZ = -nx;
    const dotA = tangentAX * dirX + tangentAZ * dirZ;
    const dotB = tangentBX * dirX + tangentBZ * dirZ;
    return dotA >= dotB ? { x: tangentAX, z: tangentAZ } : { x: tangentBX, z: tangentBZ };
  }
  return { x: dirX, z: dirZ };
}

// Mulberry32 PRNG so the seed is reproducible without extra deps.
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

const rng = mulberry32(SEED);
const noise2D = createNoise2D(rng);

/**
 * Layered noise: broad rolling hills + finer detail, with a flattened
 * starting valley around each base (the player's spawn and, symmetrically,
 * the enemy camp) so neither sits on a slope — everywhere else gets to be
 * properly hilly instead of reading as flat and empty.
 */
export function heightAt(x: number, z: number): number {
  const nx = x / WORLD_SIZE;
  const nz = z / WORLD_SIZE;

  let h = 0;
  h += noise2D(nx * 1.2, nz * 1.2) * 16;
  h += noise2D(nx * 3, nz * 3) * 6;
  h += noise2D(nx * 8, nz * 8) * 1.4;

  // Flatten a valley around whichever base (player or enemy camp) is nearer.
  const distFromPlayer = Math.hypot(x, z);
  const distFromCamp = Math.hypot(x - ENEMY_CAMP_XZ[0], z - ENEMY_CAMP_XZ[1]);
  const distFromNearestBase = Math.min(distFromPlayer, distFromCamp);
  const valleyFalloff = THREE.MathUtils.smoothstep(distFromNearestBase, 15, 60);
  h *= valleyFalloff;

  // Carve each lake's basin — landmark dips, masked by flat water planes
  // added in createWorld().
  for (const lake of WATER_FEATURES) {
    const distFromLake = Math.hypot(x - lake.center[0], z - lake.center[1]);
    const lakeDip =
      (1 - THREE.MathUtils.smoothstep(distFromLake, lake.radius * 0.55, lake.radius)) * lake.depth;
    h -= lakeDip;
  }

  return h;
}

const LOWLAND = new THREE.Color(0x5a8a52); // soft lowland grass
const MIDLAND = new THREE.Color(0x6f9a5a); // mid grass
const HIGHLAND = new THREE.Color(0x9a9270); // dry highland
const PEAK = new THREE.Color(0xc7c2ac); // rocky peak
const ROCK = new THREE.Color(0x958c7c); // steep slope

/** Blends smoothly between bands (rather than hard cutoffs) for a painted
 * gradient instead of a banded, gamey look. */
function biomeColor(height: number, slope: number): THREE.Color {
  const color = new THREE.Color();
  if (height < 2) {
    color.copy(LOWLAND).lerp(MIDLAND, THREE.MathUtils.smoothstep(height, -1, 2));
  } else if (height < 7) {
    color.copy(MIDLAND).lerp(HIGHLAND, THREE.MathUtils.smoothstep(height, 2, 7));
  } else {
    color.copy(HIGHLAND).lerp(PEAK, THREE.MathUtils.smoothstep(height, 7, 10));
  }
  // Steep slopes read as rocky regardless of height, blended in softly.
  color.lerp(ROCK, THREE.MathUtils.smoothstep(slope, 0.3, 0.75));
  return color;
}

export function createTerrain(): THREE.Mesh {
  const geometry = new THREE.PlaneGeometry(
    WORLD_SIZE,
    WORLD_SIZE,
    SEGMENTS,
    SEGMENTS,
  );
  geometry.rotateX(-Math.PI / 2);

  const position = geometry.attributes.position;
  const colors = new Float32Array(position.count * 3);

  for (let i = 0; i < position.count; i++) {
    const x = position.getX(i);
    const z = position.getZ(i);
    const y = heightAt(x, z);
    position.setY(i, y);

    // Approximate slope via neighboring sample.
    const yDx = heightAt(x + 1, z);
    const yDz = heightAt(x, z + 1);
    const slope = Math.abs(yDx - y) + Math.abs(yDz - y);

    const color = biomeColor(y, slope);
    colors[i * 3] = color.r;
    colors[i * 3 + 1] = color.g;
    colors[i * 3 + 2] = color.b;
  }

  geometry.setAttribute("color", new THREE.BufferAttribute(colors, 3));
  geometry.computeVertexNormals();

  const grassMap = TEXTURES.grass.map.clone();
  const grassNormal = TEXTURES.grass.normalMap.clone();
  const tileRepeat = WORLD_SIZE / 6;
  for (const tex of [grassMap, grassNormal]) {
    tex.repeat.set(tileRepeat, tileRepeat);
    tex.needsUpdate = true;
  }

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    map: grassMap,
    normalMap: grassNormal,
    normalScale: new THREE.Vector2(0.4, 0.4),
    roughness: 1,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}

/** A flat, semi-transparent disc sitting at WATER_LEVEL over one lake's basin
 * carved into heightAt — purely decorative, no collision. */
function createWaterPlane(lake: WaterFeature): THREE.Mesh {
  const geometry = new THREE.CircleGeometry(lake.radius * 0.98, 48);
  geometry.rotateX(-Math.PI / 2);
  const material = new THREE.MeshStandardMaterial({
    color: 0x2f6f8a,
    transparent: true,
    opacity: 0.85,
    roughness: 0.15,
    metalness: 0.1,
  });
  const mesh = new THREE.Mesh(geometry, material);
  mesh.position.set(lake.center[0], WATER_LEVEL, lake.center[1]);
  return mesh;
}

/** Terrain mesh plus a water plane per lake, grouped so main.ts can add
 * everything with a single scene.add() the same way it always has. */
export function createWorld(): THREE.Group {
  const group = new THREE.Group();
  group.add(createTerrain());
  for (const lake of WATER_FEATURES) group.add(createWaterPlane(lake));
  return group;
}
