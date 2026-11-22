/**
 * Pure, testable animation, expression, chip-arc physics, and saloon-atmosphere
 * evaluators for Indian Poker, modeled on @bighouse/sunny-meadow's animation architecture.
 */

export type GamblerAnimState = "idle" | "thinking" | "confident" | "tense" | "win" | "lose";

export type GamblerCharacterRow = 0 | 1;

export type PlayerSpriteSheetSpec = {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  characterRows: {
    rival: GamblerCharacterRow;
    challenger: GamblerCharacterRow;
  };
  stateFrames: Record<GamblerAnimState, number>;
};

export type ChipsCardsSheetSpec = {
  frameWidth: number;
  frameHeight: number;
  columns: number;
  rows: number;
  frameCount: number;
  cells: {
    cardBack: number;
    redChipStack: number;
    greenChipStack: number;
    potMedallion: number;
  };
};

export const PLAYER_SHEET_SPEC: PlayerSpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 6,
  rows: 2,
  frameCount: 12,
  characterRows: {
    rival: 0,
    challenger: 1
  },
  stateFrames: {
    idle: 0,
    thinking: 1,
    confident: 2,
    tense: 3,
    win: 4,
    lose: 5
  }
};

export const CHIPS_CARDS_SHEET_SPEC: ChipsCardsSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  columns: 4,
  rows: 1,
  frameCount: 4,
  cells: {
    cardBack: 0,
    redChipStack: 1,
    greenChipStack: 2,
    potMedallion: 3
  }
};

export type ResolveGamblerAnimParams = {
  phase: "idle" | "betting" | "reveal" | "gameOver";
  playerId?: string | undefined;
  currentPlayerId?: string | undefined;
  lastAggressorPlayerId?: string | undefined;
  toCall?: number | undefined;
  chips?: number | undefined;
  pot?: number | undefined;
  ante?: number | undefined;
  roundWinnerPlayerId?: string | undefined;
  foldedPlayerId?: string | undefined;
  isTie?: boolean | undefined;
  matchWinnerPlayerId?: string | undefined;
};

/**
 * Resolves the current gambler portrait expression state from table state.
 */
export function resolveGamblerAnimState(params: ResolveGamblerAnimParams): GamblerAnimState {
  const { phase, playerId } = params;
  if (!playerId || phase === "idle") {
    return "idle";
  }

  if (phase === "gameOver") {
    if (!params.matchWinnerPlayerId) return "idle";
    return params.matchWinnerPlayerId === playerId ? "win" : "lose";
  }

  if (phase === "reveal") {
    if (params.foldedPlayerId === playerId) return "lose";
    if (params.isTie) return "idle";
    if (params.roundWinnerPlayerId) {
      return params.roundWinnerPlayerId === playerId ? "win" : "lose";
    }
    return "idle";
  }

  // Active betting phase
  const toCall = Math.max(0, params.toCall ?? 0);
  const chips = Math.max(0, params.chips ?? 0);
  const ante = Math.max(1, params.ante ?? 5);
  const pot = Math.max(0, params.pot ?? 0);
  const isTurn = params.currentPlayerId === playerId;
  const isAggressor = params.lastAggressorPlayerId === playerId;

  // Facing a meaningful or all-in bet triggers tense sweating
  const bigBetThreshold = Math.max(ante * 2, Math.round(chips * 0.25));
  if (toCall > 0 && (toCall >= bigBetThreshold || toCall >= chips)) {
    return "tense";
  }

  // Player who just pushed a bet or raise shows a confident smirk
  if (isAggressor && !isTurn) {
    return "confident";
  }

  if (isTurn) {
    return "thinking";
  }

  // High-stakes pot tension when waiting on opponent
  if (pot >= ante * 6 && chips <= ante * 4) {
    return "tense";
  }

  return "idle";
}

export type GamblerRenderPose = {
  /** Column index inside players_sheet.png (0..5) */
  frameIndex: number;
  /** Local horizontal offset (px) */
  offsetX: number;
  /** Local vertical offset (px, negative lifts up) */
  offsetY: number;
  /** Bottom-centered subtle rotation (rad) */
  rotation: number;
  /** Volume-preserving horizontal breath/squash multiplier */
  scaleX: number;
  /** Volume-preserving vertical breath/stretch multiplier */
  scaleY: number;
  /** Warm spotlight aura opacity multiplier (0..1) */
  glowAlpha: number;
};

export type EvaluateGamblerPoseOptions = {
  isTurn?: boolean;
  reducedMotion?: boolean;
  phaseOffset?: number;
};

/**
 * Evaluates smooth, volume-preserving character bust dynamics for a given expression state and time.
 * Honors `reducedMotion` by preserving expression frame selection while zeroing tremor and motion.
 */
export function evaluateGamblerPose(
  state: GamblerAnimState,
  time: number,
  options: EvaluateGamblerPoseOptions = {}
): GamblerRenderPose {
  const frameIndex = PLAYER_SHEET_SPEC.stateFrames[state] ?? 0;
  const isTurn = Boolean(options.isTurn);
  const reducedMotion = Boolean(options.reducedMotion);
  const t = Math.max(0, time) + (options.phaseOffset ?? 0);

  if (reducedMotion) {
    return {
      frameIndex,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      scaleX: 1,
      scaleY: 1,
      glowAlpha: state === "win" ? 0.85 : isTurn ? 0.65 : state === "confident" ? 0.45 : 0.15
    };
  }

  switch (state) {
    case "thinking": {
      const breath = Math.sin(t * 2.6);
      const lean = Math.sin(t * 1.35);
      return {
        frameIndex,
        offsetX: lean * 1.1,
        offsetY: -2.2 + breath * 1.1,
        rotation: lean * 0.028,
        scaleX: 1 - breath * 0.014,
        scaleY: 1 + breath * 0.018,
        glowAlpha: 0.62 + 0.16 * Math.sin(t * 3.1)
      };
    }

    case "confident": {
      const breath = Math.sin(t * 3.0);
      const swagger = Math.sin(t * 2.1);
      return {
        frameIndex,
        offsetX: 0,
        offsetY: -2.6 + Math.abs(breath) * -1.1,
        rotation: 0.022 + swagger * 0.02,
        scaleX: 1 + breath * 0.018,
        scaleY: 1 + 0.02 - breath * 0.014,
        glowAlpha: 0.54 + 0.14 * Math.sin(t * 2.8)
      };
    }

    case "tense": {
      // Gentle, rapid-but-small nervous shiver (well below seizure/flash thresholds)
      const tremor = Math.sin(t * 22.0) * 0.65 + Math.cos(t * 15.5) * 0.45;
      const breath = Math.sin(t * 5.2);
      return {
        frameIndex,
        offsetX: tremor * 1.25,
        offsetY: 0.6 + breath * 0.8,
        rotation: tremor * 0.012,
        scaleX: 1 + breath * 0.016,
        scaleY: 1 - breath * 0.016,
        glowAlpha: isTurn ? 0.58 : 0.32
      };
    }

    case "win": {
      const bounce = Math.abs(Math.sin(t * 4.6));
      return {
        frameIndex,
        offsetX: 0,
        offsetY: -bounce * 5.5,
        rotation: Math.sin(t * 4.6) * 0.036,
        scaleX: 1 + (0.45 - bounce) * 0.045,
        scaleY: 1 - (0.45 - bounce) * 0.045,
        glowAlpha: 0.78 + 0.18 * Math.sin(t * 4.0)
      };
    }

    case "lose": {
      const sigh = Math.sin(t * 1.6);
      return {
        frameIndex,
        offsetX: 0,
        offsetY: 3.4 + sigh * 0.9,
        rotation: -0.024 + sigh * 0.012,
        scaleX: 1.02 - sigh * 0.01,
        scaleY: 0.96 + sigh * 0.012,
        glowAlpha: 0.08
      };
    }

    case "idle":
    default: {
      const breath = Math.sin(t * 2.1);
      return {
        frameIndex,
        offsetX: 0,
        offsetY: isTurn ? -1.4 + breath * 0.8 : breath * 0.7,
        rotation: Math.sin(t * 1.05) * 0.012,
        scaleX: 1 - breath * 0.012,
        scaleY: 1 + breath * 0.015,
        glowAlpha: isTurn ? 0.55 + 0.14 * Math.sin(t * 2.8) : 0.16
      };
    }
  }
}

// ─── Flying Poker Chip Parabolic Arc Physics ─────────────────────────────────

export type ChipSpriteVariant = "red" | "green";

export type FlyingChip = {
  id: number;
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  /** Peak upward lift (px) at mid-arc */
  arcHeight: number;
  /** Delay before leaving start (seconds) */
  delay: number;
  /** Active flight elapsed time (seconds) */
  elapsed: number;
  /** Total flight duration (seconds) */
  duration: number;
  variant: ChipSpriteVariant;
  rotation: number;
  spinSpeed: number;
  scale: number;
};

export type EvaluatedFlyingChip = {
  x: number;
  y: number;
  progress: number;
  alpha: number;
  scale: number;
  rotation: number;
  visible: boolean;
  variant: ChipSpriteVariant;
};

export type CreateChipVolleyOptions = {
  startX: number;
  startY: number;
  endX: number;
  endY: number;
  count: number;
  startId?: number;
  highValue?: boolean;
  spreadPx?: number;
  duration?: number;
};

/**
 * Creates a staggered parabolic volley of poker chips between two table points.
 */
export function createChipVolley(options: CreateChipVolleyOptions): FlyingChip[] {
  const count = Math.max(1, Math.min(10, Math.round(options.count)));
  const startId = options.startId ?? 1;
  const spread = options.spreadPx ?? 18;
  const baseDur = options.duration ?? 0.52;
  const chips: FlyingChip[] = [];

  for (let i = 0; i < count; i += 1) {
    const frac = count === 1 ? 0 : (i / (count - 1)) * 2 - 1;
    const jitterX = frac * spread;
    const jitterY = ((i % 3) - 1) * (spread * 0.35);
    const variant: ChipSpriteVariant = options.highValue
      ? i % 3 === 0
        ? "red"
        : "green"
      : i % 3 === 2
        ? "green"
        : "red";
    chips.push({
      id: startId + i,
      startX: options.startX + jitterX * 0.55,
      startY: options.startY + jitterY * 0.4,
      endX: options.endX + jitterX * 0.45,
      endY: options.endY + jitterY * 0.45,
      arcHeight: 34 + (i % 3) * 14,
      delay: i * 0.045,
      elapsed: 0,
      duration: baseDur + (i % 2) * 0.06,
      variant,
      rotation: frac * 0.35,
      spinSpeed: (i % 2 === 0 ? 1 : -1) * (3.2 + (i % 3) * 1.1),
      scale: 0.78 + (i % 3) * 0.08
    });
  }

  return chips;
}

/**
 * Advances flying chips by `dt` seconds (clamped for stability) and prunes completed chips.
 */
export function stepFlyingChips(chips: readonly FlyingChip[], dt: number): FlyingChip[] {
  const safeDt = Math.max(0, Math.min(0.1, dt));
  const next: FlyingChip[] = [];

  for (const chip of chips) {
    if (chip.delay > 0) {
      const remDelay = chip.delay - safeDt;
      if (remDelay >= 0) {
        next.push({ ...chip, delay: remDelay });
        continue;
      }
      const overflow = -remDelay;
      const elapsed = chip.elapsed + overflow;
      if (elapsed < chip.duration) {
        next.push({
          ...chip,
          delay: 0,
          elapsed,
          rotation: chip.rotation + chip.spinSpeed * overflow
        });
      }
      continue;
    }

    const elapsed = chip.elapsed + safeDt;
    if (elapsed < chip.duration) {
      next.push({
        ...chip,
        elapsed,
        rotation: chip.rotation + chip.spinSpeed * safeDt
      });
    }
  }

  return next;
}

/**
 * Evaluates a flying chip's screen position along a smooth ease-out parabolic arc.
 */
export function evaluateFlyingChip(chip: FlyingChip): EvaluatedFlyingChip {
  if (chip.delay > 0) {
    return {
      x: chip.startX,
      y: chip.startY,
      progress: 0,
      alpha: 0,
      scale: chip.scale,
      rotation: chip.rotation,
      visible: false,
      variant: chip.variant
    };
  }

  const rawT = Math.max(0, Math.min(1, chip.elapsed / Math.max(0.001, chip.duration)));
  // Smooth cubic ease-out horizontally/vertically with classic parabolic 4t(1-t) lift
  const eased = 1 - (1 - rawT) ** 3;
  const lift = 4 * rawT * (1 - rawT) * chip.arcHeight;
  const x = chip.startX + (chip.endX - chip.startX) * eased;
  const y = chip.startY + (chip.endY - chip.startY) * eased - lift;
  const alpha = rawT < 0.12 ? rawT / 0.12 : rawT > 0.85 ? (1 - rawT) / 0.15 : 1;
  const scale = chip.scale * (1 + 0.18 * 4 * rawT * (1 - rawT));

  return {
    x,
    y,
    progress: rawT,
    alpha: Math.max(0, Math.min(1, alpha)),
    scale,
    rotation: chip.rotation,
    visible: true,
    variant: chip.variant
  };
}

// ─── Warm Saloon Lantern Dust Motes ──────────────────────────────────────────

export type DustMote = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  radius: number;
  baseAlpha: number;
  twinklePhase: number;
  twinkleSpeed: number;
};

export function createDustMotes(count: number, width: number, height: number): DustMote[] {
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  const motes: DustMote[] = [];
  for (let i = 0; i < count; i += 1) {
    // Deterministic golden-ratio spread so motes never cluster awkwardly
    const fx = ((i * 0.6180339887) % 1 + 1) % 1;
    const fy = ((i * 0.3819660113 + 0.17) % 1 + 1) % 1;
    motes.push({
      x: fx * safeW,
      y: fy * safeH,
      vx: ((i % 5) - 2) * 3.6,
      vy: -(5.5 + (i % 4) * 2.4),
      radius: 1.3 + (i % 3) * 0.75,
      baseAlpha: 0.16 + (i % 4) * 0.07,
      twinklePhase: i * 1.13,
      twinkleSpeed: 1.2 + (i % 4) * 0.45
    });
  }
  return motes;
}

export function stepDustMotes(
  motes: readonly DustMote[],
  dt: number,
  width: number,
  height: number
): DustMote[] {
  const safeDt = Math.max(0, Math.min(0.1, dt));
  const safeW = Math.max(1, width);
  const safeH = Math.max(1, height);
  return motes.map((mote) => {
    let x = mote.x + mote.vx * safeDt;
    let y = mote.y + mote.vy * safeDt;
    if (y < -6) {
      y = safeH + 6;
    }
    if (x < -6) {
      x = safeW + 6;
    } else if (x > safeW + 6) {
      x = -6;
    }
    return {
      ...mote,
      x,
      y,
      twinklePhase: mote.twinklePhase + mote.twinkleSpeed * safeDt
    };
  });
}

// ─── Pot Glow & High-Stakes Tension Vignette ─────────────────────────────────

export type PotGlowMetrics = {
  glowIntensity: number;
  tensionVignette: number;
  sparkleAlpha: number;
};

export function evaluatePotGlow(params: {
  pot: number;
  ante: number;
  startingChips: number;
  phase: "idle" | "betting" | "reveal" | "gameOver";
  time: number;
  reducedMotion?: boolean;
}): PotGlowMetrics {
  const ante = Math.max(1, params.ante || 5);
  const scaleRef = Math.max(ante * 8, params.startingChips || 100);
  const potNorm = Math.max(0, Math.min(1, params.pot / scaleRef));
  const pulse = params.reducedMotion ? 0.5 : 0.5 + 0.5 * Math.sin(params.time * 2.4);

  const phaseBoost = params.phase === "reveal" ? 0.25 : params.phase === "betting" ? 0.1 : 0;
  const glowIntensity = Math.max(0, Math.min(1, 0.18 + potNorm * 0.62 + phaseBoost * pulse));
  const tensionVignette =
    params.phase === "betting" ? Math.max(0, Math.min(1, (potNorm - 0.18) * 1.15)) : 0;
  const sparkleAlpha = Math.max(0, Math.min(1, potNorm * (0.45 + 0.55 * pulse)));

  return {
    glowIntensity,
    tensionVignette,
    sparkleAlpha
  };
}
