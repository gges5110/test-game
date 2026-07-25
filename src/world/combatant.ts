import * as THREE from "three";

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
}
