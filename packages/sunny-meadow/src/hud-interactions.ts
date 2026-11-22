import { VIEWPORT } from "./catalogs";

export type HudRect = {
  readonly x: number;
  readonly y: number;
  readonly w: number;
  readonly h: number;
};

/** Logical canvas hitbox of the clickable character status card in the top-left HUD (opens Inventory). */
export const HUD_STATUS_HITBOX: HudRect = {
  x: 12,
  y: 10,
  w: 286,
  h: 82
} as const;

/** Logical canvas hitbox of the clickable Coin badge in the top-right HUD (opens Shop). */
export const HUD_COIN_HITBOX: HudRect = {
  x: VIEWPORT.width - 238,
  y: 44,
  w: 226,
  h: 32
} as const;

export type HudActionTarget = "inventory" | "shop";

export function isPointInRect(x: number, y: number, rect: HudRect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function hitTestHudPoint(logicalX: number, logicalY: number): HudActionTarget | null {
  if (isPointInRect(logicalX, logicalY, HUD_STATUS_HITBOX)) return "inventory";
  if (isPointInRect(logicalX, logicalY, HUD_COIN_HITBOX)) return "shop";
  return null;
}

export function clientPointToCanvasLogical(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number }
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * VIEWPORT.width,
    y: ((clientY - rect.top) / rect.height) * VIEWPORT.height
  };
}

/**
 * Coordinates canvas HUD press/click activation without opening modal dialogs on `pointerdown`.
 * Opening a `closedby="any"` dialog during `pointerdown` causes the matching `pointerup`
 * outside the centered modal box to light-dismiss it immediately upon release.
 */
export function createHudClickController() {
  let pressedTarget: HudActionTarget | "none" | null = null;

  return {
    onPointerDown(target: HudActionTarget | null, button = 0): void {
      if (button !== 0) {
        pressedTarget = null;
        return;
      }
      pressedTarget = target ?? "none";
    },
    onPointerCancel(): void {
      pressedTarget = null;
    },
    onClick(target: HudActionTarget | null): HudActionTarget | null {
      const armed = pressedTarget;
      pressedTarget = null;
      if (!target) return null;
      if (armed !== null && armed !== target) return null;
      return target;
    }
  };
}
