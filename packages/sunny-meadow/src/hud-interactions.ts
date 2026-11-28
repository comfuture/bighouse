import { VIEWPORT } from "./catalogs";
import { createDefaultViewportState, type StageViewportState } from "./viewport";

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
  w: 304,
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

export const HUD_WEAPON_BAR_LAYOUT = {
  maxVisible: 6,
  slotSize: 42,
  gap: 7,
  padX: 9,
  padY: 3,
  barHeight: 48,
  barBottomOffset: 58
} as const;

export type WeaponSlotHitbox = {
  readonly weaponId: string;
  readonly rect: HudRect;
};

export type HudLayout = {
  readonly hudWidth: number;
  readonly hudHeight: number;
  readonly compactTop: boolean;
  readonly statusRect: HudRect;
  readonly pointsRect: HudRect;
  readonly coinRect: HudRect;
  readonly progressRect: HudRect;
  readonly statusPillsY: number;
  readonly lowXpBannerY: number;
  readonly weaponBarRect: HudRect;
  readonly weaponSlots: WeaponSlotHitbox[];
  readonly weaponSlotSize: number;
  readonly weaponCaptionY: number;
  /** Vertical clearance occupied by the top HUD (in HUD px). */
  readonly topClearanceHud: number;
  /** Vertical clearance occupied by the bottom controls + weapon bar (in HUD px). */
  readonly bottomClearanceHud: number;
};

/**
 * Computes responsive HUD rectangles in HUD logical coordinate space (`viewport.hudWidth x viewport.hudHeight`).
 * - In framed 960x576 mode, produces the exact classic positions (HUD_STATUS_HITBOX, HUD_COIN_HITBOX, y=518 weapon bar).
 * - In wide landscape expanded/fullscreen mode, anchors HUD cleanly to safe corners and avoids any floating topbar.
 * - In narrow/portrait mode, switches to a 2-row top HUD (Status + Score/Coin on Row 1, Stage Progress on Row 2)
 *   and elevates the weapon bar cleanly above the mobile thumb control band.
 */
export function computeHudLayout(
  viewport: StageViewportState = createDefaultViewportState(),
  unlockedWeapons: readonly string[] = []
): HudLayout {
  const W = viewport.hudWidth;
  const H = viewport.hudHeight;
  const s = Math.max(0.01, viewport.hudScale);

  const isClassicFramed = viewport.mode === "framed" && W === VIEWPORT.width && H === VIEWPORT.height;

  const padL = isClassicFramed ? 12 : Math.max(10, Math.round(viewport.safeInsets.left / s) + 8);
  const padR = isClassicFramed ? 12 : Math.max(10, Math.round(viewport.safeInsets.right / s) + 8);
  const padT = isClassicFramed ? 10 : Math.max(8, Math.round(viewport.safeInsets.top / s) + 6);
  const padB = isClassicFramed ? 0 : Math.round(viewport.safeInsets.bottom / s);
  const innerW = Math.max(240, W - padL - padR);

  // Switch to compact 2-row top HUD when single-row (304 + 290 + 226 + gaps = 852) won't fit cleanly.
  const compactTop = !isClassicFramed && innerW < 840;

  let statusW = 304;
  let rightW = 226;
  let progW = 290;

  if (compactTop) {
    const gap = 8;
    statusW = Math.min(304, Math.max(210, Math.floor((innerW - gap) * 0.57)));
    rightW = Math.min(226, Math.max(168, innerW - gap - statusW));
    progW = Math.min(340, innerW);
  }

  // Check if a floating topbar overlaps the top-left, top-center, or top-right HUD cards.
  let sideTopY = padT;
  let centerTopY = padT;
  if (!isClassicFramed && viewport.floatingTopbarCss && viewport.floatingTopbarCss.height > 0) {
    const tb = viewport.floatingTopbarCss;
    const tbLeft = tb.left / s;
    const tbRight = (tb.left + tb.width) / s;
    const tbBottom = (tb.top + tb.height) / s;
    const clearedY = Math.max(padT, Math.ceil(tbBottom + 6));
    const margin = 8;

    const statusRight = padL + statusW;
    const rightLeft = W - padR - rightW;
    const overlapsLeft = tbLeft < statusRight + margin;
    const overlapsRight = tbRight > rightLeft - margin;

    if (overlapsLeft || overlapsRight) {
      sideTopY = clearedY;
      centerTopY = clearedY;
    } else {
      // Floating topbar fits cleanly in the center gap between Left Status & Right Coins!
      centerTopY = clearedY;
    }
  }

  const statusRect: HudRect = isClassicFramed
    ? HUD_STATUS_HITBOX
    : { x: padL, y: sideTopY, w: statusW, h: 82 };

  const pointsRect: HudRect = isClassicFramed
    ? { x: W - 238, y: 10, w: 226, h: 29 }
    : { x: W - padR - rightW, y: sideTopY, w: rightW, h: 29 };

  const coinRect: HudRect = isClassicFramed
    ? HUD_COIN_HITBOX
    : { x: W - padR - rightW, y: sideTopY + 34, w: rightW, h: 32 };

  const progressH = compactTop ? 38 : 56;
  const progressY = compactTop ? statusRect.y + statusRect.h + 6 : centerTopY;
  const progressRect: HudRect = {
    x: W * 0.5 - progW * 0.5,
    y: progressY,
    w: progW,
    h: progressH
  };

  const statusPillsY = compactTop ? progressRect.y + progressRect.h + 6 : statusRect.y + statusRect.h + 6;
  const lowXpBannerY = progressRect.y + progressRect.h + 6;
  const topClearanceHud = compactTop
    ? progressRect.y + progressRect.h + 8
    : Math.max(statusRect.y + statusRect.h, progressRect.y + progressRect.h) + 8;

  // Bottom weapon bar:
  // - Classic/landscape: anchored near bottom-center (safe-area aware).
  // - Portrait mobile overlay: elevated directly above the bottom thumb control band so it
  //   never collides with the left joypad or right action buttons.
  const compactSlots = !isClassicFramed && (viewport.isPortrait || innerW < 620);
  const slotSize = compactSlots ? 38 : HUD_WEAPON_BAR_LAYOUT.slotSize;
  const gap = compactSlots ? 6 : HUD_WEAPON_BAR_LAYOUT.gap;
  const padX = compactSlots ? 7 : HUD_WEAPON_BAR_LAYOUT.padX;
  const padY = HUD_WEAPON_BAR_LAYOUT.padY;
  const barHeight = slotSize + padY * 2;

  const visible = unlockedWeapons.slice(-HUD_WEAPON_BAR_LAYOUT.maxVisible);
  const totalW = visible.length * slotSize + Math.max(0, visible.length - 1) * gap + padX * 2;
  const barLeft = W * 0.5 - totalW * 0.5;

  let barTop: number;
  if (isClassicFramed) {
    barTop = H - HUD_WEAPON_BAR_LAYOUT.barBottomOffset;
  } else if (viewport.mobileOverlay && viewport.isPortrait) {
    const controlBandHud = viewport.mobileControlBandCss / s;
    barTop = H - controlBandHud - barHeight - 8;
  } else {
    barTop = H - barHeight - Math.max(10, padB + 8);
  }
  barTop = Math.max(topClearanceHud + 28, barTop);

  const weaponSlots: WeaponSlotHitbox[] = visible.map((weaponId, idx) => ({
    weaponId,
    rect: {
      x: barLeft + padX + idx * (slotSize + gap),
      y: barTop + padY,
      w: slotSize,
      h: slotSize
    }
  }));

  const weaponBarRect: HudRect = { x: barLeft, y: barTop, w: totalW, h: barHeight };
  const weaponCaptionY = barTop - 10;
  const bottomClearanceHud = Math.max(0, H - (weaponCaptionY - 12));

  return {
    hudWidth: W,
    hudHeight: H,
    compactTop,
    statusRect,
    pointsRect,
    coinRect,
    progressRect,
    statusPillsY,
    lowXpBannerY,
    weaponBarRect,
    weaponSlots,
    weaponSlotSize: slotSize,
    weaponCaptionY,
    topClearanceHud,
    bottomClearanceHud
  };
}

/**
 * Computes the logical canvas rectangles for the bottom-center unlocked weapon bar
 * and each visible weapon slot (shared by renderer and touch/click hit-testing).
 */
export function computeWeaponSlotHitboxes(
  unlockedWeapons: readonly string[],
  viewport?: StageViewportState
): {
  barRect: HudRect;
  slots: WeaponSlotHitbox[];
} {
  if (viewport) {
    const layout = computeHudLayout(viewport, unlockedWeapons);
    return { barRect: layout.weaponBarRect, slots: layout.weaponSlots };
  }
  const { maxVisible, slotSize, gap, padX, padY, barHeight, barBottomOffset } = HUD_WEAPON_BAR_LAYOUT;
  const visible = unlockedWeapons.slice(-maxVisible);
  const totalW = visible.length * slotSize + Math.max(0, visible.length - 1) * gap + padX * 2;
  const barLeft = VIEWPORT.width * 0.5 - totalW * 0.5;
  const barTop = VIEWPORT.height - barBottomOffset;
  const slots: WeaponSlotHitbox[] = visible.map((weaponId, idx) => ({
    weaponId,
    rect: {
      x: barLeft + padX + idx * (slotSize + gap),
      y: barTop + padY,
      w: slotSize,
      h: slotSize
    }
  }));
  return {
    barRect: { x: barLeft, y: barTop, w: totalW, h: barHeight },
    slots
  };
}

/**
 * Hit-tests a logical HUD point against the weapon slots,
 * applying a small non-overlapping touch cushion around each slot.
 */
export function hitTestWeaponSlotPoint(
  logicalX: number,
  logicalY: number,
  unlockedWeapons: readonly string[],
  layout?: HudLayout
): string | null {
  const slots = layout ? layout.weaponSlots : computeWeaponSlotHitboxes(unlockedWeapons).slots;
  const padX = 3;
  const padY = 6;
  for (const slot of slots) {
    const r = slot.rect;
    if (
      logicalX >= r.x - padX &&
      logicalX <= r.x + r.w + padX &&
      logicalY >= r.y - padY &&
      logicalY <= r.y + r.h + padY
    ) {
      return slot.weaponId;
    }
  }
  return null;
}

export function isPointInRect(x: number, y: number, rect: HudRect): boolean {
  return x >= rect.x && x <= rect.x + rect.w && y >= rect.y && y <= rect.y + rect.h;
}

export function hitTestHudPoint(logicalX: number, logicalY: number, layout?: HudLayout): HudActionTarget | null {
  const statusRect = layout ? layout.statusRect : HUD_STATUS_HITBOX;
  const coinRect = layout ? layout.coinRect : HUD_COIN_HITBOX;
  if (isPointInRect(logicalX, logicalY, statusRect)) return "inventory";
  if (isPointInRect(logicalX, logicalY, coinRect)) return "shop";
  return null;
}

export function clientPointToCanvasLogical(
  clientX: number,
  clientY: number,
  rect: { left: number; top: number; width: number; height: number },
  logicalSize: { width: number; height: number } = { width: VIEWPORT.width, height: VIEWPORT.height }
): { x: number; y: number } | null {
  if (rect.width <= 0 || rect.height <= 0) return null;
  return {
    x: ((clientX - rect.left) / rect.width) * logicalSize.width,
    y: ((clientY - rect.top) / rect.height) * logicalSize.height
  };
}

/**
 * Coordinates canvas HUD press/click activation without opening modal dialogs on `pointerdown`.
 * Opening a `closedby="any"` dialog during `pointerdown` causes the matching `pointerup`
 * outside the centered modal box to light-dismiss it immediately upon release.
 *
 * State semantics:
 * - `null`: no pointerdown observed yet (allows direct programmatic/accessibility `click`).
 * - `"none"`: pointerdown started outside a HUD target, via non-primary button, or was cancelled;
 *   rejects the subsequent `click` so cross-region drags or cancelled gestures never misfire.
 * - `"inventory" | "shop"`: pointerdown started inside that HUD target; activates only if `click`
 *   completes inside the same target.
 */
export function createHudClickController() {
  let pressedTarget: HudActionTarget | "none" | null = null;

  return {
    onPointerDown(target: HudActionTarget | null, button = 0): void {
      if (button !== 0) {
        pressedTarget = "none";
        return;
      }
      pressedTarget = target ?? "none";
    },
    onPointerCancel(): void {
      pressedTarget = "none";
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
