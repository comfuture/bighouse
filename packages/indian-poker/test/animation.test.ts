import { describe, expect, it } from "vitest";
import {
  CHIPS_CARDS_SHEET_SPEC,
  PLAYER_SHEET_SPEC,
  createChipVolley,
  createDustMotes,
  evaluateFlyingChip,
  evaluateGamblerPose,
  evaluatePotGlow,
  resolveGamblerAnimState,
  stepDustMotes,
  stepFlyingChips
} from "../src/animation";

describe("indian-poker sprite sheet specs", () => {
  it("defines the 6x2 gambler sprite sheet and 4x1 chips/cards sheet accurately", () => {
    expect(PLAYER_SHEET_SPEC).toMatchObject({
      frameWidth: 128,
      frameHeight: 128,
      columns: 6,
      rows: 2,
      frameCount: 12,
      characterRows: { rival: 0, challenger: 1 }
    });
    expect(Object.values(PLAYER_SHEET_SPEC.stateFrames)).toEqual([0, 1, 2, 3, 4, 5]);

    expect(CHIPS_CARDS_SHEET_SPEC).toMatchObject({
      frameWidth: 128,
      frameHeight: 128,
      columns: 4,
      rows: 1,
      frameCount: 4,
      cells: { cardBack: 0, redChipStack: 1, greenChipStack: 2, potMedallion: 3 }
    });
  });
});

describe("resolveGamblerAnimState", () => {
  it("returns idle when waiting or missing playerId", () => {
    expect(resolveGamblerAnimState({ phase: "idle", playerId: "p1" })).toBe("idle");
    expect(resolveGamblerAnimState({ phase: "betting" })).toBe("idle");
  });

  it("maps active turn, aggression, and high-pressure calls to thinking, confident, and tense", () => {
    expect(
      resolveGamblerAnimState({
        phase: "betting",
        playerId: "p1",
        currentPlayerId: "p1",
        toCall: 0,
        chips: 95,
        ante: 5,
        pot: 10
      })
    ).toBe("thinking");

    expect(
      resolveGamblerAnimState({
        phase: "betting",
        playerId: "p1",
        currentPlayerId: "p2",
        lastAggressorPlayerId: "p1",
        toCall: 0,
        chips: 75,
        ante: 5,
        pot: 30
      })
    ).toBe("confident");

    expect(
      resolveGamblerAnimState({
        phase: "betting",
        playerId: "p2",
        currentPlayerId: "p2",
        lastAggressorPlayerId: "p1",
        toCall: 30,
        chips: 80,
        ante: 5,
        pot: 40
      })
    ).toBe("tense");
  });

  it("maps showdown, fold, tie, and gameOver outcomes to win, lose, or idle", () => {
    expect(
      resolveGamblerAnimState({
        phase: "reveal",
        playerId: "p1",
        roundWinnerPlayerId: "p1",
        isTie: false
      })
    ).toBe("win");

    expect(
      resolveGamblerAnimState({
        phase: "reveal",
        playerId: "p2",
        roundWinnerPlayerId: "p1",
        isTie: false
      })
    ).toBe("lose");

    expect(
      resolveGamblerAnimState({
        phase: "reveal",
        playerId: "p1",
        foldedPlayerId: "p1",
        roundWinnerPlayerId: "p2"
      })
    ).toBe("lose");

    expect(
      resolveGamblerAnimState({
        phase: "reveal",
        playerId: "p1",
        isTie: true
      })
    ).toBe("idle");

    expect(
      resolveGamblerAnimState({
        phase: "gameOver",
        playerId: "p1",
        matchWinnerPlayerId: "p1"
      })
    ).toBe("win");

    expect(
      resolveGamblerAnimState({
        phase: "gameOver",
        playerId: "p2",
        matchWinnerPlayerId: "p1"
      })
    ).toBe("lose");
  });
});

describe("evaluateGamblerPose", () => {
  it("produces smooth volume-preserving breathing and state-appropriate transforms", () => {
    const idleA = evaluateGamblerPose("idle", 0.25);
    const idleB = evaluateGamblerPose("idle", 1.15);
    expect(idleA.frameIndex).toBe(0);
    expect(idleA.scaleX).not.toBe(idleB.scaleX);
    expect(idleA.scaleY).not.toBe(idleB.scaleY);
    expect(Math.abs(idleA.scaleX * idleA.scaleY - 1)).toBeLessThan(0.01);

    const thinking = evaluateGamblerPose("thinking", 0.6, { isTurn: true });
    expect(thinking.frameIndex).toBe(1);
    expect(thinking.offsetY).toBeLessThan(0);

    const win = evaluateGamblerPose("win", 0.35);
    expect(win.frameIndex).toBe(4);
    expect(win.offsetY).toBeLessThan(0);
    expect(win.glowAlpha).toBeGreaterThan(0.6);

    const lose = evaluateGamblerPose("lose", 0.5);
    expect(lose.frameIndex).toBe(5);
    expect(lose.offsetY).toBeGreaterThan(0);
  });

  it("zeros tremor and body motion when reducedMotion is enabled while preserving expression frames", () => {
    const tenseReduced = evaluateGamblerPose("tense", 0.42, { isTurn: true, reducedMotion: true });
    expect(tenseReduced.frameIndex).toBe(3);
    expect(tenseReduced.offsetX).toBe(0);
    expect(tenseReduced.offsetY).toBe(0);
    expect(tenseReduced.rotation).toBe(0);
    expect(tenseReduced.scaleX).toBe(1);
    expect(tenseReduced.scaleY).toBe(1);
    expect(tenseReduced.glowAlpha).toBeGreaterThan(0.5);
  });
});

describe("flying poker chip arc physics", () => {
  it("lifts chips cleanly along a parabolic arc and removes them on completion", () => {
    let chips = createChipVolley({
      startX: 100,
      startY: 400,
      endX: 200,
      endY: 200,
      count: 4,
      duration: 0.4
    });
    expect(chips).toHaveLength(4);

    // Advance half way through the first chip's flight
    chips = stepFlyingChips(chips, 0.1);
    chips = stepFlyingChips(chips, 0.1);
    const first = chips[0]!;
    const mid = evaluateFlyingChip(first);
    expect(mid.visible).toBe(true);
    expect(mid.progress).toBeCloseTo(0.5, 2);

    // Parabolic lift ensures the y coordinate arcs higher (smaller y) than linear interpolation
    const linearY = first.startY + (first.endY - first.startY) * (1 - (1 - mid.progress) ** 3);
    expect(mid.y).toBeLessThan(linearY - 20);

    // Advance until every staggered chip finishes
    for (let i = 0; i < 15; i += 1) {
      chips = stepFlyingChips(chips, 0.08);
    }
    expect(chips).toHaveLength(0);
  });
});

describe("ambient dust motes & pot glow", () => {
  it("steps and wraps dust motes cleanly within canvas dimensions", () => {
    const motes = createDustMotes(10, 320, 480);
    expect(motes).toHaveLength(10);
    const stepped = stepDustMotes(motes, 0.05, 320, 480);
    expect(stepped).toHaveLength(10);
    expect(stepped[0]!.y).not.toBe(motes[0]!.y);
  });

  it("increases pot glow and tension vignette as stakes grow", () => {
    const low = evaluatePotGlow({ pot: 10, ante: 5, startingChips: 100, phase: "betting", time: 1.0 });
    const high = evaluatePotGlow({ pot: 120, ante: 5, startingChips: 100, phase: "betting", time: 1.0 });
    expect(high.glowIntensity).toBeGreaterThan(low.glowIntensity);
    expect(high.tensionVignette).toBeGreaterThan(low.tensionVignette);
    expect(high.sparkleAlpha).toBeGreaterThan(low.sparkleAlpha);
  });
});
