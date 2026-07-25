/**
 * Grid A* over the world plane.
 *
 * Deliberately hand-rolled rather than pulling in a navmesh library: our
 * navigation is effectively 2D on a heightmap, and buildings appear and vanish
 * constantly. Flipping grid cells on placement is trivial, whereas a navmesh
 * would need regenerating every time. It also keeps the module free of three.js
 * so it can be unit tested directly.
 *
 * Coordinates are world-space (metres, origin at the map centre); the grid is
 * an internal detail.
 */

export interface Point {
  x: number;
  z: number;
}

/** 8-way neighbours: [dx, dz, cost]. Diagonals cost √2. */
const NEIGHBOURS: [number, number, number][] = [
  [1, 0, 1],
  [-1, 0, 1],
  [0, 1, 1],
  [0, -1, 1],
  [1, 1, Math.SQRT2],
  [1, -1, Math.SQRT2],
  [-1, 1, Math.SQRT2],
  [-1, -1, Math.SQRT2],
];

/** Binary min-heap keyed on fScore; plain arrays were the hot spot otherwise. */
class MinHeap {
  private items: number[] = [];
  private keys: number[] = [];

  get size() {
    return this.items.length;
  }

  push(item: number, key: number) {
    this.items.push(item);
    this.keys.push(key);
    let i = this.items.length - 1;
    while (i > 0) {
      const parent = (i - 1) >> 1;
      if (this.keys[parent] <= this.keys[i]) break;
      this.swap(i, parent);
      i = parent;
    }
  }

  pop(): number {
    const top = this.items[0];
    const lastItem = this.items.pop()!;
    const lastKey = this.keys.pop()!;
    if (this.items.length > 0) {
      this.items[0] = lastItem;
      this.keys[0] = lastKey;
      let i = 0;
      for (;;) {
        const left = i * 2 + 1;
        const right = left + 1;
        let smallest = i;
        if (left < this.keys.length && this.keys[left] < this.keys[smallest]) {
          smallest = left;
        }
        if (right < this.keys.length && this.keys[right] < this.keys[smallest]) {
          smallest = right;
        }
        if (smallest === i) break;
        this.swap(i, smallest);
        i = smallest;
      }
    }
    return top;
  }

  private swap(a: number, b: number) {
    [this.items[a], this.items[b]] = [this.items[b], this.items[a]];
    [this.keys[a], this.keys[b]] = [this.keys[b], this.keys[a]];
  }
}

export class NavGrid {
  readonly cols: number;
  readonly rows: number;
  /** Count of blockers covering each cell, so overlapping buildings can be
   * removed independently without punching holes in each other. */
  private blockCount: Uint8Array;

  constructor(
    private worldSize: number,
    private cellSize: number,
  ) {
    this.cols = Math.ceil(worldSize / cellSize);
    this.rows = this.cols;
    this.blockCount = new Uint8Array(this.cols * this.rows);
  }

  private colOf(x: number): number {
    return Math.floor((x + this.worldSize / 2) / this.cellSize);
  }

  private rowOf(z: number): number {
    return Math.floor((z + this.worldSize / 2) / this.cellSize);
  }

  private centreX(col: number): number {
    return (col + 0.5) * this.cellSize - this.worldSize / 2;
  }

  private centreZ(row: number): number {
    return (row + 0.5) * this.cellSize - this.worldSize / 2;
  }

  private inBounds(col: number, row: number): boolean {
    return col >= 0 && col < this.cols && row >= 0 && row < this.rows;
  }

  private index(col: number, row: number): number {
    return row * this.cols + col;
  }

  /** Marks (or clears) a circular footprint, e.g. a building being placed. */
  setCircleBlocked(centre: Point, radius: number, blocked: boolean) {
    const minCol = this.colOf(centre.x - radius);
    const maxCol = this.colOf(centre.x + radius);
    const minRow = this.rowOf(centre.z - radius);
    const maxRow = this.rowOf(centre.z + radius);
    for (let row = minRow; row <= maxRow; row++) {
      for (let col = minCol; col <= maxCol; col++) {
        if (!this.inBounds(col, row)) continue;
        const dx = this.centreX(col) - centre.x;
        const dz = this.centreZ(row) - centre.z;
        if (dx * dx + dz * dz > radius * radius) continue;
        const i = this.index(col, row);
        if (blocked) {
          if (this.blockCount[i] < 255) this.blockCount[i]++;
        } else if (this.blockCount[i] > 0) {
          this.blockCount[i]--;
        }
      }
    }
  }

  isBlocked(point: Point): boolean {
    const col = this.colOf(point.x);
    const row = this.rowOf(point.z);
    if (!this.inBounds(col, row)) return true;
    return this.blockCount[this.index(col, row)] > 0;
  }

  /**
   * Finds a walkable route from `from` to `to`, returned as world-space
   * waypoints excluding the start. Returns null when no route exists.
   *
   * If the goal itself is blocked (told to walk into a building) it routes to
   * the nearest reachable cell instead of failing, which is what a player
   * clicking on scenery actually means.
   */
  findPath(from: Point, to: Point, maxNodes = 20000): Point[] | null {
    const startCol = this.colOf(from.x);
    const startRow = this.rowOf(from.z);
    let goalCol = this.colOf(to.x);
    let goalRow = this.rowOf(to.z);
    if (!this.inBounds(startCol, startRow)) return null;
    if (!this.inBounds(goalCol, goalRow)) return null;

    if (this.blockCount[this.index(goalCol, goalRow)] > 0) {
      const open = this.nearestOpenCell(goalCol, goalRow);
      if (!open) return null;
      [goalCol, goalRow] = open;
    }

    const start = this.index(startCol, startRow);
    const goal = this.index(goalCol, goalRow);
    if (start === goal) return [];

    const total = this.cols * this.rows;
    const gScore = new Float32Array(total).fill(Infinity);
    const cameFrom = new Int32Array(total).fill(-1);
    const closed = new Uint8Array(total);
    const heap = new MinHeap();

    gScore[start] = 0;
    heap.push(start, this.heuristic(startCol, startRow, goalCol, goalRow));

    let expanded = 0;
    while (heap.size > 0 && expanded < maxNodes) {
      const current = heap.pop();
      if (current === goal) return this.reconstruct(cameFrom, current);
      if (closed[current]) continue;
      closed[current] = 1;
      expanded++;

      const col = current % this.cols;
      const row = (current / this.cols) | 0;

      for (const [dx, dz, cost] of NEIGHBOURS) {
        const nc = col + dx;
        const nr = row + dz;
        if (!this.inBounds(nc, nr)) continue;
        const ni = this.index(nc, nr);
        if (this.blockCount[ni] > 0 || closed[ni]) continue;
        // No corner cutting: a diagonal step is only legal when *both*
        // orthogonal cells beside it are clear. Allowing it when just one is
        // blocked lets the straight line between cell centres graze the
        // corner of a building, which units visibly clip through.
        if (dx !== 0 && dz !== 0) {
          if (
            this.blockCount[this.index(col + dx, row)] > 0 ||
            this.blockCount[this.index(col, row + dz)] > 0
          ) {
            continue;
          }
        }
        const tentative = gScore[current] + cost;
        if (tentative >= gScore[ni]) continue;
        gScore[ni] = tentative;
        cameFrom[ni] = current;
        heap.push(ni, tentative + this.heuristic(nc, nr, goalCol, goalRow));
      }
    }
    return null;
  }

  /** Octile distance — the admissible heuristic for 8-way movement. */
  private heuristic(col: number, row: number, goalCol: number, goalRow: number): number {
    const dx = Math.abs(col - goalCol);
    const dz = Math.abs(row - goalRow);
    return Math.max(dx, dz) + (Math.SQRT2 - 1) * Math.min(dx, dz);
  }

  /** Spiral outward for the closest walkable cell to a blocked target. */
  private nearestOpenCell(col: number, row: number): [number, number] | null {
    for (let radius = 1; radius < 16; radius++) {
      for (let dz = -radius; dz <= radius; dz++) {
        for (let dx = -radius; dx <= radius; dx++) {
          if (Math.max(Math.abs(dx), Math.abs(dz)) !== radius) continue;
          const nc = col + dx;
          const nr = row + dz;
          if (!this.inBounds(nc, nr)) continue;
          if (this.blockCount[this.index(nc, nr)] === 0) return [nc, nr];
        }
      }
    }
    return null;
  }

  private reconstruct(cameFrom: Int32Array, goal: number): Point[] {
    const cells: number[] = [];
    for (let node = goal; node !== -1; node = cameFrom[node]) cells.push(node);
    cells.reverse();
    cells.shift(); // drop the start cell; the unit is already there

    return this.smooth(cells).map((i) => ({
      x: this.centreX(i % this.cols),
      z: this.centreZ((i / this.cols) | 0),
    }));
  }

  /**
   * Drops waypoints that lie on a straight run, so units walk in long diagonal
   * lines rather than stair-stepping cell by cell.
   */
  private smooth(cells: number[]): number[] {
    if (cells.length < 3) return cells;
    const kept: number[] = [];
    for (let i = 0; i < cells.length; i++) {
      if (i === 0 || i === cells.length - 1) {
        kept.push(cells[i]);
        continue;
      }
      const prev = cells[i - 1];
      const next = cells[i + 1];
      const dxA = (cells[i] % this.cols) - (prev % this.cols);
      const dzA = ((cells[i] / this.cols) | 0) - ((prev / this.cols) | 0);
      const dxB = (next % this.cols) - (cells[i] % this.cols);
      const dzB = ((next / this.cols) | 0) - ((cells[i] / this.cols) | 0);
      if (dxA !== dxB || dzA !== dzB) kept.push(cells[i]);
    }
    return kept;
  }
}
