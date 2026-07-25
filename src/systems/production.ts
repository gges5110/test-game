import type { Inventory } from "./inventory";
import type { PlacedBuilding } from "./townBuildings";
import type { UnitKind } from "../world/soldier";

/** How many units a single building may have pending. */
export const MAX_QUEUE = 10;

/** Wood per point of HP restored when repairing. */
export const REPAIR_WOOD_PER_HP = 0.25;

/**
 * Production, construction and repair rules, kept free of rendering and
 * global state so they can be exercised directly in tests. These are the
 * parts of the game with real bookkeeping (resources charged and refunded,
 * progress accumulating, queues draining) where mistakes are invisible on
 * screen until they've already cost the player something.
 */

/**
 * Queues a unit, charging its cost immediately — AoE2 deducts at queue time,
 * not when training begins, so a deep queue locks resources up front.
 * Returns whether it was queued.
 */
export function enqueueUnit(
  building: PlacedBuilding,
  inventory: Inventory,
): boolean {
  const trains = building.def.trains;
  if (!trains) return false;
  if (building.underConstruction) return false;
  if (building.queue.length >= MAX_QUEUE) return false;
  if (!inventory.has("food", trains.foodCost)) return false;
  inventory.spend("food", trains.foodCost);
  building.queue.push(trains.unit);
  return true;
}

/**
 * Removes a queued unit and refunds it. Cancelling the one in progress also
 * abandons its timer so the next in line starts fresh rather than inheriting
 * the elapsed time.
 */
export function cancelQueued(
  building: PlacedBuilding,
  inventory: Inventory,
  index: number,
): boolean {
  const trains = building.def.trains;
  if (!trains) return false;
  if (index < 0 || index >= building.queue.length) return false;
  building.queue.splice(index, 1);
  inventory.add("food", trains.foodCost);
  if (index === 0) building.producingUntil = undefined;
  return true;
}

/**
 * Drives a building's queue. Starts the next unit when idle, and returns the
 * finished unit on the tick it completes (otherwise null).
 */
export function advanceProduction(
  building: PlacedBuilding,
  now: number,
): UnitKind | "villager" | null {
  const trains = building.def.trains;
  if (!trains || building.underConstruction) return null;

  if (building.producingUntil === undefined && building.queue.length > 0) {
    building.producingUntil = now + trains.time;
  }
  if (building.producingUntil !== undefined && now >= building.producingUntil) {
    const unit = building.queue.shift() ?? null;
    building.producingUntil = undefined;
    return unit;
  }
  return null;
}

/**
 * Applies one villager's worth of construction work. Progress is measured in
 * villager-seconds, so N builders on a site advance it N times faster.
 * Returns true on the tick construction completes.
 */
export function contributeBuild(
  building: PlacedBuilding,
  delta: number,
): boolean {
  if (!building.underConstruction) return false;
  building.buildProgress += delta / building.def.buildTime;
  if (building.buildProgress >= 1) {
    building.buildProgress = 1;
    building.underConstruction = false;
    building.hp = building.maxHp;
    return true;
  }
  building.hp = Math.max(1, building.maxHp * building.buildProgress);
  return false;
}

/** Wood needed to bring a building back to full HP. */
export function fullRepairCost(building: PlacedBuilding): number {
  const missing = building.maxHp - building.hp;
  if (missing <= 0) return 0;
  return Math.max(1, Math.ceil(missing * REPAIR_WOOD_PER_HP));
}

/**
 * Repairs as far as the player can currently afford, rather than being
 * all-or-nothing: it spends whatever wood is available up to the full cost
 * and heals proportionally. Returns the wood actually spent.
 */
export function repairBuilding(
  building: PlacedBuilding,
  inventory: Inventory,
): number {
  const fullCost = fullRepairCost(building);
  if (fullCost === 0) return 0;
  const spend = Math.min(fullCost, inventory.get("wood"));
  if (spend <= 0) return 0;
  inventory.spend("wood", spend);
  const healed = spend / REPAIR_WOOD_PER_HP;
  building.hp = Math.min(building.maxHp, building.hp + healed);
  return spend;
}
