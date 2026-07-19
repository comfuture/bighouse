import type {
  ActionResult,
  BotDifficulty,
  BotGameContext,
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
import { baseGameMetadata } from "./metadata";
import {
  carveAndSettleTerrain,
  clamp,
  generateTerrain,
  hashSeed,
  itemStats,
  nextRandom,
  particleSplashDamage,
  simulateTrajectory,
  spawnXForSeat,
  tankFacing,
  terrainHeightAt,
  windFromState,
  type TrajectoryResult
} from "./physics";
import {
  MAX_HEALTH,
  TERRAIN_STEP,
  TURN_MS,
  WORLD_HEIGHT,
  WORLD_WIDTH,
  type BotAimHistoryEntry,
  type LastShot,
  type PendingShotResolution,
  type ShotDamage,
  type TankBattlePlayerState,
  type TankBattleStageState,
  type TankItem,
  type TankItemSelection,
  type TankItems,
  type TankState
} from "./types";

const playerColors = ["#49b6ff", "#ff6b5f"] as const;
const validItems = new Set<TankItem>(["megaBlast", "warhead", "scope"]);

export const gameMetadata = baseGameMetadata;

export const tankBattleDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context): JsonObject {
    const seedValue = typeof context.room.config.seed === "string" ? context.room.config.seed : String(context.room.config.seed ?? "bighouse");
    const playerKey = context.players.map((player) => `${player.seat}:${player.playerId}`).join("|");
    const terrainSeed = hashSeed(`${seedValue}:${context.now}:${playerKey}`) || 1;
    const terrain = generateTerrain(terrainSeed);
    const randomWind = windFromState(terrainSeed);
    const tanks = context.players.map((player) => createTank(player, terrain));
    const currentPlayerId = context.players[0]?.playerId;
    return {
      worldWidth: WORLD_WIDTH,
      worldHeight: WORLD_HEIGHT,
      terrainStep: TERRAIN_STEP,
      terrainSeed,
      rngState: randomWind.state,
      terrain,
      gravity: 58,
      wind: randomWind.wind,
      tanks,
      botAimHistory: {},
      turnPhase: "aiming",
      turnNumber: 1,
      ...(currentPlayerId ? { currentPlayerId, turnDeadline: context.now + TURN_MS } : {})
    } satisfies TankBattleStageState as unknown as JsonObject;
  },

  initialPlayerState(player: PlayerSeat): JsonObject {
    return {
      seat: player.seat,
      color: playerColors[player.seat] ?? "#fbbf24",
      items: initialItems()
    } satisfies TankBattlePlayerState as unknown as JsonObject;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    if (action.type !== "fire") {
      return { ok: false, code: "invalid_action", message: "Unsupported tank battle action" };
    }
    if (context.state.phase !== "active") {
      return { ok: false, code: "invalid_action", message: "Tank battle is not active" };
    }
    const stage = tankBattleStage(context.state.stageState);
    if (stage.winnerPlayerId || stage.result) {
      return { ok: false, code: "invalid_action", message: "Tank battle is already finished" };
    }
    if (stage.turnPhase !== "aiming") {
      return { ok: false, code: "shot_resolving", message: "The previous shot is still resolving" };
    }
    const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
    if (action.playerId !== currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    const tank = stage.tanks.find((candidate) => candidate.playerId === action.playerId);
    if (!tank || tank.health <= 0) {
      return { ok: false, code: "invalid_action", message: "Player has no active tank" };
    }
    const parsed = parseFirePayload(action.payload);
    if (!parsed.ok) return parsed;
    if (parsed.item !== "none") {
      const playerState = tankBattlePlayer(context.state.playerStates[action.playerId]);
      if ((playerState.items[parsed.item] ?? 0) <= 0) {
        return { ok: false, code: "invalid_action", message: "Selected item is not available" };
      }
    }
    return { ok: true };
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const parsed = parseFirePayload(action.payload);
    if (!parsed.ok) {
      throw new Error("Tank battle fire payload must be validated before applying");
    }
    const state = context.state;
    const stage = tankBattleStage(state.stageState);
    const shooter = stage.tanks.find((tank) => tank.playerId === action.playerId);
    if (!shooter) {
      throw new Error("Tank battle shooter must exist before applying");
    }
    const playerState = tankBattlePlayer(state.playerStates[action.playerId]);
    if (parsed.item !== "none") {
      playerState.items[parsed.item] -= 1;
      state.playerStates[action.playerId] = playerState as unknown as JsonObject;
    }

    const facing = tankFacing(shooter);
    const firedWind = stage.wind;
    const trajectory = simulateTrajectory({
      start: { x: shooter.x + facing * 19, y: shooter.y - 20 },
      facing,
      angle: parsed.angle,
      power: parsed.power,
      gravity: stage.gravity,
      wind: firedWind,
      terrain: stage.terrain,
      tanks: stage.tanks,
      shooterPlayerId: action.playerId,
      worldWidth: stage.worldWidth,
      worldHeight: stage.worldHeight,
      terrainStep: stage.terrainStep
    });
    const stats = itemStats(parsed.item);
    const damage: ShotDamage[] = [];
    const debrisSeed = hashSeed(`${stage.terrainSeed}:${stage.turnNumber}:${action.playerId}`);
    let resolvedTerrain = stage.terrain;
    const resolvedTanks = stage.tanks.map((tank) => ({ ...tank }));

    if (trajectory.impact) {
      resolvedTerrain = carveAndSettleTerrain(
        stage.terrain,
        trajectory.impact,
        stats.explosionRadius,
        stage.worldHeight,
        stage.terrainStep
      );
      for (const tank of resolvedTanks) {
        const blastDistance = Math.hypot(trajectory.impact.x - tank.x, trajectory.impact.y - (tank.y - 8));
        const damageBudget = Math.min(stats.maxDamage, tank.health);
        const rawDirectHitDamage = trajectory.directHitPlayerId === tank.playerId ? stats.maxDamage : 0;
        const directHitDamage = Math.min(rawDirectHitDamage, damageBudget);
        const rawBlastDamage = directHitDamage > 0
          ? 0
          : Math.max(0, Math.round(stats.maxDamage * (1 - blastDistance / stats.explosionRadius)));
        const blastDamage = Math.min(rawBlastDamage, Math.max(0, damageBudget - directHitDamage));
        const particle = !trajectory.directHitPlayerId && blastDamage === 0
          ? particleSplashDamage({
              impact: trajectory.impact,
              target: tank,
              explosionRadius: stats.explosionRadius,
              splashRadius: stats.particleSplashRadius,
              maxParticleDamage: stats.maxParticleDamage,
              seed: debrisSeed
            })
          : {
              damage: 0,
              fragmentHits: 0,
              distance: Math.round(blastDistance * 100) / 100,
              splashRadius: stats.particleSplashRadius
            };
        const particleDamage = Math.min(particle.damage, Math.max(0, damageBudget - directHitDamage - blastDamage));
        const oldY = tank.y;
        const nextY = terrainHeightAt(resolvedTerrain, tank.x, stage.terrainStep) - 10;
        const fallDistance = Math.max(0, nextY - oldY);
        const rawFallDamage = fallDistance > 52 ? Math.min(28, Math.round((fallDistance - 52) * 0.42)) : 0;
        const impactDamage = directHitDamage + blastDamage + particleDamage;
        const fallDamage = Math.min(rawFallDamage, Math.max(0, damageBudget - impactDamage));
        const totalDamage = impactDamage + fallDamage;
        tank.y = Math.round(nextY * 100) / 100;
        if (totalDamage > 0) {
          tank.health = Math.max(0, tank.health - totalDamage);
          damage.push({
            playerId: tank.playerId,
            directHitDamage,
            blastDamage,
            particleDamage,
            particleHits: particle.fragmentHits,
            particleSplashRadius: particle.splashRadius,
            impactDistance: particle.distance,
            fallDamage,
            totalDamage,
            remainingHealth: tank.health
          });
        }
      }
    }

    const lastShot: LastShot = {
      id: stage.turnNumber,
      resolved: false,
      shooterPlayerId: action.playerId,
      angle: parsed.angle,
      power: parsed.power,
      item: parsed.item,
      wind: firedWind,
      trajectory: trajectory.trajectory,
      result: trajectory.result,
      explosionRadius: trajectory.impact ? stats.explosionRadius : 0,
      maxDamage: trajectory.impact ? stats.maxDamage : 0,
      damage: [],
      debrisSeed,
      replayDurationMs: trajectory.impact
        ? Math.min(4_200, Math.max(1_900, 1_150 + trajectory.trajectory.length * 14))
        : Math.min(3_200, Math.max(1_100, 780 + trajectory.trajectory.length * 12)),
      ...(trajectory.impact ? { impact: trajectory.impact } : {}),
      ...(trajectory.directHitPlayerId ? { directHitPlayerId: trajectory.directHitPlayerId } : {})
    };
    stage.lastShot = lastShot;
    const botAimUpdate = createBotAimUpdate(stage, state.players, action.playerId, parsed.angle, parsed.power, trajectory);
    stage.pendingResolution = {
      terrain: resolvedTerrain,
      tanks: resolvedTanks,
      damage,
      ...(botAimUpdate ? { botAimUpdate } : {})
    } satisfies PendingShotResolution;
    beginShotResolution(stage, state.players, action.playerId, context.now, lastShot.replayDurationMs);

    const events: GameEvent[] = [
      event("tankBattle.shotFired", "public", {
        playerId: action.playerId,
        angle: parsed.angle,
        power: parsed.power,
        item: parsed.item,
        wind: firedWind
      }, context.now)
    ];
    if (parsed.item !== "none") {
      events.push(event("tankBattle.itemUsed", "public", {
        playerId: action.playerId,
        item: parsed.item,
        remaining: playerState.items[parsed.item]
      }, context.now));
    }

    state.stageState = stage as unknown as JsonObject;
    return { state, events };
  },

  applyTimer(context: GameContext, timer: TimerIntent): ActionResult {
    const state = context.state;
    const stage = tankBattleStage(state.stageState);
    const reason = typeof timer.payload?.reason === "string" ? timer.payload.reason : undefined;
    if (
      timer.kind === "turn_timeout" &&
      reason === "shot_resolution" &&
      state.phase === "active" &&
      stage.turnPhase === "resolving" &&
      stage.resolutionDeadline &&
      context.now >= stage.resolutionDeadline &&
      timer.payload?.turnNumber === stage.turnNumber
    ) {
      const previousPlayerId = stage.currentPlayerId;
      if (!stage.pendingResolution) {
        // Rooms that were already resolving when this version was deployed
        // have applied their terrain and damage eagerly and do not contain the
        // new pending payload. Let their existing alarm finish the old turn.
        if (stage.lastShot) {
          stage.lastShot = { ...stage.lastShot, resolved: true };
        }
        finishShotResolution(stage, context.now);
        state.stageState = stage as unknown as JsonObject;
        return {
          state,
          events: [event("tankBattle.turnChanged", "public", {
            previousPlayerId,
            currentPlayerId: stage.currentPlayerId,
            wind: stage.wind
          }, context.now)]
        };
      }
      const pending = stage.pendingResolution;
      stage.terrain = pending.terrain;
      stage.tanks = pending.tanks;
      if (pending.botAimUpdate) {
        stage.botAimHistory = {
          ...(stage.botAimHistory ?? {}),
          [pending.botAimUpdate.playerId]: pending.botAimUpdate.history
        };
      }
      if (stage.lastShot) {
        stage.lastShot = {
          ...stage.lastShot,
          resolved: true,
          damage: pending.damage
        };
      }
      delete stage.pendingResolution;

      const events: GameEvent[] = [];
      if (stage.lastShot) {
        events.push(event("tankBattle.shotResolved", "public", stage.lastShot as unknown as JsonObject, context.now));
        if (stage.lastShot.impact) {
          events.push(event("tankBattle.terrainChanged", "public", {
            impact: stage.lastShot.impact,
            explosionRadius: stage.lastShot.explosionRadius,
            debrisSeed: stage.lastShot.debrisSeed
          }, context.now));
        }
      }
      for (const entry of pending.damage) {
        events.push(event("tankBattle.tankDamaged", "public", entry as unknown as JsonObject, context.now));
      }

      const livingTanks = stage.tanks.filter((tank) => tank.health > 0);
      if (stage.tanks.length >= 2 && livingTanks.length <= 1) {
        delete stage.turnDeadline;
        delete stage.resolutionDeadline;
        delete stage.pendingNextPlayerId;
        state.phase = "finished";
        if (livingTanks[0]) {
          stage.winnerPlayerId = livingTanks[0].playerId;
          stage.result = "win";
          events.push(event("tankBattle.gameWon", "system", { winnerPlayerId: livingTanks[0].playerId }, context.now));
        } else {
          stage.result = "draw";
          events.push(event("tankBattle.gameDrawn", "system", { reason: "mutual_destruction" }, context.now));
        }
      } else {
        finishShotResolution(stage, context.now);
        events.push(event("tankBattle.turnChanged", "public", {
          previousPlayerId,
          currentPlayerId: stage.currentPlayerId,
          wind: stage.wind
        }, context.now));
      }
      state.stageState = stage as unknown as JsonObject;
      return { state, events };
    }
    const timedPlayerId = typeof timer.payload?.playerId === "string" ? timer.payload.playerId : undefined;
    if (
      timer.kind !== "turn_timeout" ||
      state.phase !== "active" ||
      !stage.turnDeadline ||
      context.now < stage.turnDeadline ||
      !stage.currentPlayerId ||
      timedPlayerId !== stage.currentPlayerId ||
      timer.payload?.turnNumber !== stage.turnNumber ||
      stage.result
    ) {
      return { state, events: [] };
    }
    const skippedPlayerId = stage.currentPlayerId;
    advanceTurn(stage, state.players, skippedPlayerId, context.now);
    state.stageState = stage as unknown as JsonObject;
    return {
      state,
      events: [event("tankBattle.turnTimedOut", "system", {
        playerId: skippedPlayerId,
        nextPlayerId: stage.currentPlayerId
      }, context.now)]
    };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = tankBattleStage(context.state.stageState);
    return {
      worldWidth: stage.worldWidth,
      worldHeight: stage.worldHeight,
      terrainStep: stage.terrainStep,
      terrain: stage.terrain,
      gravity: stage.gravity,
      wind: stage.wind,
      players: context.state.players.map((player) => {
        const tank = stage.tanks.find((candidate) => candidate.playerId === player.playerId);
        const privateState = tankBattlePlayer(context.state.playerStates[player.playerId]);
        return {
          ...(tank ?? createTank(player, stage.terrain)),
          displayName: player.displayName ?? player.playerId,
          itemCounts: { ...privateState.items }
        };
      }),
      turnPhase: stage.turnPhase,
      currentPlayerId: stage.currentPlayerId ?? context.state.players[0]?.playerId,
      turnNumber: stage.turnNumber,
      turnDeadline: stage.turnDeadline,
      ...(stage.winnerPlayerId ? { winnerPlayerId: stage.winnerPlayerId } : {}),
      ...(stage.result ? { result: stage.result } : {}),
      ...(stage.lastShot ? { lastShot: stage.lastShot } : {})
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return tankBattlePlayer(context.state.playerStates[playerId]) as unknown as JsonObject;
  },

  nextTimers(context: GameContext): TimerIntent[] {
    const stage = tankBattleStage(context.state.stageState);
    if (context.state.phase === "active" && stage.turnPhase === "resolving" && stage.resolutionDeadline) {
      return [{
        id: "tank-battle-shot-resolution",
        kind: "turn_timeout",
        runAt: stage.resolutionDeadline,
        payload: { reason: "shot_resolution", turnNumber: stage.turnNumber }
      }];
    }
    if (context.state.phase !== "active" || !stage.turnDeadline || !stage.currentPlayerId || stage.result) {
      return [];
    }
    return [{
      id: "tank-battle-turn-timeout",
      kind: "turn_timeout",
      runAt: stage.turnDeadline,
      payload: { playerId: stage.currentPlayerId, turnNumber: stage.turnNumber }
    }];
  },

  selectBotAction(context: BotGameContext): GameAction | null {
    return selectTankBattleBotAction(context);
  }
});

export const tankBattleGamePlugin = {
  gameMetadata,
  gameDefinition: tankBattleDefinition
} satisfies ServerGamePlugin;

function createTank(player: PlayerSeat, terrain: number[]): TankState {
  const x = spawnXForSeat(player.seat);
  return {
    playerId: player.playerId,
    displayName: player.displayName ?? player.playerId,
    seat: player.seat,
    color: playerColors[player.seat] ?? "#fbbf24",
    x,
    y: Math.round((terrainHeightAt(terrain, x) - 10) * 100) / 100,
    health: MAX_HEALTH,
    maxHealth: MAX_HEALTH
  };
}

function initialItems(): TankItems {
  return { megaBlast: 2, warhead: 2, scope: 2 };
}

export function tankBattleStage(value: JsonObject): TankBattleStageState {
  const stage = value as unknown as Partial<TankBattleStageState>;
  return {
    worldWidth: stage.worldWidth ?? WORLD_WIDTH,
    worldHeight: stage.worldHeight ?? WORLD_HEIGHT,
    terrainStep: stage.terrainStep ?? TERRAIN_STEP,
    terrainSeed: stage.terrainSeed ?? 1,
    rngState: stage.rngState ?? 1,
    terrain: stage.terrain ?? generateTerrain(1),
    gravity: stage.gravity ?? 58,
    wind: stage.wind ?? 0,
    tanks: stage.tanks ?? [],
    botAimHistory: stage.botAimHistory ?? {},
    turnPhase: stage.turnPhase ?? "aiming",
    turnNumber: stage.turnNumber ?? 1,
    ...(stage.currentPlayerId ? { currentPlayerId: stage.currentPlayerId } : {}),
    ...(stage.pendingNextPlayerId ? { pendingNextPlayerId: stage.pendingNextPlayerId } : {}),
    ...(stage.turnDeadline ? { turnDeadline: stage.turnDeadline } : {}),
    ...(stage.resolutionDeadline ? { resolutionDeadline: stage.resolutionDeadline } : {}),
    ...(stage.pendingResolution ? { pendingResolution: stage.pendingResolution } : {}),
    ...(stage.winnerPlayerId ? { winnerPlayerId: stage.winnerPlayerId } : {}),
    ...(stage.result ? { result: stage.result } : {}),
    ...(stage.lastShot ? { lastShot: stage.lastShot } : {})
  };
}

function tankBattlePlayer(value: JsonObject | undefined): TankBattlePlayerState {
  const player = value as unknown as Partial<TankBattlePlayerState> | undefined;
  const items = player?.items as Partial<TankItems> | undefined;
  return {
    seat: player?.seat ?? -1,
    color: player?.color ?? "#fbbf24",
    items: {
      megaBlast: items?.megaBlast ?? 0,
      warhead: items?.warhead ?? 0,
      scope: items?.scope ?? 0
    }
  };
}

type ParsedFire =
  | { ok: true; angle: number; power: number; item: TankItemSelection }
  | { ok: false; code: string; message: string };

function parseFirePayload(payload: JsonObject): ParsedFire {
  if (typeof payload.angle !== "number" || !Number.isFinite(payload.angle) || payload.angle < 10 || payload.angle > 80) {
    return { ok: false, code: "invalid_action", message: "angle must be between 10 and 80 degrees" };
  }
  if (typeof payload.power !== "number" || !Number.isFinite(payload.power) || payload.power < 10 || payload.power > 100) {
    return { ok: false, code: "invalid_action", message: "power must be between 10 and 100" };
  }
  const rawItem = payload.item ?? "none";
  if (rawItem !== "none" && (typeof rawItem !== "string" || !validItems.has(rawItem as TankItem))) {
    return { ok: false, code: "invalid_action", message: "item is not supported" };
  }
  return {
    ok: true,
    angle: Math.round(payload.angle * 10) / 10,
    power: Math.round(payload.power * 10) / 10,
    item: rawItem as TankItemSelection
  };
}

function advanceTurn(stage: TankBattleStageState, players: PlayerSeat[], currentPlayerId: string, now: number): void {
  const livingIds = new Set(stage.tanks.filter((tank) => tank.health > 0).map((tank) => tank.playerId));
  const currentIndex = players.findIndex((player) => player.playerId === currentPlayerId);
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = players[(Math.max(0, currentIndex) + offset) % players.length];
    if (candidate && livingIds.has(candidate.playerId)) {
      stage.currentPlayerId = candidate.playerId;
      break;
    }
  }
  stage.turnNumber += 1;
  const randomWind = windFromState(stage.rngState);
  stage.rngState = randomWind.state;
  stage.wind = randomWind.wind;
  stage.turnPhase = "aiming";
  stage.turnDeadline = now + TURN_MS;
}

function beginShotResolution(
  stage: TankBattleStageState,
  players: PlayerSeat[],
  currentPlayerId: string,
  now: number,
  replayDurationMs: number
): void {
  const livingIds = new Set(stage.tanks.filter((tank) => tank.health > 0).map((tank) => tank.playerId));
  const currentIndex = players.findIndex((player) => player.playerId === currentPlayerId);
  for (let offset = 1; offset <= players.length; offset += 1) {
    const candidate = players[(Math.max(0, currentIndex) + offset) % players.length];
    if (candidate && livingIds.has(candidate.playerId)) {
      stage.pendingNextPlayerId = candidate.playerId;
      break;
    }
  }
  stage.turnPhase = "resolving";
  delete stage.turnDeadline;
  stage.resolutionDeadline = now + replayDurationMs;
}

function finishShotResolution(stage: TankBattleStageState, now: number): void {
  if (stage.pendingNextPlayerId) {
    stage.currentPlayerId = stage.pendingNextPlayerId;
  }
  delete stage.pendingNextPlayerId;
  delete stage.resolutionDeadline;
  stage.turnNumber += 1;
  const randomWind = windFromState(stage.rngState);
  stage.rngState = randomWind.state;
  stage.wind = randomWind.wind;
  stage.turnPhase = "aiming";
  stage.turnDeadline = now + TURN_MS;
}

function event(type: string, visibility: "public" | "private" | "system", payload: JsonObject, now: number): GameEvent {
  return { id: createGameEventId(), type, visibility, payload, createdAt: now };
}

function createBotAimUpdate(
  stage: TankBattleStageState,
  players: PlayerSeat[],
  shooterPlayerId: string,
  angle: number,
  power: number,
  trajectory: TrajectoryResult
): PendingShotResolution["botAimUpdate"] {
  const player = players.find((candidate) => candidate.playerId === shooterPlayerId);
  const shooter = stage.tanks.find((tank) => tank.playerId === shooterPlayerId);
  const target = stage.tanks.find((tank) => tank.playerId !== shooterPlayerId && tank.health > 0);
  const finalPoint = trajectory.impact ?? trajectory.trajectory[trajectory.trajectory.length - 1];
  if (player?.kind !== "bot" || !shooter || !target || !finalPoint) return undefined;

  const facing = tankFacing(shooter);
  const signedHorizontalError = Math.round((finalPoint.x - target.x) * facing * 10) / 10;
  const missDistance = Math.round(Math.hypot(finalPoint.x - target.x, finalPoint.y - (target.y - 8)) * 10) / 10;
  const previous = stage.botAimHistory?.[shooterPlayerId];
  const hit = trajectory.directHitPlayerId === target.playerId;
  const history: BotAimHistoryEntry = {
    targetPlayerId: target.playerId,
    shots: (previous?.shots ?? 0) + 1,
    outcome: hit ? "hit" : signedHorizontalError < 0 ? "undershoot" : "overshoot",
    signedHorizontalError: hit ? 0 : signedHorizontalError,
    missDistance: hit ? 0 : missDistance,
    angle,
    power
  };
  return { playerId: shooterPlayerId, history };
}

type BotAimProfile = {
  windAwareness: number;
  distanceError: [number, number];
  angleError: [number, number];
  powerError: [number, number];
  historyGain: number;
  historyCap: number;
  angles: number[];
  powers: number[];
};

const botAimProfiles: Record<BotDifficulty, BotAimProfile> = {
  low: {
    windAwareness: 0.05,
    distanceError: [75, 165],
    angleError: [6, 13],
    powerError: [5, 11],
    historyGain: 0.012,
    historyCap: 4,
    angles: [24, 36, 48, 60, 72],
    powers: [22, 34, 46, 58, 70, 82, 94]
  },
  medium: {
    windAwareness: 0.46,
    distanceError: [32, 78],
    angleError: [2.5, 6],
    powerError: [2.5, 6.5],
    historyGain: 0.026,
    historyCap: 7,
    angles: [20, 28, 36, 44, 52, 60, 68, 76],
    powers: [20, 28, 36, 44, 52, 60, 68, 76, 84, 92, 100]
  },
  high: {
    windAwareness: 0.82,
    distanceError: [12, 34],
    angleError: [0.8, 2.6],
    powerError: [1.2, 3.8],
    historyGain: 0.042,
    historyCap: 9,
    angles: [18, 23, 28, 33, 38, 43, 48, 53, 58, 63, 68, 73, 78],
    powers: [18, 24, 30, 36, 42, 48, 54, 60, 66, 72, 78, 84, 90, 96]
  }
};

function selectTankBattleBotAction(context: BotGameContext): GameAction | null {
  const stage = tankBattleStage(context.state.stageState);
  const shooter = stage.tanks.find((tank) => tank.playerId === context.player.playerId);
  const target = stage.tanks.find((tank) => tank.playerId !== context.player.playerId && tank.health > 0);
  if (
    !shooter ||
    !target ||
    stage.currentPlayerId !== shooter.playerId ||
    stage.turnPhase !== "aiming" ||
    context.state.phase !== "active" ||
    stage.result
  ) {
    return null;
  }
  const facing = tankFacing(shooter);
  const profile = botAimProfiles[context.difficulty];
  const noiseSeed = hashSeed(`${stage.terrainSeed}:${stage.turnNumber}:${shooter.playerId}:${context.difficulty}:aim`);
  const distanceError = stableSignedBotNoise(noiseSeed, "distance", profile.distanceError);
  const estimatedTarget = {
    x: target.x + facing * distanceError,
    y: target.y - 8
  };
  const modeledWind = stage.wind * profile.windAwareness;
  const perceivedWind = Math.abs(modeledWind) < 1 ? 0 : modeledWind;
  let best: { angle: number; power: number; score: number } | undefined;
  for (const angle of profile.angles) {
    for (const power of profile.powers) {
      const result = simulateTrajectory({
        start: { x: shooter.x + facing * 19, y: shooter.y - 20 },
        facing,
        angle,
        power,
        gravity: stage.gravity,
        wind: perceivedWind,
        terrain: stage.terrain,
        tanks: stage.tanks,
        shooterPlayerId: shooter.playerId
      });
      const finalPoint = result.impact ?? result.trajectory[result.trajectory.length - 1];
      if (!finalPoint) continue;
      const score = Math.hypot(finalPoint.x - estimatedTarget.x, finalPoint.y - estimatedTarget.y);
      if (!best || score < best.score) best = { angle, power, score };
    }
  }
  if (!best) return null;
  const history = stage.botAimHistory?.[shooter.playerId];
  const historyCorrection = history?.targetPlayerId === target.playerId && history.outcome !== "hit"
    ? clamp(-history.signedHorizontalError * profile.historyGain, -profile.historyCap, profile.historyCap)
    : 0;
  const angleNoise = stableSignedBotNoise(noiseSeed, "angle", profile.angleError);
  const powerNoise = stableSignedBotNoise(noiseSeed, "power", profile.powerError);
  return {
    type: "fire",
    payload: {
      angle: Math.round(clamp(best.angle + angleNoise, 10, 80) * 10) / 10,
      power: Math.round(clamp(best.power + powerNoise + historyCorrection, 10, 100) * 10) / 10,
      item: "none"
    }
  };
}

function stableSignedBotNoise(seed: number, label: string, range: [number, number]): number {
  const random = nextRandom(hashSeed(`${seed}:${label}`)).value;
  const sign = random < 0.5 ? -1 : 1;
  const normalized = random < 0.5 ? random * 2 : (random - 0.5) * 2;
  return sign * (range[0] + (range[1] - range[0]) * normalized);
}
