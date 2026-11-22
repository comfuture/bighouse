import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { INDIAN_POKER_MUTE_STORAGE_KEY, IndianPokerAudioManager } from "../src/audio";

function createMemoryStorage(): Storage {
  const store = new Map<string, string>();
  return {
    get length() {
      return store.size;
    },
    clear() {
      store.clear();
    },
    getItem(key: string) {
      return store.get(key) ?? null;
    },
    key(index: number) {
      return Array.from(store.keys())[index] ?? null;
    },
    removeItem(key: string) {
      store.delete(key);
    },
    setItem(key: string, value: string) {
      store.set(key, value);
    }
  };
}

describe("IndianPokerAudioManager", () => {
  const originalStorageDescriptor = Object.getOwnPropertyDescriptor(globalThis, "localStorage");

  beforeEach(() => {
    Object.defineProperty(globalThis, "localStorage", {
      value: createMemoryStorage(),
      configurable: true,
      writable: true
    });
  });

  afterEach(() => {
    if (originalStorageDescriptor) {
      Object.defineProperty(globalThis, "localStorage", originalStorageDescriptor);
    } else {
      Reflect.deleteProperty(globalThis, "localStorage");
    }
  });

  it("persists mute toggle state in localStorage across instances", () => {
    const first = new IndianPokerAudioManager();
    expect(first.muted).toBe(false);

    expect(first.toggleMute()).toBe(true);
    expect(globalThis.localStorage.getItem(INDIAN_POKER_MUTE_STORAGE_KEY)).toBe("1");

    const second = new IndianPokerAudioManager();
    expect(second.muted).toBe(true);

    expect(second.toggleMute()).toBe(false);
    expect(globalThis.localStorage.getItem(INDIAN_POKER_MUTE_STORAGE_KEY)).toBe("0");

    first.destroy();
    second.destroy();
  });

  it("falls back safely in headless environments without AudioContext or window", async () => {
    const manager = new IndianPokerAudioManager();

    await expect(manager.unlock()).resolves.toBeUndefined();
    expect(() => manager.playBgm("bgm_indian_poker")).not.toThrow();
    expect(() => manager.playSfx("sfx_deal")).not.toThrow();
    expect(() => manager.playSfx("sfx_chip_stack")).not.toThrow();
    expect(() => manager.playSfx("sfx_all_in")).not.toThrow();
    expect(() => manager.playSfx("sfx_pot_win")).not.toThrow();
    expect(() => manager.stopBgm()).not.toThrow();
    expect(() => manager.destroy()).not.toThrow();
  });
});
