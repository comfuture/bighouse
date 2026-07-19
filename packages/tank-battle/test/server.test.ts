import { cloneState, type ClientGameAction, type RoomState } from "@bighouse/game-sdk/server";
import { describe, expect, it } from "vitest";
import { carveAndSettleTerrain, generateTerrain, simulateTrajectory, tankFacing, terrainHeightAt } from "../src/physics";
import { tankBattleDefinition, tankBattleStage } from "../src/server";
import { TERRAIN_STEP, WORLD_HEIGHT, WORLD_WIDTH, type TankBattlePlayerState, type TankBattleStageState } from "../src/types";

function baseState(): RoomState {
  return {
    room: {
      roomId: "room_tank_unit",
      gameId: "tank-battle",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: { seed: "fixed-test-seed" },
      createdAt: 1,
      hostPlayerId: "p1"
    },
    phase: "active",
    version: 2,
    players: [
      { playerId: "p1", displayName: "Alpha", seat: 0, connected: true, ready: true, joinedAt: 1 },
      { playerId: "p2", displayName: "Bravo", seat: 1, connected: true, ready: true, joinedAt: 1 }
    ],
    stageState: {},
    playerStates: {},
    updatedAt: 1
  };
}

function startedState(now = 100): RoomState {
  const state = baseState();
  state.stageState = tankBattleDefinition.initialStageState({ room: state.room, players: state.players, now });
  for (const player of state.players) {
    state.playerStates[player.playerId] = tankBattleDefinition.initialPlayerState(player, { room: state.room, now });
  }
  return state;
}

function action(playerId = "p1", payload: Record<string, unknown> = { angle: 45, power: 55, item: "none" }): ClientGameAction {
  return {
    playerId,
    clientActionId: `shot-${playerId}`,
    expectedVersion: 2,
    type: "fire",
    payload
  };
}

function flatTerrainShotState(targetOffsetFromImpact: number): RoomState {
  const state = startedState();
  const stage = tankBattleStage(state.stageState);
  stage.terrain = Array.from({ length: WORLD_WIDTH / TERRAIN_STEP + 1 }, () => 540);
  stage.wind = 0;
  stage.tanks[0] = { ...stage.tanks[0]!, x: 200, y: 530 };
  const shooter = stage.tanks[0]!;
  const facing = tankFacing(shooter);
  const preview = simulateTrajectory({
    start: { x: shooter.x + facing * 19, y: shooter.y - 20 },
    facing,
    angle: 45,
    power: 25,
    gravity: stage.gravity,
    wind: stage.wind,
    terrain: stage.terrain,
    tanks: [shooter],
    shooterPlayerId: shooter.playerId
  });
  if (!preview.impact) throw new Error("flat terrain test shot must impact");
  stage.tanks[1] = { ...stage.tanks[1]!, x: preview.impact.x + targetOffsetFromImpact, y: 530 };
  state.stageState = stage as unknown as Record<string, unknown>;
  return state;
}

function botState(wind: number): RoomState {
  const state = startedState();
  state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "medium" };
  const stage = tankBattleStage(state.stageState);
  stage.terrainSeed = 246_810;
  stage.terrain = Array.from({ length: WORLD_WIDTH / TERRAIN_STEP + 1 }, () => 540);
  stage.wind = wind;
  stage.tanks[0] = { ...stage.tanks[0]!, x: 180, y: 530 };
  stage.tanks[1] = { ...stage.tanks[1]!, x: 800, y: 530 };
  state.stageState = stage as unknown as Record<string, unknown>;
  return state;
}

function selectBotPayload(state: RoomState, difficulty: "low" | "medium" | "high"): { angle: number; power: number; item: string } {
  const selected = tankBattleDefinition.selectBotAction!({
    state,
    now: 500,
    player: state.players[0]!,
    difficulty
  });
  if (!selected) throw new Error("bot test state must produce an action");
  return selected.payload as { angle: number; power: number; item: string };
}

describe("tank battle setup and visibility", () => {
  it("creates deterministic random terrain, wind, tanks, and private items", () => {
    const first = startedState();
    const second = startedState();
    const stage = tankBattleStage(first.stageState);

    expect(first.stageState).toEqual(second.stageState);
    expect(stage.terrain).toHaveLength(WORLD_WIDTH / TERRAIN_STEP + 1);
    expect(stage.wind).toBeGreaterThanOrEqual(-12);
    expect(stage.wind).toBeLessThanOrEqual(12);
    expect(stage.tanks).toHaveLength(2);
    expect(stage.tanks[0]!.x).toBeLessThan(stage.tanks[1]!.x);
    expect(stage.tanks[0]!.y).toBeCloseTo(terrainHeightAt(stage.terrain, stage.tanks[0]!.x) - 10, 2);
    expect(first.playerStates.p1).toMatchObject({ items: { megaBlast: 2, warhead: 2, scope: 2 } });
  });

  it("handles the empty pre-game initialization used by RoomDO", () => {
    const state = baseState();
    const stage = tankBattleStage(tankBattleDefinition.initialStageState({ room: state.room, players: [], now: 100 }));
    expect(stage.tanks).toEqual([]);
    expect(stage.currentPlayerId).toBeUndefined();
    expect(stage.terrain.length).toBeGreaterThan(100);
  });

  it("exposes the battlefield and item counts without leaking internal rng state", () => {
    const state = startedState();
    const publicView = tankBattleDefinition.getPublicView({ state, now: 100 });
    const privateView = tankBattleDefinition.getPrivateView({ state, now: 100 }, "p1");
    expect(publicView).toMatchObject({
      currentPlayerId: "p1",
      gravity: 58,
      players: [{ playerId: "p1", displayName: "Alpha" }, { playerId: "p2", displayName: "Bravo" }]
    });
    expect(JSON.stringify(publicView)).not.toContain("rngState");
    expect(privateView).toMatchObject({ seat: 0, items: { megaBlast: 2, warhead: 2, scope: 2 } });
    expect(privateView).not.toHaveProperty("p2");
  });
});

describe("tank battle validation and transitions", () => {
  it("accepts a valid shot without mutating during validation", () => {
    const state = startedState();
    const before = cloneState(state);
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, action())).toEqual({ ok: true });
    expect(state).toEqual(before);
  });

  it("rejects unsupported actions, invalid turns, non-finite values, bounds, and unavailable items", () => {
    const state = startedState();
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, { ...action(), type: "move" })).toMatchObject({
      ok: false,
      code: "invalid_action"
    });
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, action("p2"))).toMatchObject({ ok: false, code: "invalid_turn" });
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, action("p1", { angle: Number.NaN, power: 50 }))).toMatchObject({
      ok: false,
      code: "invalid_action"
    });
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, action("p1", { angle: 81, power: 50 }))).toMatchObject({
      ok: false,
      code: "invalid_action"
    });
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, action("p1", { angle: 45, power: 101 }))).toMatchObject({
      ok: false,
      code: "invalid_action"
    });
    (state.playerStates.p1 as unknown as TankBattlePlayerState).items.scope = 0;
    expect(tankBattleDefinition.validateAction({ state, now: 200 }, action("p1", { angle: 45, power: 50, item: "scope" }))).toMatchObject({
      ok: false,
      code: "invalid_action"
    });
  });

  it("keeps authoritative terrain and tank state unchanged until the replay timer resolves the shot", () => {
    const state = startedState();
    const beforeStage = tankBattleStage(state.stageState);
    const terrainBefore = [...beforeStage.terrain];
    const tanksBefore = beforeStage.tanks.map((tank) => ({ ...tank }));
    const result = tankBattleDefinition.applyAction({ state: cloneState(state), now: 300 }, action("p1", { angle: 48, power: 52, item: "scope" }));
    const stage = tankBattleStage(result.state.stageState);
    const player = result.state.playerStates.p1 as unknown as TankBattlePlayerState;

    expect(stage.currentPlayerId).toBe("p1");
    expect(stage.turnPhase).toBe("resolving");
    expect(stage.turnNumber).toBe(1);
    expect(stage.lastShot).toMatchObject({ resolved: false, shooterPlayerId: "p1", angle: 48, power: 52, item: "scope", damage: [] });
    expect(stage.lastShot!.trajectory.length).toBeGreaterThan(2);
    expect(stage.terrain).toEqual(terrainBefore);
    expect(stage.tanks).toEqual(tanksBefore);
    expect(stage.pendingResolution).toBeDefined();
    expect(player.items.scope).toBe(1);
    expect(result.events.map((entry) => [entry.type, entry.visibility])).toEqual(expect.arrayContaining([
      ["tankBattle.shotFired", "public"],
      ["tankBattle.itemUsed", "public"]
    ]));
    expect(result.events.map((entry) => entry.type)).not.toEqual(expect.arrayContaining([
      "tankBattle.shotResolved",
      "tankBattle.terrainChanged",
      "tankBattle.tankDamaged",
      "tankBattle.gameWon"
    ]));
    expect(result.events.find((entry) => entry.type === "tankBattle.itemUsed")?.payload).toMatchObject({ playerId: "p1", item: "scope" });
    expect(tankBattleDefinition.getPublicView({ state: result.state, now: 301 })).not.toHaveProperty("pendingResolution");
    expect(tankBattleDefinition.validateAction({ state: result.state, now: 301 }, action())).toMatchObject({
      ok: false,
      code: "shot_resolving"
    });

    const deadline = stage.resolutionDeadline!;
    const staleState = cloneState(result.state);
    const staleSnapshot = cloneState(staleState);
    const stale = tankBattleDefinition.applyTimer!({ state: staleState, now: deadline }, {
      id: "stale-resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 0 }
    });
    expect(stale.events).toEqual([]);
    expect(stale.state).toEqual(staleSnapshot);

    const earlyState = cloneState(result.state);
    const earlySnapshot = cloneState(earlyState);
    const early = tankBattleDefinition.applyTimer!({ state: earlyState, now: deadline - 1 }, {
      id: "early-resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    expect(early.events).toEqual([]);
    expect(early.state).toEqual(earlySnapshot);

    const advanced = tankBattleDefinition.applyTimer!({ state: result.state, now: deadline }, {
      id: "resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    const nextStage = tankBattleStage(advanced.state.stageState);
    expect(nextStage.currentPlayerId).toBe("p2");
    expect(nextStage.turnPhase).toBe("aiming");
    expect(nextStage.turnNumber).toBe(2);
    expect(nextStage.lastShot).toMatchObject({ resolved: true });
    expect(nextStage.pendingResolution).toBeUndefined();
    expect(advanced.events.map((entry) => entry.type)).toEqual(expect.arrayContaining([
      "tankBattle.shotResolved",
      "tankBattle.turnChanged"
    ]));
  });

  it("finishes a legacy in-flight shot that predates pending resolution state", () => {
    const fired = tankBattleDefinition.applyAction(
      { state: startedState(), now: 350 },
      action("p1", { angle: 42, power: 50, item: "none" })
    );
    const legacyStage = tankBattleStage(fired.state.stageState);
    const pending = legacyStage.pendingResolution!;
    legacyStage.terrain = pending.terrain;
    legacyStage.tanks = pending.tanks;
    legacyStage.lastShot!.damage = pending.damage;
    delete (legacyStage.lastShot as unknown as { resolved?: boolean }).resolved;
    delete legacyStage.pendingResolution;
    fired.state.stageState = legacyStage as unknown as Record<string, unknown>;

    const deadline = legacyStage.resolutionDeadline!;
    const advanced = tankBattleDefinition.applyTimer!({ state: fired.state, now: deadline }, {
      id: "legacy-resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    const nextStage = tankBattleStage(advanced.state.stageState);

    expect(nextStage.turnPhase).toBe("aiming");
    expect(nextStage.currentPlayerId).toBe("p2");
    expect(nextStage.turnNumber).toBe(2);
    expect(nextStage.lastShot?.resolved).toBe(true);
    expect(advanced.events.map((entry) => entry.type)).toEqual(["tankBattle.turnChanged"]);
  });

  it("delays lethal damage, terrain destruction, and the finished result until the replay timer", () => {
    const state = startedState();
    const stage = tankBattleStage(state.stageState);
    stage.terrain = Array.from({ length: WORLD_WIDTH / TERRAIN_STEP + 1 }, () => 540);
    stage.wind = 0;
    stage.tanks[0] = { ...stage.tanks[0]!, x: 200, y: 530 };
    stage.tanks[1] = { ...stage.tanks[1]!, x: 260, y: 530, health: 50 };
    state.stageState = stage as unknown as Record<string, unknown>;
    const terrainBefore = [...stage.terrain];
    const tanksBefore = stage.tanks.map((tank) => ({ ...tank }));

    const fired = tankBattleDefinition.applyAction(
      { state, now: 400 },
      action("p1", { angle: 10, power: 10, item: "warhead" })
    );
    const resolving = tankBattleStage(fired.state.stageState);
    expect(fired.state.phase).toBe("active");
    expect(resolving.turnPhase).toBe("resolving");
    expect(resolving.terrain).toEqual(terrainBefore);
    expect(resolving.tanks).toEqual(tanksBefore);
    expect(resolving.lastShot).toMatchObject({ resolved: false, damage: [] });
    expect(resolving.winnerPlayerId).toBeUndefined();
    expect(resolving.result).toBeUndefined();
    expect(fired.events.map((entry) => entry.type)).not.toEqual(expect.arrayContaining([
      "tankBattle.terrainChanged",
      "tankBattle.tankDamaged",
      "tankBattle.gameWon"
    ]));

    const deadline = resolving.resolutionDeadline!;
    const result = tankBattleDefinition.applyTimer!({ state: fired.state, now: deadline }, {
      id: "lethal-resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    const finished = tankBattleStage(result.state.stageState);
    expect(result.state.phase).toBe("finished");
    expect(finished.terrain).not.toEqual(terrainBefore);
    expect(finished.tanks.find((tank) => tank.playerId === "p2")?.health).toBe(0);
    expect(finished.lastShot?.resolved).toBe(true);
    expect(finished.lastShot?.damage).toContainEqual(expect.objectContaining({ playerId: "p2", remainingHealth: 0 }));
    const lethalDamage = finished.lastShot!.damage.find((entry) => entry.playerId === "p2")!;
    expect(lethalDamage).toMatchObject({
      directHitDamage: 50,
      blastDamage: 0,
      particleDamage: 0,
      fallDamage: 0,
      totalDamage: 50
    });
    expect(lethalDamage.totalDamage).toBe(
      lethalDamage.directHitDamage + lethalDamage.blastDamage + lethalDamage.particleDamage + lethalDamage.fallDamage
    );
    expect(finished.winnerPlayerId).toBe("p1");
    expect(finished.result).toBe("win");
    expect(finished.turnDeadline).toBeUndefined();
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "tankBattle.gameWon",
      visibility: "system",
      payload: { winnerPlayerId: "p1" }
    }));
    expect(result.events.map((entry) => entry.type)).toEqual(expect.arrayContaining([
      "tankBattle.shotResolved",
      "tankBattle.terrainChanged",
      "tankBattle.tankDamaged",
      "tankBattle.gameWon"
    ]));
    expect(tankBattleDefinition.validateAction({ state: result.state, now: deadline + 1 }, action())).toMatchObject({ ok: false, code: "invalid_action" });
  });

  it("applies deterministic terrain-fragment splash outside the blast radius only after resolution", () => {
    const state = flatTerrainShotState(60);
    const beforeHealth = tankBattleStage(state.stageState).tanks[1]!.health;
    const fired = tankBattleDefinition.applyAction(
      { state, now: 600 },
      action("p1", { angle: 45, power: 25, item: "none" })
    );
    const resolving = tankBattleStage(fired.state.stageState);
    const pendingDamage = resolving.pendingResolution!.damage.find((entry) => entry.playerId === "p2")!;

    expect(resolving.tanks[1]!.health).toBe(beforeHealth);
    expect(resolving.lastShot?.damage).toEqual([]);
    expect(pendingDamage).toMatchObject({
      directHitDamage: 0,
      blastDamage: 0,
      fallDamage: 0,
      particleSplashRadius: 102
    });
    expect(pendingDamage.impactDistance).toBeGreaterThan(44);
    expect(pendingDamage.particleDamage).toBeGreaterThan(0);
    expect(pendingDamage.particleHits).toBeGreaterThan(0);
    expect(pendingDamage.totalDamage).toBe(pendingDamage.particleDamage);
    const repeated = tankBattleDefinition.applyAction(
      { state: flatTerrainShotState(60), now: 600 },
      action("p1", { angle: 45, power: 25, item: "none" })
    );
    expect(tankBattleStage(repeated.state.stageState).pendingResolution!.damage.find((entry) => entry.playerId === "p2"))
      .toEqual(pendingDamage);

    const deadline = resolving.resolutionDeadline!;
    const resolved = tankBattleDefinition.applyTimer!({ state: fired.state, now: deadline }, {
      id: "particle-resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    const resolvedStage = tankBattleStage(resolved.state.stageState);
    expect(resolvedStage.tanks[1]!.health).toBe(beforeHealth - pendingDamage.totalDamage);
    expect(resolvedStage.lastShot?.damage).toContainEqual(pendingDamage);
  });

  it("does not apply fragment splash beyond the particle radius", () => {
    const state = flatTerrainShotState(150);
    const fired = tankBattleDefinition.applyAction(
      { state, now: 700 },
      action("p1", { angle: 45, power: 25, item: "none" })
    );
    const resolving = tankBattleStage(fired.state.stageState);
    expect(resolving.pendingResolution!.damage.find((entry) => entry.playerId === "p2")).toBeUndefined();
    expect(resolving.pendingResolution!.tanks[1]!.health).toBe(100);
  });

  it("advances the turn only for the current, due timeout", () => {
    const state = startedState(100);
    const stale = tankBattleDefinition.applyTimer!({ state: cloneState(state), now: 1_000 }, {
      id: "timeout",
      kind: "turn_timeout",
      runAt: 1_000,
      payload: { playerId: "p2" }
    });
    expect(stale.events).toEqual([]);

    const dueAt = tankBattleStage(state.stageState).turnDeadline!;
    const due = tankBattleDefinition.applyTimer!({ state: cloneState(state), now: dueAt }, {
      id: "timeout",
      kind: "turn_timeout",
      runAt: dueAt,
      payload: { playerId: "p1", turnNumber: 1 }
    });
    expect(tankBattleStage(due.state.stageState).currentPlayerId).toBe("p2");
    expect(due.events[0]).toMatchObject({ type: "tankBattle.turnTimedOut", visibility: "system" });
    expect(tankBattleDefinition.nextTimers({ state: due.state, now: dueAt })).toHaveLength(1);
  });
});

describe("tank battle bot aiming", () => {
  it("uses difficulty-specific deterministic estimation and mostly ignores wind on low", () => {
    const calm = botState(0);
    const strongWind = botState(12);
    const lowCalm = selectBotPayload(cloneState(calm), "low");
    const lowWind = selectBotPayload(cloneState(strongWind), "low");
    const medium = selectBotPayload(cloneState(strongWind), "medium");
    const high = selectBotPayload(cloneState(strongWind), "high");

    expect(lowWind).toEqual(lowCalm);
    expect(new Set([lowWind, medium, high].map((payload) => `${payload.angle}:${payload.power}`)).size).toBe(3);
    expect(selectBotPayload(cloneState(strongWind), "high")).toEqual(high);
  });

  it("corrects the next power from signed undershoot and overshoot history", () => {
    const withoutHistory = botState(6);
    const withHistory = cloneState(withoutHistory);
    const stage = tankBattleStage(withHistory.stageState);
    stage.botAimHistory = {
      p1: {
        targetPlayerId: "p2",
        shots: 1,
        outcome: "undershoot",
        signedHorizontalError: -180,
        missDistance: 190,
        angle: 44,
        power: 52
      }
    };
    withHistory.stageState = stage as unknown as Record<string, unknown>;

    const baseline = selectBotPayload(withoutHistory, "medium");
    const corrected = selectBotPayload(withHistory, "medium");
    expect(corrected.angle).toBe(baseline.angle);
    expect(corrected.power).toBeGreaterThan(baseline.power);

    const withOvershoot = cloneState(withoutHistory);
    const overshootStage = tankBattleStage(withOvershoot.stageState);
    overshootStage.botAimHistory = {
      p1: {
        ...stage.botAimHistory.p1!,
        outcome: "overshoot",
        signedHorizontalError: 180
      }
    };
    withOvershoot.stageState = overshootStage as unknown as Record<string, unknown>;
    const reduced = selectBotPayload(withOvershoot, "medium");
    expect(reduced.angle).toBe(baseline.angle);
    expect(reduced.power).toBeLessThan(baseline.power);
  });

  it("records bot trial results after resolution without exposing aim history publicly", () => {
    const state = botState(4);
    const fired = tankBattleDefinition.applyAction(
      { state, now: 800 },
      action("p1", { angle: 42, power: 48, item: "none" })
    );
    const resolving = tankBattleStage(fired.state.stageState);
    expect(resolving.botAimHistory?.p1).toBeUndefined();
    expect(resolving.pendingResolution?.botAimUpdate).toMatchObject({ playerId: "p1" });
    expect(JSON.stringify(tankBattleDefinition.getPublicView({ state: fired.state, now: 801 }))).not.toContain("botAim");

    const deadline = resolving.resolutionDeadline!;
    const resolved = tankBattleDefinition.applyTimer!({ state: fired.state, now: deadline }, {
      id: "bot-history-resolution",
      kind: "turn_timeout",
      runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    const resolvedStage = tankBattleStage(resolved.state.stageState);
    expect(resolvedStage.botAimHistory?.p1).toMatchObject({ targetPlayerId: "p2", shots: 1, angle: 42, power: 48 });
    expect(["hit", "undershoot", "overshoot"]).toContain(resolvedStage.botAimHistory?.p1?.outcome);
    expect(JSON.stringify(tankBattleDefinition.getPublicView({ state: resolved.state, now: deadline }))).not.toContain("botAim");
  });
});

describe("tank battle deterministic physics", () => {
  it("generates repeatable terrain and a crater that settles downward", () => {
    expect(generateTerrain(1234)).toEqual(generateTerrain(1234));
    expect(generateTerrain(1234)).not.toEqual(generateTerrain(5678));
    const flat = Array.from({ length: WORLD_WIDTH / TERRAIN_STEP + 1 }, () => 420);
    const crater = carveAndSettleTerrain(flat, { x: 500, y: 420 }, 68);
    expect(terrainHeightAt(crater, 500)).toBeGreaterThan(terrainHeightAt(flat, 500));
    expect(Math.max(...crater)).toBeLessThan(WORLD_HEIGHT);
  });

  it("applies gravity and wind to a fixed-step server trajectory", () => {
    const terrain = Array.from({ length: WORLD_WIDTH / TERRAIN_STEP + 1 }, () => 540);
    const calm = simulateTrajectory({
      start: { x: 100, y: 500 },
      facing: 1,
      angle: 45,
      power: 50,
      gravity: 58,
      wind: 0,
      terrain,
      tanks: [],
      shooterPlayerId: "p1"
    });
    const windy = simulateTrajectory({
      start: { x: 100, y: 500 },
      facing: 1,
      angle: 45,
      power: 50,
      gravity: 58,
      wind: 10,
      terrain,
      tanks: [],
      shooterPlayerId: "p1"
    });
    expect(calm.result).toBe("impact");
    expect(windy.result).toBe("impact");
    expect(windy.impact!.x).toBeGreaterThan(calm.impact!.x);
  });
});
