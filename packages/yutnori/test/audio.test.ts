import { describe, expect, it } from "vitest";
import { createThrowAudio, remainingImpactDelays } from "../src/audio";
import type { YutThrow } from "../src/types";

const roll: YutThrow = { matchId: "m", rollId: "r", turnId: 1, playerId: "p", faces: [true, false, false, false], outcome: "backDo", steps: -1, startedAt: 1000, durationMs: 1800, visualSeed: 1 };

describe("shared wood-impact sound timeline", () => {
  it("schedules four short impacts during the landing phase", () => {
    const delays = remainingImpactDelays(roll, 1000);
    expect(delays).toHaveLength(4);
    expect(delays[0]).toBeGreaterThan(900);
    expect(delays.at(-1)).toBeLessThan(1800);
  });
  it("skips impacts that happened before a late listener joined", () => {
    expect(remainingImpactDelays(roll, 2300)).toEqual([122, 284]);
    expect(remainingImpactDelays(roll, 2800)).toEqual([]);
  });
});

describe("yutnori BGM & SFX audio controller", () => {
  it("preserves single-argument default and tracks independent SFX and BGM mute flags", () => {
    const audio = createThrowAudio(false);
    expect(audio.isMuted()).toBe(false);
    expect(audio.isBgmMuted()).toBe(false);

    audio.setMuted(true);
    expect(audio.isMuted()).toBe(true);
    expect(audio.isBgmMuted()).toBe(false);

    audio.setBgmMuted(true);
    expect(audio.isBgmMuted()).toBe(true);

    audio.setMuted(false);
    audio.setBgmMuted(false);
    expect(audio.isMuted()).toBe(false);
    expect(audio.isBgmMuted()).toBe(false);
    audio.destroy();
  });

  it("handles headless playback calls without AudioContext safely", () => {
    const audio = createThrowAudio(false, true);
    expect(audio.isBgmMuted()).toBe(true);
    expect(() => {
      audio.unlock();
      audio.playBgm();
      audio.play(roll, 1000);
      audio.playOutcome("yut");
      audio.playOutcome("mo");
      audio.playOutcome("backDo");
      audio.playHop();
      audio.playCapture();
      audio.playStack();
      audio.playFinish();
      audio.playVictory();
      audio.stopBgm();
      audio.destroy();
    }).not.toThrow();
  });
});
