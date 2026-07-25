import { describe, it, expect } from "vitest";
import { NavGrid, type Point } from "./pathfinding";

/** Small world so grids stay easy to reason about: 40x40 cells of 1 unit. */
function grid() {
  return new NavGrid(40, 1);
}

/**
 * Blocks exactly the cell containing a point. Cell centres sit at
 * half-integers, so a circle centred on an integer is 0.707 away from all four
 * neighbours and can silently block nothing — aim at the centre instead.
 */
function blockCell(nav: NavGrid, x: number, z: number) {
  nav.setCircleBlocked({ x: Math.floor(x) + 0.5, z: Math.floor(z) + 0.5 }, 0.3, true);
}

function pathLength(from: Point, path: Point[]): number {
  let total = 0;
  let prev = from;
  for (const p of path) {
    total += Math.hypot(p.x - prev.x, p.z - prev.z);
    prev = p;
  }
  return total;
}

/** Walks the path and asserts it never enters a blocked cell. */
function pathIsClear(nav: NavGrid, from: Point, path: Point[]): boolean {
  let prev = from;
  for (const p of path) {
    const steps = Math.ceil(Math.hypot(p.x - prev.x, p.z - prev.z) * 4);
    for (let i = 1; i <= steps; i++) {
      const t = i / steps;
      const sample = {
        x: prev.x + (p.x - prev.x) * t,
        z: prev.z + (p.z - prev.z) * t,
      };
      if (nav.isBlocked(sample)) return false;
    }
    prev = p;
  }
  return true;
}

describe("NavGrid blocking", () => {
  it("marks and clears a circular footprint", () => {
    const nav = grid();
    expect(nav.isBlocked({ x: 0, z: 0 })).toBe(false);

    nav.setCircleBlocked({ x: 0, z: 0 }, 2, true);
    expect(nav.isBlocked({ x: 0, z: 0 })).toBe(true);
    expect(nav.isBlocked({ x: 5, z: 0 })).toBe(false);

    nav.setCircleBlocked({ x: 0, z: 0 }, 2, false);
    expect(nav.isBlocked({ x: 0, z: 0 })).toBe(false);
  });

  it("keeps overlapping footprints independent", () => {
    const nav = grid();
    // Two buildings covering the same cell; removing one must not clear it.
    nav.setCircleBlocked({ x: 0, z: 0 }, 2, true);
    nav.setCircleBlocked({ x: 1, z: 0 }, 2, true);

    nav.setCircleBlocked({ x: 1, z: 0 }, 2, false);

    expect(nav.isBlocked({ x: 0, z: 0 })).toBe(true);
  });

  it("treats everything outside the world as blocked", () => {
    const nav = grid();
    expect(nav.isBlocked({ x: 500, z: 0 })).toBe(true);
  });
});

describe("NavGrid.findPath", () => {
  it("returns an empty path when already at the destination", () => {
    const nav = grid();
    expect(nav.findPath({ x: 0, z: 0 }, { x: 0.2, z: 0.2 })).toEqual([]);
  });

  it("goes essentially straight across open ground", () => {
    const nav = grid();
    const from = { x: -10, z: 0 };
    const to = { x: 10, z: 0 };

    const path = nav.findPath(from, to)!;

    expect(path).not.toBeNull();
    // Straight-line distance is 20; allow a little for cell snapping.
    expect(pathLength(from, path)).toBeLessThan(23);
    // Smoothing should collapse a straight run to very few waypoints.
    expect(path.length).toBeLessThan(4);
  });

  it("routes around a wall instead of through it", () => {
    const nav = grid();
    // Vertical wall at x=0 spanning z in [-6, 6], with gaps beyond.
    for (let z = -6; z <= 6; z++) blockCell(nav, 0, z);
    const from = { x: -5, z: 0 };
    const to = { x: 5, z: 0 };

    const path = nav.findPath(from, to)!;

    expect(path).not.toBeNull();
    expect(pathIsClear(nav, from, path)).toBe(true);
    // Detouring around a 12-long wall must cost more than the 10-unit direct line.
    expect(pathLength(from, path)).toBeGreaterThan(11);
  });

  it("returns null when the destination is walled off completely", () => {
    const nav = grid();
    // Ring the target so nothing can reach it.
    for (let angle = 0; angle < 360; angle += 10) {
      const rad = (angle * Math.PI) / 180;
      nav.setCircleBlocked(
        { x: 10 + Math.cos(rad) * 3, z: 10 + Math.sin(rad) * 3 },
        1,
        true,
      );
    }

    expect(nav.findPath({ x: -10, z: -10 }, { x: 10, z: 10 })).toBeNull();
  });

  it("walks to the edge of a blocked target rather than failing", () => {
    const nav = grid();
    // Clicking on a building should approach it, not refuse to move.
    nav.setCircleBlocked({ x: 5, z: 0 }, 2, true);

    const from = { x: -5, z: 0 };
    const path = nav.findPath(from, { x: 5, z: 0 })!;

    expect(path).not.toBeNull();
    expect(path.length).toBeGreaterThan(0);
    expect(pathIsClear(nav, from, path)).toBe(true);
  });

  it("never cuts diagonally between two blocked cells", () => {
    const nav = grid();
    // A diagonal pinch: blocking one side alone must still stop the shortcut,
    // since the straight line would graze the blocked cell's corner.
    blockCell(nav, 1, 0);

    const from = { x: 0.5, z: 0.5 };
    const path = nav.findPath(from, { x: 1.5, z: 1.5 })!;

    expect(path).not.toBeNull();
    expect(pathIsClear(nav, from, path)).toBe(true);
  });

  it("produces a clear path through a maze-like corridor", () => {
    const nav = grid();
    // Two staggered walls forcing an S-shaped route.
    for (let z = -12; z <= 4; z++) blockCell(nav, -3, z);
    for (let z = -4; z <= 12; z++) blockCell(nav, 3, z);

    const from = { x: -10, z: 0 };
    const to = { x: 10, z: 0 };
    const path = nav.findPath(from, to)!;

    expect(path).not.toBeNull();
    expect(pathIsClear(nav, from, path)).toBe(true);
  });
});
