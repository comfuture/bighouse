/**
 * Modular 2D Character & Monster Animation System for Sunny Meadow Adventure.
 *
 * Replaces raw bottom-strip rectangle slicing (which severed outlines and hands)
 * with two clean, seam-free rendering pipelines:
 * 1. Multi-frame drawn sprite sheets (for Hero & key monsters) with state-driven
 *    clips (idle, walk, jump, fall, climb, hurt, stun) and speed-coupled stride cadence.
 * 2. Continuous whole-body foot-pivoted deformation profiles (volume-preserving
 *    squash & stretch, stride shear/skew, gait-specific rock/hop, and smooth
 *    continuous scanline slither for snakes) so single-frame sprites animate
 *    expressively with ZERO cut-off seams.
 */

export type ActorAnimState = "idle" | "walk" | "jump" | "fall" | "climb" | "attack" | "hurt" | "stun";

export type GaitProfileKind =
  | "sheet_biped"
  | "sheet_waddle"
  | "biped_waddle"
  | "quad_gallop"
  | "hopper_bounce"
  | "spider_scuttle"
  | "slither_wave"
  | "wing_flutter"
  | "ethereal_float";

export type AnimationClip = {
  frames: readonly number[];
  fps: number;
  loop: boolean;
};

export type SpriteSheetSpec = {
  frameWidth: number;
  frameHeight: number;
  frameCount: number;
  clips: Partial<Record<ActorAnimState, AnimationClip>>;
};

export type CharacterAnimationSpec = {
  gait: GaitProfileKind;
  /** Present when this sprite has a true multi-frame drawn sprite sheet */
  sheet?: SpriteSheetSpec;
  /** Stride cadence multiplier (radians/sec at reference speed) */
  strideFreq: number;
  /** Vertical bounce amplitude (px) while moving */
  bouncePx: number;
  /** Foot-pivoted rock rotation amplitude (rad) */
  rockRad: number;
  /** Continuous horizontal shear (skewX) amplitude for lively forward lean */
  skewAmp: number;
  /** Squash/stretch amplitude while walking */
  squashAmp: number;
};

export type ActorAnimInput = {
  spriteKey: string;
  state: ActorAnimState;
  time: number;
  speedPx: number;
  vy: number;
  grounded: boolean;
  facing: number;
};

export type ActorRenderPose = {
  /** Frame index inside the multi-frame sheet, or -1 to draw the single base image */
  frameIndex: number;
  /** Foot-anchored local offsets (px) */
  offsetX: number;
  offsetY: number;
  /** Foot-anchored rotation (rad) */
  rotation: number;
  /** Continuous horizontal shear (skewX) — keeps the entire silhouette 100% seamless */
  skewX: number;
  /** Volume-preserving scale modifiers (multiplied with entity squashX/squashY) */
  scaleX: number;
  scaleY: number;
  /** Ground shadow width multiplier */
  shadowScale: number;
  /** Optional smooth continuous scanline wave (zero discontinuity across rows) */
  wave?: {
    amplitudePx: number;
    frequency: number;
    phase: number;
  };
};

export const HERO_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  frameCount: 8,
  clips: {
    idle: { frames: [0], fps: 1, loop: true },
    walk: { frames: [1, 2, 3, 4, 5, 6], fps: 10.5, loop: true },
    jump: { frames: [7], fps: 1, loop: false },
    fall: { frames: [7], fps: 1, loop: false },
    climb: { frames: [3, 6], fps: 5.5, loop: true },
    attack: { frames: [2], fps: 1, loop: false },
    hurt: { frames: [7], fps: 1, loop: false },
    stun: { frames: [0], fps: 1, loop: true }
  }
};

export const FOUR_FRAME_WALK_SHEET_SPEC: SpriteSheetSpec = {
  frameWidth: 128,
  frameHeight: 128,
  frameCount: 4,
  clips: {
    idle: { frames: [3], fps: 1, loop: true },
    walk: { frames: [0, 1, 2, 3], fps: 7.5, loop: true },
    jump: { frames: [1], fps: 1, loop: false },
    fall: { frames: [1], fps: 1, loop: false },
    hurt: { frames: [1], fps: 1, loop: false },
    stun: { frames: [3], fps: 1, loop: true }
  }
};

export const CHARACTER_ANIMATIONS: Record<string, CharacterAnimationSpec> = {
  hero: {
    gait: "sheet_biped",
    sheet: HERO_SHEET_SPEC,
    strideFreq: 11.5,
    bouncePx: 1.6,
    rockRad: 0.025,
    skewAmp: 0.03,
    squashAmp: 0.025
  },
  red_mushroom: {
    gait: "sheet_waddle",
    sheet: FOUR_FRAME_WALK_SHEET_SPEC,
    strideFreq: 9.2,
    bouncePx: 2.0,
    rockRad: 0.04,
    skewAmp: 0.03,
    squashAmp: 0.035
  },
  yellow_hamster: {
    gait: "sheet_waddle",
    sheet: FOUR_FRAME_WALK_SHEET_SPEC,
    strideFreq: 10.5,
    bouncePx: 2.0,
    rockRad: 0.045,
    skewAmp: 0.035,
    squashAmp: 0.035
  },
  blue_rabbit: {
    gait: "hopper_bounce",
    strideFreq: 9.8,
    bouncePx: 5.5,
    rockRad: 0.07,
    skewAmp: 0.06,
    squashAmp: 0.085
  },
  emerald_frog: {
    gait: "hopper_bounce",
    strideFreq: 8.6,
    bouncePx: 5.0,
    rockRad: 0.06,
    skewAmp: 0.055,
    squashAmp: 0.095
  },
  lime_slime: {
    gait: "hopper_bounce",
    strideFreq: 8.2,
    bouncePx: 4.5,
    rockRad: 0.05,
    skewAmp: 0.08,
    squashAmp: 0.13
  },
  orange_fox: {
    gait: "quad_gallop",
    strideFreq: 12.2,
    bouncePx: 4.2,
    rockRad: 0.085,
    skewAmp: 0.075,
    squashAmp: 0.07
  },
  crimson_boar: {
    gait: "quad_gallop",
    strideFreq: 11.6,
    bouncePx: 3.4,
    rockRad: 0.075,
    skewAmp: 0.065,
    squashAmp: 0.065
  },
  cobalt_golem: {
    gait: "biped_waddle",
    strideFreq: 6.4,
    bouncePx: 2.8,
    rockRad: 0.075,
    skewAmp: 0.045,
    squashAmp: 0.06
  },
  scarlet_drake: {
    gait: "biped_waddle",
    strideFreq: 9.6,
    bouncePx: 3.6,
    rockRad: 0.065,
    skewAmp: 0.055,
    squashAmp: 0.06
  },
  violet_spider: {
    gait: "spider_scuttle",
    strideFreq: 15.5,
    bouncePx: 2.2,
    rockRad: 0.065,
    skewAmp: 0.085,
    squashAmp: 0.055
  },
  purple_snake: {
    gait: "slither_wave",
    strideFreq: 10.2,
    bouncePx: 1.4,
    rockRad: 0.04,
    skewAmp: 0.07,
    squashAmp: 0.045
  },
  sky_owl: {
    gait: "wing_flutter",
    strideFreq: 11.0,
    bouncePx: 4.5,
    rockRad: 0.06,
    skewAmp: 0.04,
    squashAmp: 0.065
  },
  teal_bat: {
    gait: "wing_flutter",
    strideFreq: 14.0,
    bouncePx: 4.8,
    rockRad: 0.075,
    skewAmp: 0.045,
    squashAmp: 0.08
  },
  gold_griffin: {
    gait: "wing_flutter",
    strideFreq: 9.5,
    bouncePx: 5.0,
    rockRad: 0.065,
    skewAmp: 0.04,
    squashAmp: 0.06
  },
  starlight_dragon: {
    gait: "wing_flutter",
    strideFreq: 8.5,
    bouncePx: 5.8,
    rockRad: 0.055,
    skewAmp: 0.035,
    squashAmp: 0.055
  },
  indigo_wisp: {
    gait: "ethereal_float",
    strideFreq: 5.2,
    bouncePx: 6.0,
    rockRad: 0.05,
    skewAmp: 0.05,
    squashAmp: 0.075
  }
};

const DEFAULT_ANIM_SPEC: CharacterAnimationSpec = {
  gait: "biped_waddle",
  strideFreq: 9.0,
  bouncePx: 3.0,
  rockRad: 0.06,
  skewAmp: 0.05,
  squashAmp: 0.055
};

export function getCharacterAnimationSpec(spriteKey: string): CharacterAnimationSpec {
  return CHARACTER_ANIMATIONS[spriteKey] ?? DEFAULT_ANIM_SPEC;
}

/**
 * Resolves the animation state from kinematics and combat status.
 */
export function resolveActorAnimState(params: {
  grounded: boolean;
  onLadder?: boolean;
  speedPx: number;
  vy: number;
  attacking?: boolean;
  hurt?: boolean;
  stunned?: boolean;
}): ActorAnimState {
  if (params.hurt) return "hurt";
  if (params.stunned) return "stun";
  if (params.onLadder) return "climb";
  if (params.attacking) return "attack";
  if (!params.grounded) return params.vy < 40 ? "jump" : "fall";
  if (params.speedPx > 10) return "walk";
  return "idle";
}

/**
 * Selects the frame index within a real multi-frame sprite sheet, or -1 if single-frame.
 */
export function selectSheetFrame(
  spec: CharacterAnimationSpec,
  state: ActorAnimState,
  time: number,
  speedPx: number,
  hasLoadedSheet: boolean
): number {
  if (!spec.sheet || !hasLoadedSheet) return -1;
  const clip = spec.sheet.clips[state] ?? spec.sheet.clips.idle;
  if (!clip || clip.frames.length === 0) return -1;
  if (clip.frames.length === 1) return clip.frames[0]!;

  // Couple walk FPS smoothly to horizontal movement speed so strides never slide unnaturally
  const speedScale =
    state === "walk" ? Math.max(0.65, Math.min(1.55, 0.55 + speedPx / 240)) : 1.0;
  const idx = Math.floor(Math.max(0, time) * clip.fps * speedScale);
  const framePos = clip.loop ? idx % clip.frames.length : Math.min(clip.frames.length - 1, idx);
  return clip.frames[framePos]!;
}

/**
 * Computes the complete, seam-free render pose for a character or monster.
 * Guarantees 100% intact silhouettes with zero rectangular limb-slicing artifacts.
 */
export function evaluateActorPose(input: ActorAnimInput, hasLoadedSheet: boolean): ActorRenderPose {
  const spec = getCharacterAnimationSpec(input.spriteKey);
  const frameIndex = selectSheetFrame(spec, input.state, input.time, input.speedPx, hasLoadedSheet);
  const speedNorm = Math.min(1.4, Math.max(0.45, input.speedPx / 160));
  const phase = input.time * spec.strideFreq * (input.state === "walk" ? speedNorm : 1);

  // 1. Hurt / Hitstun recoil pose
  if (input.state === "hurt") {
    return {
      frameIndex,
      offsetX: 0,
      offsetY: 0,
      rotation: -0.18,
      skewX: -0.1,
      scaleX: 1.08,
      scaleY: 0.92,
      shadowScale: 0.95
    };
  }

  // 2. Stunned dizzy sway pose
  if (input.state === "stun") {
    const sway = Math.sin(input.time * 9.5);
    return {
      frameIndex,
      offsetX: sway * 1.5,
      offsetY: 0,
      rotation: sway * 0.085,
      skewX: sway * 0.05,
      scaleX: 1.03,
      scaleY: 0.97,
      shadowScale: 1.0
    };
  }

  // 3. Ladder climbing pose
  if (input.state === "climb") {
    const climbWave = Math.sin(input.time * 10);
    return {
      frameIndex,
      offsetX: 0,
      offsetY: climbWave * 1.6,
      rotation: climbWave * 0.055,
      skewX: climbWave * 0.03,
      scaleX: 1,
      scaleY: 1,
      shadowScale: 0.75
    };
  }

  // 4. Airborne (jump / fall) — dynamic stretch on ascent, gentle cushion on descent
  if (!input.grounded && spec.gait !== "wing_flutter" && spec.gait !== "ethereal_float") {
    const vyNorm = Math.max(-1, Math.min(1, input.vy / 520));
    const stretch = Math.abs(vyNorm) * 0.08;
    return {
      frameIndex,
      offsetX: 0,
      offsetY: 0,
      rotation: vyNorm * 0.1,
      skewX: input.speedPx > 20 ? 0.06 : 0,
      scaleX: 1 - stretch * 0.65,
      scaleY: 1 + stretch,
      shadowScale: Math.max(0.55, 0.9 - Math.abs(vyNorm) * 0.28)
    };
  }

  // 5. Flying / Floating creatures (continuous rhythmic wingbeat or figure-8 hover)
  if (spec.gait === "wing_flutter") {
    const flap = Math.sin(input.time * spec.strideFreq);
    const lift = Math.cos(input.time * spec.strideFreq);
    return {
      frameIndex,
      offsetX: 0,
      offsetY: -lift * spec.bouncePx,
      rotation: flap * spec.rockRad + (input.speedPx > 30 ? 0.07 : 0),
      skewX: input.speedPx > 30 ? 0.05 : 0,
      scaleX: 1 + flap * spec.squashAmp,
      scaleY: 1 - flap * spec.squashAmp * 0.85,
      shadowScale: 0.78 - lift * 0.08
    };
  }

  if (spec.gait === "ethereal_float") {
    const hoverY = Math.sin(input.time * spec.strideFreq) * spec.bouncePx;
    const hoverX = Math.cos(input.time * spec.strideFreq * 0.5) * 2.5;
    const pulse = Math.sin(input.time * 4.2) * spec.squashAmp;
    return {
      frameIndex,
      offsetX: hoverX,
      offsetY: -hoverY,
      rotation: Math.sin(input.time * 2.6) * spec.rockRad,
      skewX: Math.cos(input.time * 3.1) * spec.skewAmp,
      scaleX: 1 + pulse,
      scaleY: 1 - pulse * 0.7,
      shadowScale: 0.72 + Math.sin(input.time * spec.strideFreq) * 0.08
    };
  }

  // 6. Idle breathing pose (calm, cohesive, subtle)
  if (input.state === "idle" || input.state === "attack") {
    const breath = Math.sin(input.time * 3.4);
    return {
      frameIndex,
      offsetX: 0,
      offsetY: 0,
      rotation: 0,
      skewX: input.state === "attack" ? 0.08 : 0,
      scaleX: 1 - breath * 0.018,
      scaleY: 1 + breath * 0.022,
      shadowScale: 1.0
    };
  }

  // 7. Ground walking / running poses — tailored cleanly to each gait!
  const s = Math.sin(phase);
  const c = Math.cos(phase);
  const stepArc = Math.abs(s); // 0 at foot contact, 1 at mid-stride peak

  if (frameIndex >= 0) {
    // True multi-frame drawn sprite sheet: the artwork already carries full leg & arm strides,
    // so apply only subtle, crisp secondary body dynamics (zero exaggeration, zero artifacts).
    return {
      frameIndex,
      offsetX: 0,
      offsetY: -stepArc * spec.bouncePx,
      rotation: s * spec.rockRad,
      skewX: 0.03 + c * spec.skewAmp * 0.5,
      scaleX: 1 + (0.5 - stepArc) * spec.squashAmp,
      scaleY: 1 - (0.5 - stepArc) * spec.squashAmp,
      shadowScale: 1 - stepArc * 0.1
    };
  }

  if (spec.gait === "slither_wave") {
    return {
      frameIndex: -1,
      offsetX: 0,
      offsetY: -stepArc * spec.bouncePx,
      rotation: s * spec.rockRad,
      skewX: 0.05 + c * spec.skewAmp,
      scaleX: 1 + c * spec.squashAmp,
      scaleY: 1 - c * spec.squashAmp * 0.75,
      shadowScale: 1.0 + c * 0.06,
      wave: {
        amplitudePx: 3.4,
        frequency: 0.095,
        phase
      }
    };
  }

  if (spec.gait === "quad_gallop") {
    // Energetic four-legged gallop: lean forward, stretch on push-off, compact on contact
    const push = Math.max(0, s);
    return {
      frameIndex: -1,
      offsetX: 0,
      offsetY: -stepArc * spec.bouncePx,
      rotation: -c * spec.rockRad + 0.02,
      skewX: 0.055 + s * spec.skewAmp,
      scaleX: 1 + (push - 0.35) * spec.squashAmp * 1.4,
      scaleY: 1 - (push - 0.35) * spec.squashAmp * 1.1,
      shadowScale: 1 - stepArc * 0.14
    };
  }

  if (spec.gait === "hopper_bounce") {
    // Lively bouncy gait: soft squash on contact, vertical lift at arc peak
    const lift = stepArc;
    return {
      frameIndex: -1,
      offsetX: 0,
      offsetY: -lift * spec.bouncePx,
      rotation: c * spec.rockRad,
      skewX: 0.04 + s * spec.skewAmp,
      scaleX: 1 + (0.45 - lift) * spec.squashAmp * 1.5,
      scaleY: 1 - (0.45 - lift) * spec.squashAmp * 1.5,
      shadowScale: 1 - lift * 0.18
    };
  }

  if (spec.gait === "spider_scuttle") {
    // Brisk low-to-ground skittering motion
    return {
      frameIndex: -1,
      offsetX: 0,
      offsetY: -stepArc * spec.bouncePx,
      rotation: s * spec.rockRad,
      skewX: 0.045 + c * spec.skewAmp,
      scaleX: 1 + c * spec.squashAmp,
      scaleY: 1 - c * spec.squashAmp,
      shadowScale: 1 - stepArc * 0.08
    };
  }

  // Default: biped_waddle (rhythmic alternating step rock + contact squash)
  return {
    frameIndex: -1,
    offsetX: 0,
    offsetY: -stepArc * spec.bouncePx,
    rotation: s * spec.rockRad,
    skewX: 0.035 + c * spec.skewAmp,
    scaleX: 1 + (0.5 - stepArc) * spec.squashAmp * 1.4,
    scaleY: 1 - (0.5 - stepArc) * spec.squashAmp * 1.4,
    shadowScale: 1 - stepArc * 0.12
  };
}
