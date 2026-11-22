/**
 * Pure, testable animation kinematics & sprite-sheet evaluators for OneCard.
 *
 * Drives:
 * 1. Illustrated 8x2 (1024x256, 128x128 cell) card art & VFX sprite-sheet mapping.
 * 2. Smooth quadratic Bezier-arc card flight poses with dynamic tilt & scale lift.
 * 3. Smoothly damped clockwise/counterclockwise direction swirl kinematics.
 * 4. Attack stack aura scaling (with <= 2.2Hz pulse for motion accessibility).
 * 5. Sparkle, ember, ripple, and victory confetti particle simulation.
 */

import { isJoker, rankOf, suitOf, type Suit } from "./rules";

export type OneCardSpriteKey =
  | "cardBack"
  | "colorJoker"
  | "bwJoker"
  | "rankAce"
  | "rankJack"
  | "rankQueen"
  | "rankKing"
  | "rankSeven"
  | "suitSpade"
  | "suitHeart"
  | "suitClub"
  | "suitDiamond"
  | "vfxAttack"
  | "vfxReverse"
  | "vfxJump"
  | "vfxSparkle";

export type SpriteCellSpec = {
  col: number;
  row: number;
};

export type SpriteCellRect = {
  key: OneCardSpriteKey;
  col: number;
  row: number;
  x: number;
  y: number;
  width: number;
  height: number;
  /** CSS background-position percentages for 800% x 200% sprite rendering */
  bgPosXPercent: number;
  bgPosYPercent: number;
};

export type OneCardArtSheetSpec = {
  width: number;
  height: number;
  cellWidth: number;
  cellHeight: number;
  cols: number;
  rows: number;
  cells: Record<OneCardSpriteKey, SpriteCellSpec>;
};

export const ONECARD_ART_SHEET_SPEC: OneCardArtSheetSpec = {
  width: 1024,
  height: 256,
  cellWidth: 128,
  cellHeight: 128,
  cols: 8,
  rows: 2,
  cells: {
    cardBack: { col: 0, row: 0 },
    colorJoker: { col: 1, row: 0 },
    bwJoker: { col: 2, row: 0 },
    rankAce: { col: 3, row: 0 },
    rankJack: { col: 4, row: 0 },
    rankQueen: { col: 5, row: 0 },
    rankKing: { col: 6, row: 0 },
    rankSeven: { col: 7, row: 0 },
    suitSpade: { col: 0, row: 1 },
    suitHeart: { col: 1, row: 1 },
    suitClub: { col: 2, row: 1 },
    suitDiamond: { col: 3, row: 1 },
    vfxAttack: { col: 4, row: 1 },
    vfxReverse: { col: 5, row: 1 },
    vfxJump: { col: 6, row: 1 },
    vfxSparkle: { col: 7, row: 1 }
  }
};

export function getSpriteCell(key: OneCardSpriteKey): SpriteCellRect {
  const cell = ONECARD_ART_SHEET_SPEC.cells[key];
  const { cellWidth, cellHeight, cols, rows } = ONECARD_ART_SHEET_SPEC;
  return {
    key,
    col: cell.col,
    row: cell.row,
    x: cell.col * cellWidth,
    y: cell.row * cellHeight,
    width: cellWidth,
    height: cellHeight,
    bgPosXPercent: cols > 1 ? (cell.col / (cols - 1)) * 100 : 0,
    bgPosYPercent: rows > 1 ? (cell.row / (rows - 1)) * 100 : 0
  };
}

export function resolveSuitSprite(suit: Suit): OneCardSpriteKey {
  switch (suit) {
    case "S":
      return "suitSpade";
    case "H":
      return "suitHeart";
    case "C":
      return "suitClub";
    case "D":
      return "suitDiamond";
  }
}

export function resolveCardCenterSprite(card: string): OneCardSpriteKey {
  if (card === "CJ") return "colorJoker";
  if (card === "BJ") return "bwJoker";
  const rank = rankOf(card);
  if (rank === "A") return "rankAce";
  if (rank === "J") return "rankJack";
  if (rank === "Q") return "rankQueen";
  if (rank === "K") return "rankKing";
  if (rank === "7") return "rankSeven";
  const suit = suitOf(card);
  return suit === "J" ? "colorJoker" : resolveSuitSprite(suit);
}

export type CardSpecialBadge = {
  sprite: OneCardSpriteKey;
  label: string;
  kind: "attack" | "reverse" | "jump" | "wild" | "extra";
};

export function resolveCardSpecialBadge(card: string): CardSpecialBadge | null {
  if (card === "CJ") return { sprite: "vfxAttack", label: "+7", kind: "attack" };
  if (card === "BJ") return { sprite: "vfxAttack", label: "+5", kind: "attack" };
  const rank = rankOf(card);
  if (rank === "2") return { sprite: "vfxAttack", label: "+2", kind: "attack" };
  if (rank === "A") return { sprite: "vfxAttack", label: "+3", kind: "attack" };
  if (rank === "Q") return { sprite: "vfxReverse", label: "REV", kind: "reverse" };
  if (rank === "J") return { sprite: "vfxJump", label: "SKIP", kind: "jump" };
  if (rank === "K") return { sprite: "vfxSparkle", label: "+1", kind: "extra" };
  if (rank === "7") return { sprite: "rankSeven", label: "WILD", kind: "wild" };
  return null;
}

export function isAttackCard(card: string): boolean {
  if (isJoker(card)) return true;
  const rank = rankOf(card);
  return rank === "2" || rank === "A";
}

export type CardFlightInput = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Normalized progress in [0, 1] */
  progress: number;
  /** Peak vertical arc lift in pixels (defaults to proportional to distance) */
  arcHeight?: number | undefined;
  /** Starting tilt angle in degrees */
  initialTiltDeg?: number | undefined;
  /** Landing settle tilt angle in degrees */
  finalTiltDeg?: number | undefined;
  /** Additional scale lift at mid-flight (default 0.14) */
  scaleLift?: number | undefined;
};

export type CardFlightPose = {
  x: number;
  y: number;
  rotationDeg: number;
  scale: number;
  opacity: number;
  elevation: number;
};

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

/** Smooth cubic ease-out with subtle tactile acceleration at takeoff */
export function easeFlightProgress(t: number): number {
  const c = clamp01(t);
  return 1 - Math.pow(1 - c, 3);
}

/**
 * Evaluates a card's position, rotation, scale lift, and elevation along a
 * quadratic Bezier arc from (startX, startY) to (endX, endY).
 */
export function evaluateCardFlightPose(input: CardFlightInput): CardFlightPose {
  const rawT = clamp01(input.progress);
  const t = easeFlightProgress(rawT);
  const inv = 1 - t;

  const dx = input.endX - input.startX;
  const dy = input.endY - input.startY;
  const dist = Math.hypot(dx, dy);
  const arcHeight = input.arcHeight ?? Math.min(110, Math.max(26, dist * 0.24));

  // Control point lifts upward above the midpoint with gentle lateral sweep
  const ctrlX = (input.startX + input.endX) * 0.5 + Math.max(-28, Math.min(28, dx * 0.08));
  const ctrlY = Math.min(input.startY, input.endY) - arcHeight;

  const x = inv * inv * input.startX + 2 * inv * t * ctrlX + t * t * input.endX;
  const y = inv * inv * input.startY + 2 * inv * t * ctrlY + t * t * input.endY;

  const elevation = Math.sin(Math.PI * t);
  const scaleLift = input.scaleLift ?? 0.14;
  // Gentle landing cushion settle in the final 15% of flight
  const settle = rawT > 0.85 ? -Math.sin(((rawT - 0.85) / 0.15) * Math.PI) * 0.025 : 0;
  const scale = 1 + elevation * scaleLift + settle;

  const initialTilt = input.initialTiltDeg ?? 0;
  const finalTilt = input.finalTiltDeg ?? 0;
  const bankDir = dx === 0 ? 1 : Math.sign(dx);
  const bankTilt = elevation * bankDir * Math.min(10, dist * 0.025);
  const rotationDeg = initialTilt + (finalTilt - initialTilt) * t + bankTilt;

  const opacity = rawT < 0.06 ? 0.82 + (rawT / 0.06) * 0.18 : 1;

  return { x, y, rotationDeg, scale, opacity, elevation };
}

export type TurnDirection = "clockwise" | "counterclockwise";

export type DirectionSwirlState = {
  angleRad: number;
  angularVelocity: number;
  directionSign: 1 | -1;
  flashIntensity: number;
};

export function createDirectionSwirlState(turnDirection: TurnDirection): DirectionSwirlState {
  const directionSign = turnDirection === "clockwise" ? 1 : -1;
  return {
    angleRad: 0,
    angularVelocity: directionSign * 0.65,
    directionSign,
    flashIntensity: 0
  };
}

/**
 * Steps the center-stage direction swirl ring with smooth inertia and a
 * luminous directional shockwave flash whenever `turnDirection` reverses.
 */
export function stepDirectionSwirl(
  state: DirectionSwirlState,
  turnDirection: TurnDirection,
  dtSec: number,
  reducedMotion = false
): DirectionSwirlState {
  const dt = Math.max(0, Math.min(0.05, Number.isFinite(dtSec) ? dtSec : 0));
  const nextSign: 1 | -1 = turnDirection === "clockwise" ? 1 : -1;
  const flipped = nextSign !== state.directionSign;

  const baseSpeed = reducedMotion ? 0.18 : 0.72;
  const targetVel = nextSign * baseSpeed;
  // Smooth exponential damping toward target velocity (reverses smoothly through 0)
  const blend = 1 - Math.exp(-(reducedMotion ? 8 : 5.5) * dt);
  let nextVel = state.angularVelocity + (targetVel - state.angularVelocity) * blend;

  // Brief celebratory spin kick on direction flip (kept gentle under reduced motion)
  let flashIntensity = Math.max(0, state.flashIntensity - dt * 1.45);
  if (flipped) {
    flashIntensity = reducedMotion ? 0.4 : 1.0;
    if (!reducedMotion) {
      nextVel = state.angularVelocity * 0.25 + nextSign * 2.2;
    }
  }

  const TWO_PI = Math.PI * 2;
  const nextAngle = ((state.angleRad + nextVel * dt) % TWO_PI + TWO_PI) % TWO_PI;

  return {
    angleRad: nextAngle,
    angularVelocity: nextVel,
    directionSign: nextSign,
    flashIntensity
  };
}

export type AttackAuraSpec = {
  active: boolean;
  /** Normalized intensity in [0, 1] scaling with activeAttackCount */
  intensity: number;
  /** Ring radius multiplier around the discard pile */
  ringRadiusScale: number;
  /** Embers spawned per second */
  emberRate: number;
  /** Smooth pulse value in [0, 1] strictly <= 2.2Hz for comfort */
  pulse: number;
  /** Number of crackling lightning arcs to draw */
  arcCount: number;
};

export function evaluateAttackAura(
  activeAttackCount: number,
  timeSec: number,
  reducedMotion = false
): AttackAuraSpec {
  const count = Math.max(0, Math.floor(Number.isFinite(activeAttackCount) ? activeAttackCount : 0));
  if (count <= 0) {
    return {
      active: false,
      intensity: 0,
      ringRadiusScale: 1,
      emberRate: 0,
      pulse: 0,
      arcCount: 0
    };
  }

  // Smoothly saturates from +2 (~0.33) -> +5 (~0.62) -> +10 (~0.85) -> +14+ (~0.98)
  const intensity = clamp01(1 - Math.exp(-count / 5.2));
  // Frequency strictly capped <= 2.0Hz (well under 3Hz flash safety threshold)
  const freqHz = reducedMotion ? 0.55 : Math.min(2.0, 1.05 + intensity * 0.85);
  const pulse = 0.5 + 0.5 * Math.sin(Math.max(0, timeSec) * Math.PI * 2 * freqHz);

  return {
    active: true,
    intensity,
    ringRadiusScale: 1.04 + intensity * 0.26 + (reducedMotion ? 0 : pulse * 0.05),
    emberRate: reducedMotion ? 2 : 6 + intensity * 18,
    pulse,
    arcCount: reducedMotion ? 2 : Math.min(7, 2 + Math.ceil(intensity * 5))
  };
}

export type FxParticleKind = "sparkle" | "ember" | "confetti" | "ring" | "medallion";

export type FxParticle = {
  kind: FxParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  size: number;
  endSize?: number | undefined;
  rotation: number;
  vRot: number;
  life: number;
  maxLife: number;
  color: string;
  secondaryColor?: string | undefined;
  gravity: number;
  drag: number;
  spriteKey?: OneCardSpriteKey | undefined;
};

/**
 * Pure particle array stepper: advances physics, ages particles, and prunes expired ones.
 */
export function stepFxParticles(particles: readonly FxParticle[], dtSec: number): FxParticle[] {
  const dt = Math.max(0, Math.min(0.05, Number.isFinite(dtSec) ? dtSec : 0));
  if (dt <= 0) return [...particles];

  const next: FxParticle[] = [];
  for (const p of particles) {
    const life = p.life + dt;
    if (life >= p.maxLife) continue;
    const damping = Math.exp(-p.drag * dt);
    const vx = p.vx * damping;
    const vy = (p.vy + p.gravity * dt) * damping;
    next.push({
      ...p,
      x: p.x + vx * dt,
      y: p.y + vy * dt,
      vx,
      vy,
      rotation: p.rotation + p.vRot * dt,
      life
    });
  }
  return next;
}

export function createImpactSparkles(
  x: number,
  y: number,
  color: string,
  count = 10,
  useSprite = true
): FxParticle[] {
  const out: FxParticle[] = [];
  for (let i = 0; i < count; i += 1) {
    const angle = (i / count) * Math.PI * 2 + (i % 2 === 0 ? 0.15 : -0.15);
    const speed = 55 + ((i * 37) % 85);
    out.push({
      kind: "sparkle",
      x,
      y,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - 18,
      size: 10 + (i % 3) * 4,
      rotation: angle,
      vRot: (i % 2 === 0 ? 1 : -1) * 3.2,
      life: 0,
      maxLife: 0.42 + (i % 4) * 0.07,
      color,
      gravity: 90,
      drag: 3.4,
      spriteKey: useSprite && i % 2 === 0 ? "vfxSparkle" : undefined
    });
  }
  return out;
}

export const SUIT_THEME_COLORS: Record<Suit, { primary: string; glow: string }> = {
  S: { primary: "#60a5fa", glow: "rgba(96, 165, 250, 0.55)" },
  H: { primary: "#fb7185", glow: "rgba(251, 113, 133, 0.58)" },
  C: { primary: "#34d399", glow: "rgba(52, 211, 153, 0.55)" },
  D: { primary: "#fbbf24", glow: "rgba(251, 191, 36, 0.58)" }
};

export function createSuitWaveParticles(x: number, y: number, suit: Suit): FxParticle[] {
  const theme = SUIT_THEME_COLORS[suit];
  const spriteKey = resolveSuitSprite(suit);
  return [
    {
      kind: "ring",
      x,
      y,
      vx: 0,
      vy: 0,
      size: 28,
      endSize: 190,
      rotation: 0,
      vRot: 0,
      life: 0,
      maxLife: 0.68,
      color: theme.primary,
      secondaryColor: theme.glow,
      gravity: 0,
      drag: 0
    },
    {
      kind: "medallion",
      x,
      y,
      vx: 0,
      vy: -24,
      size: 56,
      endSize: 76,
      rotation: 0,
      vRot: 0.35,
      life: 0,
      maxLife: 0.78,
      color: theme.primary,
      gravity: 0,
      drag: 1.5,
      spriteKey
    },
    ...createImpactSparkles(x, y, theme.primary, 10, true)
  ];
}

export function createWinConfetti(width: number, height: number, count = 42): FxParticle[] {
  const palette = ["#fbbf24", "#34d399", "#fb7185", "#60a5fa", "#f472b6", "#fde68a"];
  const out: FxParticle[] = [];
  const safeW = Math.max(200, width);
  const safeH = Math.max(200, height);
  for (let i = 0; i < count; i += 1) {
    const frac = (i + 0.5) / count;
    const x = safeW * (0.1 + frac * 0.8);
    const y = safeH * (0.12 + ((i * 29) % 18) * 0.01);
    out.push({
      kind: i % 5 === 0 ? "sparkle" : "confetti",
      x,
      y,
      vx: ((i % 7) - 3) * 34,
      vy: -120 - ((i * 19) % 110),
      size: i % 5 === 0 ? 18 : 8 + (i % 4) * 2,
      rotation: (i * 0.7) % (Math.PI * 2),
      vRot: (i % 2 === 0 ? 1 : -1) * (3.5 + (i % 4)),
      life: 0,
      maxLife: 1.85 + (i % 5) * 0.25,
      color: palette[i % palette.length]!,
      gravity: 220,
      drag: 0.85,
      spriteKey: i % 5 === 0 ? "vfxSparkle" : undefined
    });
  }
  return out;
}
