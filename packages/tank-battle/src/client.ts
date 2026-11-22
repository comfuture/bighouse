import "./style.css";
import Phaser from "phaser";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import { triggerPlacementFeedback, triggerSelectionFeedback } from "@bighouse/game-sdk/feedback";
import { createGameUi, type MountedGameUi } from "@bighouse/ui";
import skyBackdropUrl from "./assets/images/sky_backdrop.png?url";
import parallaxMountainsUrl from "./assets/images/parallax_mountains.png?url";
import cloudsSheetUrl from "./assets/images/clouds_sheet.png?url";
import terrainTileUrl from "./assets/images/terrain_tile.png?url";
import tanksSheetUrl from "./assets/images/tanks_sheet.png?url";
import barrelProjectileSheetUrl from "./assets/images/barrel_projectile_sheet.png?url";
import explosionSheetUrl from "./assets/images/explosion_sheet.png?url";
import itemsSheetUrl from "./assets/images/items_sheet.png?url";
import {
  BARREL_FRAME_INDEX,
  BARREL_PROJECTILE_SHEET_SPEC,
  CLOUDS_SHEET_SPEC,
  EXPLOSION_SHEET_SPEC,
  ITEM_ICON_FRAME,
  ITEMS_SHEET_SPEC,
  PROJECTILE_FRAME_BY_ITEM,
  TANK_SHEET_SPEC,
  createInitialClouds,
  createInitialWindStreaks,
  evaluateTankPose,
  resolveTankAnimState,
  selectExplosionFrame,
  stepCloudDrift,
  stepWindStreaks,
  type DriftingCloud,
  type WindStreak
} from "./animation";
import { createTankBattleAudio, type TankBattleAudioController } from "./audio";
import { clamp, simulateTrajectory, tankFacing } from "./physics";
import type {
  LastShot,
  TankBattlePrivateView,
  TankBattlePublicView,
  TankItemSelection
} from "./types";
export { gameMetadata } from "./client-metadata";

type TankBattleClient = {
  playerId: string;
  version: number;
  serverTime: number;
  /** `performance.now()` when the snapshot carrying `serverTime` arrived. */
  receivedAt: number;
  connected: boolean;
  /** Bumped by the host whenever the server rejects one of this player's actions. */
  actionErrorRevision: number;
  publicView: TankBattlePublicView;
  privateView: TankBattlePrivateView;
  sendAction(action: { type: string; payload: Record<string, unknown> }): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

type BattleButton = {
  container: Phaser.GameObjects.Container;
  background: Phaser.GameObjects.Rectangle;
  label: Phaser.GameObjects.Text;
  icon?: Phaser.GameObjects.Sprite;
};

type TankVisual = {
  aura: Phaser.GameObjects.Arc;
  barrel: Phaser.GameObjects.Sprite;
  hull: Phaser.GameObjects.Sprite;
};

type ActiveExplosion = {
  sprite: Phaser.GameObjects.Sprite;
  startedAt: number;
  durationMs: number;
};

type ShotAnimation = {
  shot: LastShot;
  startedAt: number;
  baseView: TankBattlePublicView;
  exploded: boolean;
  lastTrailAt: number;
};

type QueuedShotAnimation = Pick<ShotAnimation, "shot" | "baseView">;

type TankBattleLocalState = {
  selectedItem: TankItemSelection;
  angle: number;
  power: number;
  lastOwnShotPower?: number;
};

type TankBattleLayout = {
  mode: "standard" | "compact-landscape";
  width: number;
  height: number;
  battleWidth: number;
  battleHeight: number;
  aimWidth: number;
  aimHeight: number;
  hudCenterX: number;
  playerRightX: number;
  angle: {
    minusX: number;
    plusX: number;
    y: number;
    buttonWidth: number;
    buttonHeight: number;
    textX: number;
    textY: number;
    helpY: number;
  };
  items: {
    startX: number;
    startY: number;
    stepX: number;
    stepY: number;
    width: number;
    height: number;
    fontSize: number;
  };
  mute: {
    x: number;
    y: number;
    width: number;
    height: number;
    fontSize: number;
  };
  power: {
    textX: number;
    textY: number;
    gaugeX: number;
    gaugeY: number;
    gaugeWidth: number;
    gaugeHeight: number;
    markerLabelY: number;
    labelsY: number;
    helpX: number;
    helpY: number;
  };
  fire: { x: number; y: number; width: number; height: number; fontSize: number };
};

const standardLayout: TankBattleLayout = {
  mode: "standard",
  width: 1000,
  height: 800,
  battleWidth: 1000,
  battleHeight: 600,
  aimWidth: 1000,
  aimHeight: 800,
  hudCenterX: 500,
  playerRightX: 972,
  angle: {
    minusX: 54,
    plusX: 254,
    y: 653,
    buttonWidth: 72,
    buttonHeight: 56,
    textX: 154,
    textY: 638,
    helpY: 674
  },
  items: {
    startX: 385,
    startY: 650,
    stepX: 162,
    stepY: 0,
    width: 152,
    height: 62,
    fontSize: 13
  },
  mute: {
    x: 896,
    y: 650,
    width: 168,
    height: 56,
    fontSize: 15
  },
  power: {
    textX: 36,
    textY: 744,
    gaugeX: 166,
    gaugeY: 744,
    gaugeWidth: 488,
    gaugeHeight: 20,
    markerLabelY: 718,
    labelsY: 774,
    helpX: 410,
    helpY: 774
  },
  fire: { x: 838, y: 753, width: 276, height: 64, fontSize: 20 }
};

const compactLandscapeLayout: TankBattleLayout = {
  mode: "compact-landscape",
  width: 1500,
  height: 800,
  battleWidth: 1000,
  battleHeight: 600,
  aimWidth: 1000,
  aimHeight: 600,
  hudCenterX: 500,
  playerRightX: 972,
  angle: {
    minusX: 1092,
    plusX: 1408,
    y: 140,
    buttonWidth: 144,
    buttonHeight: 144,
    textX: 1250,
    textY: 88,
    helpY: 190
  },
  items: {
    startX: 1092,
    startY: 318,
    stepX: 158,
    stepY: 0,
    width: 144,
    height: 144,
    fontSize: 13
  },
  mute: {
    x: 118,
    y: 656,
    width: 188,
    height: 62,
    fontSize: 16
  },
  power: {
    textX: 1038,
    textY: 494,
    gaugeX: 1110,
    gaugeY: 486,
    gaugeWidth: 344,
    gaugeHeight: 24,
    markerLabelY: 448,
    labelsY: 530,
    helpX: 1282,
    helpY: 556
  },
  fire: { x: 1250, y: 687, width: 420, height: 144, fontSize: 22 }
};

const compactLandscapeQuery = "(orientation: landscape) and (max-height: 520px)";
const reducedMotionQuery = "(prefers-reduced-motion: reduce)";
const ANGLE_MIN = 10;
const ANGLE_MAX = 80;
const IMPACT_EFFECT_MS = 950;
const EXPLOSION_ANIM_MS = 520;
const FIRE_POSE_MS = 420;
const HIT_POSE_MS = 460;
const MAX_WIND_SPEED = 12;

const TEX_SKY = "tb-sky-backdrop";
const TEX_MOUNTAINS = "tb-parallax-mountains";
const TEX_CLOUDS = "tb-clouds";
const TEX_TERRAIN_TILE = "tb-terrain-tile";
const TEX_TERRAIN_CANVAS = "tb-terrain-canvas";
const TEX_TANKS = "tb-tanks";
const TEX_WEAPONS = "tb-weapons";
const TEX_EXPLOSION = "tb-explosion";
const TEX_ITEMS = "tb-items";

const TANK_SPRITE_SCALE = 0.72;
const TANK_GROUND_ORIGIN_Y = 108 / 128;
const BARREL_SPRITE_SCALE = 0.52;
const BARREL_PIVOT_ORIGIN_X = 25 / 128;

const itemLabels: Record<Exclude<TankItemSelection, "none">, string> = {
  megaBlast: "광역 폭탄",
  warhead: "고폭탄",
  scope: "궤도 스코프"
};

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  const callbacks = {
    sendAction: context.sendAction,
    requestPlayAgain: context.requestPlayAgain,
    leaveFinishedGame: context.leaveFinishedGame
  };
  let client = toTankBattleClient(context, callbacks, undefined);
  const surface = document.createElement("div");
  surface.className = "game-contained-surface tank-battle-game";
  container.replaceChildren(surface);

  const layoutMedia = window.matchMedia(compactLandscapeQuery);
  let scene: TankBattleScene;
  let game: Phaser.Game;
  let chatOpen = false;
  const startPhaser = (layout: TankBattleLayout, localState?: TankBattleLocalState): void => {
    scene = new TankBattleScene(() => client, layout, localState);
    game = new Phaser.Game({
      type: Phaser.AUTO,
      parent: surface,
      width: layout.width,
      height: layout.height,
      backgroundColor: "#0a1228",
      render: { antialias: true, pixelArt: false, roundPixels: false },
      scale: {
        mode: Phaser.Scale.FIT,
        autoCenter: Phaser.Scale.CENTER_BOTH,
        width: layout.width,
        height: layout.height
      },
      scene: [scene]
    });
    if (chatOpen && game.input.keyboard) game.input.keyboard.enabled = false;
  };
  startPhaser(layoutMedia.matches ? compactLandscapeLayout : standardLayout);
  const gameUi = createGameUi(container, context, context);
  syncResultDialog(gameUi, client);
  const handleChatOpenChange = (event: Event): void => {
    chatOpen = (event as CustomEvent<{ open: boolean }>).detail.open;
    if (game.input.keyboard) game.input.keyboard.enabled = !chatOpen;
  };
  container.addEventListener("bighouse-chat-open-change", handleChatOpenChange);
  const handleLayoutChange = (event: MediaQueryListEvent): void => {
    const localState = scene.captureLocalState();
    scene.prepareDestroy();
    game.destroy(true, false);
    surface.replaceChildren();
    startPhaser(event.matches ? compactLandscapeLayout : standardLayout, localState);
  };
  layoutMedia.addEventListener("change", handleLayoutChange);
  container.classList.add("tank-battle-host");

  return {
    update(nextContext) {
      const previous = client;
      client = toTankBattleClient({ ...context, ...nextContext }, callbacks, previous);
      gameUi.update(nextContext);
      syncResultDialog(gameUi, client);
      scene.applySnapshot(client, previous);
    },
    destroy() {
      container.classList.remove("tank-battle-host");
      layoutMedia.removeEventListener("change", handleLayoutChange);
      container.removeEventListener("bighouse-chat-open-change", handleChatOpenChange);
      gameUi.destroy();
      scene.prepareDestroy();
      game.destroy(true, false);
      surface.remove();
    }
  };
}

class TankBattleScene extends Phaser.Scene {
  private readonly getClient: () => TankBattleClient;
  private readonly layout: TankBattleLayout;
  private readonly audio: TankBattleAudioController = createTankBattleAudio();

  private skyImage?: Phaser.GameObjects.Image;
  private mountainImage?: Phaser.GameObjects.Image;
  private cloudSprites: Phaser.GameObjects.Sprite[] = [];
  private cloudStates: DriftingCloud[] = [];
  private windStreaks: WindStreak[] = [];
  private windStreakGraphics?: Phaser.GameObjects.Graphics;

  private terrainCanvasTexture?: Phaser.Textures.CanvasTexture;
  private terrainImage?: Phaser.GameObjects.Image;
  private terrainFallbackGraphics?: Phaser.GameObjects.Graphics;
  private initialTerrain: number[] = [];
  private lastTerrainSignature = "";

  private readonly tankVisuals = new Map<string, TankVisual>();
  private tankOverlayGraphics?: Phaser.GameObjects.Graphics;
  private previewGraphics?: Phaser.GameObjects.Graphics;
  private hudGraphics?: Phaser.GameObjects.Graphics;
  private windGraphics?: Phaser.GameObjects.Graphics;
  private powerGaugeGraphics?: Phaser.GameObjects.Graphics;
  private projectileSprite?: Phaser.GameObjects.Sprite;

  private statusText?: Phaser.GameObjects.Text;
  private windText?: Phaser.GameObjects.Text;
  private gravityText?: Phaser.GameObjects.Text;
  private angleText?: Phaser.GameObjects.Text;
  private powerText?: Phaser.GameObjects.Text;
  private lastPowerText?: Phaser.GameObjects.Text;
  private playerTexts: Phaser.GameObjects.Text[] = [];
  private itemButtons = new Map<Exclude<TankItemSelection, "none">, BattleButton>();
  private angleButtons: BattleButton[] = [];
  private fireButton?: BattleButton;
  private muteButton?: BattleButton;

  private selectedItem: TankItemSelection = "none";
  private angle = 45;
  private power = 55;
  private lastOwnShotPower: number | undefined;
  private chargeStartedAt: number | undefined;
  private chargingPointerId: number | undefined;
  private awaitingSnapshot = false;
  private shotAnimation: ShotAnimation | undefined;
  private readonly shotAnimationQueue: QueuedShotAnimation[] = [];
  private readonly activeExplosions: ActiveExplosion[] = [];
  private readonly tankFireTimes = new Map<string, number>();
  private readonly tankHitTimes = new Map<string, number>();
  private readonly shownDamageShotIds = new Set<number>();
  private seenShotId: number | undefined;
  private playedOutcomeKey: string | undefined;
  private lastUiSecond = -1;
  private lastSmokeEmitAt = 0;
  private readonly heldAngleKeys = new Set<string>();
  private angleHoldStartedAt: number | undefined;
  private nextGearCreakAt = 0;
  private activeAimPointerId: number | undefined;
  private flightSafetyTimer: Phaser.Time.TimerEvent | undefined;
  private soundingShotId: number | undefined;

  private reducedMotion = false;
  private reducedMotionMedia?: MediaQueryList;
  private handleReducedMotionChange?: (event: MediaQueryListEvent) => void;

  constructor(getClient: () => TankBattleClient, layout: TankBattleLayout, localState?: TankBattleLocalState) {
    super({ key: "tank-battle" });
    this.getClient = getClient;
    this.layout = layout;
    if (localState) {
      this.selectedItem = localState.selectedItem;
      this.angle = localState.angle;
      this.power = localState.power;
      this.lastOwnShotPower = localState.lastOwnShotPower;
    }
  }

  captureLocalState(): TankBattleLocalState {
    return {
      selectedItem: this.selectedItem,
      angle: this.angle,
      power: this.power,
      ...(this.lastOwnShotPower === undefined ? {} : { lastOwnShotPower: this.lastOwnShotPower })
    };
  }

  preload(): void {
    this.load.image(TEX_SKY, skyBackdropUrl);
    this.load.image(TEX_MOUNTAINS, parallaxMountainsUrl);
    this.load.image(TEX_TERRAIN_TILE, terrainTileUrl);
    this.load.spritesheet(TEX_CLOUDS, cloudsSheetUrl, {
      frameWidth: CLOUDS_SHEET_SPEC.frameWidth,
      frameHeight: CLOUDS_SHEET_SPEC.frameHeight
    });
    this.load.spritesheet(TEX_TANKS, tanksSheetUrl, {
      frameWidth: TANK_SHEET_SPEC.frameWidth,
      frameHeight: TANK_SHEET_SPEC.frameHeight
    });
    this.load.spritesheet(TEX_WEAPONS, barrelProjectileSheetUrl, {
      frameWidth: BARREL_PROJECTILE_SHEET_SPEC.frameWidth,
      frameHeight: BARREL_PROJECTILE_SHEET_SPEC.frameHeight
    });
    this.load.spritesheet(TEX_EXPLOSION, explosionSheetUrl, {
      frameWidth: EXPLOSION_SHEET_SPEC.frameWidth,
      frameHeight: EXPLOSION_SHEET_SPEC.frameHeight
    });
    this.load.spritesheet(TEX_ITEMS, itemsSheetUrl, {
      frameWidth: ITEMS_SHEET_SPEC.frameWidth,
      frameHeight: ITEMS_SHEET_SPEC.frameHeight
    });
  }

  create(): void {
    this.setupReducedMotion();
    this.createSkyBackdrop();
    this.createTerrainLayer();
    this.tankOverlayGraphics = this.add.graphics().setDepth(5.5);
    this.previewGraphics = this.add.graphics().setDepth(3);
    this.hudGraphics = this.add.graphics().setDepth(10);
    this.windGraphics = this.add.graphics().setDepth(11);
    this.projectileSprite = this.add
      .sprite(0, 0, TEX_WEAPONS, PROJECTILE_FRAME_BY_ITEM.none)
      .setScale(0.46)
      .setDepth(7)
      .setVisible(false);

    this.createParticleTextures();
    this.createHud();
    this.createControls();

    const initialView = this.getClient().publicView;
    this.initialTerrain = [...initialView.terrain];
    const initialShot = initialView.lastShot;
    this.seenShotId = initialShot?.id;
    if (initialShot?.shooterPlayerId === this.getClient().playerId) {
      this.lastOwnShotPower = initialShot.power;
    }
    this.renderAll();

    this.input.on("pointerdown", this.handleBattlefieldPointerDown, this);
    this.input.on("pointermove", this.handleBattlefieldPointerMove, this);
    this.input.on("pointerup", this.handleGlobalPointerUp, this);
    this.input.on("gameout", this.handleGameOut, this);
    this.input.keyboard?.on("keydown", this.handleKeyDown, this);
    this.input.keyboard?.on("keyup", this.handleKeyUp, this);
    this.input.keyboard?.on("keydown-SPACE", this.handleSpaceDown, this);
    this.input.keyboard?.on("keyup-SPACE", this.handleSpaceUp, this);
    this.game.events.on(Phaser.Core.Events.BLUR, this.handleBlur, this);
  }

  update(time: number, delta: number): void {
    this.updateHeldAngle(time, delta);
    if (this.chargeStartedAt !== undefined) {
      this.power = chargedPower(time - this.chargeStartedAt);
      this.renderPowerAndPreview();
    }
    if (this.shotAnimation) {
      this.updateShotAnimation(time);
    }
    this.updateAtmosphere(time, delta);
    this.updateTanksTick(time);
    this.updateExplosions(time);
    this.emitDamagedTankSmoke(time);

    const second = Math.floor(time / 250);
    if (second !== this.lastUiSecond) {
      this.lastUiSecond = second;
      this.renderStatus();
    }
  }

  applySnapshot(next: TankBattleClient, previous: TankBattleClient): void {
    if (!this.sys.isActive()) return;
    if (next.version !== previous.version) {
      this.awaitingSnapshot = false;
    } else if (
      this.awaitingSnapshot &&
      (next.actionErrorRevision !== previous.actionErrorRevision || (previous.connected && !next.connected))
    ) {
      this.awaitingSnapshot = false;
      this.stopFlightAudio();
      this.renderPowerAndPreview();
      this.refreshButtonStyles();
    }

    const shot = next.publicView.lastShot;
    if (!shot) {
      this.seenShotId = undefined;
      this.shownDamageShotIds.clear();
      this.playedOutcomeKey = undefined;
      if (previous.publicView.lastShot && next.publicView.turnNumber <= 1) {
        this.lastOwnShotPower = undefined;
        this.power = 55;
        this.angle = 45;
        this.initialTerrain = [...next.publicView.terrain];
        this.lastTerrainSignature = "";
      }
    } else if (shot.shooterPlayerId === next.playerId) {
      this.lastOwnShotPower = shot.power;
    }

    if (shot && shot.id !== this.seenShotId) {
      this.seenShotId = shot.id;
      const nextAnimation = {
        shot,
        baseView: clonePublicView(previous.publicView)
      };
      if (this.shotAnimation) {
        this.shotAnimationQueue.push(nextAnimation);
      } else {
        this.beginShotAnimation(nextAnimation);
      }
    }

    // Show authoritative damage popups & hit reactions as soon as resolved shot arrives
    if (shot?.resolved && shot.damage.length > 0 && !this.shownDamageShotIds.has(shot.id) && !this.shotAnimation) {
      this.presentShotDamage(shot, next.publicView);
    }

    // Play victory/defeat fanfare once match ends (after replay finishes or immediately if already finished)
    if (next.publicView.result && !this.shotAnimation) {
      this.playMatchOutcomeSound(next);
    }

    this.ensureSelectedItemAvailable();
    this.renderAll();
  }

  prepareDestroy(): void {
    this.cancelCharge();
    this.stopAngleAdjustment();
    this.activeAimPointerId = undefined;
    this.shotAnimationQueue.length = 0;
    if (this.reducedMotionMedia && this.handleReducedMotionChange) {
      this.reducedMotionMedia.removeEventListener("change", this.handleReducedMotionChange);
    }
    if (!this.sys.isActive()) {
      this.audio.destroy();
      return;
    }
    this.input.off("pointerdown", this.handleBattlefieldPointerDown, this);
    this.input.off("pointermove", this.handleBattlefieldPointerMove, this);
    this.input.off("pointerup", this.handleGlobalPointerUp, this);
    this.input.off("gameout", this.handleGameOut, this);
    this.input.keyboard?.off("keydown", this.handleKeyDown, this);
    this.input.keyboard?.off("keyup", this.handleKeyUp, this);
    this.input.keyboard?.off("keydown-SPACE", this.handleSpaceDown, this);
    this.input.keyboard?.off("keyup-SPACE", this.handleSpaceUp, this);
    this.game.events.off(Phaser.Core.Events.BLUR, this.handleBlur, this);
    this.flightSafetyTimer?.remove(false);
    this.flightSafetyTimer = undefined;
    this.audio.destroy();
    this.tweens.killAll();
    this.time.removeAllEvents();
    for (const exp of this.activeExplosions) exp.sprite.destroy();
    this.activeExplosions.length = 0;
    if (this.textures.exists(TEX_TERRAIN_CANVAS)) {
      this.textures.remove(TEX_TERRAIN_CANVAS);
    }
  }

  private setupReducedMotion(): void {
    if (typeof window === "undefined" || typeof window.matchMedia !== "function") return;
    this.reducedMotionMedia = window.matchMedia(reducedMotionQuery);
    this.reducedMotion = this.reducedMotionMedia.matches;
    this.handleReducedMotionChange = (event: MediaQueryListEvent) => {
      this.reducedMotion = event.matches;
    };
    this.reducedMotionMedia.addEventListener("change", this.handleReducedMotionChange);
  }

  private createSkyBackdrop(): void {
    const bw = this.layout.battleWidth;
    const bh = this.layout.battleHeight;

    if (this.textures.exists(TEX_SKY)) {
      this.skyImage = this.add.image(0, 0, TEX_SKY).setOrigin(0, 0).setDisplaySize(bw, bh).setDepth(0);
    }
    if (this.textures.exists(TEX_MOUNTAINS)) {
      this.mountainImage = this.add
        .image(bw / 2, bh - 26, TEX_MOUNTAINS)
        .setOrigin(0.5, 1)
        .setDisplaySize(bw + 40, 320)
        .setDepth(0.4);
    }

    this.cloudStates = createInitialClouds(bw);
    this.cloudSprites = this.cloudStates.map((cloud) =>
      this.add
        .sprite(cloud.x, cloud.y, TEX_CLOUDS, cloud.frame)
        .setScale(cloud.scale)
        .setAlpha(cloud.alpha)
        .setDepth(0.7)
    );

    this.windStreaks = createInitialWindStreaks(bw, bh);
    this.windStreakGraphics = this.add.graphics().setDepth(0.85);
  }

  private createTerrainLayer(): void {
    const bw = this.layout.battleWidth;
    const bh = this.layout.battleHeight;
    if (this.textures.exists(TEX_TERRAIN_CANVAS)) {
      this.textures.remove(TEX_TERRAIN_CANVAS);
    }
    const canvasTex = this.textures.createCanvas(TEX_TERRAIN_CANVAS, bw, bh);
    if (canvasTex) {
      this.terrainCanvasTexture = canvasTex;
      this.terrainImage = this.add.image(0, 0, TEX_TERRAIN_CANVAS).setOrigin(0, 0).setDepth(2);
    } else {
      this.terrainFallbackGraphics = this.add.graphics().setDepth(2);
    }
  }

  private createHud(): void {
    const layout = this.layout;
    const style: Phaser.Types.GameObjects.Text.TextStyle = {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      color: "#f8fbff",
      stroke: "#091224",
      strokeThickness: 3
    };
    this.statusText = this.add.text(layout.hudCenterX, 102, "", { ...style, fontSize: "19px", fontStyle: "bold" }).setOrigin(0.5).setDepth(12);
    this.windText = this.add.text(layout.hudCenterX, 20, "", { ...style, fontSize: "16px", fontStyle: "bold" }).setOrigin(0.5).setDepth(12);
    this.gravityText = this.add.text(layout.hudCenterX, 71, "", { ...style, fontSize: "12px", color: "#cfe4ff", strokeThickness: 2 }).setOrigin(0.5).setDepth(12);
    this.playerTexts = [
      this.add.text(28, 20, "", { ...style, fontSize: "16px", fontStyle: "bold" }).setDepth(12),
      this.add.text(layout.playerRightX, 20, "", { ...style, fontSize: "16px", fontStyle: "bold", align: "right" }).setOrigin(1, 0).setDepth(12)
    ];
  }

  private createControls(): void {
    const layout = this.layout;
    this.drawControlsBackground();

    const minus = this.createButton(
      layout.angle.minusX,
      layout.angle.y,
      layout.angle.buttonWidth,
      layout.angle.buttonHeight,
      "−",
      () => this.changeAngle(-2),
      30
    );
    const plus = this.createButton(
      layout.angle.plusX,
      layout.angle.y,
      layout.angle.buttonWidth,
      layout.angle.buttonHeight,
      "+",
      () => this.changeAngle(2),
      30
    );
    this.angleButtons = [minus, plus];
    this.angleText = this.add.text(layout.angle.textX, layout.angle.textY, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "21px",
      fontStyle: "bold",
      color: "#ffffff",
      align: "center"
    }).setOrigin(0.5).setDepth(14);
    this.add.text(layout.angle.textX, layout.angle.helpY, "← ↓  낮추기   ·   높이기  ↑ →", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#a9d8ff",
      align: "center"
    }).setOrigin(0.5).setDepth(14);

    const itemEntries = ["megaBlast", "warhead", "scope"] as const;
    itemEntries.forEach((item, index) => {
      const button = this.createItemButton(
        layout.items.startX + index * layout.items.stepX,
        layout.items.startY + index * layout.items.stepY,
        layout.items.width,
        layout.items.height,
        item,
        () => this.selectItem(item),
        layout.items.fontSize
      );
      this.itemButtons.set(item, button);
    });

    this.muteButton = this.createButton(
      layout.mute.x,
      layout.mute.y,
      layout.mute.width,
      layout.mute.height,
      this.muteButtonLabel(),
      () => this.handleToggleMute(),
      layout.mute.fontSize,
      true,
      true
    );

    this.powerGaugeGraphics = this.add.graphics().setDepth(13);
    this.powerText = this.add.text(layout.power.textX, layout.power.textY, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "22px",
      fontStyle: "bold",
      color: "#ffffff"
    }).setOrigin(0, 0.5).setDepth(14);
    this.lastPowerText = this.add.text(layout.power.gaugeX, layout.power.markerLabelY, "", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#fde68a",
      backgroundColor: "#422006",
      padding: { x: 5, y: 2 }
    }).setOrigin(0.5).setDepth(14).setVisible(false);
    this.add.text(layout.power.gaugeX, layout.power.labelsY, "10", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#b9d9ff"
    }).setOrigin(0.5).setDepth(14);
    this.add.text(layout.power.helpX, layout.power.helpY, "Space / 버튼을 길게 눌러 충전", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#b9d9ff"
    }).setOrigin(0.5).setDepth(14);
    this.add.text(layout.power.gaugeX + layout.power.gaugeWidth, layout.power.labelsY, "100", {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: "12px",
      fontStyle: "bold",
      color: "#b9d9ff"
    }).setOrigin(0.5).setDepth(14);

    this.fireButton = this.createButton(
      layout.fire.x,
      layout.fire.y,
      layout.fire.width,
      layout.fire.height,
      "발사 · 길게 눌러 충전",
      () => undefined,
      layout.fire.fontSize
    );
    this.fireButton.container.on("pointerdown", (pointer: Phaser.Input.Pointer) => this.startCharge(pointer.id));
  }

  private drawControlsBackground(): void {
    const graphics = this.hudGraphics;
    if (!graphics) return;
    graphics.clear();

    // Sleek dark glass HUD pills over the twilight battlefield sky
    const centerX = this.layout.hudCenterX;
    graphics
      .fillStyle(0x071226, 0.72)
      .fillRoundedRect(centerX - 134, 6, 268, 78, 14)
      .lineStyle(1.5, 0x7dd3fc, 0.45)
      .strokeRoundedRect(centerX - 134, 6, 268, 78, 14)
      .fillStyle(0x071226, 0.68)
      .fillRoundedRect(14, 10, 232, 38, 11)
      .lineStyle(1.5, 0x49b6ff, 0.55)
      .strokeRoundedRect(14, 10, 232, 38, 11)
      .fillStyle(0x071226, 0.68)
      .fillRoundedRect(this.layout.battleWidth - 246, 10, 232, 38, 11)
      .lineStyle(1.5, 0xff6b5f, 0.55)
      .strokeRoundedRect(this.layout.battleWidth - 246, 10, 232, 38, 11);

    if (this.layout.mode === "compact-landscape") {
      graphics
        .fillStyle(0x07101f, 1)
        .fillRect(this.layout.battleWidth, 0, this.layout.width - this.layout.battleWidth, this.layout.height)
        .fillRect(0, this.layout.battleHeight, this.layout.battleWidth, this.layout.height - this.layout.battleHeight)
        .lineStyle(3, 0x7dd3fc, 0.8)
        .lineBetween(this.layout.battleWidth + 1, 0, this.layout.battleWidth + 1, this.layout.height)
        .lineBetween(0, this.layout.battleHeight + 1, this.layout.battleWidth, this.layout.battleHeight + 1)
        .fillStyle(0x073e78, 0.96)
        .fillRoundedRect(1020, 34, 460, 186, 18)
        .lineStyle(3, 0x22d3ee, 1)
        .strokeRoundedRect(1020, 34, 460, 186, 18)
        .fillStyle(0x0b2039, 1)
        .fillRoundedRect(1020, 234, 460, 168, 18)
        .lineStyle(2, 0x38bdf8, 0.82)
        .strokeRoundedRect(1020, 234, 460, 168, 18)
        .fillStyle(0x0b2039, 1)
        .fillRoundedRect(1020, 416, 460, 164, 18)
        .lineStyle(2, 0x38bdf8, 0.82)
        .strokeRoundedRect(1020, 416, 460, 164, 18)
        .fillStyle(0x3a160c, 1)
        .fillRoundedRect(1020, 594, 460, 186, 18)
        .lineStyle(3, 0xfb923c, 1)
        .strokeRoundedRect(1020, 594, 460, 186, 18);
      return;
    }

    graphics
      .fillStyle(0x07101f, 1)
      .fillRect(0, this.layout.battleHeight, this.layout.width, this.layout.height - this.layout.battleHeight)
      .lineStyle(3, 0x7dd3fc, 0.8)
      .lineBetween(0, this.layout.battleHeight + 1, this.layout.width, this.layout.battleHeight + 1)
      .fillStyle(0x073e78, 0.96)
      .fillRoundedRect(12, 610, 288, 82, 14)
      .lineStyle(3, 0x22d3ee, 1)
      .strokeRoundedRect(12, 610, 288, 82, 14)
      .fillStyle(0x0b2039, 1)
      .fillRoundedRect(18, 708, 656, 82, 14)
      .lineStyle(2, 0x38bdf8, 0.82)
      .strokeRoundedRect(18, 708, 656, 82, 14)
      .fillStyle(0x3a160c, 1)
      .fillRoundedRect(688, 708, 300, 82, 14)
      .lineStyle(3, 0xfb923c, 1)
      .strokeRoundedRect(688, 708, 300, 82, 14);
  }

  private createItemButton(
    x: number,
    y: number,
    width: number,
    height: number,
    item: Exclude<TankItemSelection, "none">,
    onPress: () => void,
    fontSize: number
  ): BattleButton {
    const background = this.add.rectangle(0, 0, width, height, 0x203250, 1).setStrokeStyle(2, 0x5475a3, 0.9);
    const isCompact = this.layout.mode === "compact-landscape";
    const icon = this.add
      .sprite(isCompact ? 0 : -width / 2 + 28, isCompact ? -22 : 0, TEX_ITEMS, ITEM_ICON_FRAME[item])
      .setDisplaySize(isCompact ? 62 : 42, isCompact ? 62 : 42);
    const label = this.add.text(isCompact ? 0 : 18, isCompact ? 34 : 0, itemLabels[item], {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: `${fontSize}px`,
      fontStyle: "bold",
      color: "#f8fbff",
      align: "center",
      lineSpacing: 2
    }).setOrigin(0.5);

    const container = this.add.container(x, y, [background, icon, label])
      .setDepth(14)
      .setSize(width, height)
      .setInteractive({ useHandCursor: true });
    container.on("pointerover", () => background.setFillStyle(0x2c4772, 1));
    container.on("pointerout", () => this.refreshButtonStyles());
    container.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      void this.audio.unlock();
      event.stopPropagation();
      if (!this.canAim()) return;
      triggerSelectionFeedback();
      onPress();
    });
    return { container, background, label, icon };
  }

  private createButton(
    x: number,
    y: number,
    width: number,
    height: number,
    text: string,
    onPress: () => void,
    fontSize = 18,
    addToScene = true,
    alwaysEnabled = false
  ): BattleButton {
    const background = this.add.rectangle(0, 0, width, height, 0x203250, 1).setStrokeStyle(1, 0x5475a3, 0.9);
    const label = this.add.text(0, 0, text, {
      fontFamily: "Inter, Pretendard, system-ui, sans-serif",
      fontSize: `${fontSize}px`,
      fontStyle: "bold",
      color: "#f8fbff",
      align: "center"
    }).setOrigin(0.5);
    const container = this.add.container(x, y, [background, label])
      .setDepth(14)
      .setSize(width, height)
      .setInteractive({ useHandCursor: true });
    container.on("pointerover", () => background.setFillStyle(0x2c4772, 1));
    container.on("pointerout", () => this.refreshButtonStyles());
    container.on("pointerdown", (_pointer: Phaser.Input.Pointer, _localX: number, _localY: number, event: Phaser.Types.Input.EventData) => {
      void this.audio.unlock();
      event.stopPropagation();
      if (!alwaysEnabled && addToScene && !this.canAim()) return;
      triggerSelectionFeedback();
      onPress();
    });
    if (!addToScene) {
      container.removeFromDisplayList();
      background.removeFromDisplayList();
      label.removeFromDisplayList();
    }
    return { container, background, label };
  }

  private muteButtonLabel(): string {
    return this.audio.isMuted() ? "🔇 음소거" : "🔊 사운드";
  }

  private handleToggleMute(): void {
    this.audio.toggleMute();
    this.muteButton?.label.setText(this.muteButtonLabel());
    this.refreshButtonStyles();
  }

  private renderAll(): void {
    if (!this.sys.isActive()) return;
    this.drawTerrain(this.getVisualView().terrain);
    this.updateTanksTick(this.time.now);
    this.renderStatus();
    this.renderPowerAndPreview();
    this.renderItems();
    this.refreshButtonStyles();
  }

  private getVisualView(): TankBattlePublicView {
    return this.shotAnimation?.baseView ?? this.getClient().publicView;
  }

  private beginShotAnimation(animation: QueuedShotAnimation, startedAt = performance.now()): void {
    this.shotAnimation = { ...animation, startedAt, exploded: false, lastTrailAt: 0 };
    this.tankFireTimes.set(animation.shot.shooterPlayerId, this.time.now);
    this.spawnMuzzleFlash(animation.shot, animation.baseView);
    if (this.soundingShotId !== animation.shot.id) {
      this.startFlightAudio(animation.shot.id);
    }
  }

  private updateAtmosphere(time: number, delta: number): void {
    const view = this.getVisualView();
    const bw = this.layout.battleWidth;

    this.cloudStates = stepCloudDrift(this.cloudStates, view.wind, delta, bw, this.reducedMotion);
    for (let i = 0; i < this.cloudSprites.length; i += 1) {
      const sprite = this.cloudSprites[i];
      const state = this.cloudStates[i];
      if (!sprite || !state) continue;
      const bob = this.reducedMotion ? 0 : Math.sin(time / 1000 * 0.65 + i * 1.4) * 2.2;
      sprite.setPosition(state.x, state.y + bob);
    }

    if (this.mountainImage && !this.reducedMotion) {
      const parallaxOffset = Math.sin(time / 6500) * 6 + clamp(view.wind, -12, 12) * 0.7;
      this.mountainImage.setX(bw / 2 + parallaxOffset);
    }

    const streaksGraphics = this.windStreakGraphics;
    if (!streaksGraphics) return;
    streaksGraphics.clear();
    const windStrength = clamp(Math.abs(view.wind) / MAX_WIND_SPEED, 0, 1);
    if (windStrength < 0.04 || this.reducedMotion) return;

    this.windStreaks = stepWindStreaks(this.windStreaks, view.wind, delta, bw, this.reducedMotion);
    const dir = view.wind >= 0 ? 1 : -1;
    for (const streak of this.windStreaks) {
      const alpha = streak.alpha * (0.35 + windStrength * 0.65);
      const len = streak.length * (0.55 + windStrength * 0.85);
      streaksGraphics.lineStyle(1.6, 0xe0f2fe, alpha);
      streaksGraphics.lineBetween(streak.x, streak.y, streak.x + dir * len, streak.y);
    }
  }

  private drawTerrain(terrain: number[]): void {
    const view = this.getVisualView();
    if (terrain.length === 0) return;

    const signature = terrain.map((v) => Math.round(v)).join(",");
    if (signature === this.lastTerrainSignature) return;
    this.lastTerrainSignature = signature;

    if (this.initialTerrain.length !== terrain.length) {
      this.initialTerrain = [...terrain];
    }

    if (this.terrainCanvasTexture) {
      const ctx = this.terrainCanvasTexture.getContext();
      const width = this.layout.battleWidth;
      const height = this.layout.battleHeight;
      ctx.clearRect(0, 0, width, height);

      // 1. Textured earth & rock strata interior clipped to the live destructible polygon
      ctx.save();
      ctx.beginPath();
      ctx.moveTo(0, terrain[0] ?? height);
      for (let i = 0; i < terrain.length; i += 1) {
        ctx.lineTo(i * view.terrainStep, terrain[i] ?? height);
      }
      ctx.lineTo(width, height);
      ctx.lineTo(0, height);
      ctx.closePath();
      ctx.clip();

      const tileSource = this.textures.exists(TEX_TERRAIN_TILE)
        ? (this.textures.get(TEX_TERRAIN_TILE).getSourceImage() as CanvasImageSource)
        : null;
      if (tileSource) {
        const pattern = ctx.createPattern(tileSource, "repeat");
        if (pattern) {
          ctx.fillStyle = pattern;
          ctx.fillRect(0, 0, width, height);
        }
      } else {
        ctx.fillStyle = "#5c3e2b";
        ctx.fillRect(0, 0, width, height);
      }

      // Atmospheric depth shadow gradient toward bottom of earth cut
      const depthGrad = ctx.createLinearGradient(0, height * 0.48, 0, height);
      depthGrad.addColorStop(0, "rgba(18, 12, 10, 0)");
      depthGrad.addColorStop(0.7, "rgba(18, 12, 16, 0.24)");
      depthGrad.addColorStop(1, "rgba(8, 10, 22, 0.56)");
      ctx.fillStyle = depthGrad;
      ctx.fillRect(0, 0, width, height);

      // Soft soil-lip underside shadow just below the rim
      ctx.beginPath();
      for (let i = 0; i < terrain.length; i += 1) {
        const x = i * view.terrainStep;
        const y = (terrain[i] ?? height) + 10;
        if (i === 0) ctx.moveTo(x, y);
        else ctx.lineTo(x, y);
      }
      ctx.strokeStyle = "rgba(22, 13, 10, 0.48)";
      ctx.lineWidth = 10;
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      ctx.stroke();
      ctx.restore();

      // 2. Per-segment lush grass rim vs. scorched dark crater rim
      ctx.save();
      ctx.lineCap = "round";
      ctx.lineJoin = "round";
      for (let i = 0; i < terrain.length - 1; i += 1) {
        const x0 = i * view.terrainStep;
        const y0 = terrain[i] ?? height;
        const x1 = (i + 1) * view.terrainStep;
        const y1 = terrain[i + 1] ?? height;
        const base0 = this.initialTerrain[i] ?? y0;
        const base1 = this.initialTerrain[i + 1] ?? y1;
        const scorched = (y0 - base0 > 4) || (y1 - base1 > 4);

        // Crisp dark ink backing outline
        ctx.strokeStyle = "#111829";
        ctx.lineWidth = scorched ? 10 : 12;
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 2);
        ctx.lineTo(x1, y1 + 2);
        ctx.stroke();

        // Main rim band (scorched charcoal crater vs lush emerald grass)
        ctx.strokeStyle = scorched ? "#3d2a25" : "#65a30d";
        ctx.lineWidth = scorched ? 6 : 8;
        ctx.beginPath();
        ctx.moveTo(x0, y0 + 1);
        ctx.lineTo(x1, y1 + 1);
        ctx.stroke();

        // Top sunlit highlight edge
        ctx.strokeStyle = scorched ? "#7c4a32" : "#bef264";
        ctx.lineWidth = 2.4;
        ctx.beginPath();
        ctx.moveTo(x0, y0 - 1.5);
        ctx.lineTo(x1, y1 - 1.5);
        ctx.stroke();

        // Occasional charming grass tufts on undisturbed terrain
        if (!scorched && i % 9 === 3) {
          ctx.fillStyle = "#84cc16";
          ctx.strokeStyle = "#111829";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.moveTo(x0 - 4, y0);
          ctx.lineTo(x0 - 6, y0 - 7);
          ctx.lineTo(x0 - 1, y0 - 2);
          ctx.lineTo(x0 + 2, y0 - 9);
          ctx.lineTo(x0 + 5, y0);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();
        }
      }
      ctx.restore();

      this.terrainCanvasTexture.refresh();
      return;
    }

    // Fallback graphics renderer if CanvasTexture is unavailable
    const graphics = this.terrainFallbackGraphics;
    if (!graphics) return;
    graphics.clear();
    graphics.fillStyle(0x5a3e2c, 1);
    graphics.beginPath();
    graphics.moveTo(0, terrain[0] ?? view.worldHeight);
    terrain.forEach((y, index) => graphics.lineTo(index * view.terrainStep, y));
    graphics.lineTo(view.worldWidth, view.worldHeight);
    graphics.lineTo(0, view.worldHeight);
    graphics.closePath();
    graphics.fillPath();
    graphics.lineStyle(6, 0x84cc16, 1);
    graphics.beginPath();
    terrain.forEach((y, index) => index === 0 ? graphics.moveTo(0, y) : graphics.lineTo(index * view.terrainStep, y));
    graphics.strokePath();
  }

  private ensureTankVisual(playerId: string, seat: number, colorHex: string): TankVisual {
    const existing = this.tankVisuals.get(playerId);
    if (existing) return existing;

    const colorNum = Phaser.Display.Color.HexStringToColor(colorHex).color;
    const aura = this.add.circle(0, 0, 38, colorNum, 0).setDepth(3.5);
    const barrel = this.add
      .sprite(0, 0, TEX_WEAPONS, BARREL_FRAME_INDEX)
      .setOrigin(BARREL_PIVOT_ORIGIN_X, 0.5)
      .setScale(BARREL_SPRITE_SCALE)
      .setDepth(4.0);
    const hull = this.add
      .sprite(0, 0, TEX_TANKS, seat % 2 === 0 ? 0 : 4)
      .setOrigin(0.5, TANK_GROUND_ORIGIN_Y)
      .setScale(TANK_SPRITE_SCALE)
      .setDepth(4.2);

    const visual: TankVisual = { aura, barrel, hull };
    this.tankVisuals.set(playerId, visual);
    return visual;
  }

  private updateTanksTick(timeMs: number): void {
    const overlay = this.tankOverlayGraphics;
    if (!overlay) return;
    overlay.clear();

    const client = this.getClient();
    const publicView = this.getVisualView();
    const activeIds = new Set<string>();
    const timeSec = timeMs / 1000;
    const chargeRatio = this.chargeStartedAt === undefined ? 0 : clamp((this.power - 10) / 90, 0, 1);

    for (const tank of publicView.players) {
      activeIds.add(tank.playerId);
      const alive = tank.health > 0;
      const facing = tankFacing(tank);
      const isMe = tank.playerId === client.playerId;
      const isActiveTurn = publicView.roomPhase === "active" && publicView.currentPlayerId === tank.playerId && !publicView.result;
      const isCharging = isMe && this.chargeStartedAt !== undefined;

      const fireStarted = this.tankFireTimes.get(tank.playerId);
      const fireElapsedMs = fireStarted !== undefined ? timeMs - fireStarted : Number.POSITIVE_INFINITY;
      const firingRemainingMs = Math.max(0, FIRE_POSE_MS - fireElapsedMs);

      const hitStarted = this.tankHitTimes.get(tank.playerId);
      const hitElapsedMs = hitStarted !== undefined ? timeMs - hitStarted : Number.POSITIVE_INFINITY;
      const hitRemainingMs = Math.max(0, HIT_POSE_MS - hitElapsedMs);

      const state = resolveTankAnimState({
        alive,
        isMyTurn: isActiveTurn,
        isCharging,
        firingRemainingMs,
        hitRemainingMs
      });

      const stateElapsedSec = state === "hit"
        ? Math.max(0, hitElapsedMs / 1000)
        : state === "fire"
          ? Math.max(0, fireElapsedMs / 1000)
          : 0;

      const pose = evaluateTankPose(state, timeSec, isCharging ? chargeRatio : 0, {
        seat: tank.seat,
        stateElapsedSec,
        reducedMotion: this.reducedMotion
      });

      const visual = this.ensureTankVisual(tank.playerId, tank.seat, tank.color);
      const anchorX = tank.x + pose.offsetX * facing;
      const anchorY = tank.y + 11 + pose.offsetY;

      visual.hull
        .setPosition(anchorX, anchorY)
        .setFrame(pose.frameIndex)
        .setFlipX(facing < 0)
        .setScale(TANK_SPRITE_SCALE * pose.scaleX, TANK_SPRITE_SCALE * pose.scaleY)
        .setRotation(pose.rotation * facing)
        .setVisible(true);

      // Rotate and recoil the illustrated cannon barrel cleanly from the turret mantlet socket
      const displayedShot = this.shotAnimation?.shot ?? publicView.lastShot;
      const barrelAngle = displayedShot?.shooterPlayerId === tank.playerId
        ? displayedShot.angle
        : isMe ? this.angle : 45;
      const radians = (barrelAngle * Math.PI) / 180;
      const mantletX = anchorX + facing * 13;
      const mantletY = anchorY - 35;
      const recoilX = -facing * Math.cos(radians) * pose.barrelRecoilPx;
      const recoilY = Math.sin(radians) * pose.barrelRecoilPx;

      visual.barrel
        .setPosition(mantletX + recoilX, mantletY + recoilY)
        .setVisible(alive)
        .setFlipY(facing < 0)
        .setRotation(facing > 0 ? -radians : Math.PI + radians)
        .setScale(BARREL_SPRITE_SCALE * (1 - pose.barrelRecoilPx * 0.008), BARREL_SPRITE_SCALE);

      // Glowing charge / active turn aura
      if (pose.glowIntensity > 0.02 && alive) {
        const auraColor = state === "charge" ? 0xfbbf24 : state === "fire" ? 0xfef08a : Phaser.Display.Color.HexStringToColor(tank.color).color;
        visual.aura
          .setPosition(anchorX, anchorY - 24)
          .setFillStyle(auraColor, pose.glowIntensity * (state === "charge" ? 0.36 : 0.2))
          .setScale(1 + pose.glowIntensity * 0.35)
          .setVisible(true);
      } else {
        visual.aura.setVisible(false);
      }

      // Stylized floating health bar with dark outline & gloss shine
      const healthWidth = 74;
      const healthY = tank.y - 72;
      const hpRatio = clamp(tank.health / Math.max(1, tank.maxHealth), 0, 1);
      overlay.fillStyle(0x0b1220, 0.92).fillRoundedRect(tank.x - healthWidth / 2 - 2, healthY - 2, healthWidth + 4, 13, 5);
      overlay.lineStyle(1.5, 0x94a3b8, 0.65).strokeRoundedRect(tank.x - healthWidth / 2 - 2, healthY - 2, healthWidth + 4, 13, 5);
      if (hpRatio > 0) {
        const healthColor = tank.health > 55 ? 0x4ade80 : tank.health > 25 ? 0xfbbf24 : 0xfb7185;
        overlay.fillStyle(healthColor, 1).fillRoundedRect(tank.x - healthWidth / 2, healthY, Math.max(4, healthWidth * hpRatio), 9, 3.5);
        overlay.fillStyle(0xffffff, 0.32).fillRoundedRect(tank.x - healthWidth / 2 + 1, healthY + 1, Math.max(2, healthWidth * hpRatio - 2), 3, 2);
      }

      // Bouncing active-turn pointer chevron above active player's HP bar
      if (isActiveTurn && alive) {
        const chevronBob = this.reducedMotion ? 0 : Math.sin(timeSec * 6.5) * 3.5;
        const cy = healthY - 12 + chevronBob;
        overlay.fillStyle(0xfde047, 1).fillTriangle(tank.x, cy + 7, tank.x - 7, cy - 3, tank.x + 7, cy - 3);
        overlay.lineStyle(1.5, 0x0f172a, 1).strokeTriangle(tank.x, cy + 7, tank.x - 7, cy - 3, tank.x + 7, cy - 3);
      }
    }

    // Hide any stale visuals if players changed
    for (const [id, visual] of this.tankVisuals) {
      if (!activeIds.has(id)) {
        visual.hull.setVisible(false);
        visual.barrel.setVisible(false);
        visual.aura.setVisible(false);
      }
    }
  }

  private emitDamagedTankSmoke(timeMs: number): void {
    if (this.reducedMotion || (typeof document !== "undefined" && document.hidden)) return;
    if (timeMs - this.lastSmokeEmitAt < 260) return;
    this.lastSmokeEmitAt = timeMs;

    const view = this.getVisualView();
    for (const tank of view.players) {
      const wrecked = tank.health <= 0;
      const damaged = tank.health > 0 && tank.health <= 45;
      if (!wrecked && !damaged) continue;
      const puff = this.add
        .circle(
          tank.x + (Math.random() * 14 - 7),
          tank.y - 28,
          wrecked ? 6 + Math.random() * 4 : 4 + Math.random() * 2.5,
          wrecked ? 0x334155 : 0x94a3b8,
          wrecked ? 0.65 : 0.42
        )
        .setDepth(4.5);
      this.tweens.add({
        targets: puff,
        x: puff.x + view.wind * 1.8 + (Math.random() * 10 - 5),
        y: puff.y - (wrecked ? 36 : 24),
        scale: wrecked ? 2.1 : 1.6,
        alpha: 0,
        duration: wrecked ? 850 : 620,
        ease: "Sine.Out",
        onComplete: () => puff.destroy()
      });
    }
  }

  private spawnMuzzleFlash(shot: LastShot, view: TankBattlePublicView): void {
    const shooter = view.players.find((p) => p.playerId === shot.shooterPlayerId);
    if (!shooter) return;
    const facing = tankFacing(shooter);
    const radians = (shot.angle * Math.PI) / 180;
    const tipX = shooter.x + facing * (13 + Math.cos(radians) * 44);
    const tipY = shooter.y - 24 - Math.sin(radians) * 44;

    const flash = this.add
      .sprite(tipX, tipY, TEX_EXPLOSION, 0)
      .setScale(0.45)
      .setDepth(6.5)
      .setRotation(Math.random() * Math.PI);
    this.tweens.add({
      targets: flash,
      scale: 0.78,
      alpha: 0,
      duration: 180,
      ease: "Quad.Out",
      onComplete: () => flash.destroy()
    });
  }

  private renderStatus(): void {
    const client = this.getClient();
    const view = this.getVisualView();
    const myTurn = view.currentPlayerId === client.playerId;
    const estimatedServerTime = client.serverTime + (performance.now() - client.receivedAt);
    const seconds = view.turnDeadline ? Math.max(0, Math.ceil((view.turnDeadline - estimatedServerTime) / 1000)) : undefined;
    if (this.shotAnimation) {
      this.statusText?.setText(this.shotAnimation.exploded ? "폭발 충격과 잔해가 가라앉는 중" : "포탄 비행 중");
    } else if (view.result) {
      this.statusText?.setText(view.result === "draw" ? "동시 격파 — 무승부" : view.winnerPlayerId === client.playerId ? "승리!" : "패배");
    } else if (view.roomPhase !== "active") {
      this.statusText?.setText("상대 플레이어를 기다리는 중");
    } else if (view.turnPhase === "resolving") {
      this.statusText?.setText("포탄 비행 중 · 충돌 결과 계산 완료");
    } else if (myTurn) {
      this.statusText?.setText(`내 턴 · 발사 버튼을 누르고 떼세요${seconds === undefined ? "" : ` · ${seconds}초`}`);
    } else {
      const opponent = view.players.find((player) => player.playerId === view.currentPlayerId);
      this.statusText?.setText(`${opponent?.displayName ?? "상대"}의 조준을 기다리는 중${seconds === undefined ? "" : ` · ${seconds}초`}`);
    }
    const windArrow = view.wind > 0 ? "→" : view.wind < 0 ? "←" : "·";
    this.windText?.setText(`바람 ${windArrow} ${Math.abs(view.wind).toFixed(1)} / ${MAX_WIND_SPEED}`);
    this.renderWindIndicator(view.wind);
    this.gravityText?.setText(`중력 ${view.gravity.toFixed(1)} px/s²  ·  턴 ${view.turnNumber}`);
    view.players.slice(0, 2).forEach((player, index) => {
      this.playerTexts[index]?.setText(`${player.displayName}  HP ${player.health}/${player.maxHealth}`)
        .setColor(player.color);
    });
  }

  private renderPowerAndPreview(): void {
    this.angleText?.setText(`각도 조절  ${Math.round(this.angle)}°`);
    this.powerText?.setText(`현재\n${Math.round(this.power)}`);
    if (this.fireButton) {
      this.fireButton.label.setText(this.chargeStartedAt === undefined ? "발사 · 길게 눌러 충전" : `손을 떼서 발사  ${Math.round(this.power)}`);
    }
    this.renderPowerGauge();
    this.drawPreview();
  }

  private renderWindIndicator(wind: number): void {
    const graphics = this.windGraphics;
    if (!graphics) return;
    const centerX = this.layout.hudCenterX;
    const y = 47;
    const maxLength = 88;
    const normalized = clamp(Math.abs(wind) / MAX_WIND_SPEED, 0, 1);
    const direction = wind < 0 ? -1 : wind > 0 ? 1 : 0;
    const endX = centerX + direction * maxLength * normalized;

    graphics.clear();
    graphics.lineStyle(2, 0x6083ac, 0.85).lineBetween(centerX - maxLength, y, centerX + maxLength, y);
    graphics.lineStyle(2, 0xc7d7f4, 0.9).lineBetween(centerX, y - 7, centerX, y + 7);
    graphics.fillStyle(0xdbeafe, 1).fillCircle(centerX, y, 3);
    if (direction === 0 || normalized === 0) return;

    const color = direction > 0 ? 0x67e8f9 : 0x93c5fd;
    const arrowLength = maxLength * normalized;
    const headLength = clamp(arrowLength * 0.35, 2, 12);
    const headHeight = clamp(arrowLength * 0.22, 2, 8);
    graphics.lineStyle(3 + normalized * 3, color, 1).lineBetween(centerX, y, endX, y);
    graphics.fillStyle(color, 1);
    graphics.beginPath();
    graphics.moveTo(endX, y);
    graphics.lineTo(endX - direction * headLength, y - headHeight);
    graphics.lineTo(endX - direction * headLength, y + headHeight);
    graphics.closePath();
    graphics.fillPath();
  }

  private renderPowerGauge(): void {
    const graphics = this.powerGaugeGraphics;
    if (!graphics) return;
    const { gaugeX, gaugeY, gaugeWidth, gaugeHeight, markerLabelY } = this.layout.power;
    const currentPower = clamp(this.power, 10, 100);
    const currentWidth = gaugeWidth * ((currentPower - 10) / 90);

    graphics.clear();
    graphics.fillStyle(0x030a14, 1).fillRoundedRect(
      gaugeX,
      gaugeY,
      gaugeWidth,
      gaugeHeight,
      gaugeHeight / 2
    );
    graphics.lineStyle(2, 0x7dd3fc, 0.9).strokeRoundedRect(
      gaugeX,
      gaugeY,
      gaugeWidth,
      gaugeHeight,
      gaugeHeight / 2
    );
    if (currentWidth > 0) {
      graphics.fillStyle(this.chargeStartedAt === undefined ? 0x22d3ee : 0xfbbf24, 1).fillRoundedRect(
        gaugeX + 3,
        gaugeY + 3,
        Math.max(6, currentWidth - 6),
        gaugeHeight - 6,
        (gaugeHeight - 6) / 2
      );
    }

    if (this.lastOwnShotPower === undefined) {
      this.lastPowerText?.setVisible(false);
      return;
    }
    const previousPower = clamp(this.lastOwnShotPower, 10, 100);
    const markerX = gaugeX + gaugeWidth * ((previousPower - 10) / 90);
    graphics.lineStyle(3, 0xfde047, 1).lineBetween(markerX, gaugeY - 5, markerX, gaugeY + gaugeHeight + 3);
    graphics.fillStyle(0xfde047, 1).fillTriangle(markerX, gaugeY - 1, markerX - 5, gaugeY - 8, markerX + 5, gaugeY - 8);
    this.lastPowerText
      ?.setText(`이전 발사 ${Math.round(previousPower)}`)
      .setPosition(clamp(markerX, gaugeX + 42, gaugeX + gaugeWidth - 42), markerLabelY)
      .setVisible(true);
  }

  private drawPreview(): void {
    const graphics = this.previewGraphics;
    if (!graphics) return;
    graphics.clear();
    const client = this.getClient();
    const view = this.getVisualView();
    const tank = view.players.find((player) => player.playerId === client.playerId);
    if (!tank || !this.canAim()) return;
    const facing = tankFacing(tank);
    const radians = (this.angle * Math.PI) / 180;
    if (this.selectedItem !== "scope") {
      graphics.lineStyle(3, 0xfef3c7, 0.58);
      graphics.beginPath();
      graphics.moveTo(tank.x + facing * 19, tank.y - 20);
      graphics.lineTo(tank.x + facing * Math.cos(radians) * 78, tank.y - 20 - Math.sin(radians) * 78);
      graphics.strokePath();
      return;
    }
    const prediction = simulateTrajectory({
      start: { x: tank.x + facing * 19, y: tank.y - 20 },
      facing,
      angle: this.angle,
      power: this.power,
      gravity: view.gravity,
      wind: view.wind,
      terrain: view.terrain,
      tanks: view.players,
      shooterPlayerId: client.playerId,
      worldWidth: view.worldWidth,
      worldHeight: view.worldHeight,
      terrainStep: view.terrainStep
    });
    graphics.fillStyle(0x67e8f9, 0.88);
    prediction.trajectory.forEach((point, index) => {
      if (index % 3 === 0) graphics.fillCircle(point.x, point.y, index % 9 === 0 ? 3.5 : 2.2);
    });
    if (prediction.impact) {
      graphics.lineStyle(2.5, 0xfde047, 0.95).strokeCircle(prediction.impact.x, prediction.impact.y, 10);
      graphics.lineStyle(1.5, 0xfde047, 0.7).lineBetween(prediction.impact.x - 15, prediction.impact.y, prediction.impact.x + 15, prediction.impact.y);
      graphics.lineStyle(1.5, 0xfde047, 0.7).lineBetween(prediction.impact.x, prediction.impact.y - 15, prediction.impact.x, prediction.impact.y + 15);
    }
  }

  private renderItems(): void {
    const items = this.getClient().privateView.items ?? { megaBlast: 0, warhead: 0, scope: 0 };
    const separator = this.layout.mode === "compact-landscape" ? "\n×" : "\n×";
    for (const [item, button] of this.itemButtons) {
      button.label.setText(`${itemLabels[item]}${separator}${items[item] ?? 0}`);
    }
  }

  private refreshButtonStyles(): void {
    const enabled = this.canAim();
    const items = this.getClient().privateView.items ?? { megaBlast: 0, warhead: 0, scope: 0 };
    for (const button of this.angleButtons) {
      button.container.setAlpha(enabled ? 1 : 0.78);
      button.background.setFillStyle(enabled ? 0x075fc7 : 0x173b5c, 1);
      button.background.setStrokeStyle(2, enabled ? 0x67e8f9 : 0x4d83a6, 1);
      button.label.setColor(enabled ? "#ffffff" : "#9fc8de");
    }
    for (const [item, button] of this.itemButtons) {
      const available = enabled && (items[item] ?? 0) > 0;
      button.container.setAlpha(available ? 1 : 0.38);
      button.background.setFillStyle(this.selectedItem === item ? 0x0f766e : available ? 0x244b78 : 0x203250, 1);
      button.background.setStrokeStyle(2, this.selectedItem === item ? 0x67e8f9 : 0x5475a3, 0.9);
    }
    if (this.muteButton) {
      const muted = this.audio.isMuted();
      this.muteButton.label.setText(this.muteButtonLabel());
      this.muteButton.background.setFillStyle(muted ? 0x3b1d2e : 0x153458, 1);
      this.muteButton.background.setStrokeStyle(2, muted ? 0xfb7185 : 0x67e8f9, 0.92);
      this.muteButton.label.setColor(muted ? "#fecdd3" : "#e0f2fe");
    }
    if (this.fireButton) {
      this.fireButton.container.setAlpha(enabled ? 1 : 0.78);
      this.fireButton.background.setFillStyle(
        enabled ? this.chargeStartedAt === undefined ? 0xdc3e24 : 0xf59e0b : 0x5f291f,
        1
      );
      this.fireButton.background.setStrokeStyle(3, enabled ? 0xffd39c : 0xb8674e, 1);
      this.fireButton.label.setColor(enabled ? "#ffffff" : "#d7aa9e");
    }
  }

  private updateShotAnimation(time: number): void {
    const animation = this.shotAnimation;
    if (!animation) return;
    const serverReplayDuration = clamp(animation.shot.replayDurationMs || 1_900, 900, 4_500);
    const impactDuration = animation.shot.impact ? IMPACT_EFFECT_MS : 0;
    const flightDuration = Math.max(700, serverReplayDuration - impactDuration);
    const elapsed = time - animation.startedAt;
    const flightProgress = clamp(elapsed / flightDuration, 0, 1);
    const point = pointAlongPath(animation.shot.trajectory, flightProgress);

    if (point && flightProgress < 1 && this.projectileSprite) {
      const nextPoint = pointAlongPath(animation.shot.trajectory, Math.min(1, flightProgress + 0.02)) ?? point;
      const dx = nextPoint.x - point.x;
      const dy = nextPoint.y - point.y;
      const angleRad = Math.hypot(dx, dy) > 0.01 ? Math.atan2(dy, dx) : 0;
      const frame = PROJECTILE_FRAME_BY_ITEM[animation.shot.item];
      this.projectileSprite
        .setFrame(frame)
        .setPosition(point.x, point.y)
        .setRotation(angleRad)
        .setScale(animation.shot.item === "megaBlast" ? 0.56 : 0.48)
        .setVisible(true);

      // Continuous smoke-puff + glowing spark trail behind flying shell
      if (time - animation.lastTrailAt >= (this.reducedMotion ? 75 : 28)) {
        animation.lastTrailAt = time;
        this.spawnProjectileTrail(point.x, point.y, animation.shot.item);
      }
    } else {
      this.projectileSprite?.setVisible(false);
    }

    if (flightProgress >= 1 && !animation.exploded) {
      animation.exploded = true;
      this.audio.stopFlight();
      if (animation.shot.impact) {
        this.playExplosion(animation.shot);
      }
      this.renderStatus();
    }

    if (elapsed >= flightDuration + impactDuration) {
      this.shotAnimation = undefined;
      this.projectileSprite?.setVisible(false);
      this.stopFlightAudio();

      const latestClient = this.getClient();
      const latestShot = latestClient.publicView.lastShot;
      if (latestShot?.resolved && latestShot.damage.length > 0 && !this.shownDamageShotIds.has(latestShot.id)) {
        this.presentShotDamage(latestShot, latestClient.publicView);
      }
      if (latestClient.publicView.result) {
        this.playMatchOutcomeSound(latestClient);
      }

      const nextAnimation = this.shotAnimationQueue.shift();
      if (nextAnimation) this.beginShotAnimation(nextAnimation, time);
      this.renderAll();
    }
  }

  private spawnProjectileTrail(x: number, y: number, item: TankItemSelection): void {
    const smoke = this.add.circle(x, y, item === "megaBlast" ? 5.5 : 4, 0xe2e8f0, 0.55).setDepth(6.2);
    this.tweens.add({
      targets: smoke,
      scale: 2.0,
      alpha: 0,
      duration: 360,
      ease: "Sine.Out",
      onComplete: () => smoke.destroy()
    });
    const sparkColor = item === "warhead" ? 0xfb7185 : item === "megaBlast" ? 0xf97316 : 0xfef08a;
    const spark = this.add
      .circle(x + (Math.random() * 6 - 3), y + (Math.random() * 6 - 3), 2.5, sparkColor, 0.92)
      .setDepth(6.5);
    this.tweens.add({
      targets: spark,
      y: spark.y + 8,
      scale: 0.2,
      alpha: 0,
      duration: 240,
      ease: "Quad.Out",
      onComplete: () => spark.destroy()
    });
  }

  private updateExplosions(timeMs: number): void {
    for (let i = this.activeExplosions.length - 1; i >= 0; i -= 1) {
      const exp = this.activeExplosions[i]!;
      const elapsed = timeMs - exp.startedAt;
      if (elapsed >= exp.durationMs) {
        exp.sprite.destroy();
        this.activeExplosions.splice(i, 1);
        continue;
      }
      const frame = selectExplosionFrame(elapsed, exp.durationMs);
      exp.sprite.setFrame(frame);
    }
  }

  private playExplosion(shot: LastShot): void {
    if (!shot.impact) return;
    if (shot.directHitPlayerId) {
      this.audio.playTankExplosion();
      this.tankHitTimes.set(shot.directHitPlayerId, this.time.now);
    } else {
      this.audio.playTerrainExplosion();
    }

    const { x, y } = shot.impact;

    // 8-frame illustrated cartoon explosion sprite
    const expScale = Math.max(1.05, shot.explosionRadius / 32);
    const expSprite = this.add
      .sprite(x, y, TEX_EXPLOSION, 0)
      .setScale(expScale)
      .setDepth(8.5);
    this.activeExplosions.push({
      sprite: expSprite,
      startedAt: this.time.now,
      durationMs: EXPLOSION_ANIM_MS
    });

    // Crisp shockwave ring pulse
    const ring = this.add.circle(x, y, Math.max(12, shot.explosionRadius * 0.45), 0xfef08a, 0)
      .setStrokeStyle(4, 0xfde047, 0.9)
      .setDepth(8.2);
    this.tweens.add({
      targets: ring,
      scale: 2.1,
      alpha: 0,
      duration: 420,
      ease: "Quad.Out",
      onComplete: () => ring.destroy()
    });

    const sparks = this.add.particles(x, y, "tank-battle-spark", {
      speed: { min: 110, max: 320 },
      angle: { min: 190, max: 350 },
      lifespan: { min: 300, max: 640 },
      gravityY: 260,
      scale: { start: 1.25, end: 0 },
      quantity: 0,
      emitting: false
    }).setDepth(9);
    sparks.explode(this.reducedMotion ? 12 : 34);

    const debris = this.add.particles(x, y, "tank-battle-debris", {
      speedX: { min: -195, max: 195 },
      speedY: { min: -310, max: -80 },
      lifespan: { min: 520, max: 880 },
      gravityY: 390,
      rotate: { min: 0, max: 360 },
      scale: { min: 0.65, max: 1.5 },
      quantity: 0,
      emitting: false
    }).setDepth(8);
    debris.explode(this.reducedMotion ? 8 : 26);

    this.time.delayedCall(IMPACT_EFFECT_MS - 50, () => {
      sparks.destroy();
      debris.destroy();
    });

    if (!this.reducedMotion) {
      this.cameras.main.shake(330, 0.007 + shot.explosionRadius / 25_000);
    }

    if (shot.resolved && shot.damage.length > 0 && !this.shownDamageShotIds.has(shot.id)) {
      this.presentShotDamage(shot, this.getClient().publicView);
    }
  }

  private presentShotDamage(shot: LastShot, view: TankBattlePublicView): void {
    this.shownDamageShotIds.add(shot.id);
    for (const entry of shot.damage) {
      if (entry.totalDamage <= 0) continue;
      this.tankHitTimes.set(entry.playerId, this.time.now);
      const target = view.players.find((p) => p.playerId === entry.playerId);
      if (!target) continue;

      const isDirect = entry.directHitDamage > 0;
      const label = isDirect ? `직격! -${entry.totalDamage}` : `-${entry.totalDamage}`;
      const text = this.add.text(target.x, target.y - 82, label, {
        fontFamily: "Inter, Pretendard, system-ui, sans-serif",
        fontSize: isDirect ? "22px" : "18px",
        fontStyle: "bold",
        color: isDirect ? "#fde047" : "#fb7185",
        stroke: "#091224",
        strokeThickness: 5
      }).setOrigin(0.5).setDepth(13);

      this.tweens.add({
        targets: text,
        y: text.y - 44,
        alpha: 0,
        duration: 1_150,
        ease: "Cubic.Out",
        onComplete: () => text.destroy()
      });
    }
  }

  private playMatchOutcomeSound(client: TankBattleClient): void {
    const view = client.publicView;
    if (!view.result) return;
    const outcomeKey = `${view.result}:${view.winnerPlayerId ?? "none"}:${view.turnNumber}`;
    if (this.playedOutcomeKey === outcomeKey) return;
    this.playedOutcomeKey = outcomeKey;
    if (view.result === "win" && view.winnerPlayerId === client.playerId) {
      this.audio.playVictory();
    } else {
      this.audio.playDefeat();
    }
  }

  private createParticleTextures(): void {
    if (!this.textures.exists("tank-battle-spark")) {
      const spark = this.make.graphics({ x: 0, y: 0 });
      spark.fillStyle(0xffe082, 1).fillCircle(4, 4, 4).generateTexture("tank-battle-spark", 8, 8).destroy();
    }
    if (!this.textures.exists("tank-battle-debris")) {
      const debris = this.make.graphics({ x: 0, y: 0 });
      debris.fillStyle(0x6b4f36, 1).fillRect(0, 0, 8, 6).generateTexture("tank-battle-debris", 8, 6).destroy();
    }
  }

  private changeAngle(delta: number): void {
    if (!this.canAim()) return;
    this.angle = clamp(this.angle + delta, ANGLE_MIN, ANGLE_MAX);
    this.audio.playGearCreak(0.45);
    this.renderPowerAndPreview();
  }

  private updateHeldAngle(time: number, delta: number): void {
    if (this.heldAngleKeys.size === 0) return;
    if (!this.canAim()) {
      this.stopAngleAdjustment();
      return;
    }
    const direction = this.currentAngleKeyDirection();
    if (direction === 0) return;
    this.angleHoldStartedAt ??= time;
    const heldMs = Math.max(0, time - this.angleHoldStartedAt);
    const speed = clamp(24 + heldMs * 0.05, 24, 120);
    const previousAngle = this.angle;
    this.angle = clamp(this.angle + direction * speed * (Math.min(delta, 50) / 1_000), ANGLE_MIN, ANGLE_MAX);
    if (this.angle === previousAngle) return;

    this.renderPowerAndPreview();
    if (time >= this.nextGearCreakAt) {
      const intensity = clamp((speed - 24) / 96, 0, 1);
      this.audio.playGearCreak(intensity);
      this.nextGearCreakAt = time + 210 - intensity * 125;
    }
  }

  private handleKeyDown(event: KeyboardEvent): void {
    void this.audio.unlock();
    const direction = angleDirectionForKey(event.code);
    if (direction === 0) return;
    if (this.canAim()) event.preventDefault();
    if (!this.canAim() || this.heldAngleKeys.has(event.code)) return;
    const previousDirection = this.currentAngleKeyDirection();
    this.heldAngleKeys.add(event.code);
    if (this.currentAngleKeyDirection() !== previousDirection) {
      this.angleHoldStartedAt = performance.now();
      this.nextGearCreakAt = 0;
    }
  }

  private handleKeyUp(event: KeyboardEvent): void {
    const direction = angleDirectionForKey(event.code);
    if (direction === 0) return;
    if (this.heldAngleKeys.delete(event.code)) event.preventDefault();
    if (this.currentAngleKeyDirection() === 0) {
      this.angleHoldStartedAt = undefined;
    } else {
      this.angleHoldStartedAt = performance.now();
    }
  }

  private currentAngleKeyDirection(): number {
    let direction = 0;
    for (const code of this.heldAngleKeys) direction += angleDirectionForKey(code);
    return clamp(direction, -1, 1);
  }

  private stopAngleAdjustment(): void {
    this.heldAngleKeys.clear();
    this.angleHoldStartedAt = undefined;
    this.nextGearCreakAt = 0;
  }

  private handleBattlefieldPointerDown(pointer: Phaser.Input.Pointer): void {
    void this.audio.unlock();
    if (
      !pointer.wasTouch || pointer.worldX < 0 || pointer.worldX >= this.layout.aimWidth ||
      pointer.worldY < 0 || pointer.worldY >= this.layout.aimHeight || !this.canAim()
    ) return;
    this.activeAimPointerId = pointer.id;
    this.updateAngleFromPointer(pointer);
  }

  private handleBattlefieldPointerMove(pointer: Phaser.Input.Pointer): void {
    if (!pointer.wasTouch || !pointer.isDown || pointer.id !== this.activeAimPointerId) return;
    this.updateAngleFromPointer(pointer);
  }

  private updateAngleFromPointer(pointer: Phaser.Input.Pointer): void {
    const client = this.getClient();
    const tank = this.getVisualView().players.find((candidate) => candidate.playerId === client.playerId);
    if (!tank || !this.canAim()) return;
    const facing = tankFacing(tank);
    const barrelX = tank.x + facing * 4;
    const barrelY = tank.y - 21;
    const vectorX = pointer.worldX - barrelX;
    const vectorY = pointer.worldY - barrelY;
    const magnitude = Math.hypot(vectorX, vectorY);
    if (magnitude < 1) return;
    const cosine = clamp((vectorX * facing) / magnitude, -1, 1);
    const unsignedAngle = Math.acos(cosine) * (180 / Math.PI);
    const elevationAngle = vectorY <= 0 ? unsignedAngle : -unsignedAngle;
    this.angle = Math.round(clamp(elevationAngle, ANGLE_MIN, ANGLE_MAX) * 10) / 10;
    this.renderPowerAndPreview();
  }

  private selectItem(item: Exclude<TankItemSelection, "none">): void {
    if (!this.canAim() || (this.getClient().privateView.items?.[item] ?? 0) <= 0) return;
    this.selectedItem = this.selectedItem === item ? "none" : item;
    this.audio.playItemSelect();
    this.renderItems();
    this.renderPowerAndPreview();
    this.refreshButtonStyles();
  }

  private startCharge(pointerId?: number): void {
    if (!this.canAim() || this.chargeStartedAt !== undefined) return;
    this.chargeStartedAt = performance.now();
    this.chargingPointerId = pointerId;
    this.power = 10;
    triggerSelectionFeedback();
    this.refreshButtonStyles();
  }

  private releaseCharge(send: boolean): void {
    if (this.chargeStartedAt === undefined) return;
    const elapsed = performance.now() - this.chargeStartedAt;
    this.power = chargedPower(elapsed);
    this.chargeStartedAt = undefined;
    this.chargingPointerId = undefined;
    if (send && this.canAim()) {
      const firedPower = Math.round(this.power * 10) / 10;
      this.lastOwnShotPower = firedPower;
      this.awaitingSnapshot = true;
      this.tankFireTimes.set(this.getClient().playerId, this.time.now);
      triggerPlacementFeedback();
      this.startFlightAudio(this.getClient().publicView.turnNumber);
      this.getClient().sendAction({
        type: "fire",
        payload: { angle: this.angle, power: firedPower, item: this.selectedItem }
      });
    }
    this.renderPowerAndPreview();
    this.refreshButtonStyles();
  }

  private cancelCharge(): void {
    this.releaseCharge(false);
  }

  private handleBlur(): void {
    this.cancelCharge();
    this.stopAngleAdjustment();
    this.activeAimPointerId = undefined;
  }

  private handleGameOut(): void {
    this.cancelCharge();
    this.activeAimPointerId = undefined;
  }

  private handleGlobalPointerUp(pointer: Phaser.Input.Pointer): void {
    if (pointer.id === this.activeAimPointerId) this.activeAimPointerId = undefined;
    if (this.chargingPointerId === undefined || pointer.id === this.chargingPointerId) {
      this.releaseCharge(true);
    }
  }

  private handleSpaceDown(event: KeyboardEvent): void {
    event.preventDefault();
    void this.audio.unlock();
    if (!event.repeat) this.startCharge();
  }

  private handleSpaceUp(event: KeyboardEvent): void {
    event.preventDefault();
    this.releaseCharge(true);
  }

  private startFlightAudio(shotId: number): void {
    this.soundingShotId = shotId;
    this.flightSafetyTimer?.remove(false);
    this.flightSafetyTimer = this.time.delayedCall(5_000, () => this.stopFlightAudio());
    void this.audio.resume().then((ready) => {
      if (!ready || this.soundingShotId !== shotId || this.shotAnimation?.exploded) return;
      this.audio.playLaunch();
      this.audio.playFlight();
    });
  }

  private stopFlightAudio(): void {
    this.flightSafetyTimer?.remove(false);
    this.flightSafetyTimer = undefined;
    this.soundingShotId = undefined;
    this.audio.stopFlight();
  }

  private canAim(): boolean {
    const client = this.getClient();
    const view = client.publicView;
    return (
      view.roomPhase === "active" &&
      view.turnPhase !== "resolving" &&
      view.currentPlayerId === client.playerId &&
      !view.result &&
      !this.awaitingSnapshot &&
      !this.shotAnimation
    );
  }

  private ensureSelectedItemAvailable(): void {
    if (this.selectedItem === "none") return;
    if ((this.getClient().privateView.items?.[this.selectedItem] ?? 0) <= 0) this.selectedItem = "none";
  }
}

function toTankBattleClient(
  context: GameClientContext,
  callbacks: Pick<TankBattleClient, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">,
  previous: TankBattleClient | undefined
): TankBattleClient {
  return {
    playerId: context.playerId,
    version: context.version,
    serverTime: context.serverTime,
    receivedAt: previous && previous.serverTime === context.serverTime ? previous.receivedAt : performance.now(),
    connected: context.connected !== false,
    actionErrorRevision: context.actionError?.revision ?? 0,
    publicView: {
      ...(context.publicView as unknown as TankBattlePublicView),
      roomPhase: context.phase,
      rematchRequests: context.rematchRequests
    },
    privateView: context.privateView as unknown as TankBattlePrivateView,
    ...callbacks
  };
}

function syncResultDialog(gameUi: MountedGameUi, client: TankBattleClient): void {
  const view = client.publicView;
  const finished = view.roomPhase === "finished" && Boolean(view.result);
  if (!finished) {
    gameUi.setResult({ open: false, title: "", message: "" });
    return;
  }
  const requested = view.rematchRequests?.includes(client.playerId) ?? false;
  gameUi.setResult({
    open: true,
    title: view.result === "draw" ? "무승부" : view.winnerPlayerId === client.playerId ? "전장 승리" : "탱크 파괴",
    message: requested ? "상대의 재대결 응답을 기다리고 있습니다." : "새 지형에서 다시 싸우거나 로비로 돌아갈 수 있습니다.",
    primaryLabel: requested ? "대기 중…" : "다시 하기",
    primaryDisabled: requested,
    secondaryLabel: "나가기"
  });
}

function chargedPower(elapsedMs: number): number {
  return clamp(10 + elapsedMs / 15, 10, 100);
}

function angleDirectionForKey(code: string): -1 | 0 | 1 {
  if (code === "ArrowUp" || code === "ArrowRight") return 1;
  if (code === "ArrowDown" || code === "ArrowLeft") return -1;
  return 0;
}

function clonePublicView(view: TankBattlePublicView): TankBattlePublicView {
  return {
    ...view,
    terrain: [...view.terrain],
    players: view.players.map((player) => ({
      ...player,
      itemCounts: { ...player.itemCounts }
    })),
    ...(view.lastShot ? {
      lastShot: {
        ...view.lastShot,
        trajectory: view.lastShot.trajectory.map((point) => ({ ...point })),
        damage: view.lastShot.damage.map((entry) => ({ ...entry })),
        ...(view.lastShot.impact ? { impact: { ...view.lastShot.impact } } : {})
      }
    } : {}),
    ...(view.rematchRequests ? { rematchRequests: [...view.rematchRequests] } : {})
  };
}

function pointAlongPath(path: Array<{ x: number; y: number }>, progress: number): { x: number; y: number } | undefined {
  if (path.length === 0) return undefined;
  const index = progress * (path.length - 1);
  const left = Math.floor(index);
  const right = Math.min(path.length - 1, left + 1);
  const mix = index - left;
  const a = path[left]!;
  const b = path[right]!;
  return { x: a.x + (b.x - a.x) * mix, y: a.y + (b.y - a.y) * mix };
}
