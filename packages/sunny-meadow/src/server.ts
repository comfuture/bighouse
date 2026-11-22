import type {
  ActionResult,
  ClientGameAction,
  GameAction,
  GameContext,
  GameEvent,
  JsonObject,
  PlayerSeat,
  ServerGamePlugin,
  TimerIntent,
  ValidationResult
} from "@bighouse/game-sdk/server";
import { createGameEventId, defineGameDefinition } from "@bighouse/game-sdk/server";
import {
  computeIdleRegenAmount,
  ITEM_CATALOG,
  MOB_CATALOG,
  PLAYER_CONFIG,
  STATUS_METADATA,
  WEAPON_CATALOG,
  WEAPON_ORDER
} from "./catalogs";
import {
  addItemToInventory,
  canAddItemToInventory,
  canDismantleItem,
  computeChestCoinReward,
  computeDismantleYield,
  computeEffectiveCombatStats,
  computePlayerBaseDex,
  computeUpgradePreview,
  countItemInInventory,
  ECONOMY_ACTION_COOLDOWN_MS,
  getWeaponUpgrade,
  INVENTORY_ITEMS,
  normalizeInventory,
  normalizeWeaponUpgrades,
  removeItemAtSlot,
  removeItemFromInventory,
  rollChestStoneDrop,
  rollEliteStoneDrop,
  SHOP_OFFERS_BY_ID,
  SMELTING_RECIPES_BY_ID,
  STONE_POWDER_ITEM_ID
} from "./economy";
import { baseGameMetadata } from "./metadata";
import {
  applyExperienceGain,
  computeEffectiveXp,
  computeItemRespawnMs,
  computeMobRespawnMs,
  computePlayerBaseAtk,
  computePlayerMaxHp,
  computeSpawnPositionNear,
  SPAWN_PROTECTION_MS,
  xpRequiredForLevel
} from "./progression";
import { ALL_STAGES, getStageById, STAGES_BY_ID } from "./stages/index";
import type {
  DeathPenalty,
  PersistedPlayerProfile,
  RemotePlayerView,
  ServerItemState,
  ServerMobState,
  ServerStageRuntime,
  StatusEffectKind,
  SunnyMeadowWorldState,
  WeaponUpgradeStat,
  WorldPlayerState
} from "./types";

export const gameMetadata = baseGameMetadata;

const MAX_NEARBY_REMOTE_PLAYERS = 48;
const INTEREST_HORIZ_RANGE_PX = 2400; // ~2.5 screens in each direction
export const ITEM_COOP_GRACE_MS = 1200;
export const MOB_KILL_GRACE_MS = 1200;

/**
 * Deterministic damage formula shared between client optimistic prediction
 * and server authoritative reconciliation.
 */
export function computeDeterministicHit(
  totalAtk: number,
  critChance: number,
  critMult: number,
  roll01: number
): { damage: number; isCrit: boolean } {
  const clamped = Number.isFinite(roll01) ? Math.max(0, Math.min(0.9999, roll01)) : 0.5;
  const isCrit = clamped < critChance;
  const variance = 0.94 + ((clamped * 97) % 1) * 0.12;
  const damage = Math.max(1, Math.round(totalAtk * variance * (isCrit ? critMult : 1)));
  return { damage, isCrit };
}

function serverEntropyRoll(seed: string): number {
  let h = 2166136261;
  for (let i = 0; i < seed.length; i++) {
    h ^= seed.charCodeAt(i);
    h = Math.imul(h, 16777619);
  }
  return (h >>> 0) / 4294967296;
}

function computeMobHome(
  stage: ReturnType<typeof getStageById>,
  spawn: { x: number; y: number; facing: number },
  tpl: { width: number; height: number; flying?: boolean }
): { x: number; y: number; facing: number } {
  const ts = stage.meta.tileSize;
  const x = Math.round(spawn.x * ts - tpl.width * 0.5);
  const y = Math.round(tpl.flying ? spawn.y * ts - tpl.height - 76 : spawn.y * ts - tpl.height);
  return { x, y, facing: spawn.facing < 0 ? -1 : 1 };
}

function createInitialMobState(
  stage: ReturnType<typeof getStageById>,
  mobId: string
): ServerMobState {
  const spawn = stage.layers.mobSpawns.byId[mobId]!;
  const tpl = MOB_CATALOG[spawn.templateId]!;
  const home = computeMobHome(stage, spawn, tpl);
  return {
    id: mobId,
    templateId: spawn.templateId,
    alive: true,
    hp: tpl.hp,
    maxHp: tpl.hp,
    inCombat: false,
    respawnAt: 0,
    spawnProtectUntil: 0,
    lastHitAt: 0,
    x: home.x,
    y: home.y,
    vx: 0,
    vy: 0,
    facing: home.facing,
    contributors: {},
    defeatedAt: 0,
    rewardedPlayers: []
  };
}

function createInitialItemState(itemId: string, templateId: string): ServerItemState {
  return {
    id: itemId,
    templateId,
    available: true,
    respawnAt: 0,
    collectedAt: 0,
    collectedBy: []
  };
}

function buildInitialWorldState(): SunnyMeadowWorldState {
  const stages: Record<string, ServerStageRuntime> = {};
  for (const stage of ALL_STAGES) {
    const mobs: Record<string, ServerMobState> = {};
    for (const mobId of stage.layers.mobSpawns.allIds) {
      mobs[mobId] = createInitialMobState(stage, mobId);
    }
    const items: Record<string, ServerItemState> = {};
    for (const itemId of stage.layers.itemSpawns.allIds) {
      const spawn = stage.layers.itemSpawns.byId[itemId]!;
      items[itemId] = createInitialItemState(itemId, spawn.templateId);
    }
    stages[stage.meta.id] = { stageId: stage.meta.id, mobs, items };
  }
  return { stages, playerStageMap: {}, joinCounter: 0 };
}

/**
 * Keeps long-lived persistent rooms synchronized with the current stage catalog
 * after map updates: adds new mob/item spawns, prunes removed IDs, and backfills
 * missing mob kinematics while preserving live HP/respawn timers of unchanged IDs.
 */
function reconcileWorldStages(world: SunnyMeadowWorldState): boolean {
  let mutated = false;
  if (!world.stages) {
    world.stages = {};
    mutated = true;
  }
  for (const stage of ALL_STAGES) {
    const stageId = stage.meta.id;
    let stageRt = world.stages[stageId];
    if (!stageRt) {
      stageRt = { stageId, mobs: {}, items: {} };
      world.stages[stageId] = stageRt;
      mutated = true;
    }

    const validMobIds = new Set(stage.layers.mobSpawns.allIds);
    for (const existingId of Object.keys(stageRt.mobs)) {
      if (!validMobIds.has(existingId)) {
        delete stageRt.mobs[existingId];
        mutated = true;
      }
    }
    for (const mobId of stage.layers.mobSpawns.allIds) {
      const spawn = stage.layers.mobSpawns.byId[mobId]!;
      const tpl = MOB_CATALOG[spawn.templateId]!;
      const existing = stageRt.mobs[mobId];
      if (!existing || existing.templateId !== spawn.templateId) {
        stageRt.mobs[mobId] = createInitialMobState(stage, mobId);
        mutated = true;
      } else {
        if (existing.maxHp !== tpl.hp) {
          if (existing.alive) {
            // Carry forward damage without refilling or killing an in-flight mob.
            const damage = Math.max(0, existing.maxHp - existing.hp);
            existing.hp = damage === 0
              ? tpl.hp
              : Math.max(1, Math.min(existing.hp, tpl.hp - damage));
          }
          // A defeated mob keeps its current respawn deadline and uses the new max on respawn.
          existing.maxHp = tpl.hp;
          mutated = true;
        }
        if (typeof existing.x !== "number" || typeof existing.y !== "number") {
          const home = computeMobHome(stage, spawn, tpl);
          existing.x = home.x;
          existing.y = home.y;
          existing.vx = 0;
          existing.vy = 0;
          existing.facing = home.facing;
          mutated = true;
        }
      }
    }

    const validItemIds = new Set(stage.layers.itemSpawns.allIds);
    for (const existingId of Object.keys(stageRt.items)) {
      if (!validItemIds.has(existingId)) {
        delete stageRt.items[existingId];
        mutated = true;
      }
    }
    for (const itemId of stage.layers.itemSpawns.allIds) {
      const spawn = stage.layers.itemSpawns.byId[itemId]!;
      const existing = stageRt.items[itemId];
      if (!existing || existing.templateId !== spawn.templateId) {
        stageRt.items[itemId] = createInitialItemState(itemId, spawn.templateId);
        mutated = true;
      }
    }
  }
  return mutated;
}

function clampMobPosition(
  stageId: string,
  mobId: string,
  rawX: number,
  rawY: number
): { x: number; y: number } | null {
  if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return null;
  const stage = getStageById(stageId);
  const spawn = stage.layers.mobSpawns.byId[mobId];
  if (!spawn) return null;
  const tpl = MOB_CATALOG[spawn.templateId];
  if (!tpl) return null;
  const ts = stage.meta.tileSize;
  const worldW = stage.meta.widthTiles * ts;
  const worldH = stage.meta.heightTiles * ts;
  const minX = Math.max(0, Math.round(spawn.patrolMinX * ts - 180));
  const maxX = Math.min(worldW - tpl.width, Math.round(spawn.patrolMaxX * ts + 180));
  const minY = 0;
  const maxY = Math.max(0, worldH - tpl.height);
  return {
    x: Math.max(minX, Math.min(maxX, Math.round(rawX))),
    y: Math.max(minY, Math.min(maxY, Math.round(rawY)))
  };
}

function canPlayerSyncMob(
  world: SunnyMeadowWorldState,
  playerStates: Record<string, JsonObject>,
  stageId: string,
  playerId: string,
  mob: ServerMobState,
  now: number
): boolean {
  const sender = getPlayerState(playerStates, playerId);
  if (!sender || sender.dead || sender.inMenu || sender.stageId !== stageId) return false;
  const mobX = mob.x ?? 0;
  const mobY = mob.y ?? 0;
  const senderDist = Math.hypot(sender.x - mobX, sender.y - mobY);
  if (senderDist > 1600) return false;

  let closestId = playerId;
  let closestDist = senderDist;
  for (const [pid, sid] of Object.entries(world.playerStageMap)) {
    if (sid !== stageId) continue;
    const ps = getPlayerState(playerStates, pid);
    if (!ps || ps.dead || ps.inMenu) continue;
    const dist = Math.hypot(ps.x - mobX, ps.y - mobY);
    if (dist < closestDist - 1 || (Math.abs(dist - closestDist) <= 1 && pid < closestId)) {
      closestDist = dist;
      closestId = pid;
    }
  }

  if (closestId === playerId) return true;
  // Hysteresis prevents authority ping-pong when two players stand at similar distance.
  const prevAuth = mob.authorityPlayerId;
  const prevAuthState = prevAuth ? getPlayerState(playerStates, prevAuth) : undefined;
  const prevAuthFresh =
    Boolean(prevAuth) &&
    prevAuth !== playerId &&
    Boolean(prevAuthState && !prevAuthState.dead && !prevAuthState.inMenu) &&
    typeof mob.stateUpdatedAt === "number" &&
    now - mob.stateUpdatedAt < 550;
  if (!prevAuthFresh && senderDist <= closestDist + 160) return true;
  if (prevAuth === playerId && senderDist <= closestDist + 140) return true;
  return false;
}

function processDueRespawns(world: SunnyMeadowWorldState, now: number): GameEvent[] {
  const events: GameEvent[] = [];
  for (const stageRt of Object.values(world.stages)) {
    const stage = STAGES_BY_ID[stageRt.stageId];
    if (!stage) continue;

    const respawnedMobs: Array<{
      id: string;
      hp: number;
      maxHp: number;
      x: number;
      y: number;
      facing: number;
      spawnProtectUntil: number;
    }> = [];
    const respawnedItems: string[] = [];

    for (const mob of Object.values(stageRt.mobs)) {
      if (!mob.alive && mob.respawnAt > 0 && mob.respawnAt <= now) {
        const spawn = stage.layers.mobSpawns.byId[mob.id];
        const tpl = MOB_CATALOG[mob.templateId];
        const home = spawn && tpl ? computeMobHome(stage, spawn, tpl) : { x: mob.x ?? 0, y: mob.y ?? 0, facing: -1 };
        mob.alive = true;
        mob.hp = mob.maxHp;
        mob.inCombat = false;
        mob.respawnAt = 0;
        mob.contributors = {};
        mob.defeatedAt = 0;
        mob.rewardedPlayers = [];
        mob.x = home.x;
        mob.y = home.y;
        mob.vx = 0;
        mob.vy = 0;
        mob.facing = home.facing;
        mob.stateUpdatedAt = now;
        delete mob.authorityPlayerId;
        delete mob.statuses;
        // 2-second blinking spawn protection: cannot attack or be damaged!
        mob.spawnProtectUntil = now + SPAWN_PROTECTION_MS;
        respawnedMobs.push({
          id: mob.id,
          hp: mob.hp,
          maxHp: mob.maxHp,
          x: home.x,
          y: home.y,
          facing: home.facing,
          spawnProtectUntil: mob.spawnProtectUntil
        });
      }
    }

    for (const item of Object.values(stageRt.items)) {
      if (!item.available && item.respawnAt > 0 && item.respawnAt <= now) {
        item.available = true;
        item.respawnAt = 0;
        item.collectedAt = 0;
        item.collectedBy = [];
        respawnedItems.push(item.id);
      }
    }

    if (respawnedMobs.length > 0) {
      events.push(
        makeEvent(
          "sunny.mobsRespawned",
          {
            stageId: stageRt.stageId,
            mobs: respawnedMobs
          },
          now
        )
      );
    }

    if (respawnedItems.length > 0) {
      events.push(
        makeEvent(
          "sunny.itemsRespawned",
          {
            stageId: stageRt.stageId,
            itemIds: respawnedItems
          },
          now
        )
      );
    }
  }
  return events;
}

function getWorld(stageState: JsonObject): SunnyMeadowWorldState {
  return stageState as unknown as SunnyMeadowWorldState;
}

function getPlayerState(
  playerStates: Record<string, JsonObject>,
  playerId: string
): WorldPlayerState | undefined {
  return playerStates[playerId] as unknown as WorldPlayerState | undefined;
}

function createFreshPlayerState(
  player: PlayerSeat,
  joinCounter: number,
  now: number,
  persisted?: JsonObject | null
): WorldPlayerState {
  const displayName = player.displayName?.trim() || `모험가-${player.playerId.slice(-4)}`;
  const saved = persisted as Partial<PersistedPlayerProfile> | null | undefined;

  const level = typeof saved?.level === "number" && saved.level >= 1 ? Math.floor(saved.level) : 1;
  const xp = typeof saved?.xp === "number" && saved.xp >= 0 ? Math.floor(saved.xp) : 0;
  const goldenHeartBonus =
    typeof saved?.goldenHeartBonus === "number" && saved.goldenHeartBonus >= 0
      ? Math.floor(saved.goldenHeartBonus)
      : 0;
  const maxHp = computePlayerMaxHp(level, goldenHeartBonus);
  const baseAtk = computePlayerBaseAtk(level);
  const hp =
    typeof saved?.hp === "number" && saved.hp > 0
      ? Math.min(maxHp, Math.max(Math.round(maxHp * 0.25), Math.floor(saved.hp)))
      : maxHp;

  const stageId =
    typeof saved?.lastStageId === "string" && STAGES_BY_ID[saved.lastStageId]
      ? saved.lastStageId
      : "stage-1";
  const stage = getStageById(stageId);

  let x: number;
  let y: number;
  const worldW = stage.meta.widthTiles * stage.meta.tileSize;
  const worldH = stage.meta.heightTiles * stage.meta.tileSize;
  if (
    typeof saved?.lastX === "number" &&
    typeof saved?.lastY === "number" &&
    Number.isFinite(saved.lastX) &&
    Number.isFinite(saved.lastY) &&
    saved.lastX >= 8 &&
    saved.lastX <= worldW - 40 &&
    saved.lastY >= 0 &&
    saved.lastY <= worldH - 40
  ) {
    x = Math.round(saved.lastX);
    y = Math.round(saved.lastY);
  } else {
    const pos = computeSpawnPositionNear(stage, joinCounter);
    x = pos.x;
    y = pos.y;
  }

  const rawWeapons = Array.isArray(saved?.unlockedWeapons)
    ? saved.unlockedWeapons.filter((id): id is string => typeof id === "string" && Boolean(WEAPON_CATALOG[id]))
    : [];
  const unlockedWeapons = Array.from(new Set(["wooden_sword", ...rawWeapons])).sort(
    (a, b) => WEAPON_ORDER.indexOf(a as (typeof WEAPON_ORDER)[number]) - WEAPON_ORDER.indexOf(b as (typeof WEAPON_ORDER)[number])
  );
  const equippedWeaponId =
    typeof saved?.equippedWeaponId === "string" && unlockedWeapons.includes(saved.equippedWeaponId)
      ? saved.equippedWeaponId
      : unlockedWeapons[unlockedWeapons.length - 1] ?? "wooden_sword";

  const highestStageNumber = Math.max(
    stage.meta.stageNumber,
    typeof saved?.highestStageNumber === "number" ? Math.floor(saved.highestStageNumber) : 1
  );

  return {
    playerId: player.playerId,
    displayName,
    stageId,
    x,
    y,
    vx: 0,
    vy: 0,
    facing: 1,
    animState: "idle",
    level,
    xp,
    xpToNext: xpRequiredForLevel(level),
    hp,
    maxHp,
    baseAtk,
    baseDex: computePlayerBaseDex(level),
    goldenHeartBonus,
    potions: typeof saved?.potions === "number" ? Math.max(0, Math.floor(saved.potions)) : PLAYER_CONFIG.startingPotions,
    coins: typeof saved?.coins === "number" ? Math.max(0, Math.floor(saved.coins)) : 0,
    score: typeof saved?.score === "number" ? Math.max(0, Math.floor(saved.score)) : 0,
    mobsDefeated: typeof saved?.mobsDefeated === "number" ? Math.max(0, Math.floor(saved.mobsDefeated)) : 0,
    unlockedWeapons,
    equippedWeaponId,
    inventory: normalizeInventory(saved?.inventory),
    weaponUpgrades: normalizeWeaponUpgrades(saved?.weaponUpgrades),
    highestStageNumber,
    lastUpdatedAt: now,
    lastActivityAt: now
  };
}

function countPlayersInStage(world: SunnyMeadowWorldState, stageId: string): number {
  let count = 0;
  for (const sid of Object.values(world.playerStageMap)) {
    if (sid === stageId) count += 1;
  }
  return Math.max(1, count);
}

function playersInStageIds(world: SunnyMeadowWorldState, stageId: string, excludePlayerId?: string): string[] {
  const result: string[] = [];
  for (const [pid, sid] of Object.entries(world.playerStageMap)) {
    if (sid === stageId && pid !== excludePlayerId) {
      result.push(pid);
    }
  }
  return result;
}

function nearbyPlayersOnStage(
  world: SunnyMeadowWorldState,
  playerStates: Record<string, JsonObject>,
  stageId: string,
  originX: number,
  excludePlayerId?: string
): RemotePlayerView[] {
  const candidates: Array<{ dist: number; view: RemotePlayerView }> = [];
  for (const [pid, sid] of Object.entries(world.playerStageMap)) {
    if (sid !== stageId || pid === excludePlayerId) continue;
    const ps = getPlayerState(playerStates, pid);
    if (!ps) continue;
    const dist = Math.abs(ps.x - originX);
    if (dist <= INTEREST_HORIZ_RANGE_PX) {
      candidates.push({
        dist,
        view: {
          playerId: ps.playerId,
          displayName: ps.displayName,
          stageId: ps.stageId,
          x: ps.x,
          y: ps.y,
          vx: ps.vx,
          vy: ps.vy,
          facing: ps.facing,
          animState: ps.animState,
          level: ps.level,
          hp: ps.hp,
          maxHp: ps.maxHp,
          equippedWeaponId: ps.equippedWeaponId,
          ...(ps.dead ? { dead: true } : {}),
          ...(ps.inMenu ? { inMenu: true } : {})
        }
      });
    }
  }
  candidates.sort((a, b) => a.dist - b.dist);
  return candidates.slice(0, MAX_NEARBY_REMOTE_PLAYERS).map((c) => c.view);
}

function makeEvent(
  type: string,
  payload: JsonObject,
  now: number,
  visibility: GameEvent["visibility"] = "public",
  playerId?: string
): GameEvent {
  return {
    id: createGameEventId(),
    type,
    visibility,
    payload,
    ...(playerId ? { playerId } : {}),
    createdAt: now
  };
}

/** Keeps a client-reported position inside the stage it is on. */
function clampToStage(stageId: string, rawX: number, rawY: number): { x: number; y: number } {
  const stage = getStageById(stageId);
  const maxX = stage.meta.widthTiles * stage.meta.tileSize - PLAYER_CONFIG.hitboxWidth;
  const maxY = stage.meta.heightTiles * stage.meta.tileSize;
  return {
    x: Math.max(0, Math.min(maxX, Math.round(rawX))),
    y: Math.max(-120, Math.min(maxY, Math.round(rawY)))
  };
}

/**
 * Reviving penalty scales gently for tutorial levels and early stages:
 * - Lv. 1~3 (tutorial protection): 0% XP lost, 20% coins lost.
 * - Stage 1 (Lv. 4+): 20% XP lost, 30% coins lost.
 * - Lv. 4~5 or Stage 2: 35% XP lost, 50% coins lost.
 * - Stage 3+ & Lv. 6+: full current-level XP and coins lost.
 */
export function deathPenaltyOf(
  ps: Pick<WorldPlayerState, "xp" | "coins"> & Partial<Pick<WorldPlayerState, "level" | "stageId">>
): DeathPenalty {
  const safeXp = Math.max(0, Math.floor(ps.xp));
  const safeCoins = Math.max(0, Math.floor(ps.coins));
  const level = typeof ps.level === "number" && ps.level >= 1 ? Math.floor(ps.level) : 6;
  const stageNum = ps.stageId ? getStageById(ps.stageId).meta.stageNumber : 3;

  let xpRatio = 1.0;
  let coinRatio = 1.0;
  if (level <= 3) {
    xpRatio = 0.0;
    coinRatio = 0.2;
  } else if (stageNum === 1) {
    xpRatio = 0.2;
    coinRatio = 0.3;
  } else if (level <= 5 || stageNum === 2) {
    xpRatio = 0.35;
    coinRatio = 0.5;
  }

  return {
    lostXp: Math.floor(safeXp * xpRatio),
    lostCoins: Math.floor(safeCoins * coinRatio)
  };
}

/** Pays the death penalty and stands the player back up at 60% health. */
function applyRevival(ps: WorldPlayerState): void {
  const penalty = deathPenaltyOf(ps);
  ps.xp = Math.max(0, ps.xp - penalty.lostXp);
  ps.coins = Math.max(0, ps.coins - penalty.lostCoins);
  ps.hp = Math.max(20, Math.round(ps.maxHp * 0.6));
  ps.vx = 0;
  ps.vy = 0;
  delete ps.dead;
}

type ActionCheck = { ok: true } | { ok: false; code: string; message: string; stale?: true };

/**
 * Decides whether an action can take effect. `stale` marks the outcomes that are
 * normal in a shared, optimistic world: another player got there first, the
 * target is on a stage this player has left, or the player is down. Those are
 * not errors and are never shown to the player.
 */
function checkAction(context: GameContext, action: ClientGameAction): ActionCheck {
  const ps = getPlayerState(context.state.playerStates, action.playerId);
  if (!ps) return { ok: false, code: "player_not_found", message: "Player state missing" };
  const world = getWorld(context.state.stageState);
  reconcileWorldStages(world);
  const stageRt = world.stages[ps.stageId];
  if (!stageRt) return { ok: false, code: "invalid_action", message: "Unknown player stage" };

  if (action.type === "revive") {
    return ps.dead ? { ok: true } : { ok: false, code: "not_dead", message: "Player is not down", stale: true };
  }
  if (ps.dead) {
    return { ok: false, code: "player_dead", message: "Player is down", stale: true };
  }
  if (action.type === "setMenuMode") {
    return { ok: true };
  }
  // While in Inventory/Shop safe mode, player does not interact with stage mobs, items, or hazards!
  if (
    ps.inMenu &&
    (action.type === "attackMob" ||
      action.type === "collectItem" ||
      action.type === "playerHurt" ||
      action.type === "changeStage")
  ) {
    return { ok: false, code: "in_menu_mode", message: "Player is in inventory/shop safe mode", stale: true };
  }

  switch (action.type) {
    case "attackMob": {
      const mobId = typeof action.payload.mobId === "string" ? action.payload.mobId : "";
      const mob = stageRt.mobs[mobId];
      if (!mob) {
        return { ok: false, code: "mob_not_here", message: "Unknown target mob", stale: true };
      }
      // Strict 2-second spawn protection: blinking respawned mobs cannot be damaged!
      if (mob.alive && context.now < mob.spawnProtectUntil) {
        return { ok: false, code: "spawn_protected", message: "Respawning mob is temporarily invulnerable", stale: true };
      }
      if (!mob.alive) {
        // Cooperative simultaneous kill grace window:
        // If another player just killed this mob within MOB_KILL_GRACE_MS and this player
        // hasn't received XP for this kill cycle yet, allow optimistic hit to resolve with shared XP!
        const defeatedAt = mob.defeatedAt ?? 0;
        const rewarded = mob.rewardedPlayers ?? [];
        const withinGrace = defeatedAt > 0 && context.now - defeatedAt <= MOB_KILL_GRACE_MS;
        if (!withinGrace || rewarded.includes(action.playerId)) {
          return { ok: false, code: "mob_defeated", message: "Target mob is already defeated", stale: true };
        }
      }
      const hitKind = action.payload.hitKind === "splash" || action.payload.hitKind === "dot" ? action.payload.hitKind : "primary";
      if (hitKind === "splash") {
        const weapon = WEAPON_CATALOG[ps.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
        if (!weapon.special?.splash) {
          return { ok: false, code: "no_weapon_splash", message: "Equipped weapon has no splash wave", stale: true };
        }
      } else if (hitKind === "dot") {
        const dotStatus = typeof action.payload.dotStatus === "string" ? (action.payload.dotStatus as StatusEffectKind) : undefined;
        if (!dotStatus || !STATUS_METADATA[dotStatus]?.isDot) {
          return { ok: false, code: "invalid_dot_status", message: "Invalid DoT status", stale: true };
        }
        const expiresAt = mob.statuses?.[dotStatus] ?? 0;
        const hasDoTWeapon = ps.unlockedWeapons.some((wid) =>
          WEAPON_CATALOG[wid]?.special?.statuses?.some((s) => s.kind === dotStatus)
        );
        if (expiresAt < context.now - 1000 && !hasDoTWeapon) {
          return { ok: false, code: "status_expired", message: "DoT status not active on target", stale: true };
        }
      }
      return { ok: true };
    }
    case "collectItem": {
      const itemId = typeof action.payload.itemId === "string" ? action.payload.itemId : "";
      const item = stageRt.items[itemId];
      if (!item) return { ok: false, code: "item_not_here", message: "Unknown item", stale: true };
      const tpl = ITEM_CATALOG[item.templateId];
      if (!tpl) return { ok: false, code: "invalid_action", message: "Unknown item template" };
      if (tpl.category !== "weapon" && !item.available) {
        // Cooperative simultaneous item pickup grace window applies only to ordinary
        // consumables (coins, apples, potions). Important rare upgrades (golden heart
        // permanent max HP) cannot be duplicated across a lost race.
        const allowRaceDuplicate =
          tpl.category === "coin" || tpl.category === "heal" || tpl.category === "potion";
        const collectedAt = item.collectedAt ?? 0;
        const collectedBy = item.collectedBy ?? [];
        const withinGrace = allowRaceDuplicate && collectedAt > 0 && context.now - collectedAt <= ITEM_COOP_GRACE_MS;
        if (!withinGrace || collectedBy.includes(action.playerId)) {
          return { ok: false, code: "item_taken", message: "Item is respawning", stale: true };
        }
      }
      return { ok: true };
    }
    case "usePotion": {
      if (ps.potions <= 0 || ps.hp >= ps.maxHp) {
        return { ok: false, code: "potion_unusable", message: "Cannot use potion right now", stale: true };
      }
      return { ok: true };
    }
    case "idleRegen": {
      if (ps.hp >= ps.maxHp) {
        return { ok: false, code: "hp_full", message: "HP is already full", stale: true };
      }
      const lastAct = ps.lastActivityAt ?? 0;
      if (context.now - lastAct < PLAYER_CONFIG.idleRegenDelaySec * 1000 - 400) {
        return {
          ok: false,
          code: "not_idle_long_enough",
          message: "Must remain idle for 10 seconds before regenerating",
          stale: true
        };
      }
      if (ps.lastIdleRegenAt && context.now - ps.lastIdleRegenAt < PLAYER_CONFIG.idleRegenIntervalSec * 1000 - 300) {
        return { ok: false, code: "regen_cooldown", message: "Idle regen cooling down", stale: true };
      }
      return { ok: true };
    }
    case "switchWeapon": {
      const wid = typeof action.payload.weaponId === "string" ? action.payload.weaponId : "";
      if (!ps.unlockedWeapons.includes(wid)) {
        return { ok: false, code: "invalid_action", message: "Weapon not unlocked" };
      }
      return { ok: true };
    }
    case "playerHurt": {
      const amt = Number(action.payload.amount);
      if (!Number.isFinite(amt) || amt <= 0) {
        return { ok: false, code: "invalid_action", message: "Invalid damage amount" };
      }
      return { ok: true };
    }
    case "changeStage": {
      const targetStageId = typeof action.payload.targetStageId === "string" ? action.payload.targetStageId : "";
      const targetStage = STAGES_BY_ID[targetStageId];
      if (!targetStage) {
        return { ok: false, code: "invalid_action", message: "Unknown target stage" };
      }
      if (
        targetStage.meta.stageNumber > ps.highestStageNumber + 1 &&
        ps.level < targetStage.meta.minEntryLevel
      ) {
        return {
          ok: false,
          code: "level_too_low",
          message: `Lv.${targetStage.meta.minEntryLevel} 이상부터 입장할 수 있습니다.`
        };
      }
      return { ok: true };
    }
    case "shopBuy": {
      if (ps.lastEconomyActionAt && context.now - ps.lastEconomyActionAt < ECONOMY_ACTION_COOLDOWN_MS) {
        return { ok: false, code: "economy_cooldown", message: "잠시 후 다시 시도해주세요.", stale: true };
      }
      const offerId = typeof action.payload.offerId === "string" ? action.payload.offerId : "";
      const offer = SHOP_OFFERS_BY_ID[offerId];
      if (!offer) return { ok: false, code: "invalid_offer", message: "존재하지 않는 상품입니다." };
      const qty = Math.floor(Number(action.payload.quantity ?? 1));
      if (!Number.isFinite(qty) || qty < 1 || qty > 20) {
        return { ok: false, code: "invalid_quantity", message: "구매 수량이 올바르지 않습니다." };
      }
      const totalCost = offer.buyPrice * qty;
      if (ps.coins < totalCost) {
        return { ok: false, code: "insufficient_coins", message: "코인이 부족합니다.", stale: true };
      }
      if (offer.delivery === "inventory") {
        const inv = normalizeInventory(ps.inventory);
        if (!canAddItemToInventory(inv, offer.itemId, qty)) {
          return { ok: false, code: "inventory_full", message: "인벤토리 공간이 부족합니다.", stale: true };
        }
      }
      return { ok: true };
    }
    case "shopSell": {
      if (ps.lastEconomyActionAt && context.now - ps.lastEconomyActionAt < ECONOMY_ACTION_COOLDOWN_MS) {
        return { ok: false, code: "economy_cooldown", message: "잠시 후 다시 시도해주세요.", stale: true };
      }
      const rawSlot = action.payload.slotIndex;
      if (typeof rawSlot !== "number" || !Number.isInteger(rawSlot)) {
        return { ok: false, code: "invalid_slot", message: "잘못된 인벤토리 칸입니다." };
      }
      const slotIndex = rawSlot;
      const qty = Math.floor(Number(action.payload.quantity ?? 1));
      const inv = normalizeInventory(ps.inventory);
      if (slotIndex < 0 || slotIndex >= inv.length) {
        return { ok: false, code: "invalid_slot", message: "잘못된 인벤토리 칸입니다." };
      }
      const slot = inv[slotIndex];
      if (!slot || !Number.isFinite(qty) || qty < 1 || qty > slot.quantity) {
        return { ok: false, code: "invalid_quantity", message: "판매할 아이템이 부족합니다.", stale: true };
      }
      const spec = INVENTORY_ITEMS[slot.itemId];
      if (!spec || spec.sellPrice <= 0) {
        return { ok: false, code: "unsellable_item", message: "판매할 수 없는 아이템입니다.", stale: true };
      }
      return { ok: true };
    }
    case "upgradeWeapon": {
      if (ps.lastEconomyActionAt && context.now - ps.lastEconomyActionAt < ECONOMY_ACTION_COOLDOWN_MS) {
        return { ok: false, code: "economy_cooldown", message: "잠시 후 다시 강화할 수 있습니다.", stale: true };
      }
      const wid = typeof action.payload.weaponId === "string" ? action.payload.weaponId : "";
      const stat = action.payload.stat === "atk" || action.payload.stat === "dex" ? action.payload.stat : null;
      const weapon = WEAPON_CATALOG[wid];
      if (!weapon || !ps.unlockedWeapons.includes(wid) || !stat) {
        return { ok: false, code: "invalid_upgrade", message: "강화할 수 없는 무기 또는 능력치입니다." };
      }
      const cur = getWeaponUpgrade(ps.weaponUpgrades, wid);
      const preview = computeUpgradePreview(weapon, stat, cur);
      if (preview.atCap) {
        return { ok: false, code: "upgrade_maxed", message: "이미 최대 강화 단계(+10)에 도달했습니다.", stale: true };
      }
      if (ps.coins < preview.coinCost) {
        return { ok: false, code: "insufficient_coins", message: "강화 비용(코인)이 부족합니다.", stale: true };
      }
      const inv = normalizeInventory(ps.inventory);
      if (countItemInInventory(inv, preview.stoneId) < preview.stonesRequired) {
        return { ok: false, code: "insufficient_stones", message: "강화석이 부족합니다.", stale: true };
      }
      return { ok: true };
    }
    case "dismantleItem": {
      if (ps.lastEconomyActionAt && context.now - ps.lastEconomyActionAt < ECONOMY_ACTION_COOLDOWN_MS) {
        return { ok: false, code: "economy_cooldown", message: "잠시 후 다시 시도해주세요.", stale: true };
      }
      const rawSlot = action.payload.slotIndex;
      if (typeof rawSlot !== "number" || !Number.isInteger(rawSlot)) {
        return { ok: false, code: "invalid_slot", message: "잘못된 인벤토리 칸입니다." };
      }
      const slotIndex = rawSlot;
      const qty = Math.floor(Number(action.payload.quantity ?? 1));
      const inv = normalizeInventory(ps.inventory);
      if (slotIndex < 0 || slotIndex >= inv.length) {
        return { ok: false, code: "invalid_slot", message: "잘못된 인벤토리 칸입니다." };
      }
      const slot = inv[slotIndex];
      if (!slot || !Number.isFinite(qty) || qty < 1 || qty > slot.quantity) {
        return { ok: false, code: "invalid_quantity", message: "분해할 강화석이 부족합니다.", stale: true };
      }
      if (!canDismantleItem(slot.itemId)) {
        return { ok: false, code: "undismantleable_item", message: "분해할 수 없는 아이템입니다.", stale: true };
      }
      const powderYield = computeDismantleYield(slot.itemId, qty);
      const afterRemove = removeItemAtSlot(inv, slotIndex, qty).inventory;
      if (!canAddItemToInventory(afterRemove, STONE_POWDER_ITEM_ID, powderYield)) {
        return { ok: false, code: "inventory_full", message: "가방 공간이 부족합니다.", stale: true };
      }
      return { ok: true };
    }
    case "smeltStone": {
      if (ps.lastEconomyActionAt && context.now - ps.lastEconomyActionAt < ECONOMY_ACTION_COOLDOWN_MS) {
        return { ok: false, code: "economy_cooldown", message: "잠시 후 다시 시도해주세요.", stale: true };
      }
      const recipeId = typeof action.payload.recipeId === "string" ? action.payload.recipeId : "";
      const recipe = SMELTING_RECIPES_BY_ID[recipeId];
      if (!recipe) {
        return { ok: false, code: "invalid_recipe", message: "존재하지 않는 제련 레시피입니다." };
      }
      const qty = Math.floor(Number(action.payload.quantity ?? 1));
      if (!Number.isFinite(qty) || qty < 1 || qty > 20) {
        return { ok: false, code: "invalid_quantity", message: "제련 수량이 올바르지 않습니다." };
      }
      const totalCoins = recipe.coinCost * qty;
      const totalPowder = recipe.powderCost * qty;
      if (ps.coins < totalCoins) {
        return { ok: false, code: "insufficient_coins", message: "제련 비용(코인)이 부족합니다.", stale: true };
      }
      const inv = normalizeInventory(ps.inventory);
      if (countItemInInventory(inv, STONE_POWDER_ITEM_ID) < totalPowder) {
        return { ok: false, code: "insufficient_powder", message: "강화석 가루가 부족합니다.", stale: true };
      }
      const afterRemove = removeItemFromInventory(inv, STONE_POWDER_ITEM_ID, totalPowder).inventory;
      if (!canAddItemToInventory(afterRemove, recipe.outputItemId, qty)) {
        return { ok: false, code: "inventory_full", message: "가방 공간이 부족합니다.", stale: true };
      }
      return { ok: true };
    }
    case "checkpoint":
      return { ok: true };
    default:
      return { ok: false, code: "invalid_action", message: `Unsupported action '${action.type}'` };
  }
}

function applyCheckedAction(context: GameContext, action: ClientGameAction): ActionResult {
  const state = context.state;
  const now = context.now;
  const world = getWorld(state.stageState);
  reconcileWorldStages(world);
  const ps = getPlayerState(state.playerStates, action.playerId)!;
  const stageRt = world.stages[ps.stageId]!;
  const events: GameEvent[] = processDueRespawns(world, now);

  if (action.type === "attackMob") {
    const mobId = String(action.payload.mobId);
    const mob = stageRt.mobs[mobId]!;
    const mobTpl = MOB_CATALOG[mob.templateId]!;
    const weapon = WEAPON_CATALOG[ps.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
    const clientHitId = typeof action.payload.clientHitId === "string" ? action.payload.clientHitId : undefined;
    const hitKind: "primary" | "splash" | "dot" =
      action.payload.hitKind === "splash" || action.payload.hitKind === "dot" ? action.payload.hitKind : "primary";
    const dotStatus =
      hitKind === "dot" && typeof action.payload.dotStatus === "string"
        ? (action.payload.dotStatus as StatusEffectKind)
        : undefined;

    // Deterministic hit roll shared with client prediction
    const roll =
      typeof action.payload.damageRoll === "number" && Number.isFinite(action.payload.damageRoll)
        ? action.payload.damageRoll
        : ((now + ps.score + mob.hp * 17) % 100) / 100;
    const combatStats = computeEffectiveCombatStats(
      weapon,
      ps.baseAtk,
      ps.baseDex ?? computePlayerBaseDex(ps.level),
      getWeaponUpgrade(ps.weaponUpgrades, weapon.id)
    );
    const totalAtk = combatStats.totalAtk;
    const effCritChance = combatStats.critChance;
    let damage: number;
    let isCrit: boolean;
    let knockbackX = weapon.knockbackX;
    let knockbackY = weapon.knockbackY;
    let appliedStatuses: NonNullable<NonNullable<typeof weapon.special>["statuses"]> = [];

    if (hitKind === "dot" && dotStatus) {
      let dotRatio = 0.15;
      const equippedSpec = weapon.special?.statuses?.find((s) => s.kind === dotStatus);
      if (equippedSpec?.dotRatio) {
        dotRatio = equippedSpec.dotRatio;
      } else {
        for (const wid of ps.unlockedWeapons) {
          const spec = WEAPON_CATALOG[wid]?.special?.statuses?.find((s) => s.kind === dotStatus);
          if (spec?.dotRatio) {
            dotRatio = spec.dotRatio;
            break;
          }
        }
      }
      damage = Math.max(1, Math.round(totalAtk * dotRatio));
      isCrit = false;
      knockbackX = 0;
      knockbackY = 0;
    } else if (hitKind === "splash" && weapon.special?.splash) {
      const base = computeDeterministicHit(totalAtk, effCritChance, weapon.critMult, roll);
      damage = Math.max(1, Math.round(base.damage * weapon.special.splash.damageMult));
      isCrit = base.isCrit;
      knockbackX = Math.round(weapon.knockbackX * 0.7);
      knockbackY = Math.round(weapon.knockbackY * 0.7);
      appliedStatuses = weapon.special?.statuses ?? [];
    } else {
      const base = computeDeterministicHit(totalAtk, effCritChance, weapon.critMult, roll);
      damage = base.damage;
      isCrit = base.isCrit;
      appliedStatuses = weapon.special?.statuses ?? [];
    }
    const knockDir = hitKind === "dot" ? 0 : Number(action.payload.knockDir) < 0 ? -1 : 1;

    mob.contributors = mob.contributors ?? {};
    mob.rewardedPlayers = mob.rewardedPlayers ?? [];

    const awardKillRewardTo = (recipientId: string, persistList: string[]) => {
      if (mob.rewardedPlayers!.includes(recipientId)) return;
      const recipient = getPlayerState(state.playerStates, recipientId);
      if (!recipient) return;
      mob.rewardedPlayers!.push(recipientId);
      persistList.push(recipientId);

      const { gainedXp, efficiency } = computeEffectiveXp(recipient.level, mobTpl.level, mobTpl.exp);
      const lvlResult = applyExperienceGain(recipient.level, recipient.xp, gainedXp);
      recipient.level = lvlResult.level;
      recipient.xp = lvlResult.xp;
      recipient.xpToNext = lvlResult.xpToNext;
      recipient.score += mobTpl.score;
      recipient.mobsDefeated += 1;
      recipient.lastUpdatedAt = now;

      // Elite & Boss monsters rarely drop Upgrade Stones (auto-collected into killer's 4x6 inventory!)
      const stageMeta = getStageById(ps.stageId).meta;
      const dropChanceRoll = serverEntropyRoll(`edrop:${now}:${mobId}:${recipient.playerId}:${recipient.mobsDefeated}`);
      const dropColorRoll = serverEntropyRoll(`ecolor:${now}:${mobId}:${recipient.playerId}:${recipient.mobsDefeated}`);
      const dropTierRoll = serverEntropyRoll(`etier:${now}:${mobId}:${recipient.playerId}:${recipient.mobsDefeated}`);
      const eliteDrop = rollEliteStoneDrop(mobTpl, stageMeta.stageNumber, dropChanceRoll, dropColorRoll, dropTierRoll);
      let droppedStonePayload:
        | { itemId: string; name: string; quantity: number; overflow: number; color: string; iconIndex: number }
        | undefined;
      if (eliteDrop) {
        const invRes = addItemToInventory(normalizeInventory(recipient.inventory), eliteDrop.itemId, eliteDrop.quantity);
        recipient.inventory = invRes.inventory;
        const spec = INVENTORY_ITEMS[eliteDrop.itemId]!;
        droppedStonePayload = {
          itemId: eliteDrop.itemId,
          name: spec.name,
          quantity: invRes.added,
          overflow: invRes.overflow,
          color: spec.color,
          iconIndex: spec.iconIndex
        };
      }

      events.push(
        makeEvent(
          "sunny.mobDefeated",
          {
            stageId: ps.stageId,
            mobId,
            killerPlayerId: recipient.playerId,
            killerName: recipient.displayName,
            gainedXp,
            xpEfficiency: efficiency,
            score: mobTpl.score,
            respawnAt: mob.respawnAt,
            ...(typeof mob.x === "number" && typeof mob.y === "number" ? { mobX: mob.x, mobY: mob.y } : {}),
            ...(droppedStonePayload ? { droppedStone: droppedStonePayload } : {}),
            ...(recipientId === ps.playerId && clientHitId ? { clientHitId } : {}),
            persistPlayerIds: [recipient.playerId]
          },
          now
        )
      );

      if (lvlResult.levelsGained > 0) {
        recipient.maxHp = computePlayerMaxHp(recipient.level, recipient.goldenHeartBonus);
        recipient.baseAtk = computePlayerBaseAtk(recipient.level);
        recipient.baseDex = computePlayerBaseDex(recipient.level);
        recipient.hp = recipient.maxHp;
        for (const st of ALL_STAGES) {
          if (recipient.level >= st.meta.minEntryLevel && st.meta.stageNumber > recipient.highestStageNumber) {
            recipient.highestStageNumber = st.meta.stageNumber;
          }
        }
        events.push(
          makeEvent(
            "sunny.levelUp",
            {
              stageId: ps.stageId,
              playerId: recipient.playerId,
              displayName: recipient.displayName,
              level: recipient.level,
              levelsGained: lvlResult.levelsGained,
              maxHp: recipient.maxHp,
              baseAtk: recipient.baseAtk,
              x: recipient.x,
              y: recipient.y,
              persistPlayerIds: [recipient.playerId]
            },
            now
          )
        );
      }

      state.playerStates[recipient.playerId] = recipient as unknown as JsonObject;
    };

    if (!mob.alive) {
      // Grace-window simultaneous attack right after another player defeated this mob:
      // award full XP & score to this player too so optimistic play never feels robbed!
      mob.contributors[ps.playerId] = (mob.contributors[ps.playerId] ?? 0) + damage;
      const persistedIds: string[] = [];
      awardKillRewardTo(ps.playerId, persistedIds);
    } else {
      mob.inCombat = true;
      mob.lastHitAt = now;
      mob.hp = Math.max(0, mob.hp - damage);
      mob.contributors[ps.playerId] = (mob.contributors[ps.playerId] ?? 0) + damage;

      // Apply weapon status effects (stun, crystal DoT, burn, shock, etc.)
      if (appliedStatuses.length > 0) {
        mob.statuses = mob.statuses ?? {};
        for (const st of appliedStatuses) {
          const expiresAt = now + Math.round(st.durationSec * 1000);
          mob.statuses[st.kind] = Math.max(mob.statuses[st.kind] ?? 0, expiresAt);
        }
      }

      // Sync mob position from attacker so all players see knockback & hit VFX at the same spot
      const hitPos = clampMobPosition(ps.stageId, mobId, Number(action.payload.mobX), Number(action.payload.mobY));
      if (hitPos) {
        mob.x = hitPos.x;
        mob.y = hitPos.y;
        if (knockDir !== 0) {
          mob.facing = -knockDir;
        }
        mob.stateUpdatedAt = now;
        mob.authorityPlayerId = ps.playerId;
      }

      events.push(
        makeEvent(
          "sunny.mobHit",
          {
            stageId: ps.stageId,
            mobId,
            attackerId: ps.playerId,
            damage,
            isCrit,
            hitKind,
            ...(dotStatus ? { dotStatus } : {}),
            knockDir,
            knockbackX,
            knockbackY,
            hp: mob.hp,
            maxHp: mob.maxHp,
            ...(appliedStatuses.length > 0
              ? {
                  appliedStatuses: appliedStatuses.map((s) => ({
                    kind: s.kind,
                    durationSec: s.durationSec,
                    ...(typeof s.dotRatio === "number" ? { dotRatio: s.dotRatio } : {}),
                    ...(typeof s.tickIntervalSec === "number" ? { tickIntervalSec: s.tickIntervalSec } : {}),
                    ...(typeof s.speedMult === "number" ? { speedMult: s.speedMult } : {})
                  }))
                }
              : {}),
            ...(typeof mob.x === "number" && typeof mob.y === "number" ? { x: mob.x, y: mob.y } : {}),
            ...(clientHitId ? { clientHitId } : {})
          },
          now
        )
      );

      if (mob.hp <= 0) {
        mob.alive = false;
        mob.inCombat = false;
        mob.defeatedAt = now;
        delete mob.statuses;

        // Calculate dynamic player-count-scaled respawn delay
        const activeCount = countPlayersInStage(world, ps.stageId);
        const allMobs = Object.values(stageRt.mobs);
        const aliveCount = allMobs.filter((m) => m.alive).length;
        const aliveRatio = aliveCount / Math.max(1, allMobs.length);
        const respawnMs = computeMobRespawnMs(mobTpl.respawnSec, activeCount, aliveRatio);
        mob.respawnAt = now + respawnMs;

        // Reward EVERY player who dealt damage to this mob!
        const persistedIds: string[] = [];
        for (const contributorId of Object.keys(mob.contributors)) {
          awardKillRewardTo(contributorId, persistedIds);
        }
      }
    }
  } else if (action.type === "collectItem") {
    const itemId = String(action.payload.itemId);
    const item = stageRt.items[itemId]!;
    const tpl = ITEM_CATALOG[item.templateId]!;
    const clientPickupId =
      typeof action.payload.clientPickupId === "string" ? action.payload.clientPickupId : undefined;
    // A weapon pickup never becomes unavailable, so it pays out only the first time.
    const alreadyOwned = tpl.category === "weapon" && Boolean(tpl.weaponId) && ps.unlockedWeapons.includes(tpl.weaponId!);
    if (!alreadyOwned) ps.score += tpl.score;

    if (tpl.category === "weapon" && tpl.weaponId) {
      if (!ps.unlockedWeapons.includes(tpl.weaponId)) {
        ps.unlockedWeapons = [...ps.unlockedWeapons, tpl.weaponId].sort(
          (a, b) => WEAPON_ORDER.indexOf(a as (typeof WEAPON_ORDER)[number]) - WEAPON_ORDER.indexOf(b as (typeof WEAPON_ORDER)[number])
        );
      }
      ps.equippedWeaponId = tpl.weaponId;
      events.push(
        makeEvent(
          "sunny.weaponUnlocked",
          {
            stageId: ps.stageId,
            playerId: ps.playerId,
            itemId,
            weaponId: tpl.weaponId,
            weaponName: tpl.name,
            ...(clientPickupId ? { clientPickupId } : {}),
            persistProfile: true
          },
          now,
          "private",
          ps.playerId
        )
      );
    } else {
      item.collectedBy = item.collectedBy ?? [];
      const isFirstCollector = item.available;
      if (isFirstCollector) {
        item.available = false;
        item.collectedAt = now;
        const activeCount = countPlayersInStage(world, ps.stageId);
        item.respawnAt = now + computeItemRespawnMs(tpl.respawnSec, activeCount);
      }
      if (!item.collectedBy.includes(ps.playerId)) {
        item.collectedBy.push(ps.playerId);
      }

      if (tpl.category === "chest") {
        // Rare Treasure Chest: stage-scaled coin haul + rare Upgrade Stone drop (auto-collected!)
        const stageMeta = getStageById(ps.stageId).meta;
        const chestCoins = computeChestCoinReward(stageMeta.stageNumber);
        ps.coins += chestCoins;
        const chanceRoll = serverEntropyRoll(`cdrop:${now}:${itemId}:${ps.playerId}:${ps.coins}`);
        const colorRoll = serverEntropyRoll(`ccolor:${now}:${itemId}:${ps.playerId}:${ps.coins}`);
        const tierRoll = serverEntropyRoll(`ctier:${now}:${itemId}:${ps.playerId}:${ps.coins}`);
        const stoneDrop = rollChestStoneDrop(stageMeta.stageNumber, chanceRoll, colorRoll, tierRoll);
        let droppedStonePayload:
          | { itemId: string; name: string; quantity: number; overflow: number; color: string; iconIndex: number }
          | undefined;
        if (stoneDrop) {
          const invRes = addItemToInventory(normalizeInventory(ps.inventory), stoneDrop.itemId, stoneDrop.quantity);
          ps.inventory = invRes.inventory;
          const spec = INVENTORY_ITEMS[stoneDrop.itemId]!;
          droppedStonePayload = {
            itemId: stoneDrop.itemId,
            name: spec.name,
            quantity: invRes.added,
            overflow: invRes.overflow,
            color: spec.color,
            iconIndex: spec.iconIndex
          };
        }
        events.push(
          makeEvent(
            "sunny.chestOpened",
            {
              stageId: ps.stageId,
              itemId,
              openerId: ps.playerId,
              coins: chestCoins,
              respawnAt: item.respawnAt,
              ...(droppedStonePayload ? { droppedStone: droppedStonePayload } : {}),
              ...(clientPickupId ? { clientPickupId } : {}),
              persistProfile: true
            },
            now
          )
        );
      } else {
        if (tpl.category === "coin") {
          ps.coins += 1;
        } else if (tpl.category === "heal") {
          const healAmt = Math.max(tpl.healAmount ?? 30, Math.round(ps.maxHp * 0.25));
          ps.hp = Math.min(ps.maxHp, ps.hp + healAmt);
        } else if (tpl.category === "potion") {
          ps.potions += tpl.potionCount ?? 1;
        } else if (tpl.category === "max_hp") {
          ps.goldenHeartBonus += tpl.maxHpBonus ?? 20;
          ps.maxHp = computePlayerMaxHp(ps.level, ps.goldenHeartBonus);
          ps.hp = Math.min(ps.maxHp, ps.hp + (tpl.healAmount ?? 60));
        }

        events.push(
          makeEvent(
            "sunny.itemCollected",
            {
              stageId: ps.stageId,
              itemId,
              templateId: tpl.id,
              collectorId: ps.playerId,
              respawnAt: item.respawnAt,
              ...(clientPickupId ? { clientPickupId } : {}),
              persistProfile: true
            },
            now
          )
        );
      }
    }
  } else if (action.type === "usePotion") {
    const clientPotionId =
      typeof action.payload.clientPotionId === "string" ? action.payload.clientPotionId : undefined;
    ps.potions = Math.max(0, ps.potions - 1);
    const healAmt = Math.max(
      PLAYER_CONFIG.minPotionHeal,
      Math.round(ps.maxHp * PLAYER_CONFIG.potionHealRatio)
    );
    const before = ps.hp;
    ps.hp = Math.min(ps.maxHp, ps.hp + healAmt);
    events.push(
      makeEvent(
        "sunny.playerHealed",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          amount: ps.hp - before,
          hp: ps.hp,
          maxHp: ps.maxHp,
          potions: ps.potions,
          ...(clientPotionId ? { clientPotionId } : {}),
          persistProfile: true
        },
        now
      )
    );
  } else if (action.type === "idleRegen") {
    const clientRegenId =
      typeof action.payload.clientRegenId === "string" ? action.payload.clientRegenId : undefined;
    const healAmt = computeIdleRegenAmount(ps.maxHp);
    const before = ps.hp;
    ps.hp = Math.min(ps.maxHp, ps.hp + healAmt);
    ps.lastIdleRegenAt = now;
    events.push(
      makeEvent(
        "sunny.playerHealed",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          amount: ps.hp - before,
          hp: ps.hp,
          maxHp: ps.maxHp,
          potions: ps.potions,
          reason: "idle_regen",
          ...(clientRegenId ? { clientRegenId } : {}),
          persistProfile: true
        },
        now
      )
    );
  } else if (action.type === "switchWeapon") {
    ps.equippedWeaponId = String(action.payload.weaponId);
    const seq = Number(action.payload.switchSeq);
    if (Number.isFinite(seq) && seq > 0) {
      ps.weaponSwitchSeq = Math.max(ps.weaponSwitchSeq ?? 0, Math.floor(seq));
    }
    events.push(
      makeEvent(
        "sunny.weaponChanged",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          weaponId: ps.equippedWeaponId,
          ...(ps.weaponSwitchSeq !== undefined ? { switchSeq: ps.weaponSwitchSeq } : {}),
          persistProfile: true
        },
        now
      )
    );
  } else if (action.type === "playerHurt") {
    const dmg = Math.max(1, Math.min(ps.maxHp, Math.round(Number(action.payload.amount))));
    ps.hp = Math.max(0, ps.hp - dmg);
    if (ps.hp <= 0) {
      // The player goes down and stays down until they choose to revive.
      ps.dead = true;
      ps.vx = 0;
      ps.vy = 0;
      events.push(
        makeEvent(
          "sunny.playerDied",
          { stageId: ps.stageId, playerId: ps.playerId, ...deathPenaltyOf(ps), persistProfile: true },
          now
        )
      );
    }
  } else if (action.type === "revive") {
    const penalty = deathPenaltyOf(ps);
    const stage = getStageById(ps.stageId);
    world.joinCounter = (world.joinCounter ?? 0) + 1;
    const pos = computeSpawnPositionNear(stage, world.joinCounter);
    applyRevival(ps);
    ps.x = pos.x;
    ps.y = pos.y;
    events.push(
      makeEvent(
        "sunny.playerRespawned",
        { stageId: ps.stageId, playerId: ps.playerId, x: ps.x, y: ps.y, hp: ps.hp, ...penalty, persistProfile: true },
        now
      )
    );
  } else if (action.type === "changeStage") {
    const prevStageId = ps.stageId;
    const targetStageId = String(action.payload.targetStageId);
    const targetStage = getStageById(targetStageId);
    world.joinCounter = (world.joinCounter ?? 0) + 1;
    const pos = computeSpawnPositionNear(targetStage, world.joinCounter);

    ps.stageId = targetStage.meta.id;
    ps.x = pos.x;
    ps.y = pos.y;
    ps.vx = 0;
    ps.vy = 0;
    ps.hp = Math.max(ps.hp, Math.round(ps.maxHp * 0.6));
    ps.highestStageNumber = Math.max(ps.highestStageNumber, targetStage.meta.stageNumber);
    world.playerStageMap[ps.playerId] = ps.stageId;

    if (prevStageId !== ps.stageId) {
      events.push(
        makeEvent(
          "sunny.playerLeft",
          {
            stageId: prevStageId,
            playerId: ps.playerId,
            stagePlayerCount: playersInStageIds(world, prevStageId).length
          },
          now
        )
      );
    }
    events.push(
      makeEvent(
        "sunny.playerJoined",
        {
          stageId: ps.stageId,
          stagePlayerCount: countPlayersInStage(world, ps.stageId),
          persistProfile: true,
          player: {
            playerId: ps.playerId,
            displayName: ps.displayName,
            stageId: ps.stageId,
            x: ps.x,
            y: ps.y,
            vx: 0,
            vy: 0,
            facing: ps.facing,
            animState: "idle",
            level: ps.level,
            hp: ps.hp,
            maxHp: ps.maxHp,
            equippedWeaponId: ps.equippedWeaponId
          }
        },
        now
      )
    );
  } else if (action.type === "setMenuMode") {
    const inMenu = Boolean(action.payload.inMenu);
    if (inMenu) {
      ps.inMenu = true;
      ps.vx = 0;
      ps.vy = 0;
      ps.animState = "idle";
    } else {
      delete ps.inMenu;
    }
    events.push(
      makeEvent(
        "sunny.playerMenuMode",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          inMenu
        },
        now
      )
    );
  } else if (action.type === "shopBuy") {
    const offerId = String(action.payload.offerId);
    const offer = SHOP_OFFERS_BY_ID[offerId]!;
    const qty = Math.floor(Number(action.payload.quantity ?? 1));
    const totalCost = offer.buyPrice * qty;
    ps.coins = Math.max(0, ps.coins - totalCost);
    ps.lastEconomyActionAt = now;

    if (offer.delivery === "potion") {
      ps.potions += qty;
    } else {
      const invRes = addItemToInventory(normalizeInventory(ps.inventory), offer.itemId, qty);
      ps.inventory = invRes.inventory;
    }

    events.push(
      makeEvent(
        "sunny.shopResult",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          kind: "buy",
          offerId,
          itemId: offer.itemId,
          itemName: offer.name,
          quantity: qty,
          coinsDelta: -totalCost,
          coins: ps.coins,
          persistProfile: true
        },
        now,
        "private",
        ps.playerId
      )
    );
  } else if (action.type === "shopSell") {
    const slotIndex = Math.floor(Number(action.payload.slotIndex));
    const qty = Math.floor(Number(action.payload.quantity ?? 1));
    const rem = removeItemAtSlot(normalizeInventory(ps.inventory), slotIndex, qty);
    const spec = rem.itemId ? INVENTORY_ITEMS[rem.itemId] : undefined;
    const earned = spec ? spec.sellPrice * rem.removed : 0;
    ps.inventory = rem.inventory;
    ps.coins += earned;
    ps.lastEconomyActionAt = now;

    events.push(
      makeEvent(
        "sunny.shopResult",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          kind: "sell",
          slotIndex,
          itemId: rem.itemId ?? "",
          itemName: spec?.name ?? "",
          quantity: rem.removed,
          coinsDelta: earned,
          coins: ps.coins,
          persistProfile: true
        },
        now,
        "private",
        ps.playerId
      )
    );
  } else if (action.type === "upgradeWeapon") {
    const wid = String(action.payload.weaponId);
    const stat = action.payload.stat as WeaponUpgradeStat;
    const weapon = WEAPON_CATALOG[wid]!;
    const upgrades = normalizeWeaponUpgrades(ps.weaponUpgrades);
    const cur = getWeaponUpgrade(upgrades, wid);
    const preview = computeUpgradePreview(weapon, stat, cur);

    ps.coins = Math.max(0, ps.coins - preview.coinCost);
    ps.inventory = removeItemFromInventory(normalizeInventory(ps.inventory), preview.stoneId, preview.stonesRequired).inventory;
    ps.lastEconomyActionAt = now;
    ps.upgradeAttempts = (ps.upgradeAttempts ?? 0) + 1;

    const roll = serverEntropyRoll(`upg:${now}:${ps.playerId}:${wid}:${stat}:${ps.upgradeAttempts}:${ps.score}`);
    const success = roll < preview.successRate;
    const nextState = success
      ? {
          atkLevel: cur.atkLevel + (stat === "atk" ? 1 : 0),
          dexLevel: cur.dexLevel + (stat === "dex" ? 1 : 0),
          failStreak: 0
        }
      : {
          atkLevel: cur.atkLevel,
          dexLevel: cur.dexLevel,
          failStreak: Math.min(10, cur.failStreak + 1)
        };
    upgrades[wid] = nextState;
    ps.weaponUpgrades = upgrades;

    events.push(
      makeEvent(
        "sunny.weaponUpgraded",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          weaponId: wid,
          weaponName: weapon.name,
          stat,
          success,
          atkLevel: nextState.atkLevel,
          dexLevel: nextState.dexLevel,
          totalLevel: nextState.atkLevel + nextState.dexLevel,
          failStreak: nextState.failStreak,
          coinsSpent: preview.coinCost,
          stonesSpent: preview.stonesRequired,
          stoneId: preview.stoneId,
          persistProfile: true
        },
        now,
        "private",
        ps.playerId
      )
    );
  } else if (action.type === "dismantleItem") {
    const slotIndex = Math.floor(Number(action.payload.slotIndex));
    const qty = Math.floor(Number(action.payload.quantity ?? 1));
    const rem = removeItemAtSlot(normalizeInventory(ps.inventory), slotIndex, qty);
    const spec = rem.itemId ? INVENTORY_ITEMS[rem.itemId] : undefined;
    const powderGained = rem.itemId ? computeDismantleYield(rem.itemId, rem.removed) : 0;
    const added = addItemToInventory(rem.inventory, STONE_POWDER_ITEM_ID, powderGained);
    ps.inventory = added.inventory;
    ps.lastEconomyActionAt = now;

    events.push(
      makeEvent(
        "sunny.itemDismantled",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          slotIndex,
          itemId: rem.itemId ?? "",
          itemName: spec?.name ?? "",
          quantity: rem.removed,
          powderGained: added.added,
          persistProfile: true
        },
        now,
        "private",
        ps.playerId
      )
    );
  } else if (action.type === "smeltStone") {
    const recipeId = String(action.payload.recipeId);
    const recipe = SMELTING_RECIPES_BY_ID[recipeId]!;
    const qty = Math.floor(Number(action.payload.quantity ?? 1));
    const totalCoins = recipe.coinCost * qty;
    const totalPowder = recipe.powderCost * qty;
    ps.coins = Math.max(0, ps.coins - totalCoins);
    const afterPowder = removeItemFromInventory(normalizeInventory(ps.inventory), STONE_POWDER_ITEM_ID, totalPowder).inventory;
    const added = addItemToInventory(afterPowder, recipe.outputItemId, qty);
    ps.inventory = added.inventory;
    ps.lastEconomyActionAt = now;
    const outSpec = INVENTORY_ITEMS[recipe.outputItemId]!;

    events.push(
      makeEvent(
        "sunny.stoneSmelted",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          recipeId,
          itemId: recipe.outputItemId,
          itemName: outSpec.name,
          tier: recipe.tier,
          quantity: added.added,
          powderSpent: totalPowder,
          coinsSpent: totalCoins,
          coins: ps.coins,
          persistProfile: true
        },
        now,
        "private",
        ps.playerId
      )
    );
  } else if (action.type === "checkpoint") {
    const rawX = Number(action.payload.x);
    const rawY = Number(action.payload.y);
    if (Number.isFinite(rawX) && Number.isFinite(rawY)) {
      const position = clampToStage(ps.stageId, rawX, rawY);
      ps.x = position.x;
      ps.y = position.y;
    }
    events.push(
      makeEvent(
        "sunny.checkpointSaved",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          persistProfile: true
        },
        now,
        "private",
        ps.playerId
      )
    );
  }

  if (
    action.type !== "idleRegen" &&
    action.type !== "checkpoint" &&
    !(action.type === "attackMob" && action.payload.hitKind === "dot")
  ) {
    ps.lastActivityAt = now;
  }
  ps.lastUpdatedAt = now;
  state.playerStates[action.playerId] = ps as unknown as JsonObject;
  return { state, events };
}

export const sunnyMeadowDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(): JsonObject {
    return buildInitialWorldState() as unknown as JsonObject;
  },

  initialPlayerState(player, context): JsonObject {
    return createFreshPlayerState(player, player.seat + 1, context.now, null) as unknown as JsonObject;
  },

  onPlayerJoin(context, player, persistedProfile): ActionResult {
    const state = context.state;
    const world = getWorld(state.stageState);
    reconcileWorldStages(world);
    const respawnEvents = processDueRespawns(world, context.now);
    world.joinCounter = (world.joinCounter ?? 0) + 1;

    const ps = createFreshPlayerState(player, world.joinCounter, context.now, persistedProfile);
    state.playerStates[player.playerId] = ps as unknown as JsonObject;
    world.playerStageMap[player.playerId] = ps.stageId;

    const stageCount = countPlayersInStage(world, ps.stageId);
    const events: GameEvent[] = [
      ...respawnEvents,
      makeEvent(
        "sunny.playerJoined",
        {
          stageId: ps.stageId,
          stagePlayerCount: stageCount,
          player: {
            playerId: ps.playerId,
            displayName: ps.displayName,
            stageId: ps.stageId,
            x: ps.x,
            y: ps.y,
            vx: 0,
            vy: 0,
            facing: ps.facing,
            animState: ps.animState,
            level: ps.level,
            hp: ps.hp,
            maxHp: ps.maxHp,
            equippedWeaponId: ps.equippedWeaponId
          }
        },
        context.now
      )
    ];

    return { state, events };
  },

  onPlayerLeave(context, playerId): ActionResult {
    const state = context.state;
    const world = getWorld(state.stageState);
    const stageId = world.playerStageMap[playerId];
    delete world.playerStageMap[playerId];

    const events: GameEvent[] = stageId
      ? [
          makeEvent(
            "sunny.playerLeft",
            {
              stageId,
              playerId,
              stagePlayerCount: playersInStageIds(world, stageId).length
            },
            context.now
          )
        ]
      : [];
    return { state, events };
  },

  extractPlayerProfile(context, playerId): JsonObject | null {
    const current = getPlayerState(context.state.playerStates, playerId);
    if (!current) return null;
    // Leaving while down does not dodge the penalty: the saved profile is the revived one.
    const ps = { ...current };
    if (ps.dead) {
      // Same outcome as pressing Revive: back at the stage start, not where they fell.
      const world = getWorld(context.state.stageState);
      const spawn = computeSpawnPositionNear(getStageById(ps.stageId), world.joinCounter ?? 0);
      applyRevival(ps);
      ps.x = spawn.x;
      ps.y = spawn.y;
    }
    const profile: PersistedPlayerProfile = {
      level: ps.level,
      xp: ps.xp,
      goldenHeartBonus: ps.goldenHeartBonus,
      hp: ps.hp,
      potions: ps.potions,
      coins: ps.coins,
      score: ps.score,
      mobsDefeated: ps.mobsDefeated,
      unlockedWeapons: [...ps.unlockedWeapons],
      equippedWeaponId: ps.equippedWeaponId,
      inventory: normalizeInventory(ps.inventory),
      weaponUpgrades: normalizeWeaponUpgrades(ps.weaponUpgrades),
      highestStageNumber: ps.highestStageNumber,
      lastStageId: ps.stageId,
      lastX: Math.round(ps.x),
      lastY: Math.round(ps.y),
      savedAt: context.now
    };
    return profile as unknown as JsonObject;
  },

  getBroadcastRecipients(context, event): string[] | undefined {
    const stageId = typeof event.payload.stageId === "string" ? event.payload.stageId : undefined;
    if (!stageId) return undefined;
    const world = getWorld(context.state.stageState);
    return playersInStageIds(world, stageId);
  },

  handleSignal(context, playerId, signal) {
    if (signal.type !== "playerPose") return undefined;
    const world = getWorld(context.state.stageState);
    const repaired = reconcileWorldStages(world);
    const ps = getPlayerState(context.state.playerStates, playerId);
    // A player who is down or in inventory/shop safe mode does not move.
    if (!ps || ps.dead || ps.inMenu) return undefined;

    const rawX = Number(signal.payload.x);
    const rawY = Number(signal.payload.y);
    const rawVx = Number(signal.payload.vx ?? 0);
    const rawVy = Number(signal.payload.vy ?? 0);
    const facing = Number(signal.payload.facing) < 0 ? -1 : 1;
    const anim = signal.payload.animState;
    const animState: WorldPlayerState["animState"] =
      anim === "walk" || anim === "jump" || anim === "climb" || anim === "attack" ? anim : "idle";

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return undefined;
    const prevX = ps.x;
    const prevY = ps.y;
    const { x, y } = clampToStage(ps.stageId, rawX, rawY);
    const vx = Number.isFinite(rawVx) ? Math.max(-600, Math.min(600, Math.round(rawVx))) : 0;
    const vy = Number.isFinite(rawVy) ? Math.max(-900, Math.min(900, Math.round(rawVy))) : 0;
    // The client emits "climb" while hanging still as well as while climbing.
    const activeAnimation = animState !== "idle" && animState !== "climb";
    const movedOrActive =
      activeAnimation || Math.abs(vx) > 8 || Math.abs(vy) > 8 || Math.abs(x - prevX) > 2 || Math.abs(y - prevY) > 2;

    // Update sender position on the cloned state before evaluating nearest-player mob authority
    ps.x = x;
    ps.y = y;

    // Nearest-player mob kinematics sync: accept compact tuples [mobId, x, y, vx, vy, facing]
    // from the player closest to each mob and relay them to all nearby players on the same stage.
    const stageRt = world.stages[ps.stageId];
    const syncedMobs: Array<[string, number, number, number, number, number]> = [];
    let stageMutated = repaired;
    if (stageRt && Array.isArray(signal.payload.mobs)) {
      const incoming = signal.payload.mobs.slice(0, 16);
      for (const entry of incoming) {
        if (!Array.isArray(entry) || entry.length < 6) continue;
        const mobId = typeof entry[0] === "string" ? entry[0] : "";
        const mob = stageRt.mobs[mobId];
        if (!mob || !mob.alive || context.now < mob.spawnProtectUntil) continue;
        if (!canPlayerSyncMob(world, context.state.playerStates, ps.stageId, playerId, mob, context.now)) {
          continue;
        }
        const clamped = clampMobPosition(ps.stageId, mobId, Number(entry[1]), Number(entry[2]));
        if (!clamped) continue;
        const mvx = Number.isFinite(Number(entry[3])) ? Math.max(-700, Math.min(700, Math.round(Number(entry[3])))) : 0;
        const mvy = Number.isFinite(Number(entry[4])) ? Math.max(-900, Math.min(900, Math.round(Number(entry[4])))) : 0;
        const mFacing = Number(entry[5]) < 0 ? -1 : 1;

        mob.x = clamped.x;
        mob.y = clamped.y;
        mob.vx = mvx;
        mob.vy = mvy;
        mob.facing = mFacing;
        mob.stateUpdatedAt = context.now;
        mob.authorityPlayerId = playerId;
        stageMutated = true;
        syncedMobs.push([mobId, clamped.x, clamped.y, mvx, mvy, mFacing]);
      }
    }

    // Spatial interest management: only send pose & mob sync to nearby players on the same stage!
    const nearby = nearbyPlayersOnStage(world, context.state.playerStates, ps.stageId, x, playerId);
    const recipientPlayerIds = nearby.map((p) => p.playerId);

    return {
      recipientPlayerIds,
      type: "sunny.playerPose",
      payload: {
        stageId: ps.stageId,
        playerId,
        displayName: ps.displayName,
        x,
        y,
        vx,
        vy,
        facing,
        animState,
        level: ps.level,
        hp: ps.hp,
        maxHp: ps.maxHp,
        equippedWeaponId: ps.equippedWeaponId,
        ...(syncedMobs.length > 0 ? { mobs: syncedMobs } : {})
      },
      playerStatePatch: {
        x,
        y,
        vx,
        vy,
        facing,
        animState,
        lastUpdatedAt: context.now,
        ...(movedOrActive ? { lastActivityAt: context.now } : {})
      },
      ...(stageMutated ? { stageState: world as unknown as JsonObject } : {})
    };
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    const check = checkAction(context, action);
    // An action that lost a race is accepted and applied as a no-op, so the player
    // gets a fresh snapshot instead of an error message.
    return check.ok || check.stale ? { ok: true } : check;
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const check = checkAction(context, action);
    if (!check.ok) {
      const world = getWorld(context.state.stageState);
      reconcileWorldStages(world);
      const respawnEvents = processDueRespawns(world, context.now);
      return {
        state: context.state,
        events: [
          ...respawnEvents,
          makeEvent("sunny.actionIgnored", { action: action.type, reason: check.code }, context.now, "private", action.playerId)
        ]
      };
    }
    return applyCheckedAction(context, action);
  },

  nextTimers(context: GameContext): TimerIntent[] {
    if (context.state.phase !== "active" || context.state.players.length === 0) {
      return [];
    }
    const world = getWorld(context.state.stageState);
    reconcileWorldStages(world);
    let earliest = Infinity;

    for (const stageRt of Object.values(world.stages)) {
      for (const mob of Object.values(stageRt.mobs)) {
        if (!mob.alive && mob.respawnAt > 0 && mob.respawnAt < earliest) {
          earliest = mob.respawnAt;
        }
      }
      for (const item of Object.values(stageRt.items)) {
        if (!item.available && item.respawnAt > 0 && item.respawnAt < earliest) {
          earliest = item.respawnAt;
        }
      }
    }

    if (!Number.isFinite(earliest)) return [];
    // Run at the due time itself. Pushing it out from "now" on every reschedule
    // (the host reschedules after each action) starved respawns in a busy room.
    const runAt = earliest;
    return [
      {
        id: `sunny-respawn:${Math.floor(runAt / 250)}`,
        kind: "turn_timeout",
        runAt,
        payload: { reason: "respawn_tick" }
      }
    ];
  },

  applyTimer(context: GameContext): ActionResult {
    const state = context.state;
    const now = context.now;
    const world = getWorld(state.stageState);
    reconcileWorldStages(world);
    const events = processDueRespawns(world, now);
    return { state, events };
  },

  getPublicView(context: GameContext, viewerPlayerId?: string): JsonObject {
    const world = getWorld(context.state.stageState);
    reconcileWorldStages(world);
    const viewerPs = viewerPlayerId
      ? getPlayerState(context.state.playerStates, viewerPlayerId)
      : undefined;
    const stageId = viewerPs?.stageId ?? "stage-1";
    const stageRt = world.stages[stageId] ?? world.stages["stage-1"]!;
    const originX = viewerPs?.x ?? 200;

    const nearbyPlayers = nearbyPlayersOnStage(
      world,
      context.state.playerStates,
      stageId,
      originX,
      viewerPlayerId
    );

    const stagePlayerCounts: Record<string, number> = {};
    for (const sid of Object.values(world.playerStageMap)) {
      stagePlayerCounts[sid] = (stagePlayerCounts[sid] ?? 0) + 1;
    }

    return {
      stageId,
      totalPlayersOnline: context.state.players.length,
      stagePlayerCount: stagePlayerCounts[stageId] ?? 0,
      stagePlayerCounts,
      // Only what a client draws (including synced mob kinematics). Who damaged or was paid stays on the server.
      mobs: Object.fromEntries(
        Object.entries(stageRt.mobs).map(([id, mob]) => {
          const activeStatuses = mob.statuses
            ? Object.entries(mob.statuses)
                .filter(([, exp]) => typeof exp === "number" && exp > context.now)
                .map(([k]) => k)
            : [];
          return [
            id,
            {
              alive: mob.alive,
              hp: mob.hp,
              maxHp: mob.maxHp,
              inCombat: mob.inCombat,
              spawnProtectUntil: mob.spawnProtectUntil,
              ...(typeof mob.x === "number" && typeof mob.y === "number"
                ? {
                    x: mob.x,
                    y: mob.y,
                    vx: mob.vx ?? 0,
                    vy: mob.vy ?? 0,
                    facing: mob.facing ?? -1
                  }
                : {}),
              ...(activeStatuses.length > 0 ? { statuses: activeStatuses } : {})
            }
          ];
        })
      ),
      items: Object.fromEntries(Object.entries(stageRt.items).map(([id, item]) => [id, { available: item.available }])),
      nearbyPlayers
    } as unknown as JsonObject;
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    const ps = getPlayerState(context.state.playerStates, playerId);
    if (!ps) return {};
    return {
      ...ps,
      baseDex: ps.baseDex ?? computePlayerBaseDex(ps.level),
      inventory: normalizeInventory(ps.inventory),
      weaponUpgrades: normalizeWeaponUpgrades(ps.weaponUpgrades)
    } as unknown as JsonObject;
  }
});

export const sunnyMeadowGamePlugin: ServerGamePlugin = {
  gameMetadata,
  gameDefinition: sunnyMeadowDefinition
};
