import type { ResourceType } from "../world/resources";

type Listener = () => void;

const BASE_CAPACITY = 20;

export class Inventory {
  private counts: Record<ResourceType, number> = {
    wood: 0,
    stone: 0,
    food: 0,
  };
  private capacityBonus = 0;
  private listeners: Listener[] = [];

  get capacity(): number {
    return BASE_CAPACITY + this.capacityBonus;
  }

  add(type: ResourceType, amount = 1) {
    this.counts[type] = Math.min(this.counts[type] + amount, this.capacity);
    this.notify();
  }

  addCapacity(amount: number) {
    this.capacityBonus += amount;
    this.notify();
  }

  has(type: ResourceType, amount: number): boolean {
    return this.counts[type] >= amount;
  }

  spend(type: ResourceType, amount: number) {
    this.counts[type] -= amount;
    this.notify();
  }

  get(type: ResourceType): number {
    return this.counts[type];
  }

  onChange(listener: Listener) {
    this.listeners.push(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}
