export type JoypadDirections = {
  left: boolean;
  right: boolean;
  up: boolean;
  down: boolean;
};

export type JoypadConfig = {
  /** Maximum pixel distance the inner joystick knob can travel from the touch origin. */
  maxRadius: number;
  /** Minimum pixel displacement from origin before any direction activates. */
  deadzone: number;
  /** Minimum normalized horizontal component (|dx| / dist) required to activate left/right. */
  horizontalAxisMin: number;
  /** Minimum normalized vertical component (|dy| / dist) required to activate up/down. */
  verticalAxisMin: number;
};

export const DEFAULT_JOYPAD_CONFIG: JoypadConfig = {
  maxRadius: 44,
  deadzone: 12,
  horizontalAxisMin: 0.42,
  verticalAxisMin: 0.6
};

export type JoypadSnapshot = {
  active: boolean;
  pointerId: number | null;
  /** Touch anchor relative to the left joypad touch zone (CSS px). */
  originX: number;
  originY: number;
  /** Clamped joystick knob offset from origin (CSS px, hypot <= maxRadius). */
  knobX: number;
  knobY: number;
  /** Unclamped finger delta from origin (CSS px). */
  rawDx: number;
  rawDy: number;
  directions: JoypadDirections;
};

const NEUTRAL_DIRECTIONS: JoypadDirections = {
  left: false,
  right: false,
  up: false,
  down: false
};

/**
 * Resolves clamped knob coordinates and directional states from a raw displacement
 * vector. Finger movement beyond `maxRadius` is never rejected; only the knob circle
 * is constrained to `maxRadius`, while direction keeps tracking the live finger vector.
 */
export function evaluateJoypadVector(
  rawDx: number,
  rawDy: number,
  config: JoypadConfig = DEFAULT_JOYPAD_CONFIG
): { knobX: number; knobY: number; directions: JoypadDirections } {
  const dx = Number.isFinite(rawDx) ? rawDx : 0;
  const dy = Number.isFinite(rawDy) ? rawDy : 0;
  const dist = Math.hypot(dx, dy);

  if (dist === 0) {
    return { knobX: 0, knobY: 0, directions: { ...NEUTRAL_DIRECTIONS } };
  }

  const clampedDist = Math.min(dist, config.maxRadius);
  const scale = clampedDist / dist;
  const knobX = dx * scale;
  const knobY = dy * scale;

  if (dist < config.deadzone) {
    return { knobX, knobY, directions: { ...NEUTRAL_DIRECTIONS } };
  }

  const nx = dx / dist;
  const ny = dy / dist;

  return {
    knobX,
    knobY,
    directions: {
      left: nx <= -config.horizontalAxisMin,
      right: nx >= config.horizontalAxisMin,
      up: ny <= -config.verticalAxisMin,
      down: ny >= config.verticalAxisMin
    }
  };
}

export type JoypadZoneRect = {
  left: number;
  top: number;
  width: number;
  height: number;
};

export type MobileJoypadController = {
  readonly config: JoypadConfig;
  getState(): JoypadSnapshot;
  begin(pointerId: number, clientX: number, clientY: number, zoneRect: JoypadZoneRect): JoypadSnapshot;
  move(pointerId: number, clientX: number, clientY: number): JoypadSnapshot | null;
  end(pointerId: number): JoypadSnapshot | null;
  reset(): JoypadSnapshot;
};

export function createMobileJoypadController(
  overrides: Partial<JoypadConfig> = {}
): MobileJoypadController {
  const config: JoypadConfig = { ...DEFAULT_JOYPAD_CONFIG, ...overrides };

  let active = false;
  let pointerId: number | null = null;
  let originClientX = 0;
  let originClientY = 0;
  let originX = 0;
  let originY = 0;
  let knobX = 0;
  let knobY = 0;
  let rawDx = 0;
  let rawDy = 0;
  let directions: JoypadDirections = { ...NEUTRAL_DIRECTIONS };

  const snapshot = (): JoypadSnapshot => ({
    active,
    pointerId,
    originX,
    originY,
    knobX,
    knobY,
    rawDx,
    rawDy,
    directions: { ...directions }
  });

  return {
    config,
    getState: snapshot,

    begin(nextPointerId, clientX, clientY, zoneRect) {
      // Ignore secondary touches while a thumb is already driving the joypad.
      if (active && pointerId !== null && pointerId !== nextPointerId) {
        return snapshot();
      }
      active = true;
      pointerId = nextPointerId;
      originClientX = clientX;
      originClientY = clientY;
      originX = clientX - zoneRect.left;
      originY = clientY - zoneRect.top;
      knobX = 0;
      knobY = 0;
      rawDx = 0;
      rawDy = 0;
      directions = { ...NEUTRAL_DIRECTIONS };
      return snapshot();
    },

    move(movePointerId, clientX, clientY) {
      if (!active || pointerId !== movePointerId) return null;
      rawDx = clientX - originClientX;
      rawDy = clientY - originClientY;
      const evaluated = evaluateJoypadVector(rawDx, rawDy, config);
      knobX = evaluated.knobX;
      knobY = evaluated.knobY;
      directions = evaluated.directions;
      return snapshot();
    },

    end(endPointerId) {
      if (!active || pointerId !== endPointerId) return null;
      return this.reset();
    },

    reset() {
      active = false;
      pointerId = null;
      originClientX = 0;
      originClientY = 0;
      knobX = 0;
      knobY = 0;
      rawDx = 0;
      rawDy = 0;
      directions = { ...NEUTRAL_DIRECTIONS };
      return snapshot();
    }
  };
}
