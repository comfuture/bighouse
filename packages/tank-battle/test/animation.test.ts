import { describe, expect, it } from "vitest";
import {
  BARREL_PROJECTILE_SHEET_SPEC,
  CLOUDS_SHEET_SPEC,
  EXPLOSION_SHEET_SPEC,
  ITEM_ICON_FRAME,
  ITEMS_SHEET_SPEC,
  PROJECTILE_FRAME_BY_ITEM,
  TANK_SHEET_SPEC,
  createInitialClouds,
  createInitialWindStreaks,
  evaluateTankPose,
  resolveTankAnimState,
  selectExplosionFrame,
  stepCloudDrift,
  stepWindStreaks,
  tankSheetFrame
} from "../src/animation";

describe("tank battle sprite sheet specs", () => {
  it("matches generated asset sheet dimensions and frame counts", () => {
    expect(TANK_SHEET_SPEC).toMatchObject({ frameWidth: 128, frameHeight: 128, columns: 4, rows: 2, frameCount: 8 });
    expect(BARREL_PROJECTILE_SHEET_SPEC).toMatchObject({ frameWidth: 128, frameHeight: 128, frameCount: 4 });
    expect(EXPLOSION_SHEET_SPEC).toMatchObject({ frameWidth: 128, frameHeight: 128, frameCount: 8, fps: 16 });
    expect(CLOUDS_SHEET_SPEC).toMatchObject({ frameWidth: 128, frameHeight: 128, frameCount: 4 });
    expect(ITEMS_SHEET_SPEC).toMatchObject({ frameWidth: 128, frameHeight: 128, frameCount: 3 });

    expect(PROJECTILE_FRAME_BY_ITEM).toEqual({ none: 1, scope: 1, megaBlast: 2, warhead: 3 });
    expect(ITEM_ICON_FRAME).toEqual({ megaBlast: 0, warhead: 1, scope: 2 });
  });

  it("maps seats to Hero Azure (row 0) and Rival Coral (row 1) frames", () => {
    expect(tankSheetFrame(0, 0)).toBe(0);
    expect(tankSheetFrame(0, 3)).toBe(3);
    expect(tankSheetFrame(1, 0)).toBe(4);
    expect(tankSheetFrame(1, 2)).toBe(6);
    expect(tankSheetFrame(1, 3)).toBe(7);
  });
});

describe("tank battle pose evaluation", () => {
  it("resolves tank animation state with deterministic combat priority", () => {
    expect(resolveTankAnimState({ alive: false, isMyTurn: true, isCharging: true, firingRemainingMs: 200, hitRemainingMs: 200 })).toBe("destroyed");
    expect(resolveTankAnimState({ alive: true, isMyTurn: true, isCharging: true, firingRemainingMs: 200, hitRemainingMs: 120 })).toBe("hit");
    expect(resolveTankAnimState({ alive: true, isMyTurn: true, isCharging: true, firingRemainingMs: 180, hitRemainingMs: 0 })).toBe("fire");
    expect(resolveTankAnimState({ alive: true, isMyTurn: true, isCharging: true, firingRemainingMs: 0, hitRemainingMs: 0 })).toBe("charge");
    expect(resolveTankAnimState({ alive: true, isMyTurn: true, isCharging: false, firingRemainingMs: 0, hitRemainingMs: 0 })).toBe("aim");
    expect(resolveTankAnimState({ alive: true, isMyTurn: false, isCharging: false, firingRemainingMs: 0, hitRemainingMs: 0 })).toBe("idle");
  });

  it("evaluates idle, aim, charge, fire, hit, and destroyed poses smoothly", () => {
    const idle = evaluateTankPose("idle", 0.5, 0, { seat: 0 });
    expect(idle.frameColumn).toBe(0);
    expect(idle.frameIndex).toBe(0);
    expect(idle.barrelRecoilPx).toBe(0);
    expect(idle.glowIntensity).toBe(0);

    const aim = evaluateTankPose("aim", 0.1, 0, { seat: 1 });
    expect([0, 1]).toContain(aim.frameColumn);
    expect(aim.frameIndex).toBe(4 + aim.frameColumn);
    expect(aim.glowIntensity).toBeGreaterThan(0);

    const lowCharge = evaluateTankPose("charge", 0.25, 0.15, { seat: 0 });
    const highCharge = evaluateTankPose("charge", 0.25, 0.95, { seat: 0 });
    expect(lowCharge.frameColumn).toBe(1);
    expect(highCharge.scaleX).toBeGreaterThan(lowCharge.scaleX);
    expect(highCharge.scaleY).toBeLessThan(lowCharge.scaleY);
    expect(highCharge.glowIntensity).toBeGreaterThan(lowCharge.glowIntensity);
    expect(highCharge.barrelRecoilPx).toBeGreaterThan(lowCharge.barrelRecoilPx);

    const wreckedHero = evaluateTankPose("destroyed", 3.0, 0, { seat: 0 });
    const wreckedRival = evaluateTankPose("destroyed", 3.0, 0, { seat: 1 });
    expect(wreckedHero.frameIndex).toBe(3);
    expect(wreckedRival.frameIndex).toBe(7);
    expect(wreckedHero.glowIntensity).toBe(0);
  });

  it("decays firing recoil and hit shake monotonically over elapsed state time", () => {
    const fireStart = evaluateTankPose("fire", 1.0, 0, { seat: 0, stateElapsedSec: 0 });
    const fireMid = evaluateTankPose("fire", 1.15, 0, { seat: 0, stateElapsedSec: 0.15 });
    const fireEnd = evaluateTankPose("fire", 1.4, 0, { seat: 0, stateElapsedSec: 0.4 });

    expect(fireStart.frameColumn).toBe(2);
    expect(fireStart.offsetX).toBeLessThan(0);
    expect(fireStart.barrelRecoilPx).toBeGreaterThan(fireMid.barrelRecoilPx);
    expect(fireMid.barrelRecoilPx).toBeGreaterThan(fireEnd.barrelRecoilPx);
    expect(Math.abs(fireStart.offsetX)).toBeGreaterThan(Math.abs(fireEnd.offsetX));

    const hitStart = evaluateTankPose("hit", 0.02, 0, { seat: 1, stateElapsedSec: 0 });
    const hitLate = evaluateTankPose("hit", 0.02, 0, { seat: 1, stateElapsedSec: 0.35 });
    expect(hitStart.frameColumn).toBe(2);
    expect(hitStart.frameIndex).toBe(6);
    expect(hitStart.scaleX - 1).toBeGreaterThan(hitLate.scaleX - 1);
    expect(Math.abs(hitStart.offsetX)).toBeGreaterThan(Math.abs(hitLate.offsetX));
  });

  it("dampens shake and idle bob under reducedMotion", () => {
    const normalHit = evaluateTankPose("hit", 0.02, 0, { stateElapsedSec: 0, reducedMotion: false });
    const reducedHit = evaluateTankPose("hit", 0.02, 0, { stateElapsedSec: 0, reducedMotion: true });
    expect(Math.abs(reducedHit.offsetX)).toBeLessThan(Math.abs(normalHit.offsetX));

    const reducedIdle = evaluateTankPose("idle", 0.4, 0, { reducedMotion: true });
    expect(reducedIdle.offsetY).toBe(0);
  });
});

describe("explosion and wind-driven atmosphere kinematics", () => {
  it("progresses explosion frames cleanly from 0 through 7 and clamps boundaries", () => {
    const duration = 520;
    const seen = new Set<number>();
    for (let step = 0; step < 8; step += 1) {
      const elapsed = (step + 0.5) * (duration / 8);
      const frame = selectExplosionFrame(elapsed, duration);
      expect(frame).toBe(step);
      seen.add(frame);
    }
    expect(seen.size).toBe(8);
    expect(selectExplosionFrame(-50, duration)).toBe(0);
    expect(selectExplosionFrame(duration * 2, duration)).toBe(7);
  });

  it("drifts and wraps clouds smoothly in both wind directions", () => {
    const worldWidth = 1000;
    const rightEdge = [{ ...createInitialClouds(worldWidth)[0]!, x: 1105, speedFactor: 1 }];
    const wrappedRight = stepCloudDrift(rightEdge, 10, 100, worldWidth);
    expect(wrappedRight[0]!.x).toBeLessThan(0);

    const leftEdge = [{ ...createInitialClouds(worldWidth)[0]!, x: -105, speedFactor: 1 }];
    const wrappedLeft = stepCloudDrift(leftEdge, -10, 100, worldWidth);
    expect(wrappedLeft[0]!.x).toBeGreaterThan(worldWidth);

    const normalDrift = stepCloudDrift([{ ...createInitialClouds(worldWidth)[0]!, x: 300, speedFactor: 1 }], 8, 100, worldWidth, false);
    const reducedDrift = stepCloudDrift([{ ...createInitialClouds(worldWidth)[0]!, x: 300, speedFactor: 1 }], 8, 100, worldWidth, true);
    expect(reducedDrift[0]!.x - 300).toBeLessThan(normalDrift[0]!.x - 300);
  });

  it("advances wind streaks only when wind is active and motion is not reduced", () => {
    const initial = createInitialWindStreaks(1000, 600);
    const calm = stepWindStreaks(initial, 0, 50, 1000);
    expect(calm).toEqual(initial);

    const windy = stepWindStreaks(initial, 10, 50, 1000);
    expect(windy[0]!.x).not.toBe(initial[0]!.x);

    const reduced = stepWindStreaks(initial, 10, 50, 1000, true);
    expect(reduced).toEqual(initial);
  });
});
