import { describe, expect, it } from "vitest";
import {
  YUT_PIECES_SHEET_SPEC,
  createAmbientPetal,
  evaluatePieceHopPose,
  evaluateSpecialNodePulse,
  getPieceSheetFrame,
  planMoveFeedback,
  planSequenceFeedback,
  spawnCaptureBurst,
  spawnFinishConfetti,
  spawnHopTrail,
  spawnStackAura,
  spawnVictoryShower,
  stepParticles
} from "../src/animation";
import type { MoveSequence, YutMove } from "../src/types";

describe("yutnori sprite sheet and pose evaluators", () => {
  it("defines the 4x2 illustrated mal pieces sprite sheet at 128x128 per cell", () => {
    expect(YUT_PIECES_SHEET_SPEC).toMatchObject({
      cellWidth: 128,
      cellHeight: 128,
      columns: 4,
      rows: 2,
      sheetWidth: 512,
      sheetHeight: 256
    });
    expect(getPieceSheetFrame("A", "idle")).toEqual({ col: 0, row: 0, sx: 0, sy: 0, sw: 128, sh: 128 });
    expect(getPieceSheetFrame("A", "crown")).toEqual({ col: 2, row: 0, sx: 256, sy: 0, sw: 128, sh: 128 });
    expect(getPieceSheetFrame("A", "effect")).toEqual({ col: 3, row: 0, sx: 384, sy: 0, sw: 128, sh: 128 });
    expect(getPieceSheetFrame("B", "hop")).toEqual({ col: 1, row: 1, sx: 128, sy: 128, sw: 128, sh: 128 });
    expect(getPieceSheetFrame("B", "effect")).toEqual({ col: 3, row: 1, sx: 384, sy: 128, sw: 128, sh: 128 });
  });

  it("evaluates hop arc lift with takeoff squash, mid-air stretch, and landing cushion", () => {
    const start = evaluatePieceHopPose(0);
    const end = evaluatePieceHopPose(1);
    expect(start).toEqual({ liftPx: 0, scaleX: 1, scaleY: 1, tiltDeg: 0, shadowScale: 1 });
    expect(end).toEqual({ liftPx: 0, scaleX: 1, scaleY: 1, tiltDeg: 0, shadowScale: 1 });

    // Takeoff anticipation squash
    const takeoff = evaluatePieceHopPose(0.08);
    expect(takeoff.liftPx).toBe(0);
    expect(takeoff.scaleX).toBeGreaterThan(1);
    expect(takeoff.scaleY).toBeLessThan(1);

    // Mid-air parabolic peak
    const peak = evaluatePieceHopPose(0.5, 20);
    expect(peak.liftPx).toBeCloseTo(20, 4);
    expect(peak.scaleY).toBeGreaterThan(1);
    expect(peak.scaleX).toBeLessThan(1);
    expect(peak.shadowScale).toBeLessThan(0.75);

    // Landing cushion squash
    const landing = evaluatePieceHopPose(0.92);
    expect(landing.liftPx).toBe(0);
    expect(landing.scaleX).toBeGreaterThan(1);
    expect(landing.scaleY).toBeLessThan(1);

    // Out-of-bounds and non-finite inputs clamp cleanly
    expect(evaluatePieceHopPose(-5)).toEqual(start);
    expect(evaluatePieceHopPose(42)).toEqual(end);
    expect(evaluatePieceHopPose(Number.NaN)).toEqual(start);
  });

  it("evaluates bounded special node pulse values across time", () => {
    for (const t of [-2.5, 0, 0.4, 1.35, 9.8, Number.NaN]) {
      const pulse = evaluateSpecialNodePulse(t, 0.7);
      expect(pulse.ringScale).toBeGreaterThanOrEqual(0.92);
      expect(pulse.ringScale).toBeLessThanOrEqual(1.51);
      expect(pulse.ringAlpha).toBeGreaterThanOrEqual(0);
      expect(pulse.ringAlpha).toBeLessThanOrEqual(0.55);
      expect(pulse.glowAlpha).toBeGreaterThanOrEqual(0.2);
      expect(pulse.glowAlpha).toBeLessThanOrEqual(0.55);
    }
  });
});

describe("yutnori board FX particles", () => {
  it("spawns structured capture, stack, hop, finish, and victory particle bursts", () => {
    const capture = spawnCaptureBurst(120, 140, "A", 7);
    expect(capture.some((p) => p.kind === "clash")).toBe(true);
    expect(capture.filter((p) => p.kind === "ring")).toHaveLength(2);
    expect(capture.filter((p) => p.kind === "spark").length).toBeGreaterThanOrEqual(15);

    const stack = spawnStackAura(200, 180, "B", 11);
    expect(stack.some((p) => p.kind === "aura")).toBe(true);
    expect(stack.some((p) => p.kind === "ring")).toBe(true);
    expect(stack.filter((p) => p.kind === "spark").length).toBeGreaterThanOrEqual(10);

    const hop = spawnHopTrail(80, 90, "A", 19);
    expect(hop.some((p) => p.kind === "dust")).toBe(true);
    expect(hop.some((p) => p.kind === "spark")).toBe(true);

    const finish = spawnFinishConfetti(300, 300, "A", 23);
    expect(finish.some((p) => p.kind === "aura")).toBe(true);
    expect(finish.some((p) => p.kind === "confetti")).toBe(true);
    expect(finish.some((p) => p.kind === "petal")).toBe(true);

    const victory = spawnVictoryShower(500, 500, "B", 29);
    expect(victory.length).toBeGreaterThanOrEqual(40);
  });

  it("steps particles with clamped dt, removes expired items, and wraps ambient petals", () => {
    const petal = createAmbientPetal(400, 400, 42, true);
    const edgePetal = { ...petal, x: 422, vx: 60, swayAmp: 0 };
    const stepped = stepParticles([edgePetal], 0.05, { width: 400, height: 400 });
    expect(stepped).toHaveLength(1);
    expect(stepped[0]!.x).toBe(-20);
    expect(edgePetal.x).toBe(422); // Does not mutate original

    const burst = spawnHopTrail(100, 100, "A", 5);
    const shortLived = burst.map((p) => ({ ...p, life: 0.04 }));
    // Large dt is clamped to 0.05s, which expires particles with life 0.04s
    expect(stepParticles(shortLived, 5.0)).toHaveLength(0);
  });
});

describe("move feedback timeline synchronization", () => {
  const firstMove: YutMove = {
    matchId: "m1",
    turnId: 1,
    playerId: "a",
    startedAt: 1000,
    rollId: "r1",
    pieceId: "A1",
    pieceIds: ["A1"],
    pathId: "outer",
    path: ["o1", "o2"],
    destination: "o2",
    capturedPieceIds: [],
    stackedPieceIds: ["A2"],
    completedPieceIds: []
  };
  const secondMove: YutMove = {
    matchId: "m1",
    turnId: 1,
    playerId: "a",
    startedAt: 1460,
    rollId: "r2",
    pieceId: "A1",
    pieceIds: ["A1", "A2"],
    pathId: "outer",
    path: ["o3", "o4", "o5"],
    destination: "o5",
    capturedPieceIds: ["B1"],
    stackedPieceIds: [],
    completedPieceIds: []
  };
  const sequence: MoveSequence = {
    sequenceId: "seq-1",
    startedAt: 1000,
    durationMs: 460 + 1190,
    moves: [firstMove, secondMove]
  };

  it("skips completed moves and subtracts elapsed time from remaining hop and arrival delays on late sequences", () => {
    // Received 140ms into secondMove (firstMove ended at 1460ms)
    const events = planSequenceFeedback(sequence, 1600);
    expect(events).toEqual([
      { delayMs: 40, kind: "hop-sfx", nodeId: "o4", pieceId: "A1" },
      { delayMs: 40, kind: "hop", nodeId: "o4", pieceId: "A1" },
      { delayMs: 220, kind: "hop", nodeId: "o5", pieceId: "A1" },
      { delayMs: 400, kind: "capture", nodeId: "o5", pieceId: "A1" }
    ]);
    // No replayed stack or hops from the already-completed firstMove
    expect(events.some((e) => e.kind === "stack" || e.nodeId === "o1" || e.nodeId === "o2")).toBe(false);
  });

  it("schedules only remaining arrival feedback when a move is already past its hop timestamps", () => {
    // standalone firstMove: startedAt=1000, travelMs=360, hops at 1000 & 1180, arrival at 1360
    expect(planMoveFeedback(firstMove, 1000, 1240)).toEqual([
      { delayMs: 120, kind: "stack", nodeId: "o2", pieceId: "A1" }
    ]);
    // After arrival (1360), no arrival or hop feedback is replayed
    expect(planMoveFeedback(firstMove, 1000, 1380)).toEqual([]);
    // After the entire sequence finishes, nothing is scheduled
    expect(planSequenceFeedback(sequence, sequence.startedAt + sequence.durationMs)).toEqual([]);
  });

  it("schedules full hops and arrival cues in order when a sequence arrives on time", () => {
    const events = planSequenceFeedback(sequence, 1000);
    expect(events).toEqual([
      { delayMs: 0, kind: "hop-sfx", nodeId: "o1", pieceId: "A1" },
      { delayMs: 0, kind: "hop", nodeId: "o1", pieceId: "A1" },
      { delayMs: 180, kind: "hop", nodeId: "o2", pieceId: "A1" },
      { delayMs: 360, kind: "stack", nodeId: "o2", pieceId: "A1" },
      { delayMs: 460, kind: "hop-sfx", nodeId: "o3", pieceId: "A1" },
      { delayMs: 460, kind: "hop", nodeId: "o3", pieceId: "A1" },
      { delayMs: 640, kind: "hop", nodeId: "o4", pieceId: "A1" },
      { delayMs: 820, kind: "hop", nodeId: "o5", pieceId: "A1" },
      { delayMs: 1000, kind: "capture", nodeId: "o5", pieceId: "A1" }
    ]);
  });
});
