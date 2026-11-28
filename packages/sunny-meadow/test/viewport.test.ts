import { describe, expect, it } from "vitest";
import { VIEWPORT } from "../src/catalogs";
import {
  clientPointToCanvasLogical,
  computeHudLayout,
  hitTestHudPoint,
  hitTestWeaponSlotPoint,
  HUD_COIN_HITBOX,
  HUD_STATUS_HITBOX,
  type HudRect
} from "../src/hud-interactions";
import {
  computeCameraBounds,
  computeCameraTarget,
  computeStageViewport,
  createDefaultViewportState
} from "../src/viewport";

function rectsOverlap(a: HudRect, b: HudRect): boolean {
  return a.x < b.x + b.w && a.x + a.w > b.x && a.y < b.y + b.h && a.y + a.h > b.y;
}

describe("@bighouse/sunny-meadow responsive stage viewport & aspect-ratio framing", () => {
  it("preserves exact 960x576 logical coordinates and classic HUD geometry in framed mode", () => {
    const vp = createDefaultViewportState();
    expect(vp.mode).toBe("framed");
    expect(vp.worldWidth).toBe(VIEWPORT.width);
    expect(vp.worldHeight).toBe(VIEWPORT.height);
    expect(vp.hudWidth).toBe(VIEWPORT.width);
    expect(vp.hudHeight).toBe(VIEWPORT.height);
    expect(vp.cameraBottomClearanceWorld).toBe(0);

    const hud = computeHudLayout(vp, ["wooden_sword", "leaf_blade"]);
    expect(hud.compactTop).toBe(false);
    expect(hud.statusRect).toEqual(HUD_STATUS_HITBOX);
    expect(hud.coinRect).toEqual(HUD_COIN_HITBOX);
    expect(hud.weaponBarRect.y).toBe(518);
  });

  it("matches exact screen aspect ratio with zero stretching across wide, tablet, and portrait screens", () => {
    const cases = [
      { label: "desktop 16:9", cssWidth: 1920, cssHeight: 1080, mobileOverlay: false },
      { label: "ultrawide 21:9", cssWidth: 2560, cssHeight: 1080, mobileOverlay: false },
      { label: "phone landscape 20:9", cssWidth: 915, cssHeight: 412, mobileOverlay: true },
      { label: "phone landscape 19.5:9", cssWidth: 844, cssHeight: 390, mobileOverlay: true },
      { label: "tablet 4:3", cssWidth: 1024, cssHeight: 768, mobileOverlay: true },
      { label: "phone portrait 9:19.5", cssWidth: 390, cssHeight: 844, mobileOverlay: true },
      { label: "compact Android portrait", cssWidth: 360, cssHeight: 800, mobileOverlay: true }
    ];

    for (const c of cases) {
      const vp = computeStageViewport({
        mode: "expanded",
        cssWidth: c.cssWidth,
        cssHeight: c.cssHeight,
        dpr: 2,
        mobileOverlay: c.mobileOverlay
      });

      const screenAspect = c.cssWidth / c.cssHeight;
      const worldAspect = vp.worldWidth / vp.worldHeight;
      const hudAspect = vp.hudWidth / vp.hudHeight;

      expect(worldAspect, `${c.label} world aspect`).toBeCloseTo(screenAspect, 4);
      expect(hudAspect, `${c.label} hud aspect`).toBeCloseTo(screenAspect, 4);
      expect(vp.pixelWidth).toBe(Math.round(c.cssWidth * 2));
      expect(vp.pixelHeight).toBe(Math.round(c.cssHeight * 2));
      // Even narrow portrait phones keep >= 500px horizontal platforming sightline
      expect(vp.worldWidth).toBeGreaterThanOrEqual(500);
      // Ultrawide monitors never reveal more than ~27.5 tiles horizontally
      expect(vp.worldWidth).toBeLessThanOrEqual(1320);
    }
  });

  it("keeps desktop fullscreen HUD crisp and avoids overlapping a centered floating topbar", () => {
    const vp = computeStageViewport({
      mode: "expanded",
      cssWidth: 1920,
      cssHeight: 1080,
      dpr: 1,
      mobileOverlay: false,
      floatingTopbarCss: { left: 660, top: 8, width: 600, height: 38 }
    });
    const hud = computeHudLayout(vp, ["wooden_sword", "leaf_blade", "star_wand"]);

    expect(hud.compactTop).toBe(false);
    // Centered topbar fits cleanly between Left Status and Right Coin pill, so only Center Progress shifts down
    expect(hud.statusRect.y).toBeLessThan(hud.progressRect.y);
    expect(hud.pointsRect.y).toBe(hud.statusRect.y);
    expect(hud.progressRect.y).toBeGreaterThanOrEqual(Math.ceil((8 + 38) / vp.hudScale));
    expect(rectsOverlap(hud.statusRect, hud.progressRect)).toBe(false);
    expect(rectsOverlap(hud.progressRect, hud.pointsRect)).toBe(false);
    expect(rectsOverlap(hud.progressRect, hud.coinRect)).toBe(false);
  });

  it("switches to a non-overlapping 2-row top HUD and elevates the weapon bar above thumb controls on mobile portrait", () => {
    const safeBottom = 34;
    const vp = computeStageViewport({
      mode: "expanded",
      cssWidth: 390,
      cssHeight: 844,
      dpr: 2,
      mobileOverlay: true,
      safeInsets: { top: 47, bottom: safeBottom },
      mobileControlBandCss: 158 + safeBottom,
      floatingTopbarCss: { left: 45, top: 53, width: 300, height: 38 }
    });

    const unlocked = ["wooden_sword", "leaf_blade", "star_wand", "golden_hammer", "maple_greatsword", "dragon_blade"];
    const hud = computeHudLayout(vp, unlocked);

    expect(vp.isPortrait).toBe(true);
    expect(hud.compactTop).toBe(true);
    // Topbar overlaps horizontal span on portrait -> all top HUD cards drop cleanly below topbar
    const topbarBottomHud = (53 + 38) / vp.hudScale;
    expect(hud.statusRect.y).toBeGreaterThanOrEqual(topbarBottomHud);
    expect(hud.pointsRect.y).toBeGreaterThanOrEqual(topbarBottomHud);

    // Zero overlaps between any top HUD panels
    expect(rectsOverlap(hud.statusRect, hud.pointsRect)).toBe(false);
    expect(rectsOverlap(hud.statusRect, hud.coinRect)).toBe(false);
    expect(rectsOverlap(hud.statusRect, hud.progressRect)).toBe(false);
    expect(rectsOverlap(hud.pointsRect, hud.progressRect)).toBe(false);
    expect(rectsOverlap(hud.coinRect, hud.progressRect)).toBe(false);

    // Weapon bar sits cleanly above the mobile control band so left joypad & right action buttons never collide with it
    const controlBandTopHud = hud.hudHeight - vp.mobileControlBandCss / vp.hudScale;
    expect(hud.weaponBarRect.y + hud.weaponBarRect.h).toBeLessThanOrEqual(controlBandTopHud);

    // Pointer hit-testing aligns cleanly with the dynamic portrait HUD
    const canvasRect = { left: 0, top: 0, width: 390, height: 844 };
    const shopClientX = ((hud.coinRect.x + hud.coinRect.w * 0.5) / hud.hudWidth) * 390;
    const shopClientY = ((hud.coinRect.y + hud.coinRect.h * 0.5) / hud.hudHeight) * 844;
    const pt = clientPointToCanvasLogical(shopClientX, shopClientY, canvasRect, {
      width: hud.hudWidth,
      height: hud.hudHeight
    })!;
    expect(hitTestHudPoint(pt.x, pt.y, hud)).toBe("shop");

    const thirdSlot = hud.weaponSlots[2]!;
    expect(
      hitTestWeaponSlotPoint(
        thirdSlot.rect.x + thirdSlot.rect.w * 0.5,
        thirdSlot.rect.y + thirdSlot.rect.h * 0.5,
        unlocked,
        hud
      )
    ).toBe("star_wand");
  });

  it("lifts ground-floor camera framing above mobile overlay controls so gameplay is not obscured", () => {
    const stageW = 200 * 48; // 9600
    const stageH = 18 * 48; // 864 (ground surface at y = 15 * 48 = 720)
    const groundSurfaceY = 15 * 48;
    const playerH = 42;
    const playerOnGroundY = groundSurfaceY - playerH;

    // Landscape mobile (844x390)
    const landscapeVp = computeStageViewport({
      mode: "expanded",
      cssWidth: 844,
      cssHeight: 390,
      mobileOverlay: true,
      mobileControlBandCss: 112
    });
    expect(landscapeVp.cameraBottomClearanceWorld).toBeGreaterThan(0);

    const landscapeHud = computeHudLayout(landscapeVp, ["wooden_sword"]);
    const landCam = computeCameraTarget({
      playerX: 400,
      playerY: playerOnGroundY,
      playerW: 28,
      playerH,
      facing: 1,
      stageWorldWidth: stageW,
      stageWorldHeight: stageH,
      screenWidthPx: 960,
      viewport: landscapeVp,
      topHudClearanceHud: landscapeHud.topClearanceHud,
      weaponBarClearanceHud: landscapeHud.bottomClearanceHud
    });
    const landGroundScreenCss = (groundSurfaceY - landCam.y) * landscapeVp.worldScale;
    // Ground sits comfortably above the bottom edge (leaving clear room for corner controls)
    expect(390 - landGroundScreenCss).toBeGreaterThanOrEqual(115);

    // Portrait mobile (390x844)
    const portraitVp = computeStageViewport({
      mode: "expanded",
      cssWidth: 390,
      cssHeight: 844,
      mobileOverlay: true,
      safeInsets: { top: 47, bottom: 34 },
      mobileControlBandCss: 192
    });
    const portraitHud = computeHudLayout(portraitVp, ["wooden_sword"]);
    const portCam = computeCameraTarget({
      playerX: 400,
      playerY: playerOnGroundY,
      playerW: 28,
      playerH,
      facing: 1,
      stageWorldWidth: stageW,
      stageWorldHeight: stageH,
      screenWidthPx: 960,
      viewport: portraitVp,
      topHudClearanceHud: portraitHud.topClearanceHud,
      weaponBarClearanceHud: portraitHud.bottomClearanceHud
    });
    const portGroundScreenCss = (groundSurfaceY - portCam.y) * portraitVp.worldScale;
    // Player standing on the ground sits completely above the bottom thumb deck + weapon bar
    expect(844 - portGroundScreenCss).toBeGreaterThanOrEqual(220);
    // And well below the top HUD
    expect(portGroundScreenCss).toBeGreaterThan(portraitHud.topClearanceHud * portraitVp.hudScale + 40);
  });

  it("keeps the isolated final-screen portal chamber visually separated even on wide aspect ratios", () => {
    const stageW = 200 * 48; // 9600 (main course: 0..8640, isolated chamber: 8640..9600)
    const stageH = 18 * 48;
    const wideVp = computeStageViewport({
      mode: "expanded",
      cssWidth: 915,
      cssHeight: 412,
      mobileOverlay: true
    });
    expect(wideVp.worldWidth).toBeGreaterThan(1200);

    // Player near summit exit in main course -> right edge of camera never crosses chamberBoundaryX (8640)
    const mainBounds = computeCameraBounds(stageW, stageH, 960, 8200, wideVp);
    expect(mainBounds.maxX + wideVp.worldWidth).toBeLessThanOrEqual(8640.5);

    // Player inside isolated chamber -> camera centers the chamber without reaching back into summit platforms (<= 8352)
    const chamberBounds = computeCameraBounds(stageW, stageH, 960, 9000, wideVp);
    expect(chamberBounds.minX).toBeGreaterThanOrEqual(8640 - 240);
    expect(chamberBounds.maxX).toBe(chamberBounds.minX);
  });
});
