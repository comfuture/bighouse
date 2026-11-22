/**
 * Pure, testable tick-animation specs & pose evaluators for Tank Battle.
 * Modeled on Sunny Meadow's sprite-sheet & deformation architecture so every
 * visual transition (idle rumble, aiming alert, charge squash/glow, cannon recoil,
 * direct-hit impact shake, wrecked smoldering, 8-frame explosion, and wind-driven
 * sky clouds) updates smoothly per frame and can be verified deterministically.
 */

import type { TankItemSelection } from "./types";

export type TankAnimState = "idle" | "aim" | "charge" | "fire" | "hit" | "destroyed";

export type SpriteSheetSpec = {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  fps?: number;
};

export const TANK_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 4,
  rows: 2,
  frameCount: 8,
  fps: 8
};

export const BARREL_PROJECTILE_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 4,
  rows: 1,
  frameCount: 4
};

export const EXPLOSION_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 8,
  rows: 1,
  frameCount: 8,
  fps: 16
};

export const CLOUDS_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 4,
  rows: 1,
  frameCount: 4
};

export const ITEMS_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 3,
  rows: 1,
  frameCount: 3
};

export const BARREL_FRAME_INDEX = 0;

export const PROJECTILE_FRAME_BY_ITEM: Record<TankItemSelection, number> = {
  none: 1,
  scope: 1,
  megaBlast: 2,
  warhead: 3
};

export const ITEM_ICON_FRAME: Record<Exclude<TankItemSelection, "none">, number> = {
  megaBlast: 0,
  warhead: 1,
  scope: 2
};

export type TankPoseOptions = {
  /** Player seat index (0 = Hero Azure row, 1 = Rival Coral row). Defaults to 0. */
  seat?: number;
  /** Elapsed time in seconds since the current transient state (fire / hit) began. */
  stateElapsedSec?: number;
  /** Reduce ambient rumble and camera/body shake when user prefers reduced motion. */
  reducedMotion?: boolean;
};

export type TankRenderPose = {
  /** Column index inside the 4-column tank pose row (0=idle, 1=active, 2=recoil, 3=wrecked). */
  frameColumn: 0 | 1 | 2 | 3;
  /** Absolute spritesheet frame index accounting for the player's seat row (0..7). */
  frameIndex: number;
  /** Local pixel offset relative to tank ground anchor (positive X is forward/facing direction). */
  offsetX: number;
  /** Local pixel vertical offset (negative lifts upward). */
  offsetY: number;
  /** Local tilt rotation in radians (positive tilts nose up when facing right). */
  rotation: number;
  /** Volume-preserving hull scale modifiers. */
  scaleX: number;
  scaleY: number;
  /** Barrel axial recoil kickback distance in pixels (>= 0). */
  barrelRecoilPx: number;
  /** Normalized glowing aura intensity [0..1] for charge buildup or firing flash. */
  glowIntensity: number;
};

export type DriftingCloud = {
  x: number;
  y: number;
  frame: number;
  scale: number;
  alpha: number;
  /** Multiplier on wind velocity so clouds drift at parallax depths. */
  speedFactor: number;
};

export type WindStreak = {
  x: number;
  y: number;
  length: number;
  alpha: number;
  speedFactor: number;
};

/**
 * Maps a tank seat (0=Azure, 1=Coral) and pose column (0..3) to its sheet frame index.
 */
export function tankSheetFrame(seat: number, column: 0 | 1 | 2 | 3): number {
  const row = seat % 2 === 0 ? 0 : 1;
  return row * TANK_SHEET_SPEC.columns + column;
}

/**
 * Resolves the high-level tank animation state from live match and transient timers.
 */
export function resolveTankAnimState(params: {
  alive: boolean;
  isMyTurn: boolean;
  isCharging: boolean;
  firingRemainingMs: number;
  hitRemainingMs: number;
}): TankAnimState {
  if (!params.alive) return "destroyed";
  if (params.hitRemainingMs > 0) return "hit";
  if (params.firingRemainingMs > 0) return "fire";
  if (params.isCharging) return "charge";
  if (params.isMyTurn) return "aim";
  return "idle";
}

/**
 * Evaluates a tank's per-tick visual pose, frame selection, recoil kickback, and charge aura.
 *
 * @param state       Current TankAnimState
 * @param time        Continuous time in seconds (e.g., Phaser `time / 1000`)
 * @param chargeRatio Normalized fire-power charge ratio in `[0, 1]`
 * @param options     Optional seat row, transient elapsed time, and reduced-motion flag
 */
export function evaluateTankPose(
  state: TankAnimState,
  time: number,
  chargeRatio = 0,
  options: TankPoseOptions = {}
): TankRenderPose {
  const seat = options.seat ?? 0;
  const t = Number.isFinite(time) ? Math.max(0, time) : 0;
  const charge = clamp01(chargeRatio);
  const reduced = Boolean(options.reducedMotion);
  const elapsed = Math.max(0, options.stateElapsedSec ?? 0);

  if (state === "destroyed") {
    const column: 0 | 1 | 2 | 3 = 3;
    return {
      frameColumn: column,
      frameIndex: tankSheetFrame(seat, column),
      offsetX: 0,
      offsetY: 1,
      rotation: 0.04,
      scaleX: 1,
      scaleY: 0.96,
      barrelRecoilPx: 0,
      glowIntensity: 0
    };
  }

  if (state === "hit") {
    // Crisp impact shock squash + decaying horizontal shake
    const decay = Math.exp(-elapsed * 7.5);
    const shakeAmp = reduced ? 1.2 : 5.5;
    const shake = Math.sin(t * 68) * shakeAmp * decay;
    const squash = 0.12 * decay;
    const column: 0 | 1 | 2 | 3 = 2;
    return {
      frameColumn: column,
      frameIndex: tankSheetFrame(seat, column),
      offsetX: shake,
      offsetY: 1.5 * decay,
      rotation: Math.sin(t * 44) * (reduced ? 0.02 : 0.09) * decay,
      scaleX: 1 + squash,
      scaleY: 1 - squash * 0.9,
      barrelRecoilPx: 2.5 * decay,
      glowIntensity: 0.35 * decay
    };
  }

  if (state === "fire") {
    // Punchy recoil kickback that snaps back smoothly over ~0.35s
    const recoilDecay = Math.exp(-elapsed * 8.2);
    const kickback = (reduced ? 3.5 : 8.5) * recoilDecay;
    const column: 0 | 1 | 2 | 3 = recoilDecay > 0.28 ? 2 : 1;
    return {
      frameColumn: column,
      frameIndex: tankSheetFrame(seat, column),
      offsetX: -kickback * 0.65,
      offsetY: 1.2 * recoilDecay,
      rotation: -(reduced ? 0.025 : 0.085) * recoilDecay,
      scaleX: 1 - 0.08 * recoilDecay,
      scaleY: 1 + 0.075 * recoilDecay,
      barrelRecoilPx: (reduced ? 5 : 13) * recoilDecay,
      glowIntensity: clamp01(recoilDecay * 1.15)
    };
  }

  if (state === "charge") {
    // Rising engine vibration + volume-preserving coiled squash + pulsing golden charge aura
    const jitterFreq = 26 + charge * 22;
    const jitterAmp = reduced ? 0.35 : 0.6 + charge * 1.6;
    const pulse = 0.5 + 0.5 * Math.sin(t * (9 + charge * 8));
    const squash = 0.025 + charge * 0.085;
    const column: 0 | 1 | 2 | 3 = 1;
    return {
      frameColumn: column,
      frameIndex: tankSheetFrame(seat, column),
      offsetX: Math.sin(t * jitterFreq) * jitterAmp,
      offsetY: 1.6 * charge,
      rotation: -0.025 * charge,
      scaleX: 1 + squash,
      scaleY: 1 - squash * 0.85,
      barrelRecoilPx: charge * 3.5,
      glowIntensity: clamp01(0.25 + charge * 0.6 + pulse * 0.15)
    };
  }

  if (state === "aim") {
    // Lively active engine-bob while waiting for player's shot
    const rumble = Math.sin(t * 11.5);
    const bobAmp = reduced ? 0.25 : 1.1;
    const column: 0 | 1 | 2 | 3 = Math.floor(t * 4.5) % 2 === 0 ? 1 : 0;
    return {
      frameColumn: column,
      frameIndex: tankSheetFrame(seat, column),
      offsetX: 0,
      offsetY: -Math.abs(rumble) * bobAmp,
      rotation: rumble * (reduced ? 0.004 : 0.014),
      scaleX: 1 - rumble * 0.014,
      scaleY: 1 + rumble * 0.016,
      barrelRecoilPx: 0,
      glowIntensity: 0.12 + 0.06 * Math.sin(t * 3.5)
    };
  }

  // Default: calm idle engine breath
  const breath = Math.sin(t * 4.2);
  const column: 0 | 1 | 2 | 3 = 0;
  return {
    frameColumn: column,
    frameIndex: tankSheetFrame(seat, column),
    offsetX: 0,
    offsetY: reduced ? 0 : -Math.abs(breath) * 0.45,
    rotation: 0,
    scaleX: 1 - breath * (reduced ? 0.004 : 0.01),
    scaleY: 1 + breath * (reduced ? 0.004 : 0.012),
    barrelRecoilPx: 0,
    glowIntensity: 0
  };
}

/**
 * Selects the explosion sprite-sheet frame index (0..7) for a given elapsed time.
 */
export function selectExplosionFrame(elapsedMs: number, durationMs = 500): number {
  const safeDuration = Math.max(1, durationMs);
  const progress = clamp01(elapsedMs / safeDuration);
  const frameCount = EXPLOSION_SHEET_SPEC.frameCount;
  return Math.min(frameCount - 1, Math.floor(progress * frameCount));
}

/**
 * Creates a balanced parallax set of twilight clouds across the battlefield sky.
 */
export function createInitialClouds(worldWidth: number): DriftingCloud[] {
  return [
    { x: worldWidth * 0.11, y: 122, frame: 0, scale: 1.05, alpha: 0.84, speedFactor: 1.0 },
    { x: worldWidth * 0.36, y: 86, frame: 1, scale: 1.18, alpha: 0.72, speedFactor: 0.72 },
    { x: worldWidth * 0.64, y: 146, frame: 2, scale: 0.88, alpha: 0.78, speedFactor: 1.25 },
    { x: worldWidth * 0.88, y: 102, frame: 3, scale: 0.96, alpha: 0.66, speedFactor: 0.84 },
    { x: worldWidth * 0.50, y: 184, frame: 1, scale: 0.78, alpha: 0.56, speedFactor: 1.42 }
  ];
}

/**
 * Advances drifting clouds according to live battlefield wind, wrapping seamlessly off-screen.
 */
export function stepCloudDrift(
  clouds: readonly DriftingCloud[],
  wind: number,
  deltaMs: number,
  worldWidth: number,
  reducedMotion = false
): DriftingCloud[] {
  const dt = Math.max(0, Math.min(deltaMs, 100)) / 1000;
  const margin = 110;
  const span = worldWidth + margin * 2;
  // Gentle ambient breeze even when wind is 0 so sky feels alive
  const baseVelocity = wind === 0 ? 4.5 : wind * 5.2;
  const motionScale = reducedMotion ? 0.2 : 1.0;

  return clouds.map((cloud) => {
    let nextX = cloud.x + baseVelocity * cloud.speedFactor * motionScale * dt;
    while (nextX > worldWidth + margin) nextX -= span;
    while (nextX < -margin) nextX += span;
    return { ...cloud, x: nextX };
  });
}

/**
 * Creates initial wind streak particles distributed across the sky.
 */
export function createInitialWindStreaks(worldWidth: number, battleHeight: number): WindStreak[] {
  const streaks: WindStreak[] = [];
  for (let i = 0; i < 14; i += 1) {
    streaks.push({
      x: ((i * 173 + 47) % Math.max(1, worldWidth)),
      y: 78 + ((i * 71) % Math.max(80, battleHeight - 230)),
      length: 26 + (i % 4) * 14,
      alpha: 0.14 + (i % 3) * 0.08,
      speedFactor: 0.75 + (i % 4) * 0.22
    });
  }
  return streaks;
}

/**
 * Advances atmospheric wind streaks scaled to live wind velocity.
 */
export function stepWindStreaks(
  streaks: readonly WindStreak[],
  wind: number,
  deltaMs: number,
  worldWidth: number,
  reducedMotion = false
): WindStreak[] {
  if (Math.abs(wind) < 0.35 || reducedMotion) return streaks.map((s) => ({ ...s }));
  const dt = Math.max(0, Math.min(deltaMs, 100)) / 1000;
  const margin = 90;
  const span = worldWidth + margin * 2;
  const baseVelocity = wind * 24;

  return streaks.map((streak) => {
    let nextX = streak.x + baseVelocity * streak.speedFactor * dt;
    while (nextX > worldWidth + margin) nextX -= span;
    while (nextX < -margin) nextX += span;
    return { ...streak, x: nextX };
  });
}

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}
