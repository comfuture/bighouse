import { describe, expect, it } from "vitest";
import { GOMOKU_MUTE_STORAGE_KEY, GomokuAudioManager, type StorageLike } from "../src/audio";

function createMemoryStorage(initial: Record<string, string> = {}): StorageLike & { data: Record<string, string> } {
  const data: Record<string, string> = { ...initial };
  return {
    data,
    getItem(key: string) {
      return Object.prototype.hasOwnProperty.call(data, key) ? data[key]! : null;
    },
    setItem(key: string, value: string) {
      data[key] = value;
    }
  };
}

describe("GomokuAudioManager", () => {
  it("persists mute toggle state in localStorage under bighouse:gomoku:muted", () => {
    const storage = createMemoryStorage();
    const audio = new GomokuAudioManager({ storage });

    expect(audio.muted).toBe(false);
    expect(audio.toggleMute()).toBe(true);
    expect(storage.data[GOMOKU_MUTE_STORAGE_KEY]).toBe("1");

    // Re-instantiating loads the persisted muted preference
    const reloaded = new GomokuAudioManager({ storage });
    expect(reloaded.muted).toBe(true);
    expect(reloaded.toggleMute()).toBe(false);
    expect(storage.data[GOMOKU_MUTE_STORAGE_KEY]).toBe("0");

    audio.destroy();
    reloaded.destroy();
  });

  it("operates as a safe no-op when AudioContext and browser globals are unavailable", async () => {
    const audio = new GomokuAudioManager({ storage: null });
    await expect(audio.unlock()).resolves.toBeUndefined();
    expect(() => audio.playBgm("bgm_gomoku")).not.toThrow();
    expect(() => audio.playSfx("sfx_stone_place")).not.toThrow();
    expect(() => audio.playSfx("sfx_turn_chime")).not.toThrow();
    expect(() => audio.playSfx("sfx_forbidden")).not.toThrow();
    expect(() => audio.playSfx("sfx_win")).not.toThrow();
    expect(() => audio.playSfx("sfx_lose")).not.toThrow();
    expect(() => audio.playSfx("sfx_draw")).not.toThrow();
    expect(() => audio.stopBgm()).not.toThrow();
    expect(audio.toggleMute()).toBe(true);
    expect(() => audio.destroy()).not.toThrow();
  });

  it("handles storage errors gracefully without crashing", () => {
    const brokenStorage: StorageLike = {
      getItem() {
        throw new Error("storage blocked");
      },
      setItem() {
        throw new Error("storage blocked");
      }
    };
    const audio = new GomokuAudioManager({ storage: brokenStorage });
    expect(audio.muted).toBe(false);
    expect(audio.toggleMute()).toBe(true);
    audio.destroy();
  });
});
