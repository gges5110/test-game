import * as THREE from "three";

export interface PbrTexture {
  map: THREE.CanvasTexture;
  normalMap: THREE.CanvasTexture;
}

// Procedurally generated (canvas-drawn) PBR-style texture maps, instead of
// downloading external asset files — keeps the whole game self-contained
// and license-free, at the cost of being less detailed than hand-authored
// or photographed textures. Each material's existing `color` still tints
// these (they're drawn as near-neutral grayscale-with-variation), so
// callers just add `.map`/`.normalMap` to an existing MeshStandardMaterial.

const SIZE = 256;

function makeContext(): CanvasRenderingContext2D {
  const canvas = document.createElement("canvas");
  canvas.width = SIZE;
  canvas.height = SIZE;
  const ctx = canvas.getContext("2d")!;
  return ctx;
}

function toTexture(ctx: CanvasRenderingContext2D, srgb: boolean): THREE.CanvasTexture {
  const texture = new THREE.CanvasTexture(ctx.canvas);
  texture.wrapS = THREE.RepeatWrapping;
  texture.wrapT = THREE.RepeatWrapping;
  texture.colorSpace = srgb ? THREE.SRGBColorSpace : THREE.NoColorSpace;
  texture.needsUpdate = true;
  return texture;
}

/** Fine, seam-safe per-pixel grayscale noise (no large-scale structure, so
 * tiling never shows a boundary) blended into whatever is already drawn. */
function addPixelNoise(ctx: CanvasRenderingContext2D, amount: number) {
  const image = ctx.getImageData(0, 0, SIZE, SIZE);
  const data = image.data;
  for (let i = 0; i < data.length; i += 4) {
    const n = (Math.random() - 0.5) * amount;
    data[i] = clampByte(data[i] + n);
    data[i + 1] = clampByte(data[i + 1] + n);
    data[i + 2] = clampByte(data[i + 2] + n);
  }
  ctx.putImageData(image, 0, 0);
}

function clampByte(v: number): number {
  return Math.max(0, Math.min(255, v));
}

/** Draws a blob and its wrap-around copies at the tile edges, so blobs
 * crossing a border tile seamlessly instead of showing a hard cut. */
function drawWrappedBlob(
  ctx: CanvasRenderingContext2D,
  x: number,
  y: number,
  radius: number,
  color: string,
) {
  for (const dx of [-SIZE, 0, SIZE]) {
    for (const dy of [-SIZE, 0, SIZE]) {
      const px = x + dx;
      const py = y + dy;
      if (px + radius < 0 || px - radius > SIZE || py + radius < 0 || py - radius > SIZE) continue;
      const gradient = ctx.createRadialGradient(px, py, 0, px, py, radius);
      gradient.addColorStop(0, color);
      gradient.addColorStop(1, "rgba(0,0,0,0)");
      ctx.fillStyle = gradient;
      ctx.beginPath();
      ctx.arc(px, py, radius, 0, Math.PI * 2);
      ctx.fill();
    }
  }
}

/** Converts a grayscale height canvas into a tangent-space normal map via
 * central-difference sampling. */
function heightToNormalMap(heightCtx: CanvasRenderingContext2D, strength: number): CanvasRenderingContext2D {
  const heightData = heightCtx.getImageData(0, 0, SIZE, SIZE).data;
  const heightAt = (x: number, y: number) => {
    const xi = (x + SIZE) % SIZE;
    const yi = (y + SIZE) % SIZE;
    return heightData[(yi * SIZE + xi) * 4] / 255;
  };

  const normalCtx = makeContext();
  const out = normalCtx.createImageData(SIZE, SIZE);
  for (let y = 0; y < SIZE; y++) {
    for (let x = 0; x < SIZE; x++) {
      const hl = heightAt(x - 1, y);
      const hr = heightAt(x + 1, y);
      const hd = heightAt(x, y - 1);
      const hu = heightAt(x, y + 1);
      const nx = (hl - hr) * strength;
      const ny = (hd - hu) * strength;
      const nz = 1;
      const len = Math.sqrt(nx * nx + ny * ny + nz * nz);
      const i = (y * SIZE + x) * 4;
      out.data[i] = ((nx / len) * 0.5 + 0.5) * 255;
      out.data[i + 1] = ((ny / len) * 0.5 + 0.5) * 255;
      out.data[i + 2] = ((nz / len) * 0.5 + 0.5) * 255;
      out.data[i + 3] = 255;
    }
  }
  normalCtx.putImageData(out, 0, 0);
  return normalCtx;
}

function createGrassTexture(): PbrTexture {
  const ctx = makeContext();
  ctx.fillStyle = "#c9c9c9";
  ctx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 90; i++) {
    const shade = 150 + Math.random() * 90;
    drawWrappedBlob(
      ctx,
      Math.random() * SIZE,
      Math.random() * SIZE,
      6 + Math.random() * 14,
      `rgba(${shade},${shade},${shade},0.35)`,
    );
  }
  addPixelNoise(ctx, 26);

  const heightCtx = makeContext();
  heightCtx.fillStyle = "#808080";
  heightCtx.fillRect(0, 0, SIZE, SIZE);
  for (let i = 0; i < 140; i++) {
    const shade = 90 + Math.random() * 130;
    drawWrappedBlob(heightCtx, Math.random() * SIZE, Math.random() * SIZE, 3 + Math.random() * 5, `rgb(${shade},${shade},${shade})`);
  }
  const normalCtx = heightToNormalMap(heightCtx, 1.2);

  return { map: toTexture(ctx, true), normalMap: toTexture(normalCtx, false) };
}

function createWoodTexture(): PbrTexture {
  const ctx = makeContext();
  ctx.fillStyle = "#c4c4c4";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Vertical grain streaks.
  for (let x = 0; x < SIZE; x += 3) {
    const shade = 165 + Math.sin(x * 0.15) * 20 + (Math.random() - 0.5) * 20;
    ctx.fillStyle = `rgba(${shade},${shade},${shade},0.5)`;
    ctx.fillRect(x, 0, 2, SIZE);
  }
  // A few knots.
  for (let i = 0; i < 4; i++) {
    drawWrappedBlob(ctx, Math.random() * SIZE, Math.random() * SIZE, 4 + Math.random() * 5, "rgba(90,90,90,0.5)");
  }
  addPixelNoise(ctx, 14);

  const heightCtx = makeContext();
  heightCtx.fillStyle = "#808080";
  heightCtx.fillRect(0, 0, SIZE, SIZE);
  for (let x = 0; x < SIZE; x += 3) {
    const shade = 110 + Math.sin(x * 0.15) * 60;
    heightCtx.fillStyle = `rgb(${shade},${shade},${shade})`;
    heightCtx.fillRect(x, 0, 2, SIZE);
  }
  const normalCtx = heightToNormalMap(heightCtx, 1.5);

  return { map: toTexture(ctx, true), normalMap: toTexture(normalCtx, false) };
}

function createStoneTexture(): PbrTexture {
  const ctx = makeContext();
  ctx.fillStyle = "#b0b0b0";
  ctx.fillRect(0, 0, SIZE, SIZE);
  // Blocky mortar-line grid.
  const blockSize = 32;
  ctx.strokeStyle = "rgba(70,70,70,0.4)";
  ctx.lineWidth = 2;
  for (let x = 0; x <= SIZE; x += blockSize) {
    ctx.beginPath();
    ctx.moveTo(x, 0);
    ctx.lineTo(x, SIZE);
    ctx.stroke();
  }
  for (let y = 0; y <= SIZE; y += blockSize) {
    ctx.beginPath();
    ctx.moveTo(0, y);
    ctx.lineTo(SIZE, y);
    ctx.stroke();
  }
  for (let i = 0; i < 60; i++) {
    const shade = 130 + Math.random() * 90;
    drawWrappedBlob(ctx, Math.random() * SIZE, Math.random() * SIZE, 3 + Math.random() * 6, `rgba(${shade},${shade},${shade},0.4)`);
  }
  addPixelNoise(ctx, 18);

  const heightCtx = makeContext();
  heightCtx.fillStyle = "#a0a0a0";
  heightCtx.fillRect(0, 0, SIZE, SIZE);
  heightCtx.strokeStyle = "rgb(50,50,50)";
  heightCtx.lineWidth = 2;
  for (let x = 0; x <= SIZE; x += blockSize) {
    heightCtx.beginPath();
    heightCtx.moveTo(x, 0);
    heightCtx.lineTo(x, SIZE);
    heightCtx.stroke();
  }
  for (let y = 0; y <= SIZE; y += blockSize) {
    heightCtx.beginPath();
    heightCtx.moveTo(0, y);
    heightCtx.lineTo(SIZE, y);
    heightCtx.stroke();
  }
  const normalCtx = heightToNormalMap(heightCtx, 2.5);

  return { map: toTexture(ctx, true), normalMap: toTexture(normalCtx, false) };
}

// Generated once and shared across every material that uses them.
export const TEXTURES = {
  grass: createGrassTexture(),
  wood: createWoodTexture(),
  stone: createStoneTexture(),
};
