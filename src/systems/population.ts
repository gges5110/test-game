/** Hard ceiling on total population (villagers + soldiers), regardless of
 * how much housing is built — mirrors AoE2's fixed population cap. */
export const POPULATION_CAP = 200;

/** Each House and Town Center raises the population capacity, up to the cap. */
export const HOUSE_POPULATION = 5;
export const TOWN_CENTER_POPULATION = 5;

export function populationCapacity(
  houseCount: number,
  townCenterCount: number,
): number {
  return Math.min(
    POPULATION_CAP,
    houseCount * HOUSE_POPULATION + townCenterCount * TOWN_CENTER_POPULATION,
  );
}
