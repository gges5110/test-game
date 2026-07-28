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

interface CircleObstacle {
  x: number;
  z: number;
  radius: number;
}

/** Every standing building (both the player's and the enemy camp's), as
 * plain circles — refreshed once a frame from main.ts, since buildings get
 * placed and destroyed during play. Farms aren't included: a villager needs
 * to walk onto one to harvest it. */
let buildingObstacles: CircleObstacle[] = [];

export function setBuildingObstacles(obstacles: CircleObstacle[]) {
  buildingObstacles = obstacles;
}

/**
 * Steers a movement direction around any building the next step would walk
 * into, instead of just refusing to move — units flow around it rather than
 * pooling at the edge. Simple circular-obstacle avoidance (deflect to the
 * tangent that best keeps the original heading) rather than full
 * pathfinding, which is enough given every obstacle here is treated as a
 * plain circle.
 *
 * `ignoreNear`, when given, skips any obstacle sitting right at that point —
 * a villager walking up to dock at a building shouldn't be deflected away
 * from the very building it's heading for.
 */
export function avoidObstacleDirection(
  x: number,
  z: number,
  dirX: number,
  dirZ: number,
  lookahead: number,
  ignoreNear?: { x: number; z: number },
): { x: number; z: number } {
  for (const obstacle of buildingObstacles) {
    if (
      ignoreNear &&
      Math.hypot(obstacle.x - ignoreNear.x, obstacle.z - ignoreNear.z) < obstacle.radius + 1
    ) {
      continue;
    }

    const toCenterX = obstacle.x - x;
    const toCenterZ = obstacle.z - z;
    const distToCenter = Math.hypot(toCenterX, toCenterZ);
    // Already inside this obstacle (e.g. a villager just trained at its
    // Town Center's exact center) — let it walk out on its own heading
    // instead of deflecting, which degenerates to a zero vector right at
    // the center and would freeze the unit in place forever.
    if (distToCenter < obstacle.radius) continue;
    if (distToCenter > obstacle.radius + lookahead + 2) continue;

    const aheadX = x + dirX * lookahead;
    const aheadZ = z + dirZ * lookahead;
    const clearance = obstacle.radius + 0.5;
    if (Math.hypot(aheadX - obstacle.x, aheadZ - obstacle.z) >= clearance) continue;

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

/** Wraps the terrain mesh in a group so main.ts can add it with a single
 * scene.add() the same way it always has (previously also held water
 * planes). */
export function createWorld(): THREE.Group {
  const group = new THREE.Group();
  group.add(createTerrain());
  return group;
}
