import { afterEach, describe, expect, it } from "vitest";
import { TANK_BATTLE_MUTE_STORAGE_KEY, createTankBattleAudio } from "../src/audio";

type StorageLike = {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
  clear(): void;
};

function createMemoryStorage(): StorageLike {
  const store = new Map<string, string>();
  return {
    getItem: (key) => store.get(key) ?? null,
    setItem: (key, value) => {
      store.set(key, value);
    },
    removeItem: (key) => {
      store.delete(key);
    },
    clear: () => {
      store.clear();
    }
  };
}

const originalLocalStorage = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

afterEach(() => {
  if (originalLocalStorage) {
    Object.defineProperty(globalThis, "localStorage", originalLocalStorage);
  } else {
    delete (globalThis as Record<string, unknown>).localStorage;
  }
});

describe("tank battle audio controller", () => {
  it("exposes the full controller contract and runs safely in headless Node", async () => {
    const audio = createTankBattleAudio();

    expect(audio.isMuted()).toBe(false);
    expect(await audio.unlock()).toBe(false);
    expect(await audio.resume()).toBe(false);

    expect(() => {
      audio.playGearCreak(0.6);
      audio.playLaunch();
      audio.playFlight();
      audio.stopFlight();
      audio.playTerrainExplosion();
      audio.playTankExplosion();
      audio.playItemSelect();
      audio.playVictory();
      audio.playDefeat();
      audio.destroy();
      // Calling destroy twice must remain idempotent
      audio.destroy();
    }).not.toThrow();
  });

  it("persists mute toggle state in localStorage across controller instances", () => {
    const memoryStorage = createMemoryStorage();
    Object.defineProperty(globalThis, "localStorage", {
      value: memoryStorage,
      configurable: true,
      writable: true
    });

    const first = createTankBattleAudio();
    expect(first.isMuted()).toBe(false);

    expect(first.toggleMute()).toBe(true);
    expect(first.isMuted()).toBe(true);
    expect(memoryStorage.getItem(TANK_BATTLE_MUTE_STORAGE_KEY)).toBe("1");
    first.destroy();

    const second = createTankBattleAudio();
    expect(second.isMuted()).toBe(true);
    expect(second.toggleMute()).toBe(false);
    expect(second.isMuted()).toBe(false);
    expect(memoryStorage.getItem(TANK_BATTLE_MUTE_STORAGE_KEY)).toBe("0");
    second.destroy();
  });
});
