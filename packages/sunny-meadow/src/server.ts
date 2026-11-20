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
  ITEM_CATALOG,
  MOB_CATALOG,
  PLAYER_CONFIG,
  WEAPON_CATALOG,
  WEAPON_ORDER
} from "./catalogs";
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
  SunnyMeadowWorldState,
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

function buildInitialWorldState(): SunnyMeadowWorldState {
  const stages: Record<string, ServerStageRuntime> = {};
  for (const stage of ALL_STAGES) {
    const mobs: Record<string, ServerMobState> = {};
    for (const mobId of stage.layers.mobSpawns.allIds) {
      const spawn = stage.layers.mobSpawns.byId[mobId]!;
      const tpl = MOB_CATALOG[spawn.templateId]!;
      mobs[mobId] = {
        id: mobId,
        templateId: spawn.templateId,
        alive: true,
        hp: tpl.hp,
        maxHp: tpl.hp,
        inCombat: false,
        respawnAt: 0,
        spawnProtectUntil: 0,
        lastHitAt: 0,
        contributors: {},
        defeatedAt: 0,
        rewardedPlayers: []
      };
    }
    const items: Record<string, ServerItemState> = {};
    for (const itemId of stage.layers.itemSpawns.allIds) {
      const spawn = stage.layers.itemSpawns.byId[itemId]!;
      items[itemId] = {
        id: itemId,
        templateId: spawn.templateId,
        available: true,
        respawnAt: 0,
        collectedAt: 0,
        collectedBy: []
      };
    }
    stages[stage.meta.id] = { stageId: stage.meta.id, mobs, items };
  }
  return { stages, playerStageMap: {}, joinCounter: 0 };
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
    goldenHeartBonus,
    potions: typeof saved?.potions === "number" ? Math.max(0, Math.floor(saved.potions)) : PLAYER_CONFIG.startingPotions,
    coins: typeof saved?.coins === "number" ? Math.max(0, Math.floor(saved.coins)) : 0,
    score: typeof saved?.score === "number" ? Math.max(0, Math.floor(saved.score)) : 0,
    mobsDefeated: typeof saved?.mobsDefeated === "number" ? Math.max(0, Math.floor(saved.mobsDefeated)) : 0,
    unlockedWeapons,
    equippedWeaponId,
    highestStageNumber,
    lastUpdatedAt: now
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
          equippedWeaponId: ps.equippedWeaponId
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

/** Reviving costs the experience earned toward the next level and every coin held. */
export function deathPenaltyOf(ps: Pick<WorldPlayerState, "xp" | "coins">): DeathPenalty {
  return { lostXp: Math.max(0, ps.xp), lostCoins: Math.max(0, ps.coins) };
}

/** Pays the death penalty and stands the player back up at 60% health. */
function applyRevival(ps: WorldPlayerState): void {
  ps.xp = 0;
  ps.coins = 0;
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
  const stageRt = world.stages[ps.stageId];
  if (!stageRt) return { ok: false, code: "invalid_action", message: "Unknown player stage" };

  if (action.type === "revive") {
    return ps.dead ? { ok: true } : { ok: false, code: "not_dead", message: "Player is not down", stale: true };
  }
  if (ps.dead) {
    return { ok: false, code: "player_dead", message: "Player is down", stale: true };
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
      return { ok: true };
    }
    case "collectItem": {
      const itemId = typeof action.payload.itemId === "string" ? action.payload.itemId : "";
      const item = stageRt.items[itemId];
      if (!item) return { ok: false, code: "item_not_here", message: "Unknown item", stale: true };
      const tpl = ITEM_CATALOG[item.templateId];
      if (!tpl) return { ok: false, code: "invalid_action", message: "Unknown item template" };
      if (tpl.category !== "weapon" && !item.available) {
        // Cooperative simultaneous item pickup grace window:
        // Allow another player who touched the item nearly simultaneously to also claim it!
        const collectedAt = item.collectedAt ?? 0;
        const collectedBy = item.collectedBy ?? [];
        const withinGrace = collectedAt > 0 && context.now - collectedAt <= ITEM_COOP_GRACE_MS;
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
  const ps = getPlayerState(state.playerStates, action.playerId)!;
  const stageRt = world.stages[ps.stageId]!;
  const events: GameEvent[] = [];

  if (action.type === "attackMob") {
    const mobId = String(action.payload.mobId);
    const mob = stageRt.mobs[mobId]!;
    const mobTpl = MOB_CATALOG[mob.templateId]!;
    const weapon = WEAPON_CATALOG[ps.equippedWeaponId] ?? WEAPON_CATALOG.wooden_sword!;
    const clientHitId = typeof action.payload.clientHitId === "string" ? action.payload.clientHitId : undefined;

    // Deterministic hit roll shared with client prediction
    const roll =
      typeof action.payload.damageRoll === "number" && Number.isFinite(action.payload.damageRoll)
        ? action.payload.damageRoll
        : ((now + ps.score + mob.hp * 17) % 100) / 100;
    const totalAtk = ps.baseAtk + weapon.atk;
    const { damage, isCrit } = computeDeterministicHit(totalAtk, weapon.critChance, weapon.critMult, roll);
    const knockDir = Number(action.payload.knockDir) < 0 ? -1 : 1;

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
            ...(recipientId === ps.playerId && clientHitId ? { clientHitId } : {}),
            persistPlayerIds: [recipient.playerId]
          },
          now
        )
      );

      if (lvlResult.levelsGained > 0) {
        recipient.maxHp = computePlayerMaxHp(recipient.level, recipient.goldenHeartBonus);
        recipient.baseAtk = computePlayerBaseAtk(recipient.level);
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

      events.push(
        makeEvent(
          "sunny.mobHit",
          {
            stageId: ps.stageId,
            mobId,
            attackerId: ps.playerId,
            damage,
            isCrit,
            knockDir,
            knockbackX: weapon.knockbackX,
            knockbackY: weapon.knockbackY,
            hp: mob.hp,
            maxHp: mob.maxHp,
            ...(clientHitId ? { clientHitId } : {})
          },
          now
        )
      );

      if (mob.hp <= 0) {
        mob.alive = false;
        mob.inCombat = false;
        mob.defeatedAt = now;

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
  } else if (action.type === "switchWeapon") {
    ps.equippedWeaponId = String(action.payload.weaponId);
    events.push(
      makeEvent(
        "sunny.weaponChanged",
        {
          stageId: ps.stageId,
          playerId: ps.playerId,
          weaponId: ps.equippedWeaponId,
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
    world.joinCounter = (world.joinCounter ?? 0) + 1;

    const ps = createFreshPlayerState(player, world.joinCounter, context.now, persistedProfile);
    state.playerStates[player.playerId] = ps as unknown as JsonObject;
    world.playerStageMap[player.playerId] = ps.stageId;

    const stageCount = countPlayersInStage(world, ps.stageId);
    const events: GameEvent[] = [
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
    if (ps.dead) applyRevival(ps);
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
    const ps = getPlayerState(context.state.playerStates, playerId);
    // A player who is down does not move.
    if (!ps || ps.dead) return undefined;

    const rawX = Number(signal.payload.x);
    const rawY = Number(signal.payload.y);
    const rawVx = Number(signal.payload.vx ?? 0);
    const rawVy = Number(signal.payload.vy ?? 0);
    const facing = Number(signal.payload.facing) < 0 ? -1 : 1;
    const anim = signal.payload.animState;
    const animState: WorldPlayerState["animState"] =
      anim === "walk" || anim === "jump" || anim === "climb" || anim === "attack" ? anim : "idle";

    if (!Number.isFinite(rawX) || !Number.isFinite(rawY)) return undefined;
    const { x, y } = clampToStage(ps.stageId, rawX, rawY);
    const vx = Number.isFinite(rawVx) ? Math.max(-600, Math.min(600, Math.round(rawVx))) : 0;
    const vy = Number.isFinite(rawVy) ? Math.max(-900, Math.min(900, Math.round(rawVy))) : 0;

    // Spatial interest management: only send pose to nearby players on the same stage!
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
        equippedWeaponId: ps.equippedWeaponId
      },
      playerStatePatch: {
        x,
        y,
        vx,
        vy,
        facing,
        animState,
        lastUpdatedAt: context.now
      }
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
      return {
        state: context.state,
        events: [makeEvent("sunny.actionIgnored", { action: action.type, reason: check.code }, context.now, "private", action.playerId)]
      };
    }
    return applyCheckedAction(context, action);
  },

  nextTimers(context: GameContext): TimerIntent[] {
    if (context.state.phase !== "active" || context.state.players.length === 0) {
      return [];
    }
    const world = getWorld(context.state.stageState);
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
    const events: GameEvent[] = [];

    for (const stageRt of Object.values(world.stages)) {
      const respawnedMobs: Array<{ id: string; hp: number; maxHp: number; spawnProtectUntil: number }> = [];
      const respawnedItems: string[] = [];

      for (const mob of Object.values(stageRt.mobs)) {
        if (!mob.alive && mob.respawnAt > 0 && mob.respawnAt <= now) {
          mob.alive = true;
          mob.hp = mob.maxHp;
          mob.inCombat = false;
          mob.respawnAt = 0;
          mob.contributors = {};
          mob.defeatedAt = 0;
          mob.rewardedPlayers = [];
          // 2-second blinking spawn protection: cannot attack or be damaged!
          mob.spawnProtectUntil = now + SPAWN_PROTECTION_MS;
          respawnedMobs.push({
            id: mob.id,
            hp: mob.hp,
            maxHp: mob.maxHp,
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

    return { state, events };
  },

  getPublicView(context: GameContext, viewerPlayerId?: string): JsonObject {
    const world = getWorld(context.state.stageState);
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
      // Only what a client draws. Who damaged or was paid for a mob stays on the server.
      mobs: Object.fromEntries(
        Object.entries(stageRt.mobs).map(([id, mob]) => [
          id,
          { alive: mob.alive, hp: mob.hp, maxHp: mob.maxHp, inCombat: mob.inCombat, spawnProtectUntil: mob.spawnProtectUntil }
        ])
      ),
      items: Object.fromEntries(Object.entries(stageRt.items).map(([id, item]) => [id, { available: item.available }])),
      nearbyPlayers
    } as unknown as JsonObject;
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    const ps = getPlayerState(context.state.playerStates, playerId);
    if (!ps) return {};
    return { ...ps } as unknown as JsonObject;
  }
});

export const sunnyMeadowGamePlugin: ServerGamePlugin = {
  gameMetadata,
  gameDefinition: sunnyMeadowDefinition
};
