import type { ResourceType } from "../world/resources";

type Listener = () => void;

export class Inventory {
  private counts: Record<ResourceType, number> = {
    wood: 0,
    stone: 0,
    fiber: 0,
  };
  private listeners: Listener[] = [];

  add(type: ResourceType, amount = 1) {
    this.counts[type] += amount;
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
