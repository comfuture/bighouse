import { describe, expect, it } from "vitest";
import { remainingImpactDelays } from "../src/audio";
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
