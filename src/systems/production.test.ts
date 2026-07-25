import { describe, it, expect, beforeEach } from "vitest";
import * as THREE from "three";
import { Inventory } from "./inventory";
import { TownBuildings, type PlacedBuilding } from "./townBuildings";
import { getBuildingDef } from "./building";
import {
  MAX_QUEUE,
  enqueueUnit,
  cancelQueued,
  advanceProduction,
  contributeBuild,
  fullRepairCost,
  repairBuilding,
} from "./production";

/** Builds a real PlacedBuilding without touching the renderer. */
function place(id: string): PlacedBuilding {
  const town = new TownBuildings();
  return town.add(
    id,
    getBuildingDef(id),
    new THREE.Group(),
    new THREE.Vector3(0, 0, 0),
  );
}

let inventory: Inventory;
beforeEach(() => {
  inventory = new Inventory();
});

describe("production queue", () => {
  it("charges the unit's cost at queue time, not when training starts", () => {
    const barracks = place("barracks");
    const cost = barracks.def.trains!.foodCost;
    inventory.add("food", cost * 3);

    enqueueUnit(barracks, inventory);

    expect(barracks.queue).toHaveLength(1);
    expect(inventory.get("food")).toBe(cost * 2);
    // Nothing has begun training yet — the charge is purely for queueing.
    expect(barracks.producingUntil).toBeUndefined();
  });

  it("refuses to queue when food is short, without partially charging", () => {
    const barracks = place("barracks");
    inventory.add("food", barracks.def.trains!.foodCost - 1);

    expect(enqueueUnit(barracks, inventory)).toBe(false);
    expect(barracks.queue).toHaveLength(0);
    expect(inventory.get("food")).toBe(barracks.def.trains!.foodCost - 1);
  });

  it("caps the queue and stops charging once full", () => {
    const barracks = place("barracks");
    inventory.add("food", 999);
    for (let i = 0; i < MAX_QUEUE + 5; i++) enqueueUnit(barracks, inventory);

    expect(barracks.queue).toHaveLength(MAX_QUEUE);
    const afterFull = inventory.get("food");
    expect(enqueueUnit(barracks, inventory)).toBe(false);
    expect(inventory.get("food")).toBe(afterFull);
  });

  it("refunds the full cost when a queued unit is cancelled", () => {
    const barracks = place("barracks");
    const cost = barracks.def.trains!.foodCost;
    inventory.add("food", cost * 2);
    enqueueUnit(barracks, inventory);
    enqueueUnit(barracks, inventory);

    cancelQueued(barracks, inventory, 1);

    expect(barracks.queue).toHaveLength(1);
    expect(inventory.get("food")).toBe(cost);
  });

  it("abandons the timer when the in-progress unit is cancelled", () => {
    const barracks = place("barracks");
    inventory.add("food", 99);
    enqueueUnit(barracks, inventory);
    enqueueUnit(barracks, inventory);
    advanceProduction(barracks, 0); // starts the head of the queue
    expect(barracks.producingUntil).toBeDefined();

    cancelQueued(barracks, inventory, 0);

    // The survivor must start fresh rather than inherit the elapsed time.
    expect(barracks.producingUntil).toBeUndefined();
  });

  it("ignores cancel requests for out-of-range slots", () => {
    const barracks = place("barracks");
    inventory.add("food", 99);
    enqueueUnit(barracks, inventory);
    const before = inventory.get("food");

    expect(cancelQueued(barracks, inventory, 5)).toBe(false);
    expect(cancelQueued(barracks, inventory, -1)).toBe(false);
    expect(barracks.queue).toHaveLength(1);
    expect(inventory.get("food")).toBe(before);
  });

  it("trains queued units one at a time, in order", () => {
    const barracks = place("barracks");
    const { time } = barracks.def.trains!;
    inventory.add("food", 99);
    enqueueUnit(barracks, inventory);
    enqueueUnit(barracks, inventory);

    expect(advanceProduction(barracks, 0)).toBeNull(); // starts first
    expect(advanceProduction(barracks, time - 0.01)).toBeNull(); // still going
    expect(advanceProduction(barracks, time)).toBe("soldier"); // first done

    expect(barracks.queue).toHaveLength(1);
    expect(advanceProduction(barracks, time)).toBeNull(); // second starts
    expect(advanceProduction(barracks, time * 2)).toBe("soldier");
    expect(barracks.queue).toHaveLength(0);
  });

  it("produces nothing while the building is still under construction", () => {
    const barracks = place("barracks");
    inventory.add("food", 99);
    enqueueUnit(barracks, inventory);
    barracks.underConstruction = true;

    expect(advanceProduction(barracks, 999)).toBeNull();
    expect(barracks.queue).toHaveLength(1);
  });

  it("won't queue into an unfinished building", () => {
    const barracks = place("barracks");
    barracks.underConstruction = true;
    inventory.add("food", 99);
    const before = inventory.get("food");

    expect(enqueueUnit(barracks, inventory)).toBe(false);
    expect(inventory.get("food")).toBe(before);
  });
});

describe("construction", () => {
  it("accumulates progress in villager-seconds and completes once", () => {
    const house = place("house");
    house.underConstruction = true;
    house.buildProgress = 0;
    const buildTime = house.def.buildTime;

    expect(contributeBuild(house, buildTime / 2)).toBe(false);
    expect(house.buildProgress).toBeCloseTo(0.5);
    expect(house.underConstruction).toBe(true);

    expect(contributeBuild(house, buildTime / 2)).toBe(true);
    expect(house.underConstruction).toBe(false);
    expect(house.hp).toBe(house.maxHp);

    // Already finished — must not report completion a second time.
    expect(contributeBuild(house, 1)).toBe(false);
  });

  it("finishes proportionally faster with more builders", () => {
    const solo = place("house");
    solo.underConstruction = true;
    solo.buildProgress = 0;
    const pair = place("house");
    pair.underConstruction = true;
    pair.buildProgress = 0;

    const step = 1;
    contributeBuild(solo, step);
    contributeBuild(pair, step);
    contributeBuild(pair, step); // second builder, same tick

    expect(pair.buildProgress).toBeCloseTo(solo.buildProgress * 2);
  });

  it("keeps HP above zero while building so a site isn't already dead", () => {
    const house = place("house");
    house.underConstruction = true;
    house.buildProgress = 0;
    contributeBuild(house, 0.001);
    expect(house.hp).toBeGreaterThan(0);
  });
});

describe("repair", () => {
  it("costs nothing at full health", () => {
    const house = place("house");
    expect(fullRepairCost(house)).toBe(0);
    expect(repairBuilding(house, inventory)).toBe(0);
  });

  it("restores to full when the player can afford it", () => {
    const house = place("house");
    house.hp = house.maxHp - 40;
    inventory.add("wood", 99);

    const spent = repairBuilding(house, inventory);

    expect(spent).toBe(fullRepairCost({ ...house, hp: house.maxHp - 40 } as PlacedBuilding));
    expect(house.hp).toBe(house.maxHp);
  });

  it("repairs partially rather than refusing when wood is short", () => {
    const house = place("house");
    house.hp = 20;
    inventory.add("wood", 3);

    const spent = repairBuilding(house, inventory);

    expect(spent).toBe(3);
    expect(inventory.get("wood")).toBe(0);
    expect(house.hp).toBeGreaterThan(20);
    expect(house.hp).toBeLessThan(house.maxHp);
  });

  it("never overheals past max HP", () => {
    const house = place("house");
    house.hp = house.maxHp - 1;
    inventory.add("wood", 99);

    repairBuilding(house, inventory);

    expect(house.hp).toBe(house.maxHp);
  });

  it("does nothing with no wood at all", () => {
    const house = place("house");
    house.hp = 10;
    expect(repairBuilding(house, inventory)).toBe(0);
    expect(house.hp).toBe(10);
  });
});
