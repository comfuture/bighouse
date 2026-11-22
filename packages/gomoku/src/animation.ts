import type { Board, Point, Stone } from "./rules";

/**
 * Pure, deterministic animation specifications and pose evaluators for Gomoku.
 * Modeled on Sunny Meadow's tick-driven animation pipeline so every curve,
 * winning-line scan, and particle stepper can be verified directly in unit tests.
 */

export type SpriteSheetSpec = {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
};

export const GOMOKU_STONES_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  frameCount: 4
};

export const GOMOKU_STONE_FRAMES = {
  black: 0,
  white: 1,
  lastMoveHalo: 2,
  sakuraPetal: 3
} as const;

export function getStoneFrameIndex(stone: Stone): number {
  return stone === "black" ? GOMOKU_STONE_FRAMES.black : GOMOKU_STONE_FRAMES.white;
}

export const STONE_DROP_DURATION_SEC = 0.34;
export const PLACEMENT_RIPPLE_DURATION_SEC = 0.54;
export const WINNING_BEAM_DURATION_SEC = 0.62;

export type StoneDropPose = {
  /** Volume-preserving horizontal scale modifier (settles to 1) */
  scaleX: number;
  /** Volume-preserving vertical scale modifier (settles to 1) */
  scaleY: number;
  /** Vertical lift offset in cell-size units (negative = lifted above board) */
  offsetY: number;
  /** Soft ground shadow radius multiplier */
  shadowScale: number;
  /** Soft ground shadow opacity multiplier (0..1) */
  shadowAlpha: number;
  /** Stone alpha (0..1) */
  opacity: number;
  /** True once the drop bounce has fully settled */
  settled: boolean;
};

export type PlacementRipplePose = {
  /** Ring radius in cell-size units */
  radiusRatio: number;
  /** Ring alpha (0..1) */
  alpha: number;
  /** Stroke thickness multiplier */
  lineWidthRatio: number;
  /** False once completed or disabled */
  active: boolean;
};

export type HoverPulsePose = {
  alpha: number;
  scale: number;
};

export type LastMoveHaloPose = {
  scale: number;
  alpha: number;
  rotation: number;
};

export type WinningLine = {
  stone: Stone;
  points: Point[];
};

export type WinningBeamPose = {
  /** Normalized line reveal progress (0..1) */
  progress: number;
  /** Soft glow opacity multiplier (0..1), always <= 1Hz modulation */
  glowAlpha: number;
  /** Traveling golden sheen position along beam (0..1) */
  shimmerOffset: number;
};

export type GomokuParticleKind = "ambient" | "burst" | "victory";

export type GomokuParticle = {
  kind: GomokuParticleKind;
  /** Normalized board-space position (0..1) */
  x: number;
  y: number;
  /** Normalized velocity (units/sec) */
  vx: number;
  vy: number;
  /** Visual size in cell-size units */
  size: number;
  /** Rotation in radians */
  rotation: number;
  /** Angular velocity (rad/sec) */
  vRot: number;
  /** Elapsed age in seconds */
  age: number;
  /** Total lifespan in seconds (Infinity for ambient petals) */
  life: number;
  /** Horizontal breeze sway phase */
  swayPhase: number;
  /** Horizontal breeze sway amplitude */
  swayAmp: number;
  /** Base peak opacity */
  alpha: number;
};

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

function easeOutCubic(t: number): number {
  const inv = 1 - clamp01(t);
  return 1 - inv * inv * inv;
}

/**
 * Evaluates a tactile Go-stone placement drop with volume-preserving squash & stretch
 * and a subtle damped overshoot settle on the wooden goban.
 */
export function evaluateStoneDropPose(elapsedSec: number, reducedMotion = false): StoneDropPose {
  if (reducedMotion || elapsedSec >= STONE_DROP_DURATION_SEC) {
    return {
      scaleX: 1,
      scaleY: 1,
      offsetY: 0,
      shadowScale: 1,
      shadowAlpha: 1,
      opacity: 1,
      settled: true
    };
  }

  const t = Math.max(0, elapsedSec);
  const impactTime = 0.085;

  // Phase 1: crisp descent onto the kaya board
  if (t < impactTime) {
    const p = t / impactTime;
    const fall = p * p; // accelerating gravity feel
    const height = (1 - fall) * 0.36;
    const stretch = (1 - p) * 0.055;
    const scaleY = 1 + stretch;
    const scaleX = 1 / scaleY;
    return {
      scaleX,
      scaleY,
      offsetY: -height,
      shadowScale: 1.18 - fall * 0.18,
      shadowAlpha: 0.42 + fall * 0.58,
      opacity: Math.min(1, 0.35 + p * 0.85),
      settled: false
    };
  }

  // Phase 2: damped spring impact squash -> subtle overshoot rebound -> crisp rest
  const post = (t - impactTime) / (STONE_DROP_DURATION_SEC - impactTime);
  const decay = Math.exp(-5.4 * post);
  // First half-cycle compresses horizontally (squash), second half slightly rebounds
  const wave = Math.sin(post * Math.PI * 2.15);
  const squash = 0.115 * decay * wave;
  const scaleX = 1 + squash;
  const scaleY = 1 / scaleX;

  // Tiny micro-hop rebound on second half-wave
  const microHop = Math.max(0, -Math.sin(post * Math.PI * 2.0)) * 0.045 * decay;

  return {
    scaleX,
    scaleY,
    offsetY: -microHop,
    shadowScale: 1 + squash * 0.45 + microHop * 0.9,
    shadowAlpha: 1 - microHop * 1.4,
    opacity: 1,
    settled: false
  };
}

/**
 * Evaluates the expanding warm impact ripple radiating from a newly placed stone.
 */
export function evaluatePlacementRipple(elapsedSec: number, reducedMotion = false): PlacementRipplePose {
  if (reducedMotion || elapsedSec < 0 || elapsedSec >= PLACEMENT_RIPPLE_DURATION_SEC) {
    return {
      radiusRatio: 1.55,
      alpha: 0,
      lineWidthRatio: 0,
      active: false
    };
  }
  const p = clamp01(elapsedSec / PLACEMENT_RIPPLE_DURATION_SEC);
  const eased = easeOutCubic(p);
  return {
    radiusRatio: 0.44 + eased * 1.12,
    alpha: (1 - p) * (1 - p) * 0.68,
    lineWidthRatio: Math.max(0.25, 1 - p * 0.72),
    active: true
  };
}

/**
 * Gentle breathing hover preview (< 0.6 Hz, safely below 3 Hz flash limits).
 */
export function evaluateHoverPulse(timeSec: number, reducedMotion = false): HoverPulsePose {
  if (reducedMotion) {
    return { alpha: 0.45, scale: 0.96 };
  }
  const wave = 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 1.1);
  return {
    alpha: 0.35 + wave * 0.16,
    scale: 0.93 + wave * 0.06
  };
}

/**
 * Calm golden last-move halo modulation (< 0.5 Hz).
 */
export function evaluateLastMoveHalo(timeSec: number, reducedMotion = false): LastMoveHaloPose {
  if (reducedMotion) {
    return { scale: 1.0, alpha: 0.92, rotation: 0 };
  }
  const breath = Math.sin(timeSec * Math.PI * 0.85);
  return {
    scale: 1.0 + breath * 0.035,
    alpha: 0.82 + breath * 0.14,
    rotation: timeSec * 0.16
  };
}

const WIN_DIRECTIONS: ReadonlyArray<readonly [number, number]> = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
];

function collectRun(board: Board, x: number, y: number, dx: number, dy: number, stone: Stone): Point[] {
  const height = board.length;
  const width = board[0]?.length ?? 0;

  let sx = x;
  let sy = y;
  while (
    sx - dx >= 0 &&
    sx - dx < width &&
    sy - dy >= 0 &&
    sy - dy < height &&
    board[sy - dy]?.[sx - dx] === stone
  ) {
    sx -= dx;
    sy -= dy;
  }

  const points: Point[] = [];
  let cx = sx;
  let cy = sy;
  while (cx >= 0 && cx < width && cy >= 0 && cy < height && board[cy]?.[cx] === stone) {
    points.push({ x: cx, y: cy });
    cx += dx;
    cy += dy;
  }
  return points;
}

/**
 * Finds the winning contiguous run of 5 or more stones on the board.
 * Prefers a winning line containing `preferredLastMove` when provided.
 */
export function findWinningLine(board: Board, preferredLastMove?: Point | null): WinningLine | null {
  const height = board.length;
  if (height === 0) return null;

  if (preferredLastMove) {
    const stone = board[preferredLastMove.y]?.[preferredLastMove.x];
    if (stone === "black" || stone === "white") {
      let bestPreferred: Point[] | null = null;
      for (const [dx, dy] of WIN_DIRECTIONS) {
        const run = collectRun(board, preferredLastMove.x, preferredLastMove.y, dx, dy, stone);
        if (run.length >= 5 && (!bestPreferred || run.length > bestPreferred.length)) {
          bestPreferred = run;
        }
      }
      if (bestPreferred) {
        return { stone, points: bestPreferred };
      }
    }
  }

  let best: WinningLine | null = null;
  for (let y = 0; y < height; y += 1) {
    const row = board[y];
    if (!row) continue;
    for (let x = 0; x < row.length; x += 1) {
      const stone = row[x];
      if (stone !== "black" && stone !== "white") continue;
      for (const [dx, dy] of WIN_DIRECTIONS) {
        // Only start from the beginning of a run to avoid redundant scans
        if (board[y - dy]?.[x - dx] === stone) continue;
        const run = collectRun(board, x, y, dx, dy, stone);
        if (run.length >= 5 && (!best || run.length > best.points.length)) {
          best = { stone, points: run };
        }
      }
    }
  }

  return best;
}

/**
 * Evaluates the animated golden 5-in-a-row victory beam progress and sheen.
 */
export function evaluateWinningBeam(
  elapsedSec: number,
  timeSec: number,
  reducedMotion = false
): WinningBeamPose {
  if (reducedMotion) {
    return {
      progress: 1,
      glowAlpha: 0.88,
      shimmerOffset: 0.5
    };
  }
  const progress = easeOutCubic(clamp01(elapsedSec / WINNING_BEAM_DURATION_SEC));
  const pulse = 0.5 + 0.5 * Math.sin(timeSec * Math.PI * 0.9);
  const shimmerOffset = (timeSec * 0.42) % 1;
  return {
    progress,
    glowAlpha: 0.72 + pulse * 0.24,
    shimmerOffset
  };
}

/**
 * Returns traditional Hoshi (star point) coordinates for common goban sizes.
 */
export function getHoshiPoints(boardSize: number): Point[] {
  if (boardSize === 15) {
    return [
      { x: 3, y: 3 },
      { x: 11, y: 3 },
      { x: 7, y: 7 },
      { x: 3, y: 11 },
      { x: 11, y: 11 }
    ];
  }
  if (boardSize === 19) {
    const coords = [3, 9, 15];
    const pts: Point[] = [];
    for (const y of coords) {
      for (const x of coords) {
        pts.push({ x, y });
      }
    }
    return pts;
  }
  if (boardSize === 9) {
    return [
      { x: 2, y: 2 },
      { x: 6, y: 2 },
      { x: 4, y: 4 },
      { x: 2, y: 6 },
      { x: 6, y: 6 }
    ];
  }
  if (boardSize >= 7 && boardSize % 2 === 1) {
    const mid = Math.floor(boardSize / 2);
    return [{ x: mid, y: mid }];
  }
  return [];
}

/** Simple deterministic LCG so particle spawns are reproducible in tests. */
function makeRng(seed: number): () => number {
  let state = (seed >>> 0) || 1;
  return () => {
    state = (1664525 * state + 1013904223) >>> 0;
    return state / 0x100000000;
  };
}

/**
 * Spawns serene ambient sakura petals drifting gently across the goban.
 */
export function createAmbientPetals(count = 7, seed = 2026): GomokuParticle[] {
  const rand = makeRng(seed);
  const petals: GomokuParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    petals.push({
      kind: "ambient",
      x: rand(),
      y: rand(),
      vx: 0.011 + rand() * 0.014,
      vy: 0.016 + rand() * 0.018,
      size: 0.36 + rand() * 0.24,
      rotation: rand() * Math.PI * 2,
      vRot: (rand() - 0.5) * 0.9,
      age: rand() * 4,
      life: Number.POSITIVE_INFINITY,
      swayPhase: rand() * Math.PI * 2,
      swayAmp: 0.008 + rand() * 0.01,
      alpha: 0.24 + rand() * 0.22
    });
  }
  return petals;
}

/**
 * Spawns delicate sakura/spark motes bursting outward from a placed stone.
 */
export function createPlacementBurstParticles(
  nx: number,
  ny: number,
  count = 6,
  seed = 77
): GomokuParticle[] {
  const rand = makeRng(seed);
  const particles: GomokuParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / Math.max(1, count)) * Math.PI * 2 + (rand() - 0.5) * 0.5;
    const speed = 0.065 + rand() * 0.075;
    particles.push({
      kind: "burst",
      x: nx,
      y: ny,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed,
      size: 0.24 + rand() * 0.16,
      rotation: rand() * Math.PI * 2,
      vRot: (rand() - 0.5) * 4.2,
      age: 0,
      life: 0.45 + rand() * 0.25,
      swayPhase: rand() * Math.PI * 2,
      swayAmp: 0.004,
      alpha: 0.78
    });
  }
  return particles;
}

/**
 * Spawns a celebratory sakura petal shower along the winning 5-in-a-row line.
 */
export function createVictoryPetalShower(
  normalizedPoints: readonly Point[],
  count = 20,
  seed = 999
): GomokuParticle[] {
  if (normalizedPoints.length === 0) return [];
  const rand = makeRng(seed);
  const particles: GomokuParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const anchor = normalizedPoints[i % normalizedPoints.length]!;
    const angle = rand() * Math.PI * 2;
    const speed = 0.04 + rand() * 0.11;
    particles.push({
      kind: "victory",
      x: anchor.x + (rand() - 0.5) * 0.04,
      y: anchor.y + (rand() - 0.5) * 0.04,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 0.03,
      size: 0.34 + rand() * 0.28,
      rotation: rand() * Math.PI * 2,
      vRot: (rand() - 0.5) * 3.6,
      age: 0,
      life: 1.4 + rand() * 1.1,
      swayPhase: rand() * Math.PI * 2,
      swayAmp: 0.015 + rand() * 0.015,
      alpha: 0.9
    });
  }
  return particles;
}

/**
 * Advances all particles by `dtSec`, wrapping ambient petals and pruning expired bursts.
 */
export function stepParticles(particles: readonly GomokuParticle[], dtSec: number): GomokuParticle[] {
  const dt = Math.max(0, dtSec);
  const next: GomokuParticle[] = [];

  for (const p of particles) {
    const age = p.age + dt;
    if (Number.isFinite(p.life) && age >= p.life) {
      continue;
    }

    const drag = p.kind === "ambient" ? 1 : Math.exp(-dt * (p.kind === "burst" ? 3.2 : 1.1));
    const vx = p.vx * drag;
    const vy = p.kind === "victory" ? p.vy * drag + 0.045 * dt : p.vy * drag;
    const sway = Math.sin(age * 1.8 + p.swayPhase) * p.swayAmp;

    let x = p.x + (vx + sway) * dt;
    let y = p.y + vy * dt;

    if (p.kind === "ambient") {
      if (x > 1.08) x = -0.08;
      else if (x < -0.08) x = 1.08;
      if (y > 1.08) y = -0.08;
      else if (y < -0.08) y = 1.08;
    }

    next.push({
      ...p,
      x,
      y,
      vx,
      vy,
      rotation: p.rotation + p.vRot * dt,
      age
    });
  }

  return next;
}

/**
 * Computes effective rendered opacity for a particle at its current age.
 */
export function evaluateParticleAlpha(particle: GomokuParticle): number {
  if (particle.kind === "ambient") {
    // Soft fade near edges so wrap-around is invisible
    const edgeX = Math.min(particle.x + 0.06, 1.06 - particle.x) / 0.14;
    const edgeY = Math.min(particle.y + 0.06, 1.06 - particle.y) / 0.14;
    return particle.alpha * clamp01(Math.min(edgeX, edgeY));
  }
  const progress = clamp01(particle.age / Math.max(0.001, particle.life));
  const fadeIn = clamp01(progress / 0.12);
  const fadeOut = 1 - progress * progress;
  return particle.alpha * fadeIn * fadeOut;
}
