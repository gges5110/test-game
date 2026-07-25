import * as THREE from "three";
import { createNoise2D } from "simplex-noise";

export const WORLD_SIZE = 400;
const SEGMENTS = 200;
const SEED = 1337;

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
 * starting valley near the origin so spawn isn't on a slope.
 */
export function heightAt(x: number, z: number): number {
  const nx = x / WORLD_SIZE;
  const nz = z / WORLD_SIZE;

  let h = 0;
  h += noise2D(nx * 1.5, nz * 1.5) * 10;
  h += noise2D(nx * 4, nz * 4) * 3;
  h += noise2D(nx * 10, nz * 10) * 0.8;

  // Flatten a valley around spawn (origin).
  const distFromSpawn = Math.sqrt(x * x + z * z);
  const valleyFalloff = THREE.MathUtils.smoothstep(distFromSpawn, 15, 60);
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

  const material = new THREE.MeshStandardMaterial({
    vertexColors: true,
    roughness: 1,
    metalness: 0,
  });

  const mesh = new THREE.Mesh(geometry, material);
  mesh.receiveShadow = true;
  return mesh;
}
