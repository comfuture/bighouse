import { describe, expect, it } from "vitest";
import {
  CHECK_PULSE_FREQUENCY_HZ,
  CHESS_PIECES_SHEET_SPEC,
  CHESS_VFX_SHEET_SPEC,
  createCaptureShardParticles,
  createCheckEmberParticle,
  createLandingDustParticles,
  createPromotionSparkles,
  createVictoryConfettiParticles,
  evaluateCheckPulse,
  evaluatePieceTravelPose,
  evaluatePromotionBeam,
  getPieceSpriteFrame,
  getVfxSpriteFrame,
  stepParticles,
  type ChessPieceKey,
  type ChessVfxKind
} from "../src/animation";

describe("chess sprite sheet specs", () => {
  it("maps all 12 white and black pieces to unique 128x128 frames inside 768x256 sheet", () => {
    const allPieces: ChessPieceKey[] = [
      "wk",
      "wq",
      "wr",
      "wb",
      "wn",
      "wp",
      "bk",
      "bq",
      "br",
      "bb",
      "bn",
      "bp"
    ];
    const seen = new Set<string>();

    for (const key of allPieces) {
      const frame = getPieceSpriteFrame(key);
      expect(frame.sw).toBe(128);
      expect(frame.sh).toBe(128);
      expect(frame.sx).toBeGreaterThanOrEqual(0);
      expect(frame.sy).toBeGreaterThanOrEqual(0);
      expect(frame.sx + frame.sw).toBeLessThanOrEqual(CHESS_PIECES_SHEET_SPEC.width);
      expect(frame.sy + frame.sh).toBeLessThanOrEqual(CHESS_PIECES_SHEET_SPEC.height);
      expect(frame.row).toBe(key.startsWith("w") ? 0 : 1);
      const cellId = `${frame.col},${frame.row}`;
      expect(seen.has(cellId)).toBe(false);
      seen.add(cellId);
    }

    expect(seen.size).toBe(12);
  });

  it("maps all 4 VFX emblems inside 512x128 sheet", () => {
    const kinds: ChessVfxKind[] = ["legalGem", "unsafeShield", "captureBurst", "promotionCrown"];
    const cols = new Set<number>();
    for (const kind of kinds) {
      const frame = getVfxSpriteFrame(kind);
      expect(frame.sw).toBe(128);
      expect(frame.sh).toBe(128);
      expect(frame.sy).toBe(0);
      expect(frame.sx + frame.sw).toBeLessThanOrEqual(CHESS_VFX_SHEET_SPEC.width);
      cols.add(frame.col);
    }
    expect(cols.size).toBe(4);
  });
});

describe("chess piece travel pose evaluator", () => {
  it("lifts pieces along a parabolic arc and gives knights a noticeably higher jump", () => {
    const start = evaluatePieceTravelPose(0, false);
    const slidingApex = evaluatePieceTravelPose(0.41, false);
    const knightApex = evaluatePieceTravelPose(0.41, true);

    expect(start.moveProgress).toBe(0);
    expect(start.liftNorm).toBe(0);
    expect(slidingApex.liftNorm).toBeGreaterThan(0.15);
    expect(knightApex.liftNorm).toBeGreaterThan(slidingApex.liftNorm * 1.8);
    expect(knightApex.shadowScale).toBeLessThan(slidingApex.shadowScale);
    expect(Math.abs(knightApex.leanRad)).toBeGreaterThan(Math.abs(slidingApex.leanRad));
  });

  it("applies tactile landing squash and settles cleanly back to unit scale at completion", () => {
    const landingSquash = evaluatePieceTravelPose(0.91, false);
    const settled = evaluatePieceTravelPose(1, false);

    expect(landingSquash.landing).toBe(true);
    expect(landingSquash.moveProgress).toBe(1);
    expect(landingSquash.liftNorm).toBe(0);
    expect(landingSquash.scaleX).toBeGreaterThan(1.03);
    expect(landingSquash.scaleY).toBeLessThan(0.97);

    expect(settled.landing).toBe(true);
    expect(settled.scaleX).toBeCloseTo(1, 5);
    expect(settled.scaleY).toBeCloseTo(1, 5);
    expect(settled.leanRad).toBe(0);
  });
});

describe("chess VFX pulses and particle lifecycle", () => {
  it("keeps check pulse strictly within WCAG safe frequency (<= 1.8Hz)", () => {
    expect(CHECK_PULSE_FREQUENCY_HZ).toBeLessThanOrEqual(1.8);
    const p0 = evaluateCheckPulse(0);
    const p1 = evaluateCheckPulse(0.25 / CHECK_PULSE_FREQUENCY_HZ);
    expect(p0.frequencyHz).toBe(CHECK_PULSE_FREQUENCY_HZ);
    expect(p1.intensity).toBeGreaterThan(p0.intensity);
    expect(p1.glowAlpha).toBeGreaterThan(0);
    expect(p1.glowAlpha).toBeLessThanOrEqual(1);
  });

  it("evaluates promotion beam fade-in, rise, and fade-out", () => {
    const start = evaluatePromotionBeam(0);
    const mid = evaluatePromotionBeam(0.4);
    const end = evaluatePromotionBeam(1);
    expect(start.alpha).toBe(0);
    expect(mid.alpha).toBeGreaterThan(0.8);
    expect(end.alpha).toBe(0);
    expect(end.crownLiftNorm).toBeGreaterThan(mid.crownLiftNorm);
  });

  it("steps and expires landing dust, capture shards, embers, promotion sparkles, and confetti", () => {
    let particles = [
      ...createLandingDustParticles(100, 100, 64, true),
      ...createCaptureShardParticles(100, 100, 64, "b"),
      createCheckEmberParticle(100, 100, 64, 0.5),
      ...createPromotionSparkles(100, 100, 64),
      ...createVictoryConfettiParticles(512, 512, 12)
    ];

    const initialCount = particles.length;
    expect(initialCount).toBeGreaterThan(30);

    // Step 1 frame (16ms)
    const afterFrame = stepParticles(particles, 0.016);
    expect(afterFrame.length).toBe(initialCount);
    expect(afterFrame[0]!.age).toBeCloseTo(0.016, 4);

    // Step across 4 seconds in 40ms increments — all particles should cleanly expire
    particles = afterFrame;
    for (let i = 0; i < 100; i += 1) {
      particles = stepParticles(particles, 0.04);
    }
    expect(particles.length).toBe(0);
  });
});
