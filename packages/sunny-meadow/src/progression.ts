/**
 * RPG Progression, Exponential Leveling, XP Efficiency Scaling,
 * Player-Scaled Respawn Timers, and Spawn Point Dispersion (+/- 2 tiles).
 */

import { PLAYER_CONFIG, VIEWPORT } from "./catalogs";
import type { ItemTemplate, NormalizedStage } from "./types";

export const MAX_LEVEL = 60;
export const SPAWN_PROTECTION_MS = 2000;
export const SPAWN_SPREAD_TILES = 2; // ±2 tiles around spawn point

/**
 * Exponential XP required to advance from `level` to `level + 1`.
 * Lv 1->2: 100, Lv 2->3: 142, Lv 5->6: 407, Lv 10->11: 2354, Lv 20->21: 78,860 ...
 */
export function xpRequiredForLevel(level: number): number {
  const safeLv = Math.max(1, Math.floor(level));
  return Math.round(100 * Math.pow(1.42, safeLv - 1));
}

export function computePlayerMaxHp(level: number, goldenHeartBonus = 0): number {
  const safeLv = Math.max(1, Math.floor(level));
  return PLAYER_CONFIG.baseMaxHp + (safeLv - 1) * PLAYER_CONFIG.hpPerLevel + Math.max(0, goldenHeartBonus);
}

export function computePlayerBaseAtk(level: number): number {
  const safeLv = Math.max(1, Math.floor(level));
  return PLAYER_CONFIG.baseAtk + (safeLv - 1) * PLAYER_CONFIG.atkPerLevel;
}

/**
 * Level-gap XP efficiency multiplier.
 * Once a player outlevels a stage's mobs by 3+ levels, XP drops steeply so they
 * must advance to higher stages (Stage 2..10) to level up effectively.
 */
export function computeXpEfficiency(playerLevel: number, mobLevel: number): number {
  const diff = playerLevel - mobLevel;
  if (diff <= 2) return 1.0;
  if (diff === 3) return 0.65;
  if (diff === 4) return 0.35;
  if (diff === 5) return 0.15;
  return 0.05;
}

export function computeEffectiveXp(playerLevel: number, mobLevel: number, baseExp: number): {
  gainedXp: number;
  efficiency: number;
} {
  const efficiency = computeXpEfficiency(playerLevel, mobLevel);
  const gainedXp = Math.max(1, Math.round(baseExp * efficiency));
  return { gainedXp, efficiency };
}

/**
 * Apply gained XP and process any number of exponential level-ups.
 */
export function applyExperienceGain(
  currentLevel: number,
  currentXp: number,
  gainedXp: number
): {
  level: number;
  xp: number;
  xpToNext: number;
  levelsGained: number;
} {
  let level = Math.max(1, Math.min(MAX_LEVEL, Math.floor(currentLevel)));
  let xp = Math.max(0, Math.floor(currentXp)) + Math.max(0, Math.floor(gainedXp));
  let levelsGained = 0;

  while (level < MAX_LEVEL) {
    const needed = xpRequiredForLevel(level);
    if (xp < needed) break;
    xp -= needed;
    level += 1;
    levelsGained += 1;
  }

  const xpToNext = xpRequiredForLevel(level);
  if (level >= MAX_LEVEL) {
    xp = Math.min(xp, xpToNext);
  }
  return { level, xp, xpToNext, levelsGained };
}

/**
 * Dynamic mob respawn interval scaled by the number of players currently active
 * in the same stage, plus an urgency boost if alive mob ratio drops low.
 * Guarantees newcomers always have mobs to fight for XP even with 100+ players.
 */
export function computeMobRespawnMs(
  baseRespawnSec: number,
  activePlayersInStage: number,
  aliveRatio = 0.5
): number {
  const n = Math.max(1, activePlayersInStage);
  // Logarithmic + mild linear scaling; faster as crowd grows
  const crowdSpeedup = 1 + 0.65 * Math.log2(n) + 0.08 * Math.min(80, n - 1);
  // If field is heavily cleared (< 45% alive), double respawn urgency
  const scarcityBoost = aliveRatio < 0.45 ? 1.8 : aliveRatio < 0.65 ? 1.25 : 1.0;
  const effectiveSec = baseRespawnSec / (crowdSpeedup * scarcityBoost);
  // Floor at 1.4s so respawns stay crisp yet readable (with 2s spawn blink!)
  return Math.round(Math.max(1.4, Math.min(baseRespawnSec, effectiveSec)) * 1000);
}

/**
 * Dynamic item respawn interval scaled by active players in the stage.
 * Rare treasure chests scale conservatively and enforce a high minimum cooldown (180s)
 * so they remain genuinely scarce even in crowded rooms.
 */
export function computeItemRespawnMs(
  baseRespawnSec: number,
  activePlayersInStage: number,
  category?: ItemTemplate["category"]
): number {
  if (baseRespawnSec <= 0) return 0;
  const n = Math.max(1, activePlayersInStage);
  if (category === "chest" || baseRespawnSec >= 180) {
    const rareSpeedup = 1 + 0.15 * Math.log2(n);
    const minSec = Math.min(baseRespawnSec, 180);
    const effectiveSec = baseRespawnSec / rareSpeedup;
    return Math.round(Math.max(minSec, Math.min(baseRespawnSec, effectiveSec)) * 1000);
  }
  const crowdSpeedup = 1 + 0.5 * Math.log2(n) + 0.05 * Math.min(60, n - 1);
  const effectiveSec = baseRespawnSec / crowdSpeedup;
  return Math.round(Math.max(3.5, Math.min(baseRespawnSec, effectiveSec)) * 1000);
}

/**
 * Place a newly connected (or stage-entering) player within ±2 tiles of the stage's
 * spawn point, clamped safely inside the supporting spawn platform.
 */
export function computeSpawnPositionNear(
  stage: NormalizedStage,
  slotSeed: number
): { x: number; y: number } {
  const ts = stage.meta.tileSize || VIEWPORT.tileSize;
  const centerX = (stage.spawn.x + 0.5) * ts;
  const surfaceY = stage.spawn.y * ts;

  // Deterministic well-distributed offset in [-2, +2] tiles using golden ratio sequence
  const frac = ((slotSeed * 0.61803398875) % 1 + 1) % 1; // [0, 1)
  const tileOffset = (frac * 2 - 1) * SPAWN_SPREAD_TILES; // [-2, +2]
  let spawnX = centerX + tileOffset * ts;

  // Find supporting platform at spawn to clamp safely so nobody spawns off a cliff
  const spawnPlat = stage.layers.platforms.allIds
    .map((id) => stage.layers.platforms.byId[id])
    .find(
      (p) =>
        p &&
        stage.spawn.x >= p.x &&
        stage.spawn.x <= p.x + p.w &&
        Math.abs(p.y - stage.spawn.y) <= 1.5
    );

  const minX = spawnPlat ? spawnPlat.x * ts + 24 : 24;
  const maxX = spawnPlat ? (spawnPlat.x + spawnPlat.w) * ts - 24 : stage.meta.widthTiles * ts - 24;
  spawnX = Math.max(minX, Math.min(maxX, spawnX));

  return {
    x: Math.round(spawnX - PLAYER_CONFIG.hitboxWidth * 0.5),
    y: Math.round(surfaceY - PLAYER_CONFIG.hitboxHeight)
  };
}
