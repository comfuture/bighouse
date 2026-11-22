/**
 * Pure, testable animation specifications, pose evaluators, and particle steppers
 * for the Bighouse Chess visual & tick-animation overhaul.
 */

export type ChessPieceKey =
  | "wk"
  | "wq"
  | "wr"
  | "wb"
  | "wn"
  | "wp"
  | "bk"
  | "bq"
  | "br"
  | "bb"
  | "bn"
  | "bp";

export type ChessVfxKind = "legalGem" | "unsafeShield" | "captureBurst" | "promotionCrown";

export type SpriteFrameCoords = {
  col: number;
  row: number;
  sx: number;
  sy: number;
  sw: number;
  sh: number;
};

export type ChessPiecesSheetSpec = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  frames: Record<ChessPieceKey, { col: number; row: number }>;
};

export type ChessVfxSheetSpec = {
  width: number;
  height: number;
  cols: number;
  rows: number;
  frameWidth: number;
  frameHeight: number;
  frames: Record<ChessVfxKind, { col: number; row: number }>;
};

export const CHESS_PIECES_SHEET_SPEC: ChessPiecesSheetSpec = {
  width: 768,
  height: 256,
  cols: 6,
  rows: 2,
  frameWidth: 128,
  frameHeight: 128,
  frames: {
    wk: { col: 0, row: 0 },
    wq: { col: 1, row: 0 },
    wr: { col: 2, row: 0 },
    wb: { col: 3, row: 0 },
    wn: { col: 4, row: 0 },
    wp: { col: 5, row: 0 },
    bk: { col: 0, row: 1 },
    bq: { col: 1, row: 1 },
    br: { col: 2, row: 1 },
    bb: { col: 3, row: 1 },
    bn: { col: 4, row: 1 },
    bp: { col: 5, row: 1 }
  }
};

export const CHESS_VFX_SHEET_SPEC: ChessVfxSheetSpec = {
  width: 512,
  height: 128,
  cols: 4,
  rows: 1,
  frameWidth: 128,
  frameHeight: 128,
  frames: {
    legalGem: { col: 0, row: 0 },
    unsafeShield: { col: 1, row: 0 },
    captureBurst: { col: 2, row: 0 },
    promotionCrown: { col: 3, row: 0 }
  }
};

export function getPieceSpriteFrame(pieceKey: ChessPieceKey): SpriteFrameCoords {
  const { col, row } = CHESS_PIECES_SHEET_SPEC.frames[pieceKey];
  const { frameWidth, frameHeight } = CHESS_PIECES_SHEET_SPEC;
  return {
    col,
    row,
    sx: col * frameWidth,
    sy: row * frameHeight,
    sw: frameWidth,
    sh: frameHeight
  };
}

export function getVfxSpriteFrame(kind: ChessVfxKind): SpriteFrameCoords {
  const { col, row } = CHESS_VFX_SHEET_SPEC.frames[kind];
  const { frameWidth, frameHeight } = CHESS_VFX_SHEET_SPEC;
  return {
    col,
    row,
    sx: col * frameWidth,
    sy: row * frameHeight,
    sw: frameWidth,
    sh: frameHeight
  };
}

export type PieceTravelPose = {
  /** Clamped linear progress [0..1] */
  progress: number;
  /** Smooth eased travel fraction along the board plane [0..1] */
  moveProgress: number;
  /** Vertical arc lift as a fraction of one board cell height [0..~0.6] */
  liftNorm: number;
  /** Forward lean angle in radians during travel */
  leanRad: number;
  /** Volume-preserving horizontal scale */
  scaleX: number;
  /** Volume-preserving vertical scale */
  scaleY: number;
  /** Ground shadow width multiplier */
  shadowScale: number;
  /** Ground shadow opacity [0..1] */
  shadowAlpha: number;
  /** True once the piece has entered the landing settle phase */
  landing: boolean;
};

const LANDING_SPLIT = 0.82;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.max(0, Math.min(1, value));
}

function easeInOutCubic(t: number): number {
  return t < 0.5 ? 4 * t * t * t : 1 - Math.pow(-2 * t + 2, 3) / 2;
}

/**
 * Evaluates a chess piece's parabolic flight and landing squash-and-stretch pose.
 * Knights jump along a distinctly higher arc than sliding/stepping pieces.
 */
export function evaluatePieceTravelPose(
  rawProgress: number,
  isKnight: boolean,
  horizontalDir = 1
): PieceTravelPose {
  const progress = clamp01(rawProgress);
  const dir = horizontalDir === 0 ? 1 : Math.sign(horizontalDir);

  if (progress < LANDING_SPLIT) {
    const flightT = progress / LANDING_SPLIT;
    const moveProgress = easeInOutCubic(flightT);
    // Smooth parabolic arc: 4 * t * (1 - t) peaks at 1.0 when flightT === 0.5
    const parabola = 4 * flightT * (1 - flightT);
    const arcHeight = isKnight ? 0.56 : 0.22;
    const liftNorm = parabola * arcHeight;

    // Subtle forward lean peaking mid-flight
    const leanAmp = isKnight ? 0.14 : 0.075;
    const leanRad = Math.sin(flightT * Math.PI) * leanAmp * dir;

    // Gentle airborne vertical stretch near apex
    const stretch = parabola * (isKnight ? 0.095 : 0.055);
    const scaleX = 1 - stretch * 0.55;
    const scaleY = 1 + stretch;

    return {
      progress,
      moveProgress,
      liftNorm,
      leanRad,
      scaleX,
      scaleY,
      shadowScale: Math.max(0.54, 1 - liftNorm * 0.58),
      shadowAlpha: Math.max(0.14, 0.36 - liftNorm * 0.34),
      landing: false
    };
  }

  // Tactile landing squash & elastic settle (0.82 -> 1.00)
  const settleT = (progress - LANDING_SPLIT) / (1 - LANDING_SPLIT);
  // Single damped squash pulse that returns cleanly to 0 at settleT = 1
  const impactWave = Math.sin(settleT * Math.PI) * (1 - settleT * 0.25);
  const squashAmp = isKnight ? 0.14 : 0.095;
  const scaleX = 1 + impactWave * squashAmp;
  const scaleY = 1 - impactWave * squashAmp * 0.85;

  return {
    progress,
    moveProgress: 1,
    liftNorm: 0,
    leanRad: 0,
    scaleX,
    scaleY,
    shadowScale: 1 + impactWave * 0.16,
    shadowAlpha: 0.36 + impactWave * 0.08,
    landing: true
  };
}

export type CheckPulseState = {
  /** Normalized 0..1 smooth pulse value */
  intensity: number;
  /** Subtle pulsing aura ring radius multiplier */
  ringScale: number;
  /** Crimson glow alpha */
  glowAlpha: number;
  /** Guaranteed safe pulse frequency in Hz (<= 1.8 Hz, WCAG 2.3.1 compliant) */
  frequencyHz: number;
};

/** Safe pulse frequency strictly below WCAG 2.3.1 three-flashes-per-second limit. */
export const CHECK_PULSE_FREQUENCY_HZ = 1.4;

/**
 * Evaluates a calm, readable crimson pulse around a checked king.
 */
export function evaluateCheckPulse(timeSec: number): CheckPulseState {
  const safeTime = Number.isFinite(timeSec) ? Math.max(0, timeSec) : 0;
  const intensity = 0.5 + 0.5 * Math.sin(safeTime * Math.PI * 2 * CHECK_PULSE_FREQUENCY_HZ);
  return {
    intensity,
    ringScale: 0.92 + intensity * 0.14,
    glowAlpha: 0.24 + intensity * 0.28,
    frequencyHz: CHECK_PULSE_FREQUENCY_HZ
  };
}

export type PromotionBeamPose = {
  alpha: number;
  widthScale: number;
  heightNorm: number;
  crownLiftNorm: number;
  crownAlpha: number;
};

/**
 * Evaluates the golden vertical light pillar & rising royal crown on pawn promotion.
 */
export function evaluatePromotionBeam(rawProgress: number): PromotionBeamPose {
  const t = clamp01(rawProgress);
  const fadeIn = Math.min(1, t / 0.18);
  const fadeOut = t > 0.58 ? 1 - (t - 0.58) / 0.42 : 1;
  const alpha = clamp01(fadeIn * fadeOut);
  const widthScale = 0.55 + Math.sin(Math.min(1, t * 1.4) * Math.PI * 0.5) * 0.65;
  const heightNorm = Math.min(1, t * 3.2);
  const crownLiftNorm = easeInOutCubic(t) * 0.95;
  const crownAlpha = clamp01(Math.min(1, t / 0.15) * (t > 0.65 ? 1 - (t - 0.65) / 0.35 : 1));
  return { alpha, widthScale, heightNorm, crownLiftNorm, crownAlpha };
}

export type ChessParticleKind = "dust_ring" | "capture_shard" | "ember" | "sparkle" | "confetti";

export type ChessParticle = {
  kind: ChessParticleKind;
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  drag: number;
  size: number;
  endSize: number;
  rotation: number;
  vRot: number;
  age: number;
  lifetime: number;
  alpha: number;
  color: string;
};

/**
 * Advances active particles by dt seconds and prunes expired particles.
 */
export function stepParticles(particles: readonly ChessParticle[], dt: number): ChessParticle[] {
  const safeDt = Math.max(0, Math.min(0.05, Number.isFinite(dt) ? dt : 0));
  if (safeDt === 0) return [...particles];
  const next: ChessParticle[] = [];
  for (const p of particles) {
    const age = p.age + safeDt;
    if (age >= p.lifetime) continue;
    const damping = Math.pow(p.drag, safeDt * 60);
    const vx = p.vx * damping;
    const vy = (p.vy + p.gravity * safeDt) * damping;
    next.push({
      ...p,
      age,
      vx,
      vy,
      x: p.x + vx * safeDt,
      y: p.y + vy * safeDt,
      rotation: p.rotation + p.vRot * safeDt
    });
  }
  return next;
}

export function createLandingDustParticles(
  cx: number,
  cy: number,
  cellSize: number,
  heavy = false
): ChessParticle[] {
  const particles: ChessParticle[] = [
    {
      kind: "dust_ring",
      x: cx,
      y: cy + cellSize * 0.28,
      vx: 0,
      vy: 0,
      gravity: 0,
      drag: 1,
      size: cellSize * 0.24,
      endSize: cellSize * (heavy ? 0.62 : 0.48),
      rotation: 0,
      vRot: 0,
      age: 0,
      lifetime: heavy ? 0.34 : 0.26,
      alpha: heavy ? 0.56 : 0.42,
      color: "#F7E5BE"
    }
  ];

  const puffCount = heavy ? 8 : 5;
  for (let i = 0; i < puffCount; i++) {
    const angle = (Math.PI * 2 * i) / puffCount + 0.2;
    const speed = cellSize * (heavy ? 1.15 : 0.72);
    particles.push({
      kind: "sparkle",
      x: cx + Math.cos(angle) * cellSize * 0.14,
      y: cy + cellSize * 0.28 + Math.sin(angle) * cellSize * 0.06,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed * 0.32 - cellSize * 0.22,
      gravity: cellSize * 1.4,
      drag: 0.92,
      size: Math.max(2.5, cellSize * 0.075),
      endSize: 0.5,
      rotation: angle,
      vRot: 2.4,
      age: 0,
      lifetime: 0.28 + (i % 3) * 0.05,
      alpha: 0.72,
      color: i % 2 === 0 ? "#FFF4D2" : "#E5C178"
    });
  }
  return particles;
}

export function createCaptureShardParticles(
  cx: number,
  cy: number,
  cellSize: number,
  capturedColor: "w" | "b"
): ChessParticle[] {
  const palette =
    capturedColor === "w"
      ? ["#FFF8E6", "#F6C853", "#DFC08A", "#FFFFFF"]
      : ["#5B6F93", "#DFCFA4", "#27334A", "#F6C853"];
  const count = 14;
  const particles: ChessParticle[] = [];
  for (let i = 0; i < count; i++) {
    const angle = (Math.PI * 2 * i) / count + ((i % 2) * 0.18 - 0.09);
    const speed = cellSize * (1.35 + (i % 4) * 0.42);
    particles.push({
      kind: "capture_shard",
      x: cx,
      y: cy,
      vx: Math.cos(angle) * speed,
      vy: Math.sin(angle) * speed - cellSize * 0.45,
      gravity: cellSize * 3.8,
      drag: 0.95,
      size: Math.max(3.5, cellSize * (0.09 + (i % 3) * 0.025)),
      endSize: 1,
      rotation: angle,
      vRot: (i % 2 === 0 ? 1 : -1) * (6 + (i % 4) * 2),
      age: 0,
      lifetime: 0.42 + (i % 3) * 0.09,
      alpha: 0.95,
      color: palette[i % palette.length]!
    });
  }
  return particles;
}

export function createCheckEmberParticle(
  cx: number,
  cy: number,
  cellSize: number,
  seed = Math.random()
): ChessParticle {
  const angle = seed * Math.PI * 2;
  const radius = cellSize * (0.28 + (seed * 7 % 1) * 0.14);
  return {
    kind: "ember",
    x: cx + Math.cos(angle) * radius,
    y: cy + Math.sin(angle) * radius * 0.65 + cellSize * 0.12,
    vx: Math.cos(angle) * cellSize * 0.12,
    vy: -cellSize * (0.55 + (seed * 13 % 1) * 0.35),
    gravity: -cellSize * 0.15,
    drag: 0.98,
    size: Math.max(2.5, cellSize * 0.068),
    endSize: 0.6,
    rotation: 0,
    vRot: 0,
    age: 0,
    lifetime: 0.75 + (seed * 5 % 1) * 0.35,
    alpha: 0.85,
    color: seed > 0.45 ? "#FF5252" : "#FFBE4F"
  };
}

export function createPromotionSparkles(
  cx: number,
  cy: number,
  cellSize: number
): ChessParticle[] {
  const particles: ChessParticle[] = [];
  const count = 16;
  for (let i = 0; i < count; i++) {
    const t = i / count;
    const angle = t * Math.PI * 2;
    particles.push({
      kind: "sparkle",
      x: cx + Math.cos(angle) * cellSize * 0.22,
      y: cy + cellSize * 0.25 - (i % 4) * cellSize * 0.12,
      vx: Math.cos(angle) * cellSize * 0.65,
      vy: -cellSize * (1.2 + (i % 4) * 0.38),
      gravity: cellSize * 0.65,
      drag: 0.96,
      size: Math.max(3, cellSize * (0.08 + (i % 2) * 0.035)),
      endSize: 0.5,
      rotation: angle,
      vRot: 4.2,
      age: 0,
      lifetime: 0.62 + (i % 4) * 0.1,
      alpha: 0.96,
      color: i % 3 === 0 ? "#FFFFFF" : i % 3 === 1 ? "#FFE77A" : "#F5B82E"
    });
  }
  return particles;
}

export function createVictoryConfettiParticles(
  boardWidth: number,
  boardHeight: number,
  count = 36
): ChessParticle[] {
  const colors = ["#F6C853", "#FFF2A8", "#2AE08D", "#E63950", "#58A6FF", "#FFFFFF"];
  const particles: ChessParticle[] = [];
  for (let i = 0; i < count; i++) {
    const frac = (i + 0.5) / count;
    const spread = ((i * 37) % 100) / 100;
    particles.push({
      kind: "confetti",
      x: boardWidth * (0.08 + frac * 0.84),
      y: -boardHeight * (0.04 + spread * 0.22),
      vx: (spread - 0.5) * boardWidth * 0.26,
      vy: boardHeight * (0.18 + ((i * 17) % 10) * 0.025),
      gravity: boardHeight * 0.22,
      drag: 0.985,
      size: Math.max(5, boardWidth * (0.014 + (i % 3) * 0.004)),
      endSize: Math.max(4, boardWidth * 0.012),
      rotation: spread * Math.PI * 2,
      vRot: (i % 2 === 0 ? 1 : -1) * (3.5 + (i % 4) * 1.4),
      age: 0,
      lifetime: 2.3 + (i % 5) * 0.25,
      alpha: 0.94,
      color: colors[i % colors.length]!
    });
  }
  return particles;
}
