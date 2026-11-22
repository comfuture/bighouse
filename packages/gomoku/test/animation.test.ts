import { describe, expect, it } from "vitest";
import {
  GOMOKU_STONES_SHEET_SPEC,
  GOMOKU_STONE_FRAMES,
  PLACEMENT_RIPPLE_DURATION_SEC,
  STONE_DROP_DURATION_SEC,
  WINNING_BEAM_DURATION_SEC,
  createAmbientPetals,
  createPlacementBurstParticles,
  createVictoryPetalShower,
  evaluateHoverPulse,
  evaluateLastMoveHalo,
  evaluateParticleAlpha,
  evaluatePlacementRipple,
  evaluateStoneDropPose,
  evaluateWinningBeam,
  findWinningLine,
  getHoshiPoints,
  getStoneFrameIndex,
  stepParticles
} from "../src/animation";
import { emptyBoard, type Board } from "../src/rules";

function withStones(stones: Array<[number, number, "black" | "white"]>): Board {
  const board = emptyBoard();
  for (const [x, y, stone] of stones) {
    board[y]![x] = stone;
  }
  return board;
}

describe("gomoku animation", () => {
  it("defines a 4-frame 128x128 stones sprite sheet spec", () => {
    expect(GOMOKU_STONES_SHEET_SPEC).toEqual({
      frameWidth: 128,
      frameHeight: 128,
      frameCount: 4
    });
    expect(getStoneFrameIndex("black")).toBe(GOMOKU_STONE_FRAMES.black);
    expect(getStoneFrameIndex("white")).toBe(GOMOKU_STONE_FRAMES.white);
  });

  it("evaluates stone drop squash/stretch and settles cleanly to scale 1", () => {
    const start = evaluateStoneDropPose(0);
    expect(start.settled).toBe(false);
    expect(start.offsetY).toBeLessThan(0);
    expect(start.scaleX * start.scaleY).toBeCloseTo(1, 3);

    // Shortly after board contact (~0.12s): tactile squash (wider, flatter) preserving volume
    const impact = evaluateStoneDropPose(0.12);
    expect(impact.settled).toBe(false);
    expect(impact.scaleX).toBeGreaterThan(1);
    expect(impact.scaleY).toBeLessThan(1);
    expect(impact.scaleX * impact.scaleY).toBeCloseTo(1, 3);

    // Fully settled after duration
    const settled = evaluateStoneDropPose(STONE_DROP_DURATION_SEC);
    expect(settled).toEqual({
      scaleX: 1,
      scaleY: 1,
      offsetY: 0,
      shadowScale: 1,
      shadowAlpha: 1,
      opacity: 1,
      settled: true
    });

    // Reduced motion jumps straight to crisp settled state
    expect(evaluateStoneDropPose(0.02, true)).toEqual(settled);
  });

  it("evaluates placement ripple, hover pulse, halo, and winning beam with reduced-motion support", () => {
    const midRipple = evaluatePlacementRipple(PLACEMENT_RIPPLE_DURATION_SEC * 0.4);
    expect(midRipple.active).toBe(true);
    expect(midRipple.alpha).toBeGreaterThan(0);
    expect(midRipple.radiusRatio).toBeGreaterThan(0.5);
    expect(evaluatePlacementRipple(PLACEMENT_RIPPLE_DURATION_SEC).active).toBe(false);
    expect(evaluatePlacementRipple(0.1, true).active).toBe(false);

    const staticHover = evaluateHoverPulse(1.25, true);
    expect(staticHover).toEqual(evaluateHoverPulse(9.75, true));
    const liveHover = evaluateHoverPulse(0.5, false);
    expect(liveHover.alpha).toBeGreaterThan(0.2);
    expect(liveHover.alpha).toBeLessThanOrEqual(0.6);

    const staticHalo = evaluateLastMoveHalo(2.0, true);
    expect(staticHalo.rotation).toBe(0);
    expect(staticHalo.scale).toBe(1);

    const beamStart = evaluateWinningBeam(0, 0, false);
    const beamDone = evaluateWinningBeam(WINNING_BEAM_DURATION_SEC, 1.0, false);
    const beamReduced = evaluateWinningBeam(0, 0, true);
    expect(beamStart.progress).toBe(0);
    expect(beamDone.progress).toBe(1);
    expect(beamReduced.progress).toBe(1);
  });

  it("detects winning 5-in-a-row lines across horizontal, vertical, and both diagonals", () => {
    expect(findWinningLine(emptyBoard())).toBeNull();

    // Horizontal
    const horiz = findWinningLine(
      withStones([
        [2, 5, "black"],
        [3, 5, "black"],
        [4, 5, "black"],
        [5, 5, "black"],
        [6, 5, "black"]
      ])
    );
    expect(horiz).toEqual({
      stone: "black",
      points: [
        { x: 2, y: 5 },
        { x: 3, y: 5 },
        { x: 4, y: 5 },
        { x: 5, y: 5 },
        { x: 6, y: 5 }
      ]
    });

    // Vertical
    const vert = findWinningLine(
      withStones([
        [9, 3, "white"],
        [9, 4, "white"],
        [9, 5, "white"],
        [9, 6, "white"],
        [9, 7, "white"]
      ])
    );
    expect(vert?.stone).toBe("white");
    expect(vert?.points).toHaveLength(5);
    expect(vert?.points[0]).toEqual({ x: 9, y: 3 });
    expect(vert?.points[4]).toEqual({ x: 9, y: 7 });

    // Main diagonal (\)
    const diagMain = findWinningLine(
      withStones([
        [4, 4, "black"],
        [5, 5, "black"],
        [6, 6, "black"],
        [7, 7, "black"],
        [8, 8, "black"]
      ])
    );
    expect(diagMain?.points).toEqual([
      { x: 4, y: 4 },
      { x: 5, y: 5 },
      { x: 6, y: 6 },
      { x: 7, y: 7 },
      { x: 8, y: 8 }
    ]);

    // Anti-diagonal (/) with 6 stones
    const diagAnti = findWinningLine(
      withStones([
        [10, 2, "white"],
        [9, 3, "white"],
        [8, 4, "white"],
        [7, 5, "white"],
        [6, 6, "white"],
        [5, 7, "white"]
      ]),
      { x: 7, y: 5 }
    );
    expect(diagAnti?.stone).toBe("white");
    expect(diagAnti?.points).toHaveLength(6);
  });

  it("returns traditional Hoshi star points for standard goban sizes", () => {
    expect(getHoshiPoints(15)).toHaveLength(5);
    expect(getHoshiPoints(15)).toContainEqual({ x: 7, y: 7 });
    expect(getHoshiPoints(19)).toHaveLength(9);
    expect(getHoshiPoints(9)).toHaveLength(5);
  });

  it("advances ambient petals indefinitely and expires finite burst/victory particles", () => {
    const ambient = createAmbientPetals(5, 101);
    const bursts = createPlacementBurstParticles(0.5, 0.5, 4, 202);
    const victory = createVictoryPetalShower(
      [
        { x: 0.3, y: 0.3 },
        { x: 0.7, y: 0.7 }
      ],
      6,
      303
    );

    let particles = [...ambient, ...bursts, ...victory];
    expect(particles).toHaveLength(15);

    // Step 0.1s: all still active and moved
    particles = stepParticles(particles, 0.1);
    expect(particles).toHaveLength(15);
    expect(evaluateParticleAlpha(particles[6]!)).toBeGreaterThan(0);

    // Step 1.0s more: bursts (life <= 0.7s) have expired, ambient + victory remain
    particles = stepParticles(particles, 1.0);
    expect(particles.some((p) => p.kind === "burst")).toBe(false);
    expect(particles.filter((p) => p.kind === "ambient")).toHaveLength(5);

    // Step 4.0s more: victory shower expired, ambient petals wrapped cleanly and remain alive
    particles = stepParticles(particles, 4.0);
    expect(particles.some((p) => p.kind === "victory")).toBe(false);
    expect(particles.filter((p) => p.kind === "ambient")).toHaveLength(5);
    for (const p of particles) {
      expect(p.x).toBeGreaterThanOrEqual(-0.08);
      expect(p.x).toBeLessThanOrEqual(1.08);
      expect(p.y).toBeGreaterThanOrEqual(-0.08);
      expect(p.y).toBeLessThanOrEqual(1.08);
    }
  });
});
