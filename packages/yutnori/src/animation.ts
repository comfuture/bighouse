/**
 * Pure, testable animation specifications, pose evaluators, and particle steppers
 * for Yutnori's illustrated Korean folk-art board and mal tokens.
 */

import type { TeamId } from "./types";

export type PieceSpriteVariant = "idle" | "hop" | "crown" | "effect";

export type PieceSheetFrame = {
  col: number;
  row: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export type YutPiecesSheetSpec = {
  cellWidth: number;
  cellHeight: number;
  columns: number;
  rows: number;
  sheetWidth: number;
  sheetHeight: number;
  variants: Record<PieceSpriteVariant, number>;
  teamRows: Record<TeamId, number>;
};

export const YUT_PIECES_SHEET_SPEC: YutPiecesSheetSpec = {
  cellWidth: 128,
  cellHeight: 128,
  columns: 4,
  rows: 2,
  sheetWidth: 512,
  sheetHeight: 256,
  variants: {
    idle: 0,
    hop: 1,
    crown: 2,
    effect: 3
  },
  teamRows: {
    A: 0,
    B: 1
  }
};

export function getPieceSheetFrame(teamId: TeamId, variant: PieceSpriteVariant): PieceSheetFrame {
  const col = YUT_PIECES_SHEET_SPEC.variants[variant];
  const row = YUT_PIECES_SHEET_SPEC.teamRows[teamId];
  return {
    col,
    row,
    sx: col * YUT_PIECES_SHEET_SPEC.cellWidth,
    sy: row * YUT_PIECES_SHEET_SPEC.cellHeight,
    sw: YUT_PIECES_SHEET_SPEC.cellWidth,
    sh: YUT_PIECES_SHEET_SPEC.cellHeight
  };
}

export type PieceHopPose = {
  /** Vertical jump lift in pixels (0 on ground, positive upward). */
  liftPx: number;
  /** Volume-preserving horizontal squash/stretch multiplier. */
  scaleX: number;
  /** Volume-preserving vertical squash/stretch multiplier. */
  scaleY: number;
  /** Playful forward/backward tilt in degrees. */
  tiltDeg: number;
  /** Ground contact shadow width/alpha multiplier. */
  shadowScale: number;
};

/**
 * Evaluates a lively, volume-preserving hop arc for a mal token over [0, 1]:
 * - [0, 0.16): brief elastic takeoff squash
 * - [0.16, 0.84): parabolic jump arc with graceful mid-air stretch and subtle tilt
 * - [0.84, 1.0]: soft cushioned landing squash settling cleanly back to rest
 */
export function evaluatePieceHopPose(progress: number, maxLiftPx = 18): PieceHopPose {
  const t = Math.min(1, Math.max(0, Number.isFinite(progress) ? progress : 0));

  if (t <= 0 || t >= 1) {
    return { liftPx: 0, scaleX: 1, scaleY: 1, tiltDeg: 0, shadowScale: 1 };
  }

  // Takeoff anticipation squash
  if (t < 0.16) {
    const u = Math.sin((t / 0.16) * Math.PI);
    const squash = u * 0.14;
    return {
      liftPx: 0,
      scaleX: 1 + squash,
      scaleY: 1 - squash * 0.85,
      tiltDeg: -u * 3.5,
      shadowScale: 1 + squash * 0.6
    };
  }

  // Landing cushion squash
  if (t > 0.84) {
    const u = Math.sin(((t - 0.84) / 0.16) * Math.PI);
    const squash = u * 0.16;
    return {
      liftPx: 0,
      scaleX: 1 + squash,
      scaleY: 1 - squash * 0.88,
      tiltDeg: u * 2.5,
      shadowScale: 1 + squash * 0.7
    };
  }

  // Parabolic flight phase
  const flight = (t - 0.16) / 0.68;
  const arc = 4 * flight * (1 - flight); // smooth parabola: 0 at edges, 1 at peak (0.5)
  const liftPx = arc * maxLiftPx;
  const stretch = Math.sin(flight * Math.PI) * 0.11;
  const tiltDeg = Math.sin(flight * Math.PI * 2) * 7.5;

  return {
    liftPx,
    scaleX: 1 - stretch * 0.75,
    scaleY: 1 + stretch,
    tiltDeg,
    shadowScale: Math.max(0.55, 1 - arc * 0.38)
  };
}

export type SpecialNodePulse = {
  /** Radius multiplier for the breathing ring beacon. */
  ringScale: number;
  /** Opacity of the outer breathing ring [0, 1]. */
  ringAlpha: number;
  /** Soft inner golden aura intensity [0, 1]. */
  glowAlpha: number;
  /** Smoothly advancing shimmer angle in radians. */
  shimmerRad: number;
};

/**
 * Evaluates a calm, warm breathing beacon for corner, center, and target nodes.
 */
export function evaluateSpecialNodePulse(timeSec: number, phaseOffset = 0): SpecialNodePulse {
  const t = Number.isFinite(timeSec) ? timeSec : 0;
  const wave = 0.5 + 0.5 * Math.sin(t * 2.4 + phaseOffset);
  const pulse = (t * 0.55 + phaseOffset / (Math.PI * 2)) % 1;
  const normalizedPulse = pulse < 0 ? pulse + 1 : pulse;

  return {
    ringScale: 0.92 + normalizedPulse * 0.58,
    ringAlpha: Math.sin(normalizedPulse * Math.PI) * 0.52,
    glowAlpha: 0.22 + wave * 0.28,
    shimmerRad: (t * 1.15 + phaseOffset) % (Math.PI * 2)
  };
}

export type YutParticleKind = "petal" | "spark" | "dust" | "ring" | "confetti" | "clash" | "aura";

export type YutParticle = {
  kind: YutParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  endSize?: number;
  rotation: number;
  spin: number;
  color: string;
  secondaryColor?: string;
  age: number;
  life: number;
  gravity: number;
  drag: number;
  alpha: number;
  swayAmp?: number;
  swayFreq?: number;
  swayPhase?: number;
};

function mulberry32(seed: number): () => number {
  let a = seed >>> 0;
  return () => {
    a = (a + 0x6d2b79f5) >>> 0;
    let t = Math.imul(a ^ (a >>> 15), 1 | a);
    t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
    return ((t ^ (t >>> 14)) >>> 0) / 4294967296;
  };
}

const PETAL_COLORS = ["#f9cdd8", "#fde2e9", "#f6b7c8", "#fff0f4"] as const;
const CONFETTI_A = ["#5e96f2", "#ffd86b", "#f9c6d4", "#8ce0ca", "#ffffff"] as const;
const CONFETTI_B = ["#ee6e5f", "#ffd86b", "#f9c6d4", "#ffad73", "#ffffff"] as const;

export function createAmbientPetal(width: number, height: number, seed: number, randomY = false): YutParticle {
  const rand = mulberry32(seed);
  const w = Math.max(60, width);
  const h = Math.max(60, height);
  return {
    kind: "petal",
    x: rand() * w,
    y: randomY ? rand() * h : -12 - rand() * 36,
    vx: 10 + rand() * 14,
    vy: 14 + rand() * 16,
    size: 4.5 + rand() * 3.8,
    rotation: rand() * Math.PI * 2,
    spin: (rand() - 0.5) * 2.1,
    color: PETAL_COLORS[Math.floor(rand() * PETAL_COLORS.length)]!,
    age: 0,
    life: 16 + rand() * 12,
    gravity: 0,
    drag: 0,
    alpha: 0.48 + rand() * 0.34,
    swayAmp: 12 + rand() * 14,
    swayFreq: 1.1 + rand() * 0.9,
    swayPhase: rand() * Math.PI * 2
  };
}

export function spawnHopTrail(x: number, y: number, teamId: TeamId, seed = 1): YutParticle[] {
  const rand = mulberry32(seed);
  const particles: YutParticle[] = [];
  const accent = teamId === "A" ? "#7fb4ff" : "#ff9b89";
  for (let i = 0; i < 6; i++) {
    const ang = rand() * Math.PI * 2;
    const speed = 18 + rand() * 34;
    particles.push({
      kind: i < 3 ? "dust" : "spark",
      x: x + (rand() - 0.5) * 10,
      y: y + (rand() - 0.5) * 8,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 12,
      size: i < 3 ? 4 + rand() * 3 : 3.5 + rand() * 2.5,
      rotation: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 6,
      color: i < 3 ? "#efe0c4" : i % 2 === 0 ? "#ffe382" : accent,
      age: 0,
      life: 0.38 + rand() * 0.24,
      gravity: i < 3 ? 28 : 45,
      drag: 2.2,
      alpha: 0.85
    });
  }
  return particles;
}

export function spawnCaptureBurst(x: number, y: number, teamId: TeamId, seed = 101): YutParticle[] {
  const rand = mulberry32(seed);
  const particles: YutParticle[] = [];
  const primary = teamId === "A" ? "#5d98f4" : "#eb5d4e";

  // Dramatic starburst sprite emblem from pieces_sheet.png
  particles.push({
    kind: "clash",
    x,
    y,
    vx: 0,
    vy: 0,
    size: 28,
    endSize: 88,
    rotation: (rand() - 0.5) * 0.4,
    spin: 1.4,
    color: "#ffcf58",
    age: 0,
    life: 0.62,
    gravity: 0,
    drag: 0,
    alpha: 0.98
  });

  // Expanding shockwave rings
  particles.push(
    {
      kind: "ring",
      x,
      y,
      vx: 0,
      vy: 0,
      size: 14,
      endSize: 78,
      rotation: 0,
      spin: 0,
      color: "#ef5e4b",
      age: 0,
      life: 0.56,
      gravity: 0,
      drag: 0,
      alpha: 0.92
    },
    {
      kind: "ring",
      x,
      y,
      vx: 0,
      vy: 0,
      size: 10,
      endSize: 58,
      rotation: 0,
      spin: 0,
      color: "#ffd968",
      age: 0,
      life: 0.46,
      gravity: 0,
      drag: 0,
      alpha: 0.85
    }
  );

  // High-energy sparks flying outward
  for (let i = 0; i < 18; i++) {
    const ang = (i / 18) * Math.PI * 2 + (rand() - 0.5) * 0.28;
    const speed = 75 + rand() * 115;
    particles.push({
      kind: "spark",
      x,
      y,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 18,
      size: 4.5 + rand() * 4.5,
      rotation: ang,
      spin: (rand() - 0.5) * 9,
      color: i % 3 === 0 ? "#ffe275" : i % 3 === 1 ? primary : "#ff7e5f",
      age: 0,
      life: 0.52 + rand() * 0.34,
      gravity: 165,
      drag: 1.8,
      alpha: 1
    });
  }

  return particles;
}

export function spawnStackAura(x: number, y: number, teamId: TeamId, seed = 202): YutParticle[] {
  const rand = mulberry32(seed);
  const particles: YutParticle[] = [];
  const accent = teamId === "A" ? "#7bb5ff" : "#ff9b85";

  // Celebratory halo sprite from pieces_sheet.png
  particles.push({
    kind: "aura",
    x,
    y,
    vx: 0,
    vy: 0,
    size: 32,
    endSize: 78,
    rotation: 0,
    spin: 1.8,
    color: "#ffd968",
    age: 0,
    life: 0.78,
    gravity: 0,
    drag: 0,
    alpha: 0.95
  });

  // Warm golden expanding ring
  particles.push({
    kind: "ring",
    x,
    y,
    vx: 0,
    vy: 0,
    size: 16,
    endSize: 64,
    rotation: 0,
    spin: 0,
    color: "#f5c851",
    age: 0,
    life: 0.65,
    gravity: 0,
    drag: 0,
    alpha: 0.88
  });

  // Rising festive sparkles
  for (let i = 0; i < 12; i++) {
    const ang = (i / 12) * Math.PI * 2 + rand() * 0.3;
    const rad = 12 + rand() * 14;
    particles.push({
      kind: "spark",
      x: x + Math.cos(ang) * rad,
      y: y + Math.sin(ang) * rad,
      vx: Math.cos(ang) * (18 + rand() * 24),
      vy: -36 - rand() * 44,
      size: 4 + rand() * 3.5,
      rotation: rand() * Math.PI,
      spin: (rand() - 0.5) * 6,
      color: i % 2 === 0 ? "#ffe680" : accent,
      age: 0,
      life: 0.62 + rand() * 0.34,
      gravity: 32,
      drag: 1.1,
      alpha: 0.95
    });
  }

  return particles;
}

export function spawnFinishConfetti(x: number, y: number, teamId: TeamId, seed = 303): YutParticle[] {
  const rand = mulberry32(seed);
  const palette = teamId === "A" ? CONFETTI_A : CONFETTI_B;
  const particles: YutParticle[] = [];

  particles.push({
    kind: "aura",
    x,
    y,
    vx: 0,
    vy: 0,
    size: 28,
    endSize: 82,
    rotation: 0,
    spin: 2.1,
    color: "#ffd968",
    age: 0,
    life: 0.85,
    gravity: 0,
    drag: 0,
    alpha: 0.95
  });

  for (let i = 0; i < 24; i++) {
    const ang = -Math.PI * 0.92 + rand() * Math.PI * 0.84;
    const speed = 75 + rand() * 145;
    const isPetal = i % 3 === 0;
    particles.push({
      kind: isPetal ? "petal" : "confetti",
      x: x + (rand() - 0.5) * 14,
      y: y + (rand() - 0.5) * 10,
      vx: Math.cos(ang) * speed,
      vy: Math.sin(ang) * speed - 30,
      size: isPetal ? 5.5 + rand() * 3.5 : 5 + rand() * 4,
      rotation: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 8,
      color: palette[Math.floor(rand() * palette.length)]!,
      age: 0,
      life: 1.15 + rand() * 0.75,
      gravity: isPetal ? 42 : 120,
      drag: 1.25,
      alpha: 0.96,
      swayAmp: isPetal ? 16 : 10,
      swayFreq: 3.2 + rand() * 2.2,
      swayPhase: rand() * Math.PI * 2
    });
  }

  return particles;
}

export function spawnVictoryShower(width: number, height: number, teamId: TeamId, seed = 404): YutParticle[] {
  const rand = mulberry32(seed);
  const palette = teamId === "A" ? CONFETTI_A : CONFETTI_B;
  const w = Math.max(120, width);
  const h = Math.max(120, height);
  const particles: YutParticle[] = [];

  for (let i = 0; i < 42; i++) {
    const isPetal = i % 2 === 0;
    particles.push({
      kind: isPetal ? "petal" : "confetti",
      x: rand() * w,
      y: -14 - rand() * (h * 0.32),
      vx: (rand() - 0.5) * 48,
      vy: 42 + rand() * 68,
      size: isPetal ? 6 + rand() * 4 : 5.5 + rand() * 4.5,
      rotation: rand() * Math.PI * 2,
      spin: (rand() - 0.5) * 7,
      color: palette[Math.floor(rand() * palette.length)]!,
      age: 0,
      life: 2.2 + rand() * 1.4,
      gravity: isPetal ? 18 : 48,
      drag: 0.45,
      alpha: 0.94,
      swayAmp: 18 + rand() * 14,
      swayFreq: 2.2 + rand() * 1.8,
      swayPhase: rand() * Math.PI * 2
    });
  }

  return particles;
}

/**
 * Pure clamped-dt particle physics stepper.
 * Returns a fresh array of active particles without mutating inputs.
 */
export function stepParticles(
  particles: readonly YutParticle[],
  dtSec: number,
  bounds?: { width: number; height: number }
): YutParticle[] {
  const dt = Math.min(0.05, Math.max(0, Number.isFinite(dtSec) ? dtSec : 0));
  if (dt === 0) return particles.map((p) => ({ ...p }));

  const alive: YutParticle[] = [];
  for (const p of particles) {
    const age = p.age + dt;
    if (age >= p.life) continue;

    const damp = p.drag > 0 ? Math.exp(-p.drag * dt) : 1;
    const vx = p.vx * damp;
    const vy = (p.vy + p.gravity * dt) * damp;
    const sway = p.swayAmp && p.swayFreq ? Math.sin(age * p.swayFreq + (p.swayPhase ?? 0)) * p.swayAmp : 0;

    let x = p.x + (vx + sway) * dt;
    let y = p.y + vy * dt;

    // Gently wrap ambient petals horizontally if they drift past the right edge
    if (p.kind === "petal" && p.gravity === 0 && bounds) {
      if (x > bounds.width + 24) x = -20;
      if (x < -24) x = bounds.width + 20;
      if (y > bounds.height + 24) continue;
    }

    alive.push({
      ...p,
      x,
      y,
      vx,
      vy,
      age,
      rotation: p.rotation + p.spin * dt
    });
  }

  return alive;
}
