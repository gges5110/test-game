import type { ResourceType } from "../world/resources";

type Listener = () => void;

const CAPACITY = 40;

export class Inventory {
  private counts: Record<ResourceType, number> = {
    wood: 0,
    stone: 0,
    food: 0,
  };
  private listeners: Listener[] = [];

  get capacity(): number {
    return CAPACITY;
  }

  add(type: ResourceType, amount = 1) {
    this.counts[type] = Math.min(this.counts[type] + amount, this.capacity);
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

  getAll(): Record<ResourceType, number> {
    return { ...this.counts };
  }

  /** Replaces all state at once (e.g. restoring a save). */
  restore(counts: Partial<Record<ResourceType, number>>) {
    this.counts = { wood: 0, stone: 0, food: 0, ...counts };
    this.notify();
  }

  onChange(listener: Listener) {
    this.listeners.push(listener);
  }

  private notify() {
    for (const l of this.listeners) l();
  }
}
