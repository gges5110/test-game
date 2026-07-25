import type { ResourceType } from "../world/resources";

const STORAGE_KEY = "explore-craft-save-v1";

export interface SavedBuilding {
  type: string;
  x: number;
  z: number;
  hp: number;
}

export interface SavedVillager {
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
}

export interface SavedSoldier {
  x: number;
  z: number;
  homeX: number;
  homeZ: number;
}

export interface SaveData {
  version: 1;
  inventory: Partial<Record<ResourceType, number>>;
  capacityBonus: number;
  built: Record<string, number>;
  crafted: Record<string, number>;
  buildings: SavedBuilding[];
  villagers: SavedVillager[];
  soldiers: SavedSoldier[];
  waveNumber: number;
}

export function saveGame(data: SaveData) {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(data));
  } catch {
    // Storage full/unavailable — losing autosave isn't worth surfacing an error over.
  }
}

export function loadGame(): SaveData | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    const data = JSON.parse(raw);
    return data?.version === 1 ? (data as SaveData) : null;
  } catch {
    return null;
  }
}

export function clearSave() {
  try {
    localStorage.removeItem(STORAGE_KEY);
  } catch {
    // ignore
  }
}
