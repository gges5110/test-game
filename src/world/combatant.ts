import * as THREE from "three";

/**
 * A combat role in the rock-paper-scissors triangle: Soldier beats Archer
 * (closes the distance before it can kite), Archer beats Scout (punishes a
 * fast melee attacker that can't shoot back), Scout beats Soldier (outruns
 * and outlasts a slower, harder-hitting brawler). Defined here (not in
 * soldier.ts) so this module — imported by both Soldier and EnemyGuard — has
 * no dependency on either.
 */
export type CombatRole = "soldier" | "archer" | "scout";

const COUNTERS: Record<CombatRole, CombatRole> = {
  soldier: "archer",
  archer: "scout",
  scout: "soldier",
};

/** Bonus damage multiplier when the attacker's role counters the target's. */
export const COUNTER_DAMAGE_MULTIPLIER = 1.5;

/**
 * Anything a Soldier can be ordered (or auto-) to fight: a wolf, a hostile
 * guard, or a destructible structure. Deliberately structural (no shared base
 * class) so existing types like Wolf satisfy it without any changes — a
 * plain object literal with these three members works too, which is how
 * EnemyBuilding qualifies without being a class at all.
 */
export interface Combatant {
  model: THREE.Group;
  alive: boolean;
  takeDamage(amount: number): boolean;
  /** What this counts as for the rock-paper-scissors triangle, if anything —
   * omitted for villagers and buildings, which the triangle doesn't apply
   * to (neither side gets a bonus fighting them). */
  combatRole?: CombatRole;
}

/** How much damage a hit actually deals once role counters are applied —
 * 1x unless the attacker's role explicitly counters the target's. */
export function counterMultiplier(
  attackerRole: CombatRole | undefined,
  targetRole: CombatRole | undefined,
): number {
  if (!attackerRole || !targetRole) return 1;
  return COUNTERS[attackerRole] === targetRole ? COUNTER_DAMAGE_MULTIPLIER : 1;
}

/** What `role` deals bonus damage to. */
export function beats(role: CombatRole): CombatRole {
  return COUNTERS[role];
}

/** What deals bonus damage to `role`. */
export function counteredBy(role: CombatRole): CombatRole {
  return (Object.keys(COUNTERS) as CombatRole[]).find((r) => COUNTERS[r] === role)!;
}
