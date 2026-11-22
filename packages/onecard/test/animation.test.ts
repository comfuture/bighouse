import { describe, expect, it } from "vitest";
import {
  ONECARD_ART_SHEET_SPEC,
  createDirectionSwirlState,
  createImpactSparkles,
  createSuitWaveParticles,
  createWinConfetti,
  evaluateAttackAura,
  evaluateCardFlightPose,
  getSpriteCell,
  resolveCardCenterSprite,
  resolveCardSpecialBadge,
  resolveSuitSprite,
  stepDirectionSwirl,
  stepFxParticles
} from "../src/animation";

describe("ONECARD_ART_SHEET_SPEC and sprite lookup", () => {
  it("maps every sprite key inside the 1024x256 8x2 grid of 128x128 cells", () => {
    expect(ONECARD_ART_SHEET_SPEC.width).toBe(1024);
    expect(ONECARD_ART_SHEET_SPEC.height).toBe(256);
    expect(ONECARD_ART_SHEET_SPEC.cols).toBe(8);
    expect(ONECARD_ART_SHEET_SPEC.rows).toBe(2);

    const cardBack = getSpriteCell("cardBack");
    expect(cardBack).toMatchObject({ col: 0, row: 0, x: 0, y: 0, width: 128, height: 128, bgPosXPercent: 0, bgPosYPercent: 0 });

    const sparkle = getSpriteCell("vfxSparkle");
    expect(sparkle).toMatchObject({ col: 7, row: 1, x: 896, y: 128, width: 128, height: 128, bgPosXPercent: 100, bgPosYPercent: 100 });

    const suitHeart = getSpriteCell("suitHeart");
    expect(suitHeart.x).toBe(128);
    expect(suitHeart.y).toBe(128);
    expect(suitHeart.bgPosYPercent).toBe(100);
  });

  it("resolves jokers, court ranks, wild 7, suits, and special badges", () => {
    expect(resolveCardCenterSprite("CJ")).toBe("colorJoker");
    expect(resolveCardCenterSprite("BJ")).toBe("bwJoker");
    expect(resolveCardCenterSprite("AS")).toBe("rankAce");
    expect(resolveCardCenterSprite("JH")).toBe("rankJack");
    expect(resolveCardCenterSprite("QC")).toBe("rankQueen");
    expect(resolveCardCenterSprite("KD")).toBe("rankKing");
    expect(resolveCardCenterSprite("7S")).toBe("rankSeven");
    expect(resolveCardCenterSprite("9H")).toBe("suitHeart");
    expect(resolveSuitSprite("C")).toBe("suitClub");

    expect(resolveCardSpecialBadge("2S")).toEqual({ sprite: "vfxAttack", label: "+2", kind: "attack" });
    expect(resolveCardSpecialBadge("AH")).toEqual({ sprite: "vfxAttack", label: "+3", kind: "attack" });
    expect(resolveCardSpecialBadge("BJ")).toEqual({ sprite: "vfxAttack", label: "+5", kind: "attack" });
    expect(resolveCardSpecialBadge("CJ")).toEqual({ sprite: "vfxAttack", label: "+7", kind: "attack" });
    expect(resolveCardSpecialBadge("QD")).toEqual({ sprite: "vfxReverse", label: "REV", kind: "reverse" });
    expect(resolveCardSpecialBadge("JC")).toEqual({ sprite: "vfxJump", label: "SKIP", kind: "jump" });
    expect(resolveCardSpecialBadge("KS")).toEqual({ sprite: "vfxSparkle", label: "+1", kind: "extra" });
    expect(resolveCardSpecialBadge("7D")).toEqual({ sprite: "rankSeven", label: "WILD", kind: "wild" });
    expect(resolveCardSpecialBadge("5H")).toBeNull();
  });
});

describe("evaluateCardFlightPose", () => {
  it("hits exact start and end coordinates and lifts along an arc mid-flight", () => {
    const start = evaluateCardFlightPose({
      startX: 100,
      startY: 500,
      endX: 400,
      endY: 260,
      progress: 0,
      initialTiltDeg: -6,
      finalTiltDeg: 4
    });
    expect(start.x).toBeCloseTo(100);
    expect(start.y).toBeCloseTo(500);
    expect(start.rotationDeg).toBeCloseTo(-6);
    expect(start.scale).toBeCloseTo(1);

    const mid = evaluateCardFlightPose({
      startX: 100,
      startY: 500,
      endX: 400,
      endY: 260,
      progress: 0.4,
      arcHeight: 80,
      scaleLift: 0.16
    });
    expect(mid.x).toBeGreaterThan(100);
    expect(mid.x).toBeLessThan(400);
    // Arc rises above the straight chord between start and end
    const linearY = 500 + (260 - 500) * 0.4;
    expect(mid.y).toBeLessThan(linearY);
    expect(mid.scale).toBeGreaterThan(1.05);
    expect(mid.elevation).toBeGreaterThan(0);

    const end = evaluateCardFlightPose({
      startX: 100,
      startY: 500,
      endX: 400,
      endY: 260,
      progress: 1,
      initialTiltDeg: -6,
      finalTiltDeg: 4
    });
    expect(end.x).toBeCloseTo(400);
    expect(end.y).toBeCloseTo(260);
    expect(end.rotationDeg).toBeCloseTo(4);
    expect(end.scale).toBeCloseTo(1);
    expect(end.elevation).toBeCloseTo(0);
  });

  it("clamps out-of-range and non-finite progress values safely", () => {
    const below = evaluateCardFlightPose({ startX: 10, startY: 20, endX: 90, endY: 120, progress: -2 });
    const above = evaluateCardFlightPose({ startX: 10, startY: 20, endX: 90, endY: 120, progress: 4 });
    const nanPose = evaluateCardFlightPose({ startX: 10, startY: 20, endX: 90, endY: 120, progress: Number.NaN });
    expect(below.x).toBeCloseTo(10);
    expect(below.y).toBeCloseTo(20);
    expect(above.x).toBeCloseTo(90);
    expect(above.y).toBeCloseTo(120);
    expect(nanPose.x).toBeCloseTo(10);
    expect(nanPose.y).toBeCloseTo(20);
  });
});

describe("direction swirl kinematics", () => {
  it("reverses angular velocity smoothly and emits a decaying flash burst on direction flip", () => {
    let swirl = createDirectionSwirlState("clockwise");
    expect(swirl.directionSign).toBe(1);
    expect(swirl.angularVelocity).toBeGreaterThan(0);

    // Flip to counterclockwise
    swirl = stepDirectionSwirl(swirl, "counterclockwise", 0.016, false);
    expect(swirl.directionSign).toBe(-1);
    expect(swirl.flashIntensity).toBe(1);
    expect(swirl.angularVelocity).toBeLessThan(0);

    // Step forward: flash decays smoothly and velocity settles toward counterclockwise cruise
    for (let i = 0; i < 40; i += 1) {
      swirl = stepDirectionSwirl(swirl, "counterclockwise", 0.03, false);
    }
    expect(swirl.flashIntensity).toBeLessThan(0.05);
    expect(swirl.angularVelocity).toBeLessThan(0);
    expect(swirl.angleRad).toBeGreaterThanOrEqual(0);
    expect(swirl.angleRad).toBeLessThan(Math.PI * 2);
  });

  it("keeps flash and angular speed gentle under reduced motion", () => {
    const start = createDirectionSwirlState("clockwise");
    const flipped = stepDirectionSwirl(start, "counterclockwise", 0.016, true);
    expect(flipped.flashIntensity).toBeLessThanOrEqual(0.5);
  });
});

describe("evaluateAttackAura", () => {
  it("is inactive at zero attack count and scales monotonically with stack size", () => {
    const none = evaluateAttackAura(0, 1.0);
    expect(none.active).toBe(false);
    expect(none.intensity).toBe(0);
    expect(none.arcCount).toBe(0);

    const small = evaluateAttackAura(2, 1.0);
    const medium = evaluateAttackAura(5, 1.0);
    const large = evaluateAttackAura(12, 1.0);

    expect(small.active).toBe(true);
    expect(small.intensity).toBeGreaterThan(0);
    expect(medium.intensity).toBeGreaterThan(small.intensity);
    expect(large.intensity).toBeGreaterThan(medium.intensity);
    expect(large.intensity).toBeLessThanOrEqual(1);
    expect(large.emberRate).toBeGreaterThan(small.emberRate);
    expect(large.pulse).toBeGreaterThanOrEqual(0);
    expect(large.pulse).toBeLessThanOrEqual(1);
  });
});

describe("FX particle simulation", () => {
  it("advances sparkle, suit wave, and confetti particles and prunes expired entries", () => {
    const sparkles = createImpactSparkles(200, 150, "#fbbf24", 8);
    const suitWave = createSuitWaveParticles(200, 150, "H");
    const confetti = createWinConfetti(800, 600, 16);

    expect(sparkles.length).toBe(8);
    expect(suitWave.some((p) => p.kind === "ring")).toBe(true);
    expect(suitWave.some((p) => p.spriteKey === "suitHeart")).toBe(true);
    expect(confetti.length).toBe(16);

    let active = [...sparkles, ...suitWave];
    const initialX = active[0]!.x;
    active = stepFxParticles(active, 0.04);
    expect(active[0]!.life).toBeCloseTo(0.04);
    expect(active[0]!.x).not.toBe(initialX);

    // Step past maxLife so all particles expire cleanly
    for (let i = 0; i < 40; i += 1) {
      active = stepFxParticles(active, 0.05);
    }
    expect(active).toHaveLength(0);
  });
});
