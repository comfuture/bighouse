import bgSkyUrl from "./assets/images/bg_sky.png?url";
import bgMountainsUrl from "./assets/images/bg_mountains.png?url";
import bgTreesUrl from "./assets/images/bg_trees.png?url";
import tilesetMeadowUrl from "./assets/images/tileset_meadow.png?url";
import heroUrl from "./assets/images/hero.png?url";
import heroSheetUrl from "./assets/images/hero_sheet.png?url";
import itemsSheetUrl from "./assets/images/items_sheet.png?url";
import economySheetUrl from "./assets/images/economy_sheet.png?url";
import mobRedMushroomUrl from "./assets/images/mob_red_mushroom.png?url";
import mobRedMushroomSheetUrl from "./assets/images/mob_red_mushroom_sheet.png?url";
import mobYellowHamsterUrl from "./assets/images/mob_yellow_hamster.png?url";
import mobYellowHamsterSheetUrl from "./assets/images/mob_yellow_hamster_sheet.png?url";
import mobBlueRabbitUrl from "./assets/images/mob_blue_rabbit.png?url";
import mobPurpleSnakeUrl from "./assets/images/mob_purple_snake.png?url";
import mobEmeraldFrogUrl from "./assets/images/mob_emerald_frog.png?url";
import mobOrangeFoxUrl from "./assets/images/mob_orange_fox.png?url";
import mobSkyOwlUrl from "./assets/images/mob_sky_owl.png?url";
import mobCrimsonBoarUrl from "./assets/images/mob_crimson_boar.png?url";
import mobTealBatUrl from "./assets/images/mob_teal_bat.png?url";
import mobCobaltGolemUrl from "./assets/images/mob_cobalt_golem.png?url";
import mobLimeSlimeUrl from "./assets/images/mob_lime_slime.png?url";
import mobVioletSpiderUrl from "./assets/images/mob_violet_spider.png?url";
import mobGoldGriffinUrl from "./assets/images/mob_gold_griffin.png?url";
import mobScarletDrakeUrl from "./assets/images/mob_scarlet_drake.png?url";
import mobIndigoWispUrl from "./assets/images/mob_indigo_wisp.png?url";
import mobStarlightDragonUrl from "./assets/images/mob_starlight_dragon.png?url";

import {
  evaluateActorPose,
  getCharacterAnimationSpec,
  resolveActorAnimState,
  type ActorRenderPose
} from "./animation";
import {
  ITEM_CATALOG,
  STATUS_METADATA,
  THEME_CATALOG,
  VIEWPORT,
  WEAPON_CATALOG,
  WEAPON_ORDER
} from "./catalogs";
import {
  computeEffectiveCombatStats,
  getWeaponUpgrade
} from "./economy";
import { HUD_COIN_HITBOX, HUD_STATUS_HITBOX } from "./hud-interactions";
import type { CompiledStage, RuntimeDecoration, RuntimePlatform, RuntimePortal } from "./map-schema";
import { computeXpEfficiency } from "./progression";
import type { ActiveStatusEffect, RemotePlayerView, StageTheme, StatusEffectKind, WeaponUpgradeState } from "./types";

export { economySheetUrl, itemsSheetUrl, heroUrl, HUD_COIN_HITBOX, HUD_STATUS_HITBOX };

const IMAGE_URLS: Record<string, string> = {
  bg_sky: bgSkyUrl,
  bg_mountains: bgMountainsUrl,
  bg_trees: bgTreesUrl,
  tileset_meadow: tilesetMeadowUrl,
  hero: heroUrl,
  hero_sheet: heroSheetUrl,
  items_sheet: itemsSheetUrl,
  economy_sheet: economySheetUrl,
  red_mushroom: mobRedMushroomUrl,
  red_mushroom_sheet: mobRedMushroomSheetUrl,
  yellow_hamster: mobYellowHamsterUrl,
  yellow_hamster_sheet: mobYellowHamsterSheetUrl,
  blue_rabbit: mobBlueRabbitUrl,
  purple_snake: mobPurpleSnakeUrl,
  emerald_frog: mobEmeraldFrogUrl,
  orange_fox: mobOrangeFoxUrl,
  sky_owl: mobSkyOwlUrl,
  crimson_boar: mobCrimsonBoarUrl,
  teal_bat: mobTealBatUrl,
  cobalt_golem: mobCobaltGolemUrl,
  lime_slime: mobLimeSlimeUrl,
  violet_spider: mobVioletSpiderUrl,
  gold_griffin: mobGoldGriffinUrl,
  scarlet_drake: mobScarletDrakeUrl,
  indigo_wisp: mobIndigoWispUrl,
  starlight_dragon: mobStarlightDragonUrl
};

export type ClientMobRender = {
  id: string;
  name: string;
  level: number;
  spriteKey: string;
  primaryColor: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  facing: number;
  grounded: boolean;
  alive: boolean;
  hp: number;
  maxHp: number;
  displayHp: number;
  inCombat: boolean;
  spawnProtectUntil: number;
  alertTimer: number;
  hitFlashTimer: number;
  hitStunTimer: number;
  animTimer: number;
  drawScale: number;
  hasCrown: boolean;
  isElite?: boolean;
  squashX: number;
  squashY: number;
  statuses: Partial<Record<StatusEffectKind, ActiveStatusEffect>>;
};

export type ClientItemRender = {
  id: string;
  templateId: string;
  x: number;
  y: number;
  available: boolean;
  bobPhase: number;
  /** Counts down when a Treasure Chest has just been opened to show the open-lid golden glow */
  openingTimer?: number;
};

export type ClientLootDrop = {
  id: string;
  x: number;
  y: number;
  vx: number;
  vy: number;
  sheet: "economy" | "items";
  iconIndex: number;
  color: string;
  label?: string;
  age: number;
  arcDuration: number;
  collected: boolean;
};

export type ClientProjectileRender = {
  x: number;
  y: number;
  w: number;
  h: number;
  color: string;
  accentColor: string;
  spin: number;
  isEnemy?: boolean;
};

export type ClientDamageText = {
  x: number;
  y: number;
  vy: number;
  text: string;
  kind: "normal" | "crit" | "playerHurt" | "heal" | "exp" | "levelup" | "info";
  age: number;
  duration: number;
  color: string;
  stroke: string;
  fontSize: number;
};

export type ClientHitEffect =
  | {
      type: "slash";
      x: number;
      y: number;
      facing: number;
      reach: number;
      color: string;
      age: number;
      duration: number;
    }
  | {
      type: "starburst";
      x: number;
      y: number;
      color: string;
      isCrit: boolean;
      radius: number;
      rotation: number;
      age: number;
      duration: number;
    }
  | {
      type: "wave";
      x: number;
      y: number;
      facing: number;
      rangePx: number;
      heightPx: number;
      color: string;
      accentColor: string;
      style: "maple_wave" | "solar_shockwave" | "dragon_flame";
      age: number;
      duration: number;
    }
  | {
      type: "levelup_pillar";
      x: number;
      y: number;
      level: number;
      age: number;
      duration: number;
    };

export type ClientParticle = {
  x: number;
  y: number;
  vx: number;
  vy: number;
  gravity: number;
  size: number;
  color: string;
  age: number;
  duration: number;
  shape: "circle" | "star";
};

export type LocalPlayerRender = {
  playerId: string;
  displayName: string;
  x: number;
  y: number;
  w: number;
  h: number;
  vx: number;
  vy: number;
  facing: number;
  grounded: boolean;
  onLadder: boolean;
  level: number;
  xp: number;
  xpToNext: number;
  hp: number;
  maxHp: number;
  baseAtk: number;
  baseDex: number;
  potions: number;
  coins: number;
  score: number;
  mobsDefeated: number;
  unlockedWeapons: string[];
  equippedWeaponId: string;
  weaponUpgrades: Record<string, WeaponUpgradeState>;
  inMenu: boolean;
  invulnTimer: number;
  slowTimer: number;
  statuses: Partial<Record<StatusEffectKind, ActiveStatusEffect>>;
  idleRegenActive: boolean;
  attackAnimTimer: number;
  attackAnimDuration: number;
  animTimer: number;
  squashX: number;
  squashY: number;
  nearbyPortal: RuntimePortal | null;
  nearbySign: RuntimeDecoration | null;
};

export type RenderScene = {
  now: number;
  stage: CompiledStage;
  camera: { x: number; y: number; maxY: number };
  shakeX: number;
  shakeY: number;
  warpFlash: number;
  player: LocalPlayerRender;
  remotePlayers: RemotePlayerView[];
  mobs: ClientMobRender[];
  items: ClientItemRender[];
  lootDrops: ClientLootDrop[];
  projectiles: ClientProjectileRender[];
  damageTexts: ClientDamageText[];
  hitEffects: ClientHitEffect[];
  particles: ClientParticle[];
  coinHover?: boolean;
  statusHover?: boolean;
  stagePlayerCount: number;
  totalPlayersOnline: number;
};

export async function loadSunnyImages(): Promise<Record<string, HTMLImageElement>> {
  const entries = Object.entries(IMAGE_URLS);
  const loaded = await Promise.all(
    entries.map(
      ([key, src]) =>
        new Promise<[string, HTMLImageElement]>((resolve, reject) => {
          const img = new Image();
          img.decoding = "async";
          img.onload = () => resolve([key, img]);
          img.onerror = () => reject(new Error(`Failed to load ${key}`));
          img.src = src;
        })
    )
  );
  return Object.fromEntries(loaded);
}

export class SunnyRenderer {
  private ctx: CanvasRenderingContext2D;
  private tintCanvas: HTMLCanvasElement;
  private tintCtx: CanvasRenderingContext2D;
  private biomeTilesets = new Map<string, HTMLCanvasElement>();
  private time = 0;

  constructor(
    canvas: HTMLCanvasElement,
    private readonly images: Record<string, HTMLImageElement>
  ) {
    const ctx = canvas.getContext("2d");
    if (!ctx) throw new Error("2D canvas context unavailable");
    this.ctx = ctx;
    this.tintCanvas = document.createElement("canvas");
    this.tintCanvas.width = 128;
    this.tintCanvas.height = 128;
    this.tintCtx = this.tintCanvas.getContext("2d")!;
  }

  render(scene: RenderScene, dt: number): void {
    this.time += dt;
    const ctx = this.ctx;
    const W = VIEWPORT.width;
    const H = VIEWPORT.height;

    ctx.save();
    ctx.clearRect(0, 0, W, H);

    this.drawParallax(ctx, scene.camera, scene.stage.meta.themeId);

    const camX = Math.round(scene.camera.x + scene.shakeX);
    const camY = Math.round(scene.camera.y + scene.shakeY);

    ctx.save();
    ctx.translate(-camX, -camY);

    this.drawHazards(ctx, scene.stage, camX, W);
    this.drawPlatforms(ctx, scene.stage, camX, W);
    this.drawMovingPlatforms(ctx, scene.stage, camX, W);
    this.drawDecorations(ctx, scene.stage, camX, W);
    this.drawLadders(ctx, scene.stage, camX, W);
    this.drawPortals(ctx, scene.stage, scene.player, camX, W);
    this.drawItems(ctx, scene.items, scene.player, camX, W);
    this.drawMobs(ctx, scene.mobs, scene.now, camX, W);
    this.drawRemotePlayers(ctx, scene.remotePlayers, camX, W);
    this.drawLocalPlayer(ctx, scene.player);
    this.drawLootDrops(ctx, scene.lootDrops);
    this.drawProjectiles(ctx, scene.projectiles);
    this.drawEffects(ctx, scene.hitEffects, scene.particles, scene.damageTexts);
    this.drawSignTooltip(ctx, scene.player.nearbySign);

    ctx.restore();

    if (scene.warpFlash > 0) {
      const a = Math.min(0.45, (scene.warpFlash / 0.28) * 0.45);
      ctx.fillStyle = `rgba(225, 245, 254, ${a.toFixed(3)})`;
      ctx.fillRect(0, 0, W, H);
    }

    this.drawHUD(ctx, scene);
    ctx.restore();
  }

  private getBiomeTileset(themeId: string): HTMLImageElement | HTMLCanvasElement | undefined {
    if (themeId === "sunny_meadow") return this.images.tileset_meadow;
    const cached = this.biomeTilesets.get(themeId);
    if (cached) return cached;

    const theme = THEME_CATALOG[themeId] ?? THEME_CATALOG.sunny_meadow!;
    const p = theme.palette;
    const ts = 48;
    const canvas = document.createElement("canvas");
    canvas.width = ts * 8;
    canvas.height = ts * 2;
    const c = canvas.getContext("2d")!;

    // Row 0, Cols 0..3: Surface tiles (left, middle, right, single)
    for (let col = 0; col < 4; col++) {
      const ox = col * ts;
      const roundL = col === 0 || col === 3 ? 9 : 0;
      const roundR = col === 2 || col === 3 ? 9 : 0;

      // Body fill (soil / stone / crystal / marble / basalt)
      c.fillStyle = p.bodyBase;
      c.beginPath();
      c.roundRect(ox + (roundL ? 2 : 0), 10, ts - (roundL ? 2 : 0) - (roundR ? 2 : 0), ts - 10, [0, 0, 0, 0]);
      c.fill();

      // Biome-specific body texture details
      c.fillStyle = p.bodyDark;
      if (theme.style === "crystal" || theme.style === "starlight") {
        // Faceted crystalline / starry geometric planes
        c.beginPath();
        c.moveTo(ox + 6, 22);
        c.lineTo(ox + 22, 16);
        c.lineTo(ox + 18, 36);
        c.closePath();
        c.fill();
        c.fillStyle = p.bodyLight;
        c.beginPath();
        c.moveTo(ox + 26, 24);
        c.lineTo(ox + 42, 19);
        c.lineTo(ox + 38, 41);
        c.closePath();
        c.fill();
        if (theme.style === "starlight") {
          c.fillStyle = p.accent;
          c.fillRect(ox + 12, 26, 3, 3);
          c.fillRect(ox + 34, 34, 2, 2);
        }
      } else if (theme.style === "cloud") {
        // Classical marble bricks with subtle gold veins
        c.fillRect(ox + 2, 26, ts - 4, 2);
        c.fillRect(ox + 22, 16, 2, 10);
        c.fillRect(ox + 12, 28, 2, 18);
        c.fillRect(ox + 36, 28, 2, 18);
      } else if (theme.style === "volcano") {
        // Dark basalt cracks with glowing magma hairline
        c.fillRect(ox + 8, 20, 14, 10);
        c.fillRect(ox + 26, 30, 14, 12);
        c.strokeStyle = p.accent;
        c.lineWidth = 1.6;
        c.beginPath();
        c.moveTo(ox + 10, 38);
        c.lineTo(ox + 22, 28);
        c.lineTo(ox + 34, 34);
        c.stroke();
      } else {
        // Rounded pebbles / stone blocks
        c.beginPath();
        c.roundRect(ox + 6, 22, 13, 8, 4);
        c.roundRect(ox + 25, 31, 15, 9, 4);
        c.fill();
        c.fillStyle = p.bodyLight;
        c.beginPath();
        c.roundRect(ox + 28, 20, 10, 6, 3);
        c.roundRect(ox + 9, 34, 11, 6, 3);
        c.fill();
      }

      // Top crust (grass / clover / moss / autumn maple / crystal cap / marble trim / magma crust)
      c.fillStyle = p.crustMid;
      c.beginPath();
      c.roundRect(ox + (roundL ? 1 : 0), 2, ts - (roundL ? 1 : 0) - (roundR ? 1 : 0), 17, [roundL, roundR, 4, 4]);
      c.fill();

      c.fillStyle = p.crustTop;
      c.beginPath();
      c.roundRect(ox + (roundL ? 2 : 0), 2, ts - (roundL ? 2 : 0) - (roundR ? 2 : 0), 11, [roundL, roundR, 3, 3]);
      c.fill();

      // Bright top specular rim
      c.fillStyle = p.crustHi;
      c.fillRect(ox + (roundL ? 7 : 2), 4, ts - (roundL ? 7 : 2) - (roundR ? 7 : 2), 3);

      // Scalloped overhang underside
      c.fillStyle = p.crustShade;
      for (let s = 0; s < 3; s++) {
        c.beginPath();
        c.arc(ox + 9 + s * 15, 18, 5, 0, Math.PI);
        c.fill();
      }

      // Crisp cel-shaded outline on exposed borders
      c.strokeStyle = p.outline;
      c.lineWidth = 2.4;
      c.beginPath();
      c.moveTo(ox + (roundL ? 6 : 0), 2);
      c.lineTo(ox + ts - (roundR ? 6 : 0), 2);
      c.stroke();
      if (roundL) {
        c.beginPath();
        c.moveTo(ox + 1.5, 8);
        c.lineTo(ox + 1.5, ts);
        c.stroke();
      }
      if (roundR) {
        c.beginPath();
        c.moveTo(ox + ts - 1.5, 8);
        c.lineTo(ox + ts - 1.5, ts);
        c.stroke();
      }
    }

    // Row 0, Col 4: Deep interior ground fill
    {
      const ox = 4 * ts;
      c.fillStyle = p.bodyBase;
      c.fillRect(ox, 0, ts, ts);
      c.fillStyle = p.bodyDark;
      c.beginPath();
      c.roundRect(ox + 5, 6, 16, 10, 4);
      c.roundRect(ox + 26, 20, 16, 11, 4);
      c.roundRect(ox + 8, 32, 14, 10, 4);
      c.fill();
      c.fillStyle = p.bodyLight;
      c.beginPath();
      c.roundRect(ox + 28, 6, 12, 7, 3);
      c.roundRect(ox + 24, 36, 12, 7, 3);
      c.fill();
      if (theme.style === "volcano" || theme.style === "starlight" || theme.style === "crystal") {
        c.fillStyle = p.accent;
        c.globalAlpha = 0.55;
        c.fillRect(ox + 14, 20, 4, 4);
        c.fillRect(ox + 36, 12, 3, 3);
        c.globalAlpha = 1;
      }
    }

    // Row 0, Cols 5..7: Moving floating platform bridge segments
    for (let i = 0; i < 3; i++) {
      const ox = (5 + i) * ts;
      const rL = i === 0 ? 8 : 0;
      const rR = i === 2 ? 8 : 0;
      c.fillStyle = p.woodDark;
      c.beginPath();
      c.roundRect(ox + (rL ? 2 : 0), 8, ts - (rL ? 2 : 0) - (rR ? 2 : 0), 26, [rL, rR, rR, rL]);
      c.fill();
      c.fillStyle = p.woodMid;
      c.beginPath();
      c.roundRect(ox + (rL ? 3 : 0), 9, ts - (rL ? 3 : 0) - (rR ? 3 : 0), 18, [rL, rR, 3, 3]);
      c.fill();
      c.fillStyle = p.woodTop;
      c.fillRect(ox + (rL ? 6 : 0), 10, ts - (rL ? 6 : 0) - (rR ? 6 : 0), 6);
      c.strokeStyle = p.outline;
      c.lineWidth = 2.2;
      c.beginPath();
      c.roundRect(ox + (rL ? 2 : 0), 8, ts - (rL ? 2 : 0) - (rR ? 2 : 0), 26, [rL, rR, rR, rL]);
      c.stroke();
      // Decorative bolt / jewel
      c.fillStyle = p.accent;
      c.beginPath();
      c.arc(ox + ts * 0.5, 21, 3.2, 0, Math.PI * 2);
      c.fill();
    }

    // Row 1, Cols 0..1: Biome-tinted ladders
    for (let col = 0; col < 2; col++) {
      const ox = col * ts;
      const oy = ts;
      c.fillStyle = p.woodMid;
      c.strokeStyle = p.outline;
      c.lineWidth = 2;
      // Left & right rails
      c.fillRect(ox + 9, oy, 7, ts);
      c.strokeRect(ox + 9, oy, 7, ts);
      c.fillRect(ox + ts - 16, oy, 7, ts);
      c.strokeRect(ox + ts - 16, oy, 7, ts);
      // Horizontal rungs
      const rungs = col === 0 ? [8, 22, 36] : [10, 26, 40];
      for (const ry of rungs) {
        c.fillStyle = p.woodTop;
        c.fillRect(ox + 14, oy + ry, ts - 28, 6);
        c.strokeRect(ox + 14, oy + ry, ts - 28, 6);
      }
    }

    // Row 1, Cols 2..7: Reuse crisp base decorations (sign, rocks, bushes, flowers)
    const baseTiles = this.images.tileset_meadow;
    if (baseTiles) {
      c.drawImage(baseTiles, 2 * ts, ts + 2, 6 * ts, ts - 2, 2 * ts, ts + 2, 6 * ts, ts - 2);
    }

    this.biomeTilesets.set(themeId, canvas);
    return canvas;
  }

  private drawParallax(ctx: CanvasRenderingContext2D, camera: RenderScene["camera"], themeId: string): void {
    const W = VIEWPORT.width;
    const H = VIEWPORT.height;
    const theme = THEME_CATALOG[themeId] ?? THEME_CATALOG.sunny_meadow!;

    const grad = ctx.createLinearGradient(0, 0, 0, H);
    grad.addColorStop(0, theme.skyGradient[0]);
    grad.addColorStop(0.62, theme.skyGradient[1]);
    grad.addColorStop(1, theme.skyGradient[2]);
    ctx.fillStyle = grad;
    ctx.fillRect(0, 0, W, H);

    // Biome-specific far sky art (sun, moon, aurora, cave ceiling, embers)
    this.drawBiomeSkyDetails(ctx, camera, theme, W, H);

    // Use illustrated parallax layers for outdoor meadow/clover/cliff/maple/forest,
    // and bespoke procedural parallax silhouettes for cavern/marsh/cloud/volcano/starlight
    const useBaseImages =
      theme.style === "meadow" ||
      theme.style === "clover" ||
      theme.style === "forest" ||
      theme.style === "cliff" ||
      theme.style === "maple";

    if (useBaseImages) {
      const layers = [
        { key: "bg_sky", factorX: 0.08, factorY: 0.04, drift: 8, anchorBottom: false, alpha: theme.style === "meadow" ? 1.0 : 0.45 },
        { key: "bg_mountains", factorX: 0.24, factorY: 0.12, drift: 0, anchorBottom: true, alpha: theme.style === "meadow" ? 0.92 : 0.65 },
        { key: "bg_trees", factorX: 0.5, factorY: 0.25, drift: 0, anchorBottom: true, alpha: theme.style === "meadow" ? 0.96 : 0.58 }
      ];

      for (const layer of layers) {
        const img = this.images[layer.key];
        if (!img) continue;
        ctx.save();
        ctx.globalAlpha = layer.alpha;
        const imgW = img.width;
        const imgH = img.height;
        const scrollX = camera.x * layer.factorX + this.time * layer.drift;
        let startX = -(scrollX % imgW);
        if (startX > 0) startX -= imgW;
        const offsetY = layer.anchorBottom
          ? H - imgH + Math.min(48, Math.max(-36, (camera.maxY - camera.y) * layer.factorY * 0.35))
          : -Math.min(30, camera.y * layer.factorY * 0.25);

        for (let x = startX; x < W; x += imgW) {
          ctx.drawImage(img, Math.floor(x), Math.floor(offsetY));
        }
        ctx.restore();
      }
    }

    // Distinct mid-ground biome landmarks & drifting ambient particles
    this.drawBiomeScenery(ctx, camera, theme, W, H);

    if (theme.ambientOverlay) {
      ctx.fillStyle = theme.ambientOverlay;
      ctx.fillRect(0, 0, W, H);
    }
  }

  private drawBiomeSkyDetails(
    ctx: CanvasRenderingContext2D,
    camera: RenderScene["camera"],
    theme: StageTheme,
    W: number,
    H: number
  ): void {
    ctx.save();
    if (theme.style === "starlight") {
      // Twinkling stars + luminous crescent moon + shimmering aurora ribbon
      for (let i = 0; i < 65; i++) {
        const sx = ((i * 173.7 - camera.x * 0.04) % W + W) % W;
        const sy = (i * 79.3) % (H * 0.72);
        const tw = 0.45 + 0.55 * Math.sin(this.time * (1.8 + (i % 5) * 0.5) + i);
        ctx.globalAlpha = tw;
        ctx.fillStyle = i % 4 === 0 ? "#FFF59D" : i % 3 === 0 ? "#E1BEE7" : "#FFFFFF";
        ctx.beginPath();
        ctx.arc(sx, sy, i % 7 === 0 ? 2.4 : 1.3, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.globalAlpha = 0.92;
      const mx = W * 0.78;
      const my = 96;
      ctx.fillStyle = "#FFF9C4";
      ctx.beginPath();
      ctx.arc(mx, my, 38, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = theme.skyGradient[0];
      ctx.beginPath();
      ctx.arc(mx + 14, my - 8, 32, 0, Math.PI * 2);
      ctx.fill();

      // Aurora ribbon
      ctx.globalAlpha = 0.24;
      const ag = ctx.createLinearGradient(0, 90, W, 240);
      ag.addColorStop(0, "#69F0AE");
      ag.addColorStop(0.5, "#80D8FF");
      ag.addColorStop(1, "#EA80FC");
      ctx.fillStyle = ag;
      ctx.beginPath();
      ctx.moveTo(0, 210);
      for (let x = 0; x <= W; x += 32) {
        const y = 155 + Math.sin(x * 0.008 + this.time * 0.9) * 34 + Math.cos(x * 0.015 - this.time * 0.6) * 18;
        ctx.lineTo(x, y);
      }
      ctx.lineTo(W, 250);
      ctx.lineTo(0, 250);
      ctx.closePath();
      ctx.fill();
    } else if (theme.style === "maple") {
      // Big warm autumn sunset disc
      const sg = ctx.createRadialGradient(W * 0.72, 128, 12, W * 0.72, 128, 92);
      sg.addColorStop(0, "#FFF8E1");
      sg.addColorStop(0.45, "#FFD54F");
      sg.addColorStop(1, "rgba(255, 138, 101, 0)");
      ctx.fillStyle = sg;
      ctx.beginPath();
      ctx.arc(W * 0.72, 128, 92, 0, Math.PI * 2);
      ctx.fill();
    } else if (theme.style === "cloud") {
      // Sunbeams descending through heavenly clouds
      ctx.globalAlpha = 0.16;
      ctx.fillStyle = "#FFFDE7";
      for (let i = 0; i < 4; i++) {
        const bx = ((i * 290 - camera.x * 0.06) % (W + 240) + (W + 240)) % (W + 240) - 120;
        ctx.beginPath();
        ctx.moveTo(bx, 0);
        ctx.lineTo(bx + 70, 0);
        ctx.lineTo(bx - 60, H);
        ctx.lineTo(bx - 150, H);
        ctx.closePath();
        ctx.fill();
      }
    } else if (theme.style === "crystal") {
      // Cavern ceiling stalactites
      ctx.fillStyle = "#0B1538";
      const scroll = camera.x * 0.14;
      const step = 64;
      const start = -((scroll % step + step) % step);
      ctx.beginPath();
      ctx.moveTo(0, 0);
      for (let x = start; x <= W + step; x += step) {
        const idx = Math.floor((x + scroll) / step);
        const drop = 42 + ((Math.abs(idx * 37) % 5) * 18);
        ctx.lineTo(x + step * 0.5, drop);
        ctx.lineTo(x + step, 14);
      }
      ctx.lineTo(W, 0);
      ctx.closePath();
      ctx.fill();
    } else if (theme.style === "volcano") {
      // Glowing volcanic sky haze
      const vg = ctx.createRadialGradient(W * 0.5, H * 0.9, 40, W * 0.5, H * 0.9, H * 0.85);
      vg.addColorStop(0, "rgba(255, 112, 67, 0.42)");
      vg.addColorStop(1, "rgba(42, 8, 5, 0)");
      ctx.fillStyle = vg;
      ctx.fillRect(0, 0, W, H);
    }
    ctx.restore();
  }

  private drawBiomeScenery(
    ctx: CanvasRenderingContext2D,
    camera: RenderScene["camera"],
    theme: StageTheme,
    W: number,
    H: number
  ): void {
    ctx.save();
    const s = theme.style;

    if (s === "clover") {
      // Cheerful distant wooden windmills spinning slowly
      const period = 380;
      const scroll = camera.x * 0.22;
      for (let x = -((scroll % period + period) % period); x < W + period; x += period) {
        const bx = x + 160;
        const by = H - 155;
        ctx.fillStyle = "rgba(141, 110, 99, 0.52)";
        ctx.beginPath();
        ctx.moveTo(bx - 16, by + 68);
        ctx.lineTo(bx - 9, by);
        ctx.lineTo(bx + 9, by);
        ctx.lineTo(bx + 16, by + 68);
        ctx.closePath();
        ctx.fill();
        ctx.save();
        ctx.translate(bx, by + 8);
        ctx.rotate(this.time * 0.55);
        ctx.strokeStyle = "rgba(255, 248, 225, 0.65)";
        ctx.lineWidth = 4;
        for (let b = 0; b < 4; b++) {
          ctx.rotate(Math.PI * 0.5);
          ctx.beginPath();
          ctx.moveTo(0, 0);
          ctx.lineTo(0, -34);
          ctx.stroke();
        }
        ctx.restore();
      }
    } else if (s === "forest") {
      // Drifting glowing fireflies in the mystic woods
      for (let i = 0; i < 24; i++) {
        const fx = ((i * 97 + this.time * 16 - camera.x * 0.35) % W + W) % W;
        const fy = 120 + ((i * 53) % (H - 180)) + Math.sin(this.time * 2.4 + i) * 18;
        ctx.globalAlpha = 0.35 + 0.5 * Math.sin(this.time * 4 + i * 1.7);
        ctx.fillStyle = i % 2 === 0 ? "#CCFF90" : "#EA80FC";
        ctx.beginPath();
        ctx.arc(fx, fy, 3.2, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s === "cliff") {
      // Sweeping white wind streaks across the cliffs
      ctx.strokeStyle = "rgba(255, 255, 255, 0.34)";
      ctx.lineWidth = 2.2;
      for (let i = 0; i < 9; i++) {
        const wx = ((W - ((this.time * (140 + i * 18) + i * 190 + camera.x * 0.25) % (W + 180))) + W + 180) % (W + 180) - 90;
        const wy = 70 + i * 52;
        ctx.beginPath();
        ctx.moveTo(wx, wy);
        ctx.quadraticCurveTo(wx + 45, wy - 10, wx + 90, wy);
        ctx.stroke();
      }
    } else if (s === "maple") {
      // Gently fluttering autumn maple leaves
      for (let i = 0; i < 22; i++) {
        const lx = ((i * 113 - this.time * 28 - camera.x * 0.3) % W + W) % W;
        const ly = ((i * 67 + this.time * (22 + (i % 4) * 7)) % H + H) % H;
        ctx.save();
        ctx.translate(lx, ly);
        ctx.rotate(this.time * 1.8 + i);
        ctx.fillStyle = i % 2 === 0 ? "#FF7043" : "#FFD54F";
        ctx.globalAlpha = 0.72;
        ctx.beginPath();
        ctx.ellipse(0, 0, 6, 3.2, 0, 0, Math.PI * 2);
        ctx.fill();
        ctx.restore();
      }
    } else if (s === "crystal") {
      // Giant glowing background crystal spires
      const period = 240;
      const scroll = camera.x * 0.28;
      for (let x = -((scroll % period + period) % period); x < W + period; x += period) {
        const cx = x + 110;
        ctx.fillStyle = "rgba(38, 198, 218, 0.22)";
        ctx.beginPath();
        ctx.moveTo(cx - 34, H);
        ctx.lineTo(cx - 8, H - 230);
        ctx.lineTo(cx + 12, H - 190);
        ctx.lineTo(cx + 38, H);
        ctx.closePath();
        ctx.fill();
        ctx.fillStyle = "rgba(132, 255, 255, 0.32)";
        ctx.beginPath();
        ctx.moveTo(cx - 8, H - 230);
        ctx.lineTo(cx + 4, H - 180);
        ctx.lineTo(cx - 12, H);
        ctx.closePath();
        ctx.fill();
      }
    } else if (s === "marsh") {
      // Silhouetted swamp cypress trees + eerie drifting lanterns
      const period = 210;
      const scroll = camera.x * 0.32;
      ctx.fillStyle = "rgba(36, 18, 54, 0.56)";
      for (let x = -((scroll % period + period) % period); x < W + period; x += period) {
        const tx = x + 90;
        ctx.fillRect(tx - 8, H - 240, 16, 240);
        ctx.beginPath();
        ctx.ellipse(tx, H - 245, 58, 26, 0, 0, Math.PI * 2);
        ctx.fill();
      }
      for (let i = 0; i < 16; i++) {
        const wx = ((i * 127 - camera.x * 0.4 + Math.sin(this.time + i) * 14) % W + W) % W;
        const wy = H - 80 - ((i * 49) % 260) + Math.cos(this.time * 2 + i) * 12;
        ctx.globalAlpha = 0.62;
        ctx.fillStyle = i % 2 === 0 ? "#B9F6CA" : "#EA80FC";
        ctx.beginPath();
        ctx.arc(wx, wy, 4.5, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s === "cloud") {
      // Fluffy cloud banks & distant celestial temple columns
      const period = 260;
      const scroll = camera.x * 0.24;
      for (let x = -((scroll % period + period) % period); x < W + period; x += period) {
        ctx.fillStyle = "rgba(255, 253, 245, 0.45)";
        ctx.fillRect(x + 120, H - 270, 22, 160);
        ctx.fillRect(x + 112, H - 278, 38, 10);
        ctx.fillStyle = "rgba(255, 255, 255, 0.78)";
        ctx.beginPath();
        ctx.arc(x + 80, H - 65, 56, 0, Math.PI * 2);
        ctx.arc(x + 140, H - 82, 68, 0, Math.PI * 2);
        ctx.arc(x + 210, H - 62, 54, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s === "volcano") {
      // Distant volcanic peaks + glowing rising embers
      const period = 320;
      const scroll = camera.x * 0.2;
      for (let x = -((scroll % period + period) % period); x < W + period; x += period) {
        ctx.fillStyle = "rgba(56, 16, 12, 0.76)";
        ctx.beginPath();
        ctx.moveTo(x, H);
        ctx.lineTo(x + 130, H - 280);
        ctx.lineTo(x + 175, H - 280);
        ctx.lineTo(x + 320, H);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 112, 67, 0.55)";
        ctx.lineWidth = 3;
        ctx.beginPath();
        ctx.moveTo(x + 150, H - 275);
        ctx.lineTo(x + 168, H - 170);
        ctx.lineTo(x + 145, H - 90);
        ctx.stroke();
      }
      for (let i = 0; i < 28; i++) {
        const ex = ((i * 89 - camera.x * 0.45 + Math.sin(this.time * 2 + i) * 18) % W + W) % W;
        const ey = H - ((this.time * (38 + (i % 5) * 14) + i * 71) % H);
        ctx.globalAlpha = 0.75;
        ctx.fillStyle = i % 2 === 0 ? "#FFD54F" : "#FF5722";
        ctx.beginPath();
        ctx.arc(ex, ey, 2.6, 0, Math.PI * 2);
        ctx.fill();
      }
    } else if (s === "starlight") {
      // Distant celestial spires & floating golden star rings
      const period = 300;
      const scroll = camera.x * 0.24;
      for (let x = -((scroll % period + period) % period); x < W + period; x += period) {
        ctx.fillStyle = "rgba(38, 24, 88, 0.65)";
        ctx.beginPath();
        ctx.moveTo(x + 30, H);
        ctx.lineTo(x + 150, H - 250);
        ctx.lineTo(x + 270, H);
        ctx.closePath();
        ctx.fill();
        ctx.strokeStyle = "rgba(255, 215, 64, 0.35)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.ellipse(x + 150, H - 265 + Math.sin(this.time * 2 + x) * 6, 36, 10, -0.2, 0, Math.PI * 2);
        ctx.stroke();
      }
    }
    ctx.restore();
  }

  private drawHazards(ctx: CanvasRenderingContext2D, stage: CompiledStage, camX: number, viewW: number): void {
    for (const hz of stage.hazards) {
      if (hz.x + hz.w < camX - 60 || hz.x > camX + viewW + 60) continue;
      ctx.save();
      if (hz.kind === "water") {
        // Shimmering animated water pool with waving foam crest
        const grad = ctx.createLinearGradient(hz.x, hz.y, hz.x, hz.y + hz.h);
        grad.addColorStop(0, "rgba(41, 182, 246, 0.84)");
        grad.addColorStop(0.55, "rgba(2, 136, 209, 0.92)");
        grad.addColorStop(1, "rgba(1, 87, 155, 0.96)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(hz.x, hz.y + hz.h);
        for (let px = 0; px <= hz.w; px += 12) {
          const wy = hz.y + Math.sin(this.time * 4.5 + (hz.x + px) * 0.06) * 4;
          ctx.lineTo(hz.x + px, wy);
        }
        ctx.lineTo(hz.x + hz.w, hz.y + hz.h);
        ctx.closePath();
        ctx.fill();

        // White foam surface line
        ctx.strokeStyle = "rgba(225, 245, 254, 0.92)";
        ctx.lineWidth = 3.2;
        ctx.beginPath();
        for (let px = 0; px <= hz.w; px += 12) {
          const wy = hz.y + Math.sin(this.time * 4.5 + (hz.x + px) * 0.06) * 4;
          if (px === 0) ctx.moveTo(hz.x + px, wy);
          else ctx.lineTo(hz.x + px, wy);
        }
        ctx.stroke();
      } else if (hz.kind === "lava") {
        // Molten glowing lava with pulsing heat glow and bubbling magma
        const glow = ctx.createLinearGradient(hz.x, hz.y - 26, hz.x, hz.y + 8);
        glow.addColorStop(0, "rgba(255, 87, 34, 0)");
        glow.addColorStop(1, "rgba(255, 112, 67, 0.45)");
        ctx.fillStyle = glow;
        ctx.fillRect(hz.x, hz.y - 26, hz.w, 34);

        const grad = ctx.createLinearGradient(hz.x, hz.y, hz.x, hz.y + hz.h);
        grad.addColorStop(0, "#FFAB00");
        grad.addColorStop(0.32, "#FF3D00");
        grad.addColorStop(1, "#B71C1C");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(hz.x, hz.y + hz.h);
        for (let px = 0; px <= hz.w; px += 14) {
          const wy = hz.y + Math.sin(this.time * 3.4 + (hz.x + px) * 0.05) * 4.5;
          ctx.lineTo(hz.x + px, wy);
        }
        ctx.lineTo(hz.x + hz.w, hz.y + hz.h);
        ctx.closePath();
        ctx.fill();

        // Glowing magma bubbles
        ctx.fillStyle = "#FFF176";
        const count = Math.max(2, Math.floor(hz.w / 44));
        for (let i = 0; i < count; i++) {
          const phase = (this.time * 1.4 + i * 0.73) % 1;
          const bx = hz.x + 18 + ((i * 47) % Math.max(16, hz.w - 36));
          const by = hz.y + 10 - phase * 14;
          ctx.globalAlpha = 1 - phase;
          ctx.beginPath();
          ctx.arc(bx, by, 3 + phase * 4.5, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (hz.kind === "poison") {
        // Bubbling neon toxic swamp
        const grad = ctx.createLinearGradient(hz.x, hz.y, hz.x, hz.y + hz.h);
        grad.addColorStop(0, "rgba(178, 255, 89, 0.86)");
        grad.addColorStop(0.45, "rgba(124, 77, 255, 0.90)");
        grad.addColorStop(1, "rgba(49, 27, 146, 0.96)");
        ctx.fillStyle = grad;
        ctx.beginPath();
        ctx.moveTo(hz.x, hz.y + hz.h);
        for (let px = 0; px <= hz.w; px += 14) {
          const wy = hz.y + Math.sin(this.time * 3.0 + (hz.x + px) * 0.07) * 3.5;
          ctx.lineTo(hz.x + px, wy);
        }
        ctx.lineTo(hz.x + hz.w, hz.y + hz.h);
        ctx.closePath();
        ctx.fill();

        ctx.fillStyle = "#CCFF90";
        const count = Math.max(2, Math.floor(hz.w / 42));
        for (let i = 0; i < count; i++) {
          const phase = (this.time * 1.1 + i * 0.61) % 1;
          const bx = hz.x + 16 + ((i * 43) % Math.max(16, hz.w - 32));
          const by = hz.y + 8 - phase * 12;
          ctx.globalAlpha = 1 - phase;
          ctx.beginPath();
          ctx.arc(bx, by, 3 + phase * 4, 0, Math.PI * 2);
          ctx.fill();
        }
      } else if (hz.kind === "spikes") {
        // Gleaming cel-shaded metallic/crystal floor spikes
        const spikeW = 18;
        const count = Math.max(1, Math.floor(hz.w / spikeW));
        const actualW = hz.w / count;
        const baseY = hz.y + Math.min(hz.h, 30);
        const tipY = hz.y;

        // Dark spike bed underneath if tall trench
        if (hz.h > 30) {
          ctx.fillStyle = "#263238";
          ctx.fillRect(hz.x, baseY - 2, hz.w, hz.h - (baseY - hz.y) + 2);
        }

        for (let i = 0; i < count; i++) {
          const sx = hz.x + i * actualW;
          const midX = sx + actualW * 0.5;
          ctx.fillStyle = "#CFD8DC";
          ctx.strokeStyle = "#263238";
          ctx.lineWidth = 2.2;
          ctx.beginPath();
          ctx.moveTo(sx + 1, baseY);
          ctx.lineTo(midX, tipY);
          ctx.lineTo(sx + actualW - 1, baseY);
          ctx.closePath();
          ctx.fill();
          ctx.stroke();

          // Bright specular facet on left edge
          ctx.fillStyle = "#FFFFFF";
          ctx.beginPath();
          ctx.moveTo(sx + 3, baseY - 2);
          ctx.lineTo(midX, tipY + 4);
          ctx.lineTo(midX - 1, baseY - 2);
          ctx.closePath();
          ctx.fill();
        }
      }
      ctx.restore();
    }
  }

  private drawPlatformSurface(ctx: CanvasRenderingContext2D, p: RuntimePlatform): void {
    if (p.surface === "normal") return;
    ctx.save();
    if (p.surface === "bouncy") {
      // Glowing spring mushroom / trampoline cap
      const pulse = Math.sin(this.time * 5.5) * 1.5;
      ctx.fillStyle = "#FF4081";
      ctx.strokeStyle = "#4A148C";
      ctx.lineWidth = 2.4;
      ctx.beginPath();
      ctx.roundRect(p.x + 3, p.y - 3 + pulse, p.w - 6, 13, 7);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#FF80AB";
      ctx.fillRect(p.x + 10, p.y - 1 + pulse, p.w - 20, 4);
      // Upward bounce chevrons
      ctx.fillStyle = "#FFF59D";
      const n = Math.max(1, Math.floor(p.w / 48));
      for (let i = 0; i < n; i++) {
        const cx = p.x + (i + 0.5) * (p.w / n);
        const cy = p.y - 8 + Math.sin(this.time * 7 + i) * 2.5;
        ctx.beginPath();
        ctx.moveTo(cx, cy - 5);
        ctx.lineTo(cx + 6, cy + 2);
        ctx.lineTo(cx - 6, cy + 2);
        ctx.closePath();
        ctx.fill();
      }
    } else if (p.surface === "ice") {
      // Translucent frosty ice glaze with shimmering sheen
      ctx.fillStyle = "rgba(178, 235, 242, 0.72)";
      ctx.strokeStyle = "#00ACC1";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(p.x + 1, p.y, p.w - 2, 12, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "rgba(255, 255, 255, 0.85)";
      for (let sx = p.x + 10; sx < p.x + p.w - 14; sx += 28) {
        ctx.fillRect(sx, p.y + 2, 12, 3);
      }
    } else if (p.surface === "conveyor_right" || p.surface === "conveyor_left") {
      const dir = p.surface === "conveyor_right" ? 1 : -1;
      ctx.fillStyle = "#37474F";
      ctx.strokeStyle = "#102027";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(p.x + 1, p.y, p.w - 2, 14, 5);
      ctx.fill();
      ctx.stroke();

      // Animated scrolling chevrons
      ctx.save();
      ctx.beginPath();
      ctx.rect(p.x + 4, p.y + 1, p.w - 8, 12);
      ctx.clip();
      const step = 20;
      const shift = (((this.time * 60 * dir) % step) + step) % step;
      ctx.strokeStyle = "#FFD740";
      ctx.lineWidth = 2.4;
      for (let cx = p.x - step + shift; cx < p.x + p.w + step; cx += step) {
        ctx.beginPath();
        ctx.moveTo(cx - 4 * dir, p.y + 3);
        ctx.lineTo(cx + 3 * dir, p.y + 7);
        ctx.lineTo(cx - 4 * dir, p.y + 11);
        ctx.stroke();
      }
      ctx.restore();
    } else if (p.surface === "mud") {
      // Sticky boggy mud rim with small bubbles
      ctx.fillStyle = "#4E342E";
      ctx.strokeStyle = "#261612";
      ctx.lineWidth = 2;
      ctx.beginPath();
      ctx.roundRect(p.x + 1, p.y, p.w - 2, 11, 5);
      ctx.fill();
      ctx.stroke();
      ctx.fillStyle = "#6D4C41";
      const bubbles = Math.max(2, Math.floor(p.w / 46));
      for (let i = 0; i < bubbles; i++) {
        const bx = p.x + 16 + i * 44;
        const r = 2.5 + Math.abs(Math.sin(this.time * 2.5 + i)) * 2.5;
        ctx.beginPath();
        ctx.arc(bx, p.y + 3, r, 0, Math.PI * 2);
        ctx.fill();
      }
    }
    ctx.restore();
  }

  private drawPlatforms(ctx: CanvasRenderingContext2D, stage: CompiledStage, camX: number, viewW: number): void {
    const tiles = this.getBiomeTileset(stage.meta.themeId);
    const ts = 48;
    for (const p of stage.platforms) {
      if (p.x + p.w < camX - ts || p.x > camX + viewW + ts) continue;
      const cols = Math.max(1, Math.round(p.w / ts));
      const rows = Math.max(1, Math.round(p.h / ts));
      if (tiles) {
        for (let r = 0; r < rows; r++) {
          for (let c = 0; c < cols; c++) {
            const tileCol = r === 0 ? (cols === 1 ? 3 : c === 0 ? 0 : c === cols - 1 ? 2 : 1) : 4;
            ctx.drawImage(tiles, tileCol * ts, 0, ts, ts, p.x + c * ts, p.y + r * ts, ts, ts);
          }
        }
        if (p.oneWay) {
          ctx.fillStyle = "rgba(35, 22, 12, 0.22)";
          ctx.beginPath();
          ctx.roundRect(p.x + 6, p.y + p.h - 4, p.w - 12, 8, 4);
          ctx.fill();
        }
      }
      this.drawPlatformSurface(ctx, p);
    }
  }

  private drawMovingPlatforms(ctx: CanvasRenderingContext2D, stage: CompiledStage, camX: number, viewW: number): void {
    const tiles = this.getBiomeTileset(stage.meta.themeId);
    const ts = 48;
    for (const mp of stage.movingPlatforms) {
      if (mp.waypoints.length >= 2) {
        ctx.save();
        ctx.strokeStyle = "rgba(255, 255, 255, 0.42)";
        ctx.lineWidth = 3;
        ctx.setLineDash([5, 7]);
        ctx.beginPath();
        mp.waypoints.forEach((wp, i) => {
          const wx = wp.x + mp.w * 0.5;
          const wy = wp.y + mp.h * 0.5;
          if (i === 0) ctx.moveTo(wx, wy);
          else ctx.lineTo(wx, wy);
        });
        ctx.stroke();
        ctx.setLineDash([]);
        ctx.restore();
      }
      if (mp.x + mp.w < camX - ts || mp.x > camX + viewW + ts) continue;
      const cols = Math.max(1, Math.round(mp.w / ts));
      if (tiles) {
        for (let c = 0; c < cols; c++) {
          const tileCol = cols === 1 ? 6 : c === 0 ? 5 : c === cols - 1 ? 7 : 6;
          ctx.drawImage(tiles, tileCol * ts, 0, ts, ts, Math.round(mp.x + c * ts), Math.round(mp.y - 4), ts, ts);
        }
      }
    }
  }

  private drawLadders(ctx: CanvasRenderingContext2D, stage: CompiledStage, camX: number, viewW: number): void {
    const tiles = this.getBiomeTileset(stage.meta.themeId);
    const ts = 48;
    for (const l of stage.ladders) {
      if (l.x + l.w < camX - ts || l.x > camX + viewW + ts) continue;
      const rows = Math.max(1, Math.round(l.h / ts));
      const drawX = Math.round(l.centerX - ts * 0.5);
      if (tiles) {
        for (let r = 0; r < rows; r++) {
          ctx.drawImage(tiles, (r === 0 ? 0 : 1) * ts, ts, ts, ts, drawX, l.y + r * ts, ts, ts);
        }
      }
    }
  }

  private drawDecorations(ctx: CanvasRenderingContext2D, stage: CompiledStage, camX: number, viewW: number): void {
    const tiles = this.getBiomeTileset(stage.meta.themeId);
    const ts = 48;
    const map: Record<string, number> = {
      flower_red: 2,
      flower_yellow: 3,
      bush: 4,
      sign: 5,
      rock: 6,
      grass_tuft: 7
    };
    for (const d of stage.decorations) {
      if (d.x + ts < camX - ts || d.x > camX + viewW + ts) continue;
      const col = map[d.kind];
      if (tiles && col !== undefined) {
        ctx.drawImage(tiles, col * ts + 1, ts + 2, ts - 2, ts - 2, d.x + 1, d.y + 5, ts - 2, ts - 2);
      }
    }
  }

  private drawPortals(
    ctx: CanvasRenderingContext2D,
    stage: CompiledStage,
    player: LocalPlayerRender,
    camX: number,
    viewW: number
  ): void {
    for (const pt of stage.portals) {
      if (pt.x + pt.w < camX - 60 || pt.x > camX + viewW + 60) continue;
      const cx = pt.x + pt.w * 0.5;
      const cy = pt.y + pt.h * 0.52;
      const rx = pt.w * 0.44;
      const ry = pt.h * 0.46;
      const pulse = 1 + Math.sin(this.time * 4.2) * 0.06;
      const isHighlight = pt.kind === "next_stage" || pt.kind === "goal";
      const locked = pt.requiredLevel !== undefined && player.level < pt.requiredLevel;

      ctx.save();
      const glow = ctx.createRadialGradient(cx, cy, 4, cx, cy, ry * 1.45);
      glow.addColorStop(0, "#FFFFFF");
      glow.addColorStop(0.45, locked ? "#9E9E9E" : pt.color);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.65;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * 1.45 * pulse, ry * 1.35 * pulse, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.globalAlpha = 0.95;
      ctx.fillStyle = isHighlight ? "#FFF8E1" : "#E1F5FE";
      ctx.strokeStyle = locked ? "#757575" : pt.color;
      ctx.lineWidth = 4;
      ctx.beginPath();
      ctx.ellipse(cx, cy, rx * pulse, ry * pulse, 0, 0, Math.PI * 2);
      ctx.fill();
      ctx.stroke();

      ctx.strokeStyle = locked ? "#616161" : isHighlight ? "#FF8F00" : "#0288D1";
      ctx.lineWidth = 3;
      for (let i = 0; i < 3; i++) {
        const a0 = this.time * 3.5 + (i * Math.PI * 2) / 3;
        ctx.beginPath();
        ctx.ellipse(cx, cy, rx * 0.62, ry * 0.62, 0, a0, a0 + 1.15);
        ctx.stroke();
      }

      if (isHighlight) {
        this.drawStar(ctx, cx, pt.y - 10 + Math.sin(this.time * 5) * 3, 12, 5, "#FFD740", "#5D3A1A");
      }

      const isNear = player.nearbyPortal?.id === pt.id;
      const badgeY = pt.y - (isHighlight ? 30 : 18) + Math.sin(this.time * 6) * 3;
      const text = locked
        ? `🔒 Lv.${pt.requiredLevel}+ 필요`
        : isNear
          ? `↑ ${pt.label || "이동"}`
          : pt.label;
      if (text) {
        ctx.font = 'bold 12px "Pretendard", "Apple SD Gothic Neo", sans-serif';
        const tw = ctx.measureText(text).width + 18;
        ctx.fillStyle = isNear ? "rgba(42, 28, 16, 0.92)" : "rgba(42, 28, 16, 0.66)";
        ctx.strokeStyle = locked ? "#EF9A9A" : isNear ? "#FFD740" : "rgba(255,255,255,0.6)";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.roundRect(cx - tw * 0.5, badgeY - 12, tw, 23, 11);
        ctx.fill();
        ctx.stroke();
        ctx.fillStyle = locked ? "#FFCDD2" : isNear ? "#FFF176" : "#FFFFFF";
        ctx.textAlign = "center";
        ctx.textBaseline = "middle";
        ctx.fillText(text, cx, badgeY - 0.5);
      }
      ctx.restore();
    }
  }

  private drawItems(
    ctx: CanvasRenderingContext2D,
    items: ClientItemRender[],
    player: LocalPlayerRender,
    camX: number,
    viewW: number
  ): void {
    const sheet = this.images.items_sheet;
    const econSheet = this.images.economy_sheet;
    const cellSize = 96;
    for (const item of items) {
      const tpl = ITEM_CATALOG[item.templateId];
      if (!tpl) continue;
      if (tpl.category === "weapon" && tpl.weaponId && player.unlockedWeapons.includes(tpl.weaponId)) {
        continue;
      }
      if (tpl.category === "chest") {
        const opening = (item.openingTimer ?? 0) > 0;
        if (!item.available && !opening) continue;
        if (item.x < camX - 64 || item.x > camX + viewW + 64) continue;

        const ix = item.x;
        const iy = item.y + 4;
        const drawSize = 52;
        ctx.save();
        if (!item.available && opening) {
          const t = Math.min(1, (item.openingTimer ?? 0) / 1.25);
          ctx.globalAlpha = Math.min(1, t * 2.2);
          // Golden light beam bursting out of the open chest
          const beam = ctx.createLinearGradient(ix, iy, ix, iy - 110);
          beam.addColorStop(0, "rgba(255, 215, 64, 0.72)");
          beam.addColorStop(1, "rgba(255, 215, 64, 0)");
          ctx.fillStyle = beam;
          ctx.beginPath();
          ctx.moveTo(ix - 20, iy);
          ctx.lineTo(ix - 36, iy - 110);
          ctx.lineTo(ix + 36, iy - 110);
          ctx.lineTo(ix + 20, iy);
          ctx.closePath();
          ctx.fill();
        } else {
          // Shimmering treasure aura for closed chest
          const pulse = 1 + Math.sin(this.time * 4.5 + item.bobPhase) * 0.08;
          const glow = ctx.createRadialGradient(ix, iy, 4, ix, iy, 36 * pulse);
          glow.addColorStop(0, "rgba(255, 215, 64, 0.72)");
          glow.addColorStop(1, "rgba(255, 215, 64, 0)");
          ctx.fillStyle = glow;
          ctx.beginPath();
          ctx.arc(ix, iy, 36 * pulse, 0, Math.PI * 2);
          ctx.fill();
        }

        if (econSheet) {
          const iconCol = item.available ? 0 : 1;
          const popScale = !item.available && opening ? 1 + Math.sin((1 - (item.openingTimer ?? 0) / 1.25) * Math.PI) * 0.14 : 1;
          const sz = drawSize * popScale;
          ctx.drawImage(econSheet, iconCol * cellSize, 0, cellSize, cellSize, ix - sz * 0.5, iy - sz * 0.52, sz, sz);
        }

        if (item.available) {
          ctx.font = 'bold 11.5px "Pretendard", "Apple SD Gothic Neo", sans-serif';
          ctx.textAlign = "center";
          const label = "★ 보물 상자";
          const tw = ctx.measureText(label).width + 14;
          ctx.fillStyle = "rgba(54, 34, 14, 0.86)";
          ctx.strokeStyle = "#FFD740";
          ctx.lineWidth = 1.6;
          ctx.beginPath();
          ctx.roundRect(ix - tw * 0.5, iy - 42, tw, 19, 9);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#FFF176";
          ctx.fillText(label, ix, iy - 29);
        }
        ctx.restore();
        continue;
      }

      if (tpl.category !== "weapon" && !item.available) continue;
      if (item.x < camX - 48 || item.x > camX + viewW + 48) continue;

      const bob = Math.sin(this.time * 4.2 + item.bobPhase) * 5;
      const ix = item.x;
      const iy = item.y + bob;
      const drawSize = tpl.category === "weapon" ? 46 : 38;

      ctx.save();
      const glow = ctx.createRadialGradient(ix, iy, 2, ix, iy, drawSize * 0.65);
      glow.addColorStop(0, tpl.glowColor);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.globalAlpha = tpl.category === "weapon" ? 0.58 : 0.35;
      ctx.fillStyle = glow;
      ctx.beginPath();
      ctx.arc(ix, iy, drawSize * 0.65, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;

      if (sheet) {
        ctx.drawImage(sheet, tpl.iconIndex * cellSize, 0, cellSize, cellSize, ix - drawSize * 0.5, iy - drawSize * 0.5, drawSize, drawSize);
      }

      if (tpl.category === "weapon") {
        ctx.font = 'bold 12px "Pretendard", "Apple SD Gothic Neo", sans-serif';
        ctx.textAlign = "center";
        const label = `★ ${tpl.name}`;
        const tw = ctx.measureText(label).width + 14;
        ctx.fillStyle = "rgba(40, 26, 14, 0.84)";
        ctx.beginPath();
        ctx.roundRect(ix - tw * 0.5, iy - 38, tw, 20, 10);
        ctx.fill();
        ctx.fillStyle = "#FFF59D";
        ctx.fillText(label, ix, iy - 24);
      }
      ctx.restore();
    }
  }

  private drawLootDrops(ctx: CanvasRenderingContext2D, drops: ClientLootDrop[]): void {
    const itemsSheet = this.images.items_sheet;
    const econSheet = this.images.economy_sheet;
    for (const d of drops) {
      const sheet = d.sheet === "economy" ? econSheet : itemsSheet;
      const sz = d.sheet === "economy" ? 34 : 26;
      ctx.save();
      const glow = ctx.createRadialGradient(d.x, d.y, 2, d.x, d.y, sz * 0.82);
      glow.addColorStop(0, d.color);
      glow.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = glow;
      ctx.globalAlpha = 0.72;
      ctx.beginPath();
      ctx.arc(d.x, d.y, sz * 0.82, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalAlpha = 1;
      if (sheet) {
        ctx.drawImage(sheet, d.iconIndex * 96, 0, 96, 96, d.x - sz * 0.5, d.y - sz * 0.5, sz, sz);
      }
      if (d.label && d.age < d.arcDuration + 0.2) {
        ctx.font = 'bold 11px "Pretendard", sans-serif';
        ctx.textAlign = "center";
        ctx.strokeStyle = "rgba(32, 20, 10, 0.9)";
        ctx.lineWidth = 3;
        ctx.strokeText(d.label, d.x, d.y - 20);
        ctx.fillStyle = d.color;
        ctx.fillText(d.label, d.x, d.y - 20);
      }
      ctx.restore();
    }
  }

  private drawMobs(
    ctx: CanvasRenderingContext2D,
    mobs: ClientMobRender[],
    now: number,
    camX: number,
    viewW: number
  ): void {
    for (const mob of mobs) {
      if (!mob.alive) continue;
      if (mob.x + mob.w < camX - 90 || mob.x > camX + viewW + 90) continue;

      const spr = this.images[mob.spriteKey];
      const footX = mob.x + mob.w * 0.5;
      const footY = mob.y + mob.h;
      const isSpawnProtected = now < mob.spawnProtectUntil;
      const isStunned = Boolean(mob.statuses?.stun && mob.statuses.stun.remaining > 0);
      const animState = resolveActorAnimState({
        grounded: mob.grounded,
        speedPx: Math.abs(mob.vx),
        vy: mob.vy,
        hurt: mob.hitStunTimer > 0,
        stunned: isStunned
      });
      const sheetImg = this.images[`${mob.spriteKey}_sheet`];
      const pose = evaluateActorPose(
        {
          spriteKey: mob.spriteKey,
          state: animState,
          time: mob.animTimer,
          speedPx: Math.abs(mob.vx),
          vy: mob.vy,
          grounded: mob.grounded,
          facing: mob.facing
        },
        Boolean(sheetImg)
      );

      ctx.save();
      // 2-second spawn protection blink (cannot attack or be attacked!)
      if (isSpawnProtected) {
        const blinkOn = Math.floor(now / 100) % 2 === 0;
        ctx.globalAlpha = blinkOn ? 0.32 : 0.82;
        ctx.strokeStyle = "rgba(128, 222, 234, 0.85)";
        ctx.lineWidth = 2.5;
        ctx.beginPath();
        ctx.ellipse(footX, footY - mob.h * 0.5, mob.w * 0.62, mob.h * 0.62, 0, 0, Math.PI * 2);
        ctx.stroke();
      }

      ctx.fillStyle = "rgba(45, 32, 18, 0.25)";
      ctx.beginPath();
      ctx.ellipse(footX, footY + 1, mob.w * 0.48 * pose.shadowScale, 5 * pose.shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      const drawSize = 62 * mob.drawScale;

      ctx.translate(footX + pose.offsetX, footY + pose.offsetY);
      ctx.scale(mob.facing, 1);
      ctx.rotate(pose.rotation);
      if (pose.skewX !== 0) {
        ctx.transform(1, 0, -pose.skewX, 1, 0, 0);
      }
      ctx.scale(mob.squashX * pose.scaleX, mob.squashY * pose.scaleY);

      if (spr) {
        this.drawActorSprite(
          ctx,
          mob.spriteKey,
          spr,
          sheetImg,
          pose,
          -drawSize * 0.5,
          -drawSize + 4,
          drawSize,
          drawSize,
          mob.hitFlashTimer > 0 ? "#FFFFFF" : null
        );
      }

      if (mob.hasCrown) {
        ctx.fillStyle = "#FFD740";
        ctx.strokeStyle = "#5D3A1A";
        ctx.lineWidth = 2;
        const cy = -drawSize + 14;
        ctx.beginPath();
        ctx.moveTo(-14, cy + 8);
        ctx.lineTo(-16, cy - 6);
        ctx.lineTo(-6, cy + 1);
        ctx.lineTo(0, cy - 10);
        ctx.lineTo(6, cy + 1);
        ctx.lineTo(16, cy - 6);
        ctx.lineTo(14, cy + 8);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
      }
      ctx.restore();

      if (isSpawnProtected) {
        ctx.save();
        ctx.font = 'bold 11px "Pretendard", "Apple SD Gothic Neo", sans-serif';
        ctx.textAlign = "center";
        ctx.strokeStyle = "rgba(18, 42, 60, 0.85)";
        ctx.lineWidth = 3;
        const label = "리젠 보호";
        ctx.strokeText(label, footX, mob.y - 10);
        ctx.fillStyle = "#80DEEA";
        ctx.fillText(label, footX, mob.y - 10);
        ctx.restore();
      } else if (mob.inCombat) {
        this.drawMobHpBar(ctx, mob, footX, mob.y - (mob.hasCrown ? 32 : 16));
      }

      // Red exclamation mark (!) alert telegraph shown for 0.5s before active mob attacks!
      if (!isSpawnProtected && mob.alertTimer > 0) {
        const alertY = mob.y - (mob.inCombat ? (mob.hasCrown ? 62 : 46) : mob.hasCrown ? 40 : 24);
        this.drawMobAlertMark(ctx, footX, alertY, mob.alertTimer);
      }

      // Active status visuals (spinning star halo for stun, elemental auras for DoTs/slow)
      if (!isSpawnProtected && mob.statuses) {
        this.drawActorStatuses(ctx, footX, mob.y, mob.w, mob.h, mob.statuses, mob.hasCrown ? 16 : 6);
      }
    }
  }

  private drawStunHalo(ctx: CanvasRenderingContext2D, cx: number, cy: number, width: number): void {
    const rx = Math.max(18, width * 0.45);
    const ry = Math.max(6, rx * 0.34);
    ctx.save();
    // Dashed golden dizzy ring
    ctx.strokeStyle = "rgba(255, 224, 130, 0.82)";
    ctx.lineWidth = 2;
    ctx.setLineDash([4, 4]);
    ctx.beginPath();
    ctx.ellipse(cx, cy, rx, ry, 0, 0, Math.PI * 2);
    ctx.stroke();
    ctx.setLineDash([]);

    // 3 orbiting golden 5-point stars with depth scaling
    for (let i = 0; i < 3; i++) {
      const ang = this.time * 5.6 + (i * Math.PI * 2) / 3;
      const sx = cx + Math.cos(ang) * rx;
      const sy = cy + Math.sin(ang) * ry;
      const depthScale = 0.8 + (Math.sin(ang) + 1) * 0.2;
      ctx.save();
      ctx.translate(sx, sy);
      ctx.rotate(this.time * 4 + i);
      this.drawStar(ctx, 0, 0, 7.5 * depthScale, 5, "#FFD740", "#6D4C00");
      ctx.restore();
    }
    ctx.restore();
  }

  private drawActorStatuses(
    ctx: CanvasRenderingContext2D,
    cx: number,
    topY: number,
    w: number,
    h: number,
    statuses: Partial<Record<StatusEffectKind, ActiveStatusEffect>>,
    haloOffsetY = 6
  ): void {
    const midY = topY + h * 0.5;
    if (statuses.stun && statuses.stun.remaining > 0) {
      this.drawStunHalo(ctx, cx, topY - haloOffsetY, w);
    }
    if (statuses.crystal_dot && statuses.crystal_dot.remaining > 0) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const ang = this.time * 3.8 + (i * Math.PI * 2) / 3;
        const sx = cx + Math.cos(ang) * (w * 0.58);
        const sy = midY + Math.sin(ang) * (h * 0.36);
        ctx.save();
        ctx.translate(sx, sy);
        ctx.rotate(ang + Math.PI * 0.25);
        ctx.fillStyle = "#40C4FF";
        ctx.strokeStyle = "#E1F5FE";
        ctx.lineWidth = 1.4;
        ctx.beginPath();
        ctx.moveTo(0, -6.5);
        ctx.lineTo(4.2, 0);
        ctx.lineTo(0, 6.5);
        ctx.lineTo(-4.2, 0);
        ctx.closePath();
        ctx.fill();
        ctx.stroke();
        ctx.restore();
      }
      ctx.restore();
    }
    if (statuses.burn && statuses.burn.remaining > 0) {
      ctx.save();
      for (let i = 0; i < 4; i++) {
        const phase = (this.time * 2.4 + i * 0.27) % 1;
        const fx = cx + Math.sin(this.time * 6 + i * 1.7) * (w * 0.38);
        const fy = topY + h - phase * (h * 0.95);
        ctx.globalAlpha = Math.max(0, 1 - phase);
        ctx.fillStyle = i % 2 === 0 ? "#FF5722" : "#FFD54F";
        ctx.beginPath();
        ctx.arc(fx, fy, 4.5 * (1 - phase * 0.45), 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (statuses.shock && statuses.shock.remaining > 0) {
      ctx.save();
      ctx.strokeStyle = "#FFFF00";
      ctx.lineWidth = 2.2;
      ctx.lineJoin = "round";
      for (let i = 0; i < 2; i++) {
        const side = i === 0 ? -1 : 1;
        const jitter = Math.sin(this.time * 38 + i * 3) * 4;
        ctx.beginPath();
        ctx.moveTo(cx + side * (w * 0.42), topY + 6 + jitter);
        ctx.lineTo(cx + side * (w * 0.58), midY - 3);
        ctx.lineTo(cx + side * (w * 0.36), midY + 5);
        ctx.lineTo(cx + side * (w * 0.54), topY + h - 8 - jitter);
        ctx.stroke();
      }
      ctx.restore();
    }
    if (statuses.poison && statuses.poison.remaining > 0) {
      ctx.save();
      for (let i = 0; i < 3; i++) {
        const phase = (this.time * 1.8 + i * 0.33) % 1;
        const bx = cx + Math.cos(i * 2.2 + this.time * 3) * (w * 0.35);
        const by = topY + h * 0.7 - phase * (h * 0.75);
        ctx.globalAlpha = 0.85 * (1 - phase);
        ctx.fillStyle = i % 2 === 0 ? "#B2FF59" : "#9C27B0";
        ctx.beginPath();
        ctx.arc(bx, by, 3.6 + phase * 2, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }
    if (statuses.slow && statuses.slow.remaining > 0) {
      ctx.save();
      ctx.strokeStyle = "rgba(179, 136, 255, 0.85)";
      ctx.lineWidth = 2.2;
      ctx.setLineDash([4, 3]);
      ctx.beginPath();
      ctx.ellipse(cx, topY + h - 3, w * 0.55, 7, 0, 0, Math.PI * 2);
      ctx.stroke();
      ctx.restore();
    }
  }

  private drawMobAlertMark(ctx: CanvasRenderingContext2D, cx: number, cy: number, alertTimer: number): void {
    const duration = 0.5;
    const elapsed = Math.max(0, duration - alertTimer);
    const pop = elapsed < 0.12 ? 0.55 + (elapsed / 0.12) * 0.72 : elapsed < 0.22 ? 1.27 - ((elapsed - 0.12) / 0.1) * 0.27 : 1.0;
    const shake = Math.sin(elapsed * 42) * 1.4;

    ctx.save();
    ctx.translate(cx + shake, cy - Math.sin(Math.min(1, elapsed / 0.16) * Math.PI * 0.5) * 6);
    ctx.scale(pop, pop);

    // Glowing crimson outer halo
    const glow = ctx.createRadialGradient(0, 0, 2, 0, 0, 22);
    glow.addColorStop(0, "rgba(255, 23, 68, 0.75)");
    glow.addColorStop(1, "rgba(255, 23, 68, 0)");
    ctx.fillStyle = glow;
    ctx.beginPath();
    ctx.arc(0, 0, 22, 0, Math.PI * 2);
    ctx.fill();

    // Small diagonal alert sparks
    ctx.strokeStyle = "#FF5252";
    ctx.lineWidth = 2.4;
    ctx.lineCap = "round";
    for (const side of [-1, 1]) {
      ctx.beginPath();
      ctx.moveTo(side * 12, -11);
      ctx.lineTo(side * 17, -15);
      ctx.stroke();
      ctx.beginPath();
      ctx.moveTo(side * 13, -1);
      ctx.lineTo(side * 18, -2);
      ctx.stroke();
    }

    // Bold cel-shaded exclamation stem & dot
    ctx.lineJoin = "round";
    ctx.fillStyle = "#FF1744";
    ctx.strokeStyle = "#FFFFFF";
    ctx.lineWidth = 4.2;

    // Stem
    ctx.beginPath();
    ctx.moveTo(-4.8, -15);
    ctx.lineTo(4.8, -15);
    ctx.lineTo(3.2, 2.5);
    ctx.lineTo(-3.2, 2.5);
    ctx.closePath();
    ctx.stroke();
    ctx.fill();

    // Dot
    ctx.beginPath();
    ctx.arc(0, 10, 4.1, 0, Math.PI * 2);
    ctx.stroke();
    ctx.fill();

    // Inner specular highlight
    ctx.fillStyle = "#FF8A80";
    ctx.fillRect(-1.5, -13, 2, 11);
    ctx.restore();
  }

  private drawMobHpBar(ctx: CanvasRenderingContext2D, mob: ClientMobRender, cx: number, barY: number): void {
    const barW = mob.hasCrown ? 92 : 62;
    const barH = mob.hasCrown ? 9 : 7;
    const x = Math.round(cx - barW * 0.5);
    const y = Math.round(barY);
    const ratio = Math.max(0, mob.hp / Math.max(1, mob.maxHp));
    const trailRatio = Math.max(ratio, mob.displayHp / Math.max(1, mob.maxHp));

    ctx.save();
    ctx.font = 'bold 11px "Pretendard", "Apple SD Gothic Neo", sans-serif';
    ctx.textAlign = "center";
    ctx.lineWidth = 3;
    ctx.strokeStyle = "rgba(42, 26, 14, 0.88)";
    const title = mob.isElite && !mob.hasCrown ? `★ Lv.${mob.level} ${mob.name}` : `Lv.${mob.level} ${mob.name}`;
    ctx.strokeText(title, cx, y - 5);
    ctx.fillStyle = mob.hasCrown ? "#FFD740" : mob.isElite ? "#FFAB40" : "#FFFFFF";
    ctx.fillText(title, cx, y - 5);

    ctx.fillStyle = "rgba(35, 22, 12, 0.88)";
    ctx.beginPath();
    ctx.roundRect(x - 2, y - 2, barW + 4, barH + 4, 5);
    ctx.fill();

    ctx.fillStyle = "#3E2723";
    ctx.beginPath();
    ctx.roundRect(x, y, barW, barH, 3);
    ctx.fill();

    if (trailRatio > 0) {
      ctx.fillStyle = "#FFF9C4";
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(2, barW * trailRatio), barH, 3);
      ctx.fill();
    }
    if (ratio > 0) {
      ctx.fillStyle = ratio > 0.35 ? "#FF4050" : "#FF1744";
      ctx.beginPath();
      ctx.roundRect(x, y, Math.max(2, barW * ratio), barH, 3);
      ctx.fill();
    }
    ctx.restore();
  }

  private drawRemotePlayers(
    ctx: CanvasRenderingContext2D,
    remotes: RemotePlayerView[],
    camX: number,
    viewW: number
  ): void {
    const spr = this.images.hero;
    const heroSheet = this.images.hero_sheet;
    const sheet = this.images.items_sheet;
    for (const rp of remotes) {
      if (rp.x < camX - 80 || rp.x > camX + viewW + 80) continue;
      const footX = rp.x + 14;
      const footY = rp.y + 42;
      const speedPx = Math.max(Math.abs(rp.vx), rp.animState === "walk" ? 190 : 0);
      const animState = resolveActorAnimState({
        grounded: rp.animState !== "jump",
        onLadder: rp.animState === "climb",
        speedPx,
        vy: rp.vy,
        attacking: rp.animState === "attack"
      });
      const pose = evaluateActorPose(
        {
          spriteKey: "hero",
          state: animState,
          time: this.time + rp.x * 0.01,
          speedPx,
          vy: rp.vy,
          grounded: rp.animState !== "jump",
          facing: rp.facing >= 0 ? 1 : -1
        },
        Boolean(heroSheet)
      );

      ctx.save();
      if (rp.inMenu) {
        ctx.filter = "grayscale(100%)";
        ctx.globalAlpha = 0.48;
      } else {
        ctx.globalAlpha = rp.dead ? 0.38 : 0.92;
      }
      ctx.fillStyle = "rgba(45, 32, 18, 0.22)";
      ctx.beginPath();
      ctx.ellipse(footX, footY + 1, 15 * pose.shadowScale, 4 * pose.shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();

      ctx.translate(footX + pose.offsetX, footY + pose.offsetY);
      ctx.scale(rp.facing >= 0 ? 1 : -1, 1);
      ctx.rotate(pose.rotation);
      if (pose.skewX !== 0) {
        ctx.transform(1, 0, -pose.skewX, 1, 0, 0);
      }
      ctx.scale(pose.scaleX, pose.scaleY);
      if (spr) {
        this.drawActorSprite(ctx, "hero", spr, heroSheet, pose, -32, -60, 64, 64, null);
      }
      if (sheet) {
        const w = WEAPON_CATALOG[rp.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
        ctx.save();
        ctx.translate(10, -22);
        if (rp.animState === "attack") {
          ctx.rotate(0.85 + Math.sin(this.time * 28) * 0.35);
          ctx.scale(1.15, 1.15);
        } else {
          ctx.rotate(-0.2);
        }
        ctx.drawImage(sheet, w.iconIndex * 96, 0, 96, 96, -4, -26, 34, 34);
        ctx.restore();
      }
      ctx.restore();

      // Overhead Player Name + Level Badge
      this.drawPlayerNameTag(ctx, footX, rp.y - 24, rp.displayName, rp.level, false, Boolean(rp.inMenu));
    }
  }

  private drawLocalPlayer(ctx: CanvasRenderingContext2D, p: LocalPlayerRender): void {
    const spr = this.images.hero;
    const heroSheet = this.images.hero_sheet;
    const sheet = this.images.items_sheet;
    const footX = p.x + p.w * 0.5;
    const footY = p.y + p.h;
    const flicker = p.invulnTimer > 0 && Math.floor(p.invulnTimer * 18) % 2 === 0;
    const isStunned = Boolean(p.statuses?.stun && p.statuses.stun.remaining > 0);
    const animState = resolveActorAnimState({
      grounded: p.grounded,
      onLadder: p.onLadder,
      speedPx: Math.abs(p.vx),
      vy: p.vy,
      attacking: p.attackAnimTimer > 0,
      stunned: isStunned
    });
    const pose = evaluateActorPose(
      {
        spriteKey: "hero",
        state: animState,
        time: p.animTimer,
        speedPx: Math.abs(p.vx),
        vy: p.vy,
        grounded: p.grounded,
        facing: p.facing
      },
      Boolean(heroSheet)
    );

    ctx.save();
    if (p.inMenu) {
      ctx.filter = "grayscale(100%)";
      ctx.globalAlpha = 0.48;
    } else if (flicker) {
      ctx.globalAlpha = 0.45;
    }
    if (p.grounded) {
      ctx.fillStyle = "rgba(45, 32, 18, 0.28)";
      ctx.beginPath();
      ctx.ellipse(footX, footY + 1, 16 * pose.shadowScale, 4.5 * pose.shadowScale, 0, 0, Math.PI * 2);
      ctx.fill();
    }

    ctx.translate(footX + pose.offsetX, footY + pose.offsetY);
    ctx.scale(p.facing, 1);
    ctx.rotate(pose.rotation);
    if (pose.skewX !== 0) {
      ctx.transform(1, 0, -pose.skewX, 1, 0, 0);
    }
    ctx.scale(p.squashX * pose.scaleX, p.squashY * pose.scaleY);

    if (spr) {
      this.drawActorSprite(ctx, "hero", spr, heroSheet, pose, -33, -62, 66, 66, null);
    }
    if (sheet) {
      const w = WEAPON_CATALOG[p.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
      const handBob = animState === "walk" ? Math.sin(p.animTimer * 12) * 1.6 : 0;
      ctx.save();
      ctx.translate(11, -22 + handBob);
      if (p.attackAnimTimer > 0) {
        const prog = 1 - p.attackAnimTimer / Math.max(0.01, p.attackAnimDuration);
        ctx.rotate(-1.35 + prog * 2.45);
        ctx.scale(1.18, 1.18);
      } else {
        ctx.rotate(-0.22 + (animState === "walk" ? Math.sin(p.animTimer * 12) * 0.14 : Math.sin(p.animTimer * 4) * 0.06));
      }
      ctx.drawImage(sheet, w.iconIndex * 96, 0, 96, 96, -6, -28, 36, 36);
      ctx.restore();
    }
    ctx.restore();

    // Local Player Overhead Name + Level Tag
    this.drawPlayerNameTag(ctx, footX, p.y - 24, p.displayName, p.level, true, p.inMenu);

    // Local player active status visuals
    if (p.statuses) {
      this.drawActorStatuses(ctx, footX, p.y - 12, p.w + 8, p.h + 8, p.statuses, 22);
    }

    // Gentle green resting aura & rising '+' motes when idle HP regen is active
    if (p.idleRegenActive) {
      ctx.save();
      const pulse = 0.5 + 0.5 * Math.sin(this.time * 3.6);
      ctx.strokeStyle = `rgba(105, 240, 174, ${0.38 + pulse * 0.28})`;
      ctx.lineWidth = 2.2;
      ctx.beginPath();
      ctx.ellipse(footX, footY - 1, 20 + pulse * 4, 6 + pulse * 1.5, 0, 0, Math.PI * 2);
      ctx.stroke();

      for (let i = 0; i < 3; i++) {
        const phase = (this.time * 0.75 + i * 0.33) % 1;
        const mx = footX + Math.sin(this.time * 2.4 + i * 2.1) * 16;
        const my = footY - 8 - phase * 42;
        ctx.globalAlpha = Math.sin(phase * Math.PI) * 0.9;
        ctx.strokeStyle = "#69F0AE";
        ctx.lineWidth = 2.2;
        ctx.beginPath();
        ctx.moveTo(mx - 3.5, my);
        ctx.lineTo(mx + 3.5, my);
        ctx.moveTo(mx, my - 3.5);
        ctx.lineTo(mx, my + 3.5);
        ctx.stroke();
      }
      ctx.restore();
    }
  }

  private drawPlayerNameTag(
    ctx: CanvasRenderingContext2D,
    cx: number,
    y: number,
    name: string,
    level: number,
    isSelf: boolean,
    inMenu = false
  ): void {
    ctx.save();
    ctx.font = 'bold 11.5px "Pretendard", "Apple SD Gothic Neo", sans-serif';
    const label = inMenu ? `정비 중 · Lv.${level} ${name}` : `Lv.${level} ${name}`;
    const tw = ctx.measureText(label).width + 14;
    ctx.fillStyle = inMenu
      ? "rgba(62, 68, 76, 0.82)"
      : isSelf
        ? "rgba(46, 30, 12, 0.86)"
        : "rgba(25, 38, 56, 0.78)";
    ctx.strokeStyle = inMenu ? "#CFD8DC" : isSelf ? "#FFD740" : "rgba(255, 255, 255, 0.55)";
    ctx.lineWidth = 1.6;
    ctx.beginPath();
    ctx.roundRect(cx - tw * 0.5, y - 10, tw, 19, 9);
    ctx.fill();
    ctx.stroke();

    ctx.fillStyle = inMenu ? "#ECEFF1" : isSelf ? "#FFF59D" : "#FFFFFF";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(label, cx, y);
    ctx.restore();
  }

  private drawProjectiles(ctx: CanvasRenderingContext2D, projectiles: ClientProjectileRender[]): void {
    for (const p of projectiles) {
      const cx = p.x + p.w * 0.5;
      const cy = p.y + p.h * 0.5;
      ctx.save();
      ctx.translate(cx, cy);
      ctx.rotate(p.spin);
      const grad = ctx.createRadialGradient(0, 0, 2, 0, 0, 18);
      grad.addColorStop(0, "#FFFFFF");
      grad.addColorStop(0.5, p.color);
      grad.addColorStop(1, "rgba(255,255,255,0)");
      ctx.fillStyle = grad;
      ctx.beginPath();
      ctx.arc(0, 0, 18, 0, Math.PI * 2);
      ctx.fill();
      if (p.isEnemy) {
        ctx.fillStyle = p.color;
        ctx.strokeStyle = "#4A148C";
        ctx.lineWidth = 2;
        ctx.beginPath();
        ctx.arc(0, 0, 8, 0, Math.PI * 2);
        ctx.fill();
        ctx.stroke();
      } else {
        this.drawStar(ctx, 0, 0, 11, 5, p.color, p.accentColor);
      }
      ctx.restore();
    }
  }

  private drawEffects(
    ctx: CanvasRenderingContext2D,
    hitEffects: ClientHitEffect[],
    particles: ClientParticle[],
    damageTexts: ClientDamageText[]
  ): void {
    for (const pt of particles) {
      const t = pt.age / pt.duration;
      const alpha = Math.max(0, 1 - t);
      const sz = pt.size * (1 - t * 0.45);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (pt.shape === "star") {
        this.drawStar(ctx, pt.x, pt.y, sz * 1.4, 4, pt.color, null);
      } else {
        ctx.fillStyle = pt.color;
        ctx.beginPath();
        ctx.arc(pt.x, pt.y, sz, 0, Math.PI * 2);
        ctx.fill();
      }
      ctx.restore();
    }

    for (const fx of hitEffects) {
      const t = fx.age / fx.duration;
      const alpha = Math.max(0, 1 - t);
      ctx.save();
      ctx.globalAlpha = alpha;
      if (fx.type === "slash") {
        ctx.translate(fx.x, fx.y);
        ctx.scale(fx.facing, 1);
        ctx.strokeStyle = fx.color;
        ctx.lineWidth = Math.max(2, (1 - t) * 11);
        ctx.lineCap = "round";
        ctx.beginPath();
        ctx.arc(0, 0, fx.reach * 0.65, -1.1 + t * 0.5, 0.95);
        ctx.stroke();
      } else if (fx.type === "starburst") {
        const scale = 0.55 + t * 0.85;
        ctx.translate(fx.x, fx.y);
        ctx.rotate(fx.rotation + t * 0.8);
        this.drawStar(ctx, 0, 0, fx.radius * scale, fx.isCrit ? 8 : 6, fx.color, "#FFFFFF");
      } else if (fx.type === "wave") {
        // Upgraded weapon forward splash wave (maple_wave, solar_shockwave, dragon_flame)
        const travel = fx.rangePx * (0.25 + 0.78 * Math.min(1, t * 1.15));
        const halfH = fx.heightPx * 0.5;
        ctx.translate(fx.x, fx.y);
        ctx.scale(fx.facing, 1);

        if (fx.style === "solar_shockwave") {
          // Expanding golden solar shockwave rings + radiant spikes
          const r = Math.max(18, travel * 0.85);
          const grad = ctx.createRadialGradient(travel * 0.35, 0, 6, travel * 0.35, 0, r);
          grad.addColorStop(0, "rgba(255, 253, 231, 0.78)");
          grad.addColorStop(0.55, "rgba(255, 215, 64, 0.42)");
          grad.addColorStop(1, "rgba(255, 111, 0, 0)");
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.ellipse(travel * 0.35, 0, r, halfH * (0.8 + t * 0.4), 0, 0, Math.PI * 2);
          ctx.fill();

          ctx.strokeStyle = fx.color;
          ctx.lineWidth = Math.max(2, (1 - t) * 7);
          ctx.beginPath();
          ctx.ellipse(travel * 0.35, 0, r * 0.92, halfH * (0.65 + t * 0.35), 0, 0, Math.PI * 2);
          ctx.stroke();

          ctx.strokeStyle = fx.accentColor;
          ctx.lineWidth = Math.max(1.5, (1 - t) * 4);
          for (let i = 0; i < 6; i++) {
            const ang = (i * Math.PI) / 3 + t * 1.4;
            ctx.beginPath();
            ctx.moveTo(travel * 0.35 + Math.cos(ang) * r * 0.45, Math.sin(ang) * halfH * 0.35);
            ctx.lineTo(travel * 0.35 + Math.cos(ang) * r * 1.05, Math.sin(ang) * halfH * 0.85);
            ctx.stroke();
          }
        } else {
          // Sweeping crescent sword-energy wave (maple_wave / dragon_flame)
          const grad = ctx.createLinearGradient(0, 0, travel + 16, 0);
          grad.addColorStop(0, "rgba(255, 255, 255, 0)");
          grad.addColorStop(0.5, fx.color);
          grad.addColorStop(1, fx.accentColor);
          ctx.fillStyle = grad;
          ctx.beginPath();
          ctx.moveTo(travel * 0.35, -halfH);
          ctx.quadraticCurveTo(travel + 26, 0, travel * 0.35, halfH);
          ctx.quadraticCurveTo(travel * 0.72, 0, travel * 0.35, -halfH);
          ctx.closePath();
          ctx.fill();

          // Bright leading blade arc
          ctx.strokeStyle = "#FFF8E1";
          ctx.lineWidth = Math.max(2.5, (1 - t) * 7.5);
          ctx.lineCap = "round";
          ctx.beginPath();
          ctx.moveTo(travel * 0.48, -halfH * 0.92);
          ctx.quadraticCurveTo(travel + 22, 0, travel * 0.48, halfH * 0.92);
          ctx.stroke();

          // Secondary inner arc for dragon_flame or drifting maple petals for maple_wave
          if (fx.style === "dragon_flame") {
            ctx.strokeStyle = "#FFD740";
            ctx.lineWidth = Math.max(2, (1 - t) * 5);
            ctx.beginPath();
            ctx.moveTo(travel * 0.22, -halfH * 0.7);
            ctx.quadraticCurveTo(travel * 0.88, 0, travel * 0.22, halfH * 0.7);
            ctx.stroke();
          } else {
            ctx.fillStyle = "#FF5722";
            for (let i = 0; i < 4; i++) {
              const lx = travel * (0.3 + i * 0.22);
              const ly = Math.sin(t * 9 + i * 2.1) * (halfH * 0.65);
              ctx.save();
              ctx.translate(lx, ly);
              ctx.rotate(t * 7 + i * 1.3);
              ctx.beginPath();
              ctx.ellipse(0, 0, 6.5, 3.2, 0, 0, Math.PI * 2);
              ctx.fill();
              ctx.restore();
            }
          }
        }
      } else if (fx.type === "levelup_pillar") {
        // Golden ascending Level-Up Light Pillar!
        const beamW = 54 * (1 - t * 0.45);
        const beamH = 260;
        const grad = ctx.createLinearGradient(fx.x, fx.y, fx.x, fx.y - beamH);
        grad.addColorStop(0, "rgba(255, 238, 88, 0.88)");
        grad.addColorStop(0.55, "rgba(255, 213, 79, 0.52)");
        grad.addColorStop(1, "rgba(255, 255, 255, 0)");
        ctx.fillStyle = grad;
        ctx.fillRect(fx.x - beamW * 0.5, fx.y - beamH, beamW, beamH);

        // Expanding golden ring at feet
        ctx.strokeStyle = "#FFD740";
        ctx.lineWidth = 4 * (1 - t);
        ctx.beginPath();
        ctx.ellipse(fx.x, fx.y, 18 + t * 72, 7 + t * 20, 0, 0, Math.PI * 2);
        ctx.stroke();

        // Big floating LEVEL UP banner!
        const bannerY = fx.y - 76 - t * 48;
        ctx.font = '900 24px "Pretendard", "Apple SD Gothic Neo", sans-serif';
        ctx.textAlign = "center";
        ctx.lineWidth = 6;
        ctx.strokeStyle = "#5D3A1A";
        const msg = `★ LEVEL UP! Lv.${fx.level} ★`;
        ctx.strokeText(msg, fx.x, bannerY);
        ctx.fillStyle = "#FFD740";
        ctx.fillText(msg, fx.x, bannerY);
      }
      ctx.restore();
    }

    for (const d of damageTexts) {
      const t = d.age / d.duration;
      const pop = t < 0.16 ? 0.65 + (t / 0.16) * 0.55 : t < 0.3 ? 1.2 - ((t - 0.16) / 0.14) * 0.2 : 1.0;
      const alpha = t < 0.55 ? 1 : Math.max(0, 1 - (t - 0.55) / 0.45);
      ctx.save();
      ctx.globalAlpha = alpha;
      ctx.translate(d.x, d.y);
      ctx.scale(pop, pop);
      ctx.font = `900 ${d.fontSize}px "Pretendard", "Apple SD Gothic Neo", sans-serif`;
      ctx.textAlign = "center";
      ctx.textBaseline = "middle";
      ctx.lineJoin = "round";
      ctx.lineWidth = d.kind === "crit" || d.kind === "levelup" ? 5.5 : 4.2;
      ctx.strokeStyle = d.stroke;
      ctx.strokeText(d.text, 0, 0);
      ctx.fillStyle = d.color;
      ctx.fillText(d.text, 0, 0);
      ctx.restore();
    }
  }

  private drawSignTooltip(ctx: CanvasRenderingContext2D, sign: RuntimeDecoration | null): void {
    if (!sign || !sign.text) return;
    const cx = sign.x + 24;
    const topY = sign.y - 18;
    ctx.save();
    ctx.font = 'bold 12.5px "Pretendard", "Apple SD Gothic Neo", sans-serif';
    const tw = ctx.measureText(sign.text).width + 24;
    const boxX = cx - tw * 0.5;
    const boxY = topY - 28;
    ctx.fillStyle = "rgba(54, 34, 18, 0.92)";
    ctx.strokeStyle = "#FFD54F";
    ctx.lineWidth = 2;
    ctx.beginPath();
    ctx.roundRect(boxX, boxY, tw, 30, 12);
    ctx.fill();
    ctx.stroke();
    ctx.fillStyle = "#FFFDE7";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(sign.text, cx, boxY + 15);
    ctx.restore();
  }

  private drawHUD(ctx: CanvasRenderingContext2D, scene: RenderScene): void {
    const W = VIEWPORT.width;
    const H = VIEWPORT.height;
    const p = scene.player;
    const sheet = this.images.items_sheet;
    const wObj = WEAPON_CATALOG[p.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;

    ctx.save();
    // --- Top-Left: Clickable Character Status Card (opens Inventory) ---
    const sb = HUD_STATUS_HITBOX;
    ctx.fillStyle = scene.statusHover ? "rgba(68, 42, 18, 0.92)" : "rgba(42, 26, 14, 0.80)";
    ctx.strokeStyle = scene.statusHover ? "#FFE57F" : "rgba(255, 224, 130, 0.65)";
    ctx.lineWidth = scene.statusHover ? 2.4 : 2;
    ctx.beginPath();
    ctx.roundRect(sb.x, sb.y, sb.w, sb.h, 14);
    ctx.fill();
    ctx.stroke();

    if (this.images.hero) {
      ctx.drawImage(this.images.hero, 15, 16, 48, 50);
    }

    // Level pill under avatar
    ctx.fillStyle = "#FFD740";
    ctx.beginPath();
    ctx.roundRect(18, 66, 44, 18, 8);
    ctx.fill();
    ctx.font = '900 11px "Pretendard", sans-serif';
    ctx.fillStyle = "#4A2C14";
    ctx.textAlign = "center";
    ctx.textBaseline = "middle";
    ctx.fillText(`Lv.${p.level}`, 40, 75);

    // HP Bar
    const barX = 72;
    const barW = 212;
    const hpRatio = Math.max(0, Math.min(1, p.hp / Math.max(1, p.maxHp)));
    ctx.fillStyle = "#3E2723";
    ctx.beginPath();
    ctx.roundRect(barX, 18, barW, 16, 8);
    ctx.fill();
    if (hpRatio > 0) {
      ctx.fillStyle = hpRatio > 0.35 ? "#FF5252" : "#D50000";
      ctx.beginPath();
      ctx.roundRect(barX + 1, 19, Math.max(8, (barW - 2) * hpRatio), 14, 7);
      ctx.fill();
    }
    ctx.font = 'bold 11px "Pretendard", sans-serif';
    ctx.fillStyle = "#FFFFFF";
    ctx.textAlign = "center";
    ctx.fillText(`HP ${Math.ceil(p.hp)} / ${p.maxHp}`, barX + barW * 0.5, 26);

    // EXP Bar
    const xpRatio = Math.max(0, Math.min(1, p.xp / Math.max(1, p.xpToNext)));
    ctx.fillStyle = "#263238";
    ctx.beginPath();
    ctx.roundRect(barX, 39, barW, 14, 7);
    ctx.fill();
    if (xpRatio > 0) {
      ctx.fillStyle = "#7C4DFF";
      ctx.beginPath();
      ctx.roundRect(barX + 1, 40, Math.max(6, (barW - 2) * xpRatio), 12, 6);
      ctx.fill();
    }
    ctx.fillStyle = "#EDE7F6";
    ctx.font = 'bold 10px "Pretendard", sans-serif';
    ctx.fillText(`EXP ${p.xp.toLocaleString()} / ${p.xpToNext.toLocaleString()}`, barX + barW * 0.5, 46);

    // ATK / DEX + Potions + Inventory trigger chip
    const eqUpgrade = getWeaponUpgrade(p.weaponUpgrades, wObj.id);
    const combatStats = computeEffectiveCombatStats(wObj, p.baseAtk, p.baseDex, eqUpgrade);
    ctx.textAlign = "left";
    ctx.font = 'bold 11px "Pretendard", sans-serif';
    ctx.fillStyle = "#FFE082";
    ctx.fillText(`ATK ${combatStats.totalAtk}`, barX, 71);
    ctx.fillStyle = "#A5D6A7";
    ctx.fillText(`DEX ${combatStats.totalDex}`, barX + 52, 71);
    if (sheet) {
      ctx.drawImage(sheet, 96, 0, 96, 96, barX + 100, 59, 20, 20);
    }
    ctx.fillStyle = p.potions > 0 ? "#FFCDD2" : "#9E9E9E";
    ctx.fillText(`×${p.potions}`, barX + 121, 71);

    const invChipW = 54;
    const invChipX = sb.x + sb.w - invChipW - 8;
    const invChipY = 61;
    ctx.fillStyle = scene.statusHover ? "#FFD740" : "rgba(255, 215, 64, 0.20)";
    ctx.beginPath();
    ctx.roundRect(invChipX, invChipY, invChipW, 19, 8);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = '800 10px "Pretendard", sans-serif';
    ctx.fillStyle = scene.statusHover ? "#4A2C14" : "#FFF8E1";
    ctx.fillText("가방 ▸", invChipX + invChipW * 0.5, invChipY + 10);

    // Active Player Status Pills & Idle Regen Badge directly beneath top-left HUD card
    {
      const activeList = p.statuses
        ? (Object.values(p.statuses) as Array<ActiveStatusEffect | undefined>).filter(
            (s): s is ActiveStatusEffect => Boolean(s && s.remaining > 0)
          )
        : [];
      if (activeList.length > 0 || p.idleRegenActive) {
        let px = 14;
        const py = 98;
        ctx.font = 'bold 11px "Pretendard", sans-serif';
        ctx.textAlign = "left";
        ctx.textBaseline = "middle";
        if (p.idleRegenActive) {
          const label = "+ 휴식 회복 중";
          const pillW = ctx.measureText(label).width + 16;
          ctx.fillStyle = "rgba(16, 46, 32, 0.86)";
          ctx.strokeStyle = "#69F0AE";
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.roundRect(px, py, pillW, 20, 9);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = "#69F0AE";
          ctx.fillText(label, px + 8, py + 10);
          px += pillW + 6;
        }
        for (const st of activeList) {
          const meta = STATUS_METADATA[st.kind];
          const label = `${meta.label} ${st.remaining.toFixed(1)}s`;
          const pillW = ctx.measureText(label).width + 16;
          ctx.fillStyle = "rgba(32, 20, 12, 0.86)";
          ctx.strokeStyle = meta.color;
          ctx.lineWidth = 1.8;
          ctx.beginPath();
          ctx.roundRect(px, py, pillW, 20, 9);
          ctx.fill();
          ctx.stroke();
          ctx.fillStyle = meta.color;
          ctx.fillText(label, px + 8, py + 10);
          px += pillW + 6;
        }
      }
    }

    // --- Top-Center: Stage Progress & Online Population ---
    const progW = 290;
    const progX = W * 0.5 - progW * 0.5;
    ctx.fillStyle = "rgba(42, 26, 14, 0.78)";
    ctx.strokeStyle = "rgba(255, 224, 130, 0.58)";
    ctx.beginPath();
    ctx.roundRect(progX, 10, progW, 56, 12);
    ctx.fill();
    ctx.stroke();

    const totalScreens = Math.max(1, Math.round(scene.stage.meta.widthTiles / scene.stage.meta.screenWidthTiles));
    const screenNum = Math.min(totalScreens, Math.max(1, Math.floor((p.x + p.w * 0.5) / VIEWPORT.width) + 1));
    const inIsolatedChamber = screenNum === totalScreens;
    ctx.font = 'bold 12px "Pretendard", sans-serif';
    ctx.textAlign = "center";
    ctx.fillStyle = inIsolatedChamber ? "#80D8FF" : "#FFF59D";
    ctx.fillText(
      inIsolatedChamber
        ? `${scene.stage.meta.name} · ★ 비밀 구역`
        : `${scene.stage.meta.name} (${screenNum}/${totalScreens - 1})`,
      W * 0.5,
      23
    );

    const trackX = progX + 16;
    const trackW = progW - 32;
    ctx.fillStyle = "rgba(255,255,255,0.22)";
    ctx.beginPath();
    ctx.roundRect(trackX, 34, trackW, 6, 3);
    ctx.fill();
    const pct = Math.max(0, Math.min(1, (p.x + p.w * 0.5) / scene.stage.meta.worldWidth));
    ctx.fillStyle = "#81C784";
    ctx.beginPath();
    ctx.roundRect(trackX, 34, Math.max(6, trackW * pct), 6, 3);
    ctx.fill();
    ctx.fillStyle = "#FFD740";
    ctx.beginPath();
    ctx.arc(trackX + trackW * pct, 37, 4.5, 0, Math.PI * 2);
    ctx.fill();

    ctx.font = 'bold 10.5px "Pretendard", sans-serif';
    ctx.fillStyle = "#B2EBF2";
    ctx.fillText(
      `Lv.${scene.stage.meta.recommendedMinLevel}~${scene.stage.meta.recommendedMaxLevel} · ${scene.stagePlayerCount}명 / 전체 ${scene.totalPlayersOnline}명`,
      W * 0.5,
      54
    );

    // Low XP efficiency notice if player strongly outlevels current stage
    const stageEff = computeXpEfficiency(p.level, scene.stage.meta.recommendedMaxLevel);
    if (stageEff < 0.5 && scene.stage.nextStageId) {
      ctx.fillStyle = "rgba(183, 28, 28, 0.88)";
      ctx.beginPath();
      ctx.roundRect(progX + 10, 72, progW - 20, 22, 10);
      ctx.fill();
      ctx.fillStyle = "#FFF59D";
      ctx.font = 'bold 11px "Pretendard", sans-serif';
      ctx.fillText("⚠ 경험치 감소 · 다음 스테이지 권장", W * 0.5, 83);
    }

    // --- Top-Right: Clearly Separated Points Pill & Clickable Coin Shop Pill with Icons ---
    // 1. Points + Mobs Defeated Pill
    const ptsX = W - 238;
    const ptsY = 10;
    const ptsW = 226;
    const ptsH = 29;
    ctx.fillStyle = "rgba(38, 25, 15, 0.84)";
    ctx.strokeStyle = "rgba(255, 224, 130, 0.55)";
    ctx.lineWidth = 1.8;
    ctx.beginPath();
    ctx.roundRect(ptsX, ptsY, ptsW, ptsH, 10);
    ctx.fill();
    ctx.stroke();

    // Star / Trophy icon for Points
    this.drawStar(ctx, ptsX + 16, ptsY + 14.5, 8.5, 5, "#FFD740", "#5D3A1A");
    ctx.textAlign = "left";
    ctx.textBaseline = "middle";
    ctx.font = '800 13px "Pretendard", sans-serif';
    ctx.fillStyle = "#FFF59D";
    ctx.fillText(`${p.score.toLocaleString()} PTS`, ptsX + 30, ptsY + 15);
    ctx.textAlign = "right";
    ctx.font = 'bold 10.5px "Pretendard", sans-serif';
    ctx.fillStyle = "#C8E6C9";
    ctx.fillText(`처치 ${p.mobsDefeated}`, ptsX + ptsW - 10, ptsY + 15);

    // 2. Coin Pill (Clickable -> Opens Shop!)
    const cb = HUD_COIN_HITBOX;
    ctx.fillStyle = scene.coinHover ? "rgba(92, 58, 18, 0.94)" : "rgba(56, 36, 14, 0.86)";
    ctx.strokeStyle = scene.coinHover ? "#FFE57F" : "#FFB300";
    ctx.lineWidth = scene.coinHover ? 2.4 : 1.8;
    ctx.beginPath();
    ctx.roundRect(cb.x, cb.y, cb.w, cb.h, 11);
    ctx.fill();
    ctx.stroke();

    // Gleaming Gold Coin icon from items_sheet (cell 3)
    if (sheet) {
      ctx.drawImage(sheet, 3 * 96, 0, 96, 96, cb.x + 6, cb.y + 4, 24, 24);
    }
    ctx.textAlign = "left";
    ctx.font = '800 13.5px "Pretendard", sans-serif';
    ctx.fillStyle = "#FFD740";
    ctx.fillText(`${p.coins.toLocaleString()} 코인`, cb.x + 34, cb.y + 16.5);

    // Subtle "상점" button chip inside Coin Pill
    const chipW = 54;
    const chipX = cb.x + cb.w - chipW - 7;
    const chipY = cb.y + 6;
    ctx.fillStyle = scene.coinHover ? "#FFD740" : "rgba(255, 215, 64, 0.22)";
    ctx.beginPath();
    ctx.roundRect(chipX, chipY, chipW, 20, 8);
    ctx.fill();
    ctx.textAlign = "center";
    ctx.font = '800 10.5px "Pretendard", sans-serif';
    ctx.fillStyle = scene.coinHover ? "#4A2C14" : "#FFF8E1";
    ctx.fillText("상점 ▸", chipX + chipW * 0.5, chipY + 10.5);

    // --- Bottom-Center: Unlocked Weapons Bar ---
    const visibleWeapons = p.unlockedWeapons.slice(-6);
    const slotSize = 42;
    const gap = 7;
    const totalW = visibleWeapons.length * slotSize + Math.max(0, visibleWeapons.length - 1) * gap + 18;
    const barLeft = W * 0.5 - totalW * 0.5;
    const barTop = H - 58;

    ctx.fillStyle = "rgba(42, 26, 14, 0.76)";
    ctx.strokeStyle = "rgba(255, 224, 130, 0.5)";
    ctx.beginPath();
    ctx.roundRect(barLeft, barTop, totalW, 48, 12);
    ctx.fill();
    ctx.stroke();

    visibleWeapons.forEach((wid, idx) => {
      const w = WEAPON_CATALOG[wid]!;
      const active = p.equippedWeaponId === wid;
      const sx = barLeft + 9 + idx * (slotSize + gap);
      const sy = barTop + 3;
      ctx.fillStyle = active ? "rgba(255, 213, 79, 0.36)" : "rgba(255, 255, 255, 0.10)";
      ctx.strokeStyle = active ? "#FFD740" : "rgba(255, 255, 255, 0.25)";
      ctx.lineWidth = active ? 2.5 : 1.5;
      ctx.beginPath();
      ctx.roundRect(sx, sy, slotSize, slotSize, 8);
      ctx.fill();
      ctx.stroke();

      if (sheet) {
        ctx.drawImage(sheet, w.iconIndex * 96, 0, 96, 96, sx + 3, sy + 3, 36, 36);
      }
      const orderIdx = WEAPON_ORDER.indexOf(wid as (typeof WEAPON_ORDER)[number]) + 1;
      ctx.fillStyle = active ? "#FFD740" : "#CCCCCC";
      ctx.font = "bold 10px sans-serif";
      ctx.textAlign = "left";
      ctx.textBaseline = "top";
      ctx.fillText(orderIdx === 10 ? "0" : String(orderIdx), sx + 3, sy + 2);

      const u = getWeaponUpgrade(p.weaponUpgrades, wid);
      const uTot = u.atkLevel + u.dexLevel;
      if (uTot > 0) {
        ctx.fillStyle = "#FFAB40";
        ctx.font = "900 10px sans-serif";
        ctx.textAlign = "right";
        ctx.textBaseline = "bottom";
        ctx.fillText(`+${uTot}`, sx + slotSize - 3, sy + slotSize - 2);
      }
    });

    ctx.font = 'bold 12px "Pretendard", sans-serif';
    ctx.textAlign = "center";
    ctx.strokeStyle = "rgba(42, 26, 14, 0.85)";
    ctx.lineWidth = 3;
    const traits: string[] = [];
    if (wObj.special?.splash) {
      traits.push(`${wObj.special.splash.rangeTiles}칸 스플래시`);
    }
    if (wObj.special?.statuses) {
      for (const st of wObj.special.statuses) {
        const meta = STATUS_METADATA[st.kind];
        traits.push(`${meta.label} ${st.durationSec}초`);
      }
    }
    const traitText = traits.length > 0 ? ` · ★ ${traits.join(" + ")}` : "";
    const upgTag = combatStats.totalLevel > 0 ? ` +${combatStats.totalLevel}` : "";
    const wInfo = `${wObj.name}${upgTag} · ATK ${combatStats.totalAtk} · DEX ${combatStats.totalDex}${traitText}`;
    ctx.strokeText(wInfo, W * 0.5, barTop - 10);
    ctx.fillStyle = "#FFF8E1";
    ctx.fillText(wInfo, W * 0.5, barTop - 10);
    ctx.restore();
  }

  /**
   * Draws an actor using either its genuine drawn multi-frame sprite sheet
   * (zero slicing!) or its intact single-frame sprite with optional continuous
   * serpentine wave deformation (zero cut lines).
   */
  private drawActorSprite(
    ctx: CanvasRenderingContext2D,
    spriteKey: string,
    baseImg: HTMLImageElement,
    sheetImg: HTMLImageElement | undefined,
    pose: ActorRenderPose,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    tintColor: string | null
  ): void {
    const spec = getCharacterAnimationSpec(spriteKey);
    const useSheet = Boolean(sheetImg && spec.sheet && pose.frameIndex >= 0);
    const src: HTMLImageElement = useSheet ? sheetImg! : baseImg;
    const fw = useSheet ? spec.sheet!.frameWidth : baseImg.width || 128;
    const fh = useSheet ? spec.sheet!.frameHeight : baseImg.height || 128;
    const sx = useSheet ? pose.frameIndex * fw : 0;

    if (tintColor) {
      this.drawTintedSprite(ctx, src, sx, 0, fw, fh, dx, dy, dw, dh, tintColor);
      return;
    }

    if (pose.wave && !useSheet) {
      // Smooth continuous horizontal wave (e.g. serpentine slither) with 1px overlap so rows never tear
      const strips = 16;
      const srcStripH = fh / strips;
      const dstStripH = dh / strips;
      for (let i = 0; i < strips; i++) {
        const t = i / strips;
        const shift = Math.sin(pose.wave.phase + t * Math.PI * 2.2) * pose.wave.amplitudePx * (1 - t * 0.65);
        ctx.drawImage(
          src,
          sx,
          i * srcStripH,
          fw,
          srcStripH + 1,
          dx + shift,
          dy + i * dstStripH,
          dw,
          dstStripH + 0.8
        );
      }
      return;
    }

    ctx.drawImage(src, sx, 0, fw, fh, dx, dy, dw, dh);
  }

  private drawTintedSprite(
    ctx: CanvasRenderingContext2D,
    img: HTMLImageElement | HTMLCanvasElement,
    sx: number,
    sy: number,
    sw: number,
    sh: number,
    dx: number,
    dy: number,
    dw: number,
    dh: number,
    color: string
  ): void {
    const tc = this.tintCtx;
    tc.clearRect(0, 0, 128, 128);
    tc.globalCompositeOperation = "source-over";
    tc.drawImage(img, sx, sy, sw, sh, 0, 0, 128, 128);
    tc.globalCompositeOperation = "source-atop";
    tc.fillStyle = color;
    tc.fillRect(0, 0, 128, 128);
    tc.globalCompositeOperation = "source-over";
    ctx.drawImage(this.tintCanvas, 0, 0, 128, 128, dx, dy, dw, dh);
  }

  private drawStar(
    ctx: CanvasRenderingContext2D,
    cx: number,
    cy: number,
    outerR: number,
    points: number,
    fill: string,
    stroke: string | null
  ): void {
    const innerR = outerR * 0.45;
    ctx.beginPath();
    for (let i = 0; i < points * 2; i++) {
      const r = i % 2 === 0 ? outerR : innerR;
      const ang = (i * Math.PI) / points - Math.PI * 0.5;
      const x = cx + Math.cos(ang) * r;
      const y = cy + Math.sin(ang) * r;
      if (i === 0) ctx.moveTo(x, y);
      else ctx.lineTo(x, y);
    }
    ctx.closePath();
    ctx.fillStyle = fill;
    ctx.fill();
    if (stroke) {
      ctx.strokeStyle = stroke;
      ctx.lineWidth = 2;
      ctx.stroke();
    }
  }
}
