import { describe, expect, it } from "vitest";
import {
  ONECARD_MUTE_STORAGE_KEY,
  OneCardAudioManager,
  type AudioStorageLike
} from "../src/audio";

function createMemoryStorage(initial: Record<string, string> = {}): AudioStorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key) {
      return key in data ? data[key]! : null;
    },
    setItem(key, value) {
      data[key] = value;
    }
  };
}

describe("OneCardAudioManager", () => {
  it("persists and restores mute state in localStorage", () => {
    const storage = createMemoryStorage();
    const first = new OneCardAudioManager(storage);
    expect(first.muted).toBe(false);

    expect(first.toggleMute()).toBe(true);
    expect(first.muted).toBe(true);
    expect(storage.data[ONECARD_MUTE_STORAGE_KEY]).toBe("1");
    first.destroy();

    const restored = new OneCardAudioManager(storage);
    expect(restored.muted).toBe(true);
    expect(restored.toggleMute()).toBe(false);
    expect(storage.data[ONECARD_MUTE_STORAGE_KEY]).toBe("0");
    restored.destroy();
  });

  it("operates safely in headless Node environments without Web Audio or working storage", async () => {
    const brokenStorage: AudioStorageLike = {
      getItem() {
        throw new Error("storage blocked");
      },
      setItem() {
        throw new Error("storage blocked");
      }
    };

    const manager = new OneCardAudioManager(brokenStorage);
    expect(manager.muted).toBe(false);

    await expect(manager.unlock()).resolves.toBeUndefined();
    expect(() => manager.playBgm("bgm_onecard")).not.toThrow();
    expect(() => manager.playSfx("sfx_card_play")).not.toThrow();
    expect(() => manager.playSfx("sfx_joker")).not.toThrow();
    expect(() => manager.playSfx("sfx_win")).not.toThrow();
    expect(manager.toggleMute()).toBe(true);
    expect(() => manager.stopBgm()).not.toThrow();
    expect(() => manager.destroy()).not.toThrow();
  });
});
