import { VIEWPORT } from "./catalogs";

export type StageDisplayMode = "framed" | "expanded";

export type SafeInsets = {
  readonly top: number;
  readonly right: number;
  readonly bottom: number;
  readonly left: number;
};

export type TopbarOverlayRect = {
  /** Relative to the canvas top-left in CSS px. */
  readonly left: number;
  readonly top: number;
  readonly width: number;
  readonly height: number;
};

export type StageViewportState = {
  readonly mode: StageDisplayMode;
  readonly cssWidth: number;
  readonly cssHeight: number;
  readonly dpr: number;
  readonly pixelWidth: number;
  readonly pixelHeight: number;
  /** Visible world dimensions in logical world px (tileSize = 48). */
  readonly worldWidth: number;
  readonly worldHeight: number;
  /** CSS px per 1 world px. */
  readonly worldScale: number;
  /** Logical HUD canvas coordinate space dimensions. */
  readonly hudWidth: number;
  readonly hudHeight: number;
  /** CSS px per 1 HUD logical px. */
  readonly hudScale: number;
  readonly isPortrait: boolean;
  readonly mobileOverlay: boolean;
  readonly safeInsets: SafeInsets;
  /** Height (CSS px) of bottom touch controls overlapping the canvas. */
  readonly mobileControlBandCss: number;
  /** Bottom clearance (world px) so camera lifts playable terrain above touch controls. */
  readonly cameraBottomClearanceWorld: number;
  /** Measured floating topbar box relative to canvas in CSS px (null when outside canvas). */
  readonly floatingTopbarCss: TopbarOverlayRect | null;
};

export type ComputeViewportInput = {
  mode: StageDisplayMode;
  cssWidth: number;
  cssHeight: number;
  dpr?: number;
  mobileOverlay?: boolean;
  safeInsets?: Partial<SafeInsets>;
  mobileControlBandCss?: number;
  floatingTopbarCss?: TopbarOverlayRect | null;
};

export type CameraBounds = {
  minX: number;
  maxX: number;
  minY: number;
  maxY: number;
};

export type CameraTargetInput = {
  playerX: number;
  playerY: number;
  playerW: number;
  playerH: number;
  facing: number;
  stageWorldWidth: number;
  stageWorldHeight: number;
  screenWidthPx: number;
  viewport: StageViewportState;
  topHudClearanceHud?: number;
  weaponBarClearanceHud?: number;
};

const BASE_W = VIEWPORT.width;
const BASE_H = VIEWPORT.height;
const BASE_ASPECT = BASE_W / BASE_H;

/** Caps horizontal world sightline on ultra-wide displays while preserving aspect ratio. */
const MAX_WORLD_VIEW_WIDTH = 1320;
const MIN_WORLD_VIEW_HEIGHT = 420;
/** Keeps enough horizontal platforming sightline on tall portrait phones. */
const MIN_WORLD_VIEW_WIDTH = 500;

const ZERO_INSETS: SafeInsets = { top: 0, right: 0, bottom: 0, left: 0 };

function clamp(v: number, lo: number, hi: number): number {
  return Math.max(lo, Math.min(hi, v));
}

function sanitizePositive(value: number, fallback: number): number {
  return Number.isFinite(value) && value > 0 ? value : fallback;
}

function normalizeInsets(insets?: Partial<SafeInsets>): SafeInsets {
  if (!insets) return ZERO_INSETS;
  return {
    top: Math.max(0, Number.isFinite(insets.top ?? 0) ? (insets.top ?? 0) : 0),
    right: Math.max(0, Number.isFinite(insets.right ?? 0) ? (insets.right ?? 0) : 0),
    bottom: Math.max(0, Number.isFinite(insets.bottom ?? 0) ? (insets.bottom ?? 0) : 0),
    left: Math.max(0, Number.isFinite(insets.left ?? 0) ? (insets.left ?? 0) : 0)
  };
}

export function createDefaultViewportState(): StageViewportState {
  return computeStageViewport({
    mode: "framed",
    cssWidth: BASE_W,
    cssHeight: BASE_H,
    dpr: 1,
    mobileOverlay: false
  });
}

/**
 * Computes logical world size, HUD scale, backing pixel dimensions, and mobile
 * overlay clearances for both framed (960x576) and expanded/fullscreen viewports.
 * Guarantees worldWidth / worldHeight === cssWidth / cssHeight (zero stretching).
 */
export function computeStageViewport(input: ComputeViewportInput): StageViewportState {
  const dpr = clamp(sanitizePositive(input.dpr ?? 1, 1), 1, 2);
  const safeInsets = normalizeInsets(input.safeInsets);
  const mobileOverlay = Boolean(input.mobileOverlay);

  if (input.mode === "framed") {
    const cssWidth = sanitizePositive(input.cssWidth, BASE_W);
    const cssHeight = sanitizePositive(input.cssHeight, BASE_H);
    const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
    const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));
    const worldScale = cssWidth / BASE_W;
    return {
      mode: "framed",
      cssWidth,
      cssHeight,
      dpr,
      pixelWidth,
      pixelHeight,
      worldWidth: BASE_W,
      worldHeight: BASE_H,
      worldScale,
      hudWidth: BASE_W,
      hudHeight: BASE_H,
      hudScale: worldScale,
      isPortrait: cssHeight > cssWidth,
      mobileOverlay,
      safeInsets,
      mobileControlBandCss: 0,
      cameraBottomClearanceWorld: 0,
      floatingTopbarCss: null
    };
  }

  const cssWidth = Math.max(240, sanitizePositive(input.cssWidth, BASE_W));
  const cssHeight = Math.max(200, sanitizePositive(input.cssHeight, BASE_H));
  const aspect = cssWidth / cssHeight;
  const isPortrait = cssHeight > cssWidth;
  const pixelWidth = Math.max(1, Math.round(cssWidth * dpr));
  const pixelHeight = Math.max(1, Math.round(cssHeight * dpr));

  // World logical dimensions preserving exact screen aspect ratio.
  let worldWidth: number;
  let worldHeight: number;
  if (aspect >= BASE_ASPECT) {
    worldHeight = BASE_H;
    worldWidth = worldHeight * aspect;
    if (worldWidth > MAX_WORLD_VIEW_WIDTH) {
      worldWidth = MAX_WORLD_VIEW_WIDTH;
      worldHeight = worldWidth / aspect;
      if (worldHeight < MIN_WORLD_VIEW_HEIGHT) {
        worldHeight = MIN_WORLD_VIEW_HEIGHT;
        worldWidth = worldHeight * aspect;
      }
    }
  } else {
    worldWidth = clamp(BASE_W * Math.pow(aspect / BASE_ASPECT, 0.55), MIN_WORLD_VIEW_WIDTH, BASE_W);
    worldHeight = worldWidth / aspect;
  }

  const worldScale = cssWidth / worldWidth;

  // HUD logical scale stays comfortable across desktops (never giant) and phones (readable + tappable).
  const hudScale = isPortrait
    ? clamp(cssWidth / 540, 0.68, 1.05)
    : clamp(Math.min(cssWidth / BASE_W, cssHeight / BASE_H), 0.72, 1.15);
  const hudWidth = cssWidth / hudScale;
  const hudHeight = cssHeight / hudScale;

  // Bottom control band in CSS px for mobile overlay controls.
  const defaultControlBandCss = !mobileOverlay
    ? 0
    : isPortrait
      ? 156 + safeInsets.bottom
      : 108 + safeInsets.bottom;
  const mobileControlBandCss = mobileOverlay
    ? Math.max(0, Number.isFinite(input.mobileControlBandCss ?? NaN) ? input.mobileControlBandCss! : defaultControlBandCss)
    : 0;

  // Lift playable ground upward above bottom overlay controls:
  // - In portrait, reserve the full control band + weapon bar band below the playable ground.
  // - In landscape, stages already have 3 tiles (144 world px) of underground soil below groundY,
  //   so add a gentle extra lift so feet & ground mobs sit cleanly above corner thumb controls.
  let cameraBottomClearanceWorld = 0;
  if (mobileOverlay) {
    if (isPortrait) {
      // Lift ground cleanly above the bottom thumb deck + weapon bar (~46 CSS px).
      const portraitLiftCss = Math.min(cssHeight * 0.36, mobileControlBandCss + 48);
      cameraBottomClearanceWorld = Math.round(portraitLiftCss / worldScale);
    } else {
      // Subtract a portion of the built-in 3-tile underground soil already at the bottom of each stage.
      const builtInSoilCss = 88 * worldScale;
      const extraLiftCss = Math.max(24, mobileControlBandCss - builtInSoilCss * 0.75);
      cameraBottomClearanceWorld = Math.round(Math.min(cssHeight * 0.2, extraLiftCss) / worldScale);
    }
  }

  return {
    mode: "expanded",
    cssWidth,
    cssHeight,
    dpr,
    pixelWidth,
    pixelHeight,
    worldWidth,
    worldHeight,
    worldScale,
    hudWidth,
    hudHeight,
    hudScale,
    isPortrait,
    mobileOverlay,
    safeInsets,
    mobileControlBandCss,
    cameraBottomClearanceWorld,
    floatingTopbarCss: input.floatingTopbarCss ?? null
  };
}

/**
 * Computes horizontal & vertical camera bounds for a stage and viewport.
 * - Keeps the isolated final-screen portal chamber visually separated from the main
 *   course even on wide 20:9 / 21:9 aspect ratios.
 * - Allows a negative upper camera bound (`minY`) in expanded mode when top HUD /
 *   floating topbar overlays are present so players on high platforms (e.g. Stage 1
 *   chamber `iso_top`) stay clearly visible below the HUD.
 */
export function computeCameraBounds(
  stageWorldWidth: number,
  stageWorldHeight: number,
  screenWidthPx: number,
  playerCenterX: number,
  viewport: StageViewportState,
  topHudClearanceHud = 0
): CameraBounds {
  const viewW = viewport.worldWidth;
  const viewH = viewport.worldHeight;
  const chamberBoundaryX = Math.max(0, stageWorldWidth - screenWidthPx);
  const inChamber = chamberBoundaryX > 0 && playerCenterX >= chamberBoundaryX;

  let minX = 0;
  let maxX = Math.max(0, stageWorldWidth - viewW);

  if (chamberBoundaryX > 0) {
    if (inChamber) {
      const chamberWidth = stageWorldWidth - chamberBoundaryX;
      if (viewW <= chamberWidth) {
        minX = chamberBoundaryX;
        maxX = stageWorldWidth - viewW;
      } else {
        // Center the floating chamber in wide viewports without reaching back into summit_exit.
        const centeredX = chamberBoundaryX + (chamberWidth - viewW) * 0.5;
        const clampedX = Math.max(chamberBoundaryX - 240, centeredX);
        minX = clampedX;
        maxX = clampedX;
      }
    } else {
      minX = 0;
      maxX = Math.max(0, chamberBoundaryX - viewW);
    }
  }

  const topClearanceWorld =
    viewport.mode === "expanded" && topHudClearanceHud > 0
      ? clamp((topHudClearanceHud * viewport.hudScale) / viewport.worldScale, 0, viewH * 0.35)
      : 0;
  const desiredMinY = topClearanceWorld > 0 ? -Math.round(topClearanceWorld) : 0;

  const effectiveBottom = stageWorldHeight + viewport.cameraBottomClearanceWorld;
  const rawMaxY = effectiveBottom - viewH;
  const minY = Math.min(desiredMinY, rawMaxY);
  const maxY = rawMaxY;

  return { minX, maxX, minY, maxY };
}

/**
 * Computes the desired camera (x, y) keeping the player comfortably inside the
 * unobstructed playable band (clear of top HUD and bottom mobile touch controls).
 */
export function computeCameraTarget(input: CameraTargetInput): { x: number; y: number; bounds: CameraBounds } {
  const { playerX, playerY, playerW, playerH, facing, viewport } = input;
  const playerCenterX = playerX + playerW * 0.5;
  const playerCenterY = playerY + playerH * 0.5;
  const bounds = computeCameraBounds(
    input.stageWorldWidth,
    input.stageWorldHeight,
    input.screenWidthPx,
    playerCenterX,
    viewport,
    input.topHudClearanceHud ?? 0
  );

  // Use a slightly gentler look-ahead on narrow portrait screens so the player stays well centered.
  const lookAheadScale = viewport.isPortrait ? 0.45 : clamp(viewport.worldWidth / BASE_W, 0.65, 1.15);
  const lookAhead = facing * 54 * lookAheadScale;
  const anchorX = viewport.isPortrait ? 0.5 : 0.46;
  const targetX = clamp(playerCenterX + lookAhead - viewport.worldWidth * anchorX, bounds.minX, bounds.maxX);

  // Convert HUD top clearance & bottom control clearance into world px to find the clear vertical window.
  const topClearanceWorld =
    viewport.mode === "expanded" && input.topHudClearanceHud
      ? (input.topHudClearanceHud * viewport.hudScale) / viewport.worldScale
      : 0;
  const bottomControlWorld =
    viewport.mode === "expanded" && viewport.mobileOverlay
      ? Math.max(
          viewport.cameraBottomClearanceWorld,
          input.weaponBarClearanceHud ? (input.weaponBarClearanceHud * viewport.hudScale) / viewport.worldScale : 0
        )
      : 0;

  const usableTop = clamp(topClearanceWorld, 0, viewport.worldHeight * 0.35);
  const usableBottom = clamp(viewport.worldHeight - bottomControlWorld, usableTop + 140, viewport.worldHeight);
  const desiredScreenY = usableTop + (usableBottom - usableTop) * 0.55;
  const targetY = clamp(playerCenterY - desiredScreenY, bounds.minY, bounds.maxY);

  return { x: targetX, y: targetY, bounds };
}
