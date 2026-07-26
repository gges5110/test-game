import { describe, expect, it } from "vitest";
import {
  populationCapacity,
  HOUSE_POPULATION,
  TOWN_CENTER_POPULATION,
  POPULATION_CAP,
} from "./population";

describe("populationCapacity", () => {
  it("sums house and town center contributions", () => {
    expect(populationCapacity(2, 1)).toBe(
      2 * HOUSE_POPULATION + TOWN_CENTER_POPULATION,
    );
  });

  it("is zero with no housing", () => {
    expect(populationCapacity(0, 0)).toBe(0);
  });

  it("never exceeds the hard cap", () => {
    expect(populationCapacity(1000, 1000)).toBe(POPULATION_CAP);
  });
});
