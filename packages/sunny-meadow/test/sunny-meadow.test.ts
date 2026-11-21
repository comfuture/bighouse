import { describe, expect, it } from "vitest";
import {
  computeIdleRegenAmount,
  isActiveMobAi,
  ITEM_CATALOG,
  LEGGED_SPRITE_CONFIG,
  MOB_ALERT_TELEGRAPH_SEC,
  MOB_CATALOG,
  PLAYER_CONFIG,
  STATUS_METADATA,
  stepIdleRegen,
  VIEWPORT,
  WALK_CYCLE_FRAMES,
  WEAPON_CATALOG,
  WEAPON_ORDER
} from "../src/catalogs";
import { compileStageForRuntime, validateNormalizedStage } from "../src/map-schema";
import { findPlatformAtLadderTop, stepOnLadder, updateMovingPlatforms } from "../src/physics";
import {
  applyExperienceGain,
  computeEffectiveXp,
  computeItemRespawnMs,
  computeMobRespawnMs,
  computePlayerBaseAtk,
  computePlayerMaxHp,
  computeSpawnPositionNear,
  SPAWN_PROTECTION_MS,
  SPAWN_SPREAD_TILES,
  xpRequiredForLevel
} from "../src/progression";
import { sunnyMeadowDefinition, deathPenaltyOf } from "../src/server";
import { ALL_STAGES, getStageById } from "../src/stages/index";
import type { RoomState } from "@bighouse/game-sdk/server";

describe("@bighouse/sunny-meadow stages, progression, respawn & scale", () => {
  it("validates all 10 expanding multi-biome stages with hazards, special terrain, isolated portal chambers, and 100% reachability", () => {
    expect(ALL_STAGES).toHaveLength(10);

    const expectedScreens = [10, 11, 12, 13, 14, 15, 16, 17, 18, 20];
    const themeIds = new Set<string>();
    const allHazardKinds = new Set<string>();
    const allSurfaces = new Set<string>();

    for (let i = 0; i < ALL_STAGES.length; i++) {
      const stage = ALL_STAGES[i]!;
      const screens = stage.meta.widthTiles / stage.meta.screenWidthTiles;
      expect(screens, `${stage.meta.id} screen count`).toBe(expectedScreens[i]);
      expect(stage.meta.widthTiles).toBe(expectedScreens[i]! * 20);
      themeIds.add(stage.meta.themeId);

      // Every stage has environmental hazards & an isolated warp portal chamber
      expect(stage.layers.hazards.allIds.length, `${stage.meta.id} hazards`).toBeGreaterThan(0);
      for (const hid of stage.layers.hazards.allIds) {
        allHazardKinds.add(stage.layers.hazards.byId[hid]!.kind);
      }
      for (const pid of stage.layers.platforms.allIds) {
        const surf = stage.layers.platforms.byId[pid]!.surface;
        if (surf) allSurfaces.add(surf);
      }

      // Isolated portal chamber exists and is linked via bidirectional warp portal
      expect(stage.links.portalPairs.length, `${stage.meta.id} portal pairs`).toBeGreaterThanOrEqual(1);
      const isoFloor = stage.layers.platforms.byId[`s${i + 1}_iso_floor`];
      expect(isoFloor, `${stage.meta.id} isolated chamber floor`).toBeDefined();

      // Verify 100% reachability via physics + ladders + bouncy pads + portals
      const report = validateNormalizedStage(stage);
      expect(report.errors, `${stage.meta.id} errors`).toEqual([]);
      expect(report.warnings, `${stage.meta.id} warnings`).toEqual([]);
      expect(report.valid, `${stage.meta.id} valid`).toBe(true);
    }

    // All 10 stages have distinct biome themes
    expect(themeIds.size).toBe(10);
    // Tall vertical stages exist (Stages 4, 6, 8, 10)
    expect(getStageById("stage-4").meta.heightTiles).toBeGreaterThanOrEqual(26);
    expect(getStageById("stage-8").meta.heightTiles).toBeGreaterThanOrEqual(28);
    expect(getStageById("stage-10").meta.heightTiles).toBeGreaterThanOrEqual(30);
    // All 4 hazard kinds & all 4 special surface types appear across stages
    expect(allHazardKinds).toEqual(new Set(["water", "spikes", "lava", "poison"]));
    expect(allSurfaces.has("bouncy")).toBe(true);
    expect(allSurfaces.has("ice")).toBe(true);
    expect(allSurfaces.has("conveyor_right")).toBe(true);
    expect(allSurfaces.has("conveyor_left")).toBe(true);
    expect(allSurfaces.has("mud")).toBe(true);
    // Higher stages pack significantly more mobs to support exponential XP progression
    expect(getStageById("stage-10").layers.mobSpawns.allIds.length).toBeGreaterThan(
      getStageById("stage-1").layers.mobSpawns.allIds.length * 2
    );
  });

  it("redistributes Stage 1 mobs to higher stages and escalates monster diversity through Stage 10", () => {
    const mobsIn = (stageId: string) => {
      const st = getStageById(stageId);
      return new Set(st.layers.mobSpawns.allIds.map((id) => st.layers.mobSpawns.byId[id]!.templateId));
    };

    const s1 = mobsIn("stage-1");
    expect(s1.has("red_mushroom")).toBe(true);
    expect(s1.has("yellow_hamster")).toBe(true);
    // Moved out of Stage 1 into Stages 2, 3, and 4
    expect(s1.has("blue_rabbit")).toBe(false);
    expect(s1.has("purple_snake")).toBe(false);
    expect(s1.has("king_mushroom")).toBe(false);

    expect(mobsIn("stage-2").has("blue_rabbit")).toBe(true);
    expect(mobsIn("stage-2").has("emerald_frog")).toBe(true);
    expect(mobsIn("stage-3").has("purple_snake")).toBe(true);
    expect(mobsIn("stage-3").has("orange_fox")).toBe(true);
    expect(mobsIn("stage-4").has("king_mushroom")).toBe(true);
    expect(mobsIn("stage-4").has("sky_owl")).toBe(true);
    expect(mobsIn("stage-10").has("indigo_wisp")).toBe(true);
    expect(mobsIn("stage-10").has("starlight_dragon")).toBe(true);

    // Average mob HP & EXP strictly escalate from Stage 1 to Stage 10
    const avgHp = (stageId: string) => {
      const ids = [...mobsIn(stageId)];
      return ids.reduce((s, id) => s + MOB_CATALOG[id]!.hp, 0) / ids.length;
    };
    expect(avgHp("stage-1")).toBeLessThan(avgHp("stage-3"));
    expect(avgHp("stage-3")).toBeLessThan(avgHp("stage-6"));
    expect(avgHp("stage-6")).toBeLessThan(avgHp("stage-10"));
  });

  it("disperses newly joined players within +/-2 tiles around the stage spawn point", () => {
    const stage1 = getStageById("stage-1");
    const ts = VIEWPORT.tileSize;
    const centerX = (stage1.spawn.x + 0.5) * ts;
    const xs = new Set<number>();

    for (let i = 1; i <= 200; i++) {
      const pos = computeSpawnPositionNear(stage1, i);
      const actorCenter = pos.x + 14;
      expect(Math.abs(actorCenter - centerX)).toBeLessThanOrEqual(SPAWN_SPREAD_TILES * ts + 2);
      xs.add(pos.x);
    }
    // Should spread across many distinct positions rather than stacking everyone on 1 pixel
    expect(xs.size).toBeGreaterThan(50);
  });

  it("enforces exponential XP growth, stat scaling, and diminishing XP returns in lower stages", () => {
    const lv1 = xpRequiredForLevel(1);
    const lv5 = xpRequiredForLevel(5);
    const lv10 = xpRequiredForLevel(10);
    const lv20 = xpRequiredForLevel(20);
    expect(lv5).toBeGreaterThan(lv1 * 3);
    expect(lv10).toBeGreaterThan(lv5 * 5);
    expect(lv20).toBeGreaterThan(lv10 * 25);

    expect(computePlayerMaxHp(10)).toBeGreaterThan(computePlayerMaxHp(1));
    expect(computePlayerBaseAtk(10)).toBeGreaterThan(computePlayerBaseAtk(1));

    // Level-up rollover across multiple levels
    const res = applyExperienceGain(1, 0, 300);
    expect(res.level).toBe(3);
    expect(res.levelsGained).toBe(2);

    // Stage 1 Red Mushroom (Lv 1) gives full XP to Lv 1 player, but only 5% to Lv 10 player
    const freshXp = computeEffectiveXp(1, MOB_CATALOG.red_mushroom!.level, MOB_CATALOG.red_mushroom!.exp);
    const highLvXp = computeEffectiveXp(10, MOB_CATALOG.red_mushroom!.level, MOB_CATALOG.red_mushroom!.exp);
    expect(freshXp.efficiency).toBe(1.0);
    expect(highLvXp.efficiency).toBe(0.05);
    expect(highLvXp.gainedXp).toBeLessThan(freshXp.gainedXp * 0.2);
  });

  it("scales mob and item respawn rates faster as player count in a stage increases", () => {
    const soloMob = computeMobRespawnMs(10, 1, 0.8);
    const tenPlayersMob = computeMobRespawnMs(10, 10, 0.8);
    const hundredPlayersMob = computeMobRespawnMs(10, 100, 0.8);
    expect(tenPlayersMob).toBeLessThan(soloMob * 0.5);
    expect(hundredPlayersMob).toBeLessThan(tenPlayersMob);

    const scarceMob = computeMobRespawnMs(10, 5, 0.2);
    const abundantMob = computeMobRespawnMs(10, 5, 0.9);
    expect(scarceMob).toBeLessThan(abundantMob);

    const soloItem = computeItemRespawnMs(20, 1);
    const crowdItem = computeItemRespawnMs(20, 50);
    expect(crowdItem).toBeLessThan(soloItem * 0.4);
  });

  it("handles 200 concurrent players with spatial interest management and 2s respawn protection", () => {
    const now = 1_700_000_000_000;
    const room = {
      roomId: "room_world_1",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };

    // Join 200 concurrent players into Stage 1
    for (let i = 0; i < 200; i++) {
      const seat = {
        playerId: `p_${i}`,
        displayName: `용사${i}`,
        seat: i,
        connected: true,
        ready: true,
        joinedAt: now + i
      };
      state.players.push(seat);
      const joined = sunnyMeadowDefinition.onPlayerJoin!({ state, now: now + i }, seat, null);
      state = joined.state;
    }

    // Spatial interest management caps visible nearby players per client
    const view = sunnyMeadowDefinition.getPublicView({ state, now }, "p_0") as {
      totalPlayersOnline: number;
      stagePlayerCount: number;
      nearbyPlayers: unknown[];
    };
    expect(view.totalPlayersOnline).toBe(200);
    expect(view.stagePlayerCount).toBe(200);
    expect(view.nearbyPlayers.length).toBeLessThanOrEqual(48);

    // Defeat a mob and respawn it via timer -> verify 2-second spawn protection
    const targetMobId = "s1_mob_1a";
    let t = now + 500;
    for (let hit = 0; hit < 6; hit++) {
      const check = sunnyMeadowDefinition.validateAction({ state, now: t }, {
        playerId: "p_0",
        clientActionId: `atk_${hit}`,
        expectedVersion: state.version,
        type: "attackMob",
        payload: { mobId: targetMobId, knockDir: 1 }
      });
      if (!check.ok) break;
      state = sunnyMeadowDefinition.applyAction({ state, now: t }, {
        playerId: "p_0",
        clientActionId: `atk_${hit}`,
        expectedVersion: state.version,
        type: "attackMob",
        payload: { mobId: targetMobId, knockDir: 1 }
      }).state;
      t += 100;
    }

    const timers = sunnyMeadowDefinition.nextTimers({ state, now: t });
    expect(timers.length).toBe(1);
    const respawnTime = timers[0]!.runAt + 10;
    const tick = sunnyMeadowDefinition.applyTimer!({ state, now: respawnTime }, timers[0]!);
    state = tick.state;
    expect(tick.events.some((e) => e.type === "sunny.mobsRespawned")).toBe(true);

    // During 2-second blink window, attacking MUST be rejected as spawn_protected
    const duringProtectAction = {
      playerId: "p_0",
      clientActionId: "atk_during_blink",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId: targetMobId, knockDir: 1 }
    };
    // Losing a race is not an error: the action is accepted and changes nothing.
    expect(sunnyMeadowDefinition.validateAction({ state, now: respawnTime + 1000 }, duringProtectAction)).toEqual({ ok: true });
    const duringProtect = sunnyMeadowDefinition.applyAction({ state: structuredClone(state), now: respawnTime + 1000 }, duringProtectAction);
    expect(duringProtect.state).toEqual(state);
    expect(duringProtect.events).toEqual([expect.objectContaining({ type: "sunny.actionIgnored", visibility: "private" })]);
    expect(duringProtect.events[0]!.payload).toMatchObject({ action: "attackMob", reason: "spawn_protected" });

    // After 2 seconds, attacking is allowed again
    const afterProtect = sunnyMeadowDefinition.validateAction(
      { state, now: respawnTime + SPAWN_PROTECTION_MS + 50 },
      {
        playerId: "p_0",
        clientActionId: "atk_after_blink",
        expectedVersion: state.version,
        type: "attackMob",
        payload: { mobId: targetMobId, knockDir: 1 }
      }
    );
    expect(afterProtect.ok).toBe(true);
  });

  it("grants items to both players on simultaneous pickup and shares mob XP across co-op contributors and grace-window kills", () => {
    const now = 1_700_000_000_000;
    const room = {
      roomId: "room_coop",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };

    for (const [i, id] of ["pA", "pB", "pC"].entries()) {
      const seat = { playerId: id, displayName: id, seat: i, connected: true, ready: true, joinedAt: now };
      state.players.push(seat);
      state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, seat, null).state;
    }

    // 1. Simultaneous item pickup: pA collects coin at t=0, pB collects same coin 200ms later -> BOTH get it!
    const coinId = "s1_it_1c1";
    const pickA = sunnyMeadowDefinition.validateAction({ state, now: now + 10 }, {
      playerId: "pA",
      clientActionId: "pick_a",
      expectedVersion: state.version,
      type: "collectItem",
      payload: { itemId: coinId, clientPickupId: "pick_1" }
    });
    expect(pickA.ok).toBe(true);
    state = sunnyMeadowDefinition.applyAction({ state, now: now + 10 }, {
      playerId: "pA",
      clientActionId: "pick_a",
      expectedVersion: state.version,
      type: "collectItem",
      payload: { itemId: coinId, clientPickupId: "pick_1" }
    }).state;

    // pB grabs the same item 200ms later -> allowed via cooperative grace window!
    const pickB = sunnyMeadowDefinition.validateAction({ state, now: now + 210 }, {
      playerId: "pB",
      clientActionId: "pick_b",
      expectedVersion: state.version,
      type: "collectItem",
      payload: { itemId: coinId, clientPickupId: "pick_2" }
    });
    expect(pickB.ok).toBe(true);
    state = sunnyMeadowDefinition.applyAction({ state, now: now + 210 }, {
      playerId: "pB",
      clientActionId: "pick_b",
      expectedVersion: state.version,
      type: "collectItem",
      payload: { itemId: coinId, clientPickupId: "pick_2" }
    }).state;

    // Duplicate grab by pA in the same cycle is rejected
    const pickADupAction = {
      playerId: "pA",
      clientActionId: "pick_a_dup",
      expectedVersion: state.version,
      type: "collectItem",
      payload: { itemId: coinId }
    };
    // Losing a race is not an error: the action is accepted and changes nothing.
    expect(sunnyMeadowDefinition.validateAction({ state, now: now + 250 }, pickADupAction)).toEqual({ ok: true });
    const pickADup = sunnyMeadowDefinition.applyAction({ state: structuredClone(state), now: now + 250 }, pickADupAction);
    expect(pickADup.state).toEqual(state);
    expect(pickADup.events).toEqual([expect.objectContaining({ type: "sunny.actionIgnored", visibility: "private" })]);

    expect((state.playerStates.pA as { coins: number }).coins).toBe(1);
    expect((state.playerStates.pB as { coins: number }).coins).toBe(1);

    // 2. Cooperative mob combat: pA damages mob, pB finishes it, and pC's simultaneous swing lands 150ms later
    //    -> ALL THREE receive full kill XP!
    const mobId = "s1_mob_1a";
    let t = now + 500;
    // pA lands first hit (non-lethal)
    state = sunnyMeadowDefinition.applyAction({ state, now: t }, {
      playerId: "pA",
      clientActionId: "coop_a1",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId, knockDir: 1, damageRoll: 0.5, clientHitId: "h_a1" }
    }).state;
    t += 50;

    // pB lands finishing hits until mob dies
    for (let k = 0; k < 5; k++) {
      const v = sunnyMeadowDefinition.validateAction({ state, now: t }, {
        playerId: "pB",
        clientActionId: `coop_b_${k}`,
        expectedVersion: state.version,
        type: "attackMob",
        payload: { mobId, knockDir: 1, damageRoll: 0.5 }
      });
      if (!v.ok) break;
      state = sunnyMeadowDefinition.applyAction({ state, now: t }, {
        playerId: "pB",
        clientActionId: `coop_b_${k}`,
        expectedVersion: state.version,
        type: "attackMob",
        payload: { mobId, knockDir: 1, damageRoll: 0.5 }
      }).state;
      t += 50;
    }

    // Both pA (damage contributor) and pB (finisher) received XP!
    expect((state.playerStates.pA as { xp: number }).xp).toBeGreaterThan(0);
    expect((state.playerStates.pB as { xp: number }).xp).toBeGreaterThan(0);

    // pC swung optimistically on the same mob 150ms after death -> grace window grants pC XP too!
    const lateHitC = sunnyMeadowDefinition.validateAction({ state, now: t + 150 }, {
      playerId: "pC",
      clientActionId: "coop_c_late",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId, knockDir: 1, damageRoll: 0.5, clientHitId: "h_c1" }
    });
    expect(lateHitC.ok).toBe(true);
    state = sunnyMeadowDefinition.applyAction({ state, now: t + 150 }, {
      playerId: "pC",
      clientActionId: "coop_c_late",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId, knockDir: 1, damageRoll: 0.5, clientHitId: "h_c1" }
    }).state;
    expect((state.playerStates.pC as { xp: number }).xp).toBeGreaterThan(0);

    // After grace window expires (2000ms later), hitting dead mob is rejected
    const expiredHitAction = {
      playerId: "pC",
      clientActionId: "coop_c_too_late",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId, knockDir: 1 }
    };
    // Losing a race is not an error: the action is accepted and changes nothing.
    expect(sunnyMeadowDefinition.validateAction({ state, now: t + 2000 }, expiredHitAction)).toEqual({ ok: true });
    const expiredHit = sunnyMeadowDefinition.applyAction({ state: structuredClone(state), now: t + 2000 }, expiredHitAction);
    expect(expiredHit.state).toEqual(state);
    expect(expiredHit.events).toEqual([expect.objectContaining({ type: "sunny.actionIgnored", visibility: "private" })]);
  });
});

describe("@bighouse/sunny-meadow server hardening", () => {
  const now = 1_700_000_000_000;

  function worldWith(playerId: string): RoomState {
    const room = { roomId: "room_hardening", gameId: "sunny-meadow", mode: "default", minPlayers: 1, maxPlayers: 500, config: {}, createdAt: now };
    const state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    const seat = { playerId, displayName: playerId, seat: 0, connected: true, ready: true, joinedAt: now };
    state.players.push(seat);
    return sunnyMeadowDefinition.onPlayerJoin!({ state, now }, seat, null).state;
  }

  type World = { stages: Record<string, { mobs: Record<string, Record<string, unknown>>; items: Record<string, { templateId: string }> }> };

  it("schedules the respawn alarm for the due time, not a moving offset from now", () => {
    const state = worldWith("p1");
    const stage = (state.stageState as unknown as World).stages["stage-1"]!;
    const mob = Object.values(stage.mobs)[0]!;
    mob.alive = false;
    mob.respawnAt = now + 5_000;

    // However late the host asks, the alarm stays on the respawn time, so a busy room cannot starve it.
    for (const askedAt of [now, now + 4_900, now + 9_000]) {
      const [timer] = sunnyMeadowDefinition.nextTimers({ state, now: askedAt });
      expect(timer?.runAt).toBe(now + 5_000);
    }
  });

  it("pays a weapon pickup's score once, however often it is collected", () => {
    let state = worldWith("p1");
    // Stand the player on whichever stage has a weapon pickup.
    const stages = (state.stageState as unknown as World).stages;
    const [stageId, weaponItemId] = Object.entries(stages).flatMap(([id, stage]) =>
      Object.entries(stage.items)
        .filter(([, item]) => ITEM_CATALOG[item.templateId]?.category === "weapon")
        .map(([itemId]) => [id, itemId] as const)
    )[0]!;
    (state.playerStates.p1 as { stageId: string }).stageId = stageId;
    const scoreOf = (s: RoomState) => (s.playerStates.p1 as { score: number }).score;
    const collect = (s: RoomState, n: number) =>
      sunnyMeadowDefinition.applyAction(
        { state: structuredClone(s), now: now + n },
        { playerId: "p1", clientActionId: `w${n}`, expectedVersion: 0, type: "collectItem", payload: { itemId: weaponItemId } }
      ).state;

    state = collect(state, 1);
    const afterFirst = scoreOf(state);
    expect(afterFirst).toBeGreaterThan(0);
    state = collect(collect(state, 2), 3);
    expect(scoreOf(state)).toBe(afterFirst);
  });

  it("keeps a checkpoint inside the stage", () => {
    const state = worldWith("p1");
    const saved = sunnyMeadowDefinition.applyAction(
      { state: structuredClone(state), now: now + 1 },
      { playerId: "p1", clientActionId: "cp", expectedVersion: 0, type: "checkpoint", payload: { x: 1e300, y: -1e300 } }
    ).state.playerStates.p1 as { x: number; y: number };
    const stage = getStageById("stage-1");
    expect(saved.x).toBeLessThanOrEqual(stage.meta.widthTiles * stage.meta.tileSize);
    expect(saved.y).toBe(-120);
  });

  it("shows clients only what they draw for mobs and items", () => {
    const state = worldWith("p1");
    const stage = (state.stageState as unknown as World).stages["stage-1"]!;
    Object.values(stage.mobs)[0]!.contributors = { someone: 12 };
    const view = sunnyMeadowDefinition.getPublicView({ state, now }, "p1") as unknown as {
      mobs: Record<string, object>;
      items: Record<string, object>;
    };
    expect(Object.keys(Object.values(view.mobs)[0]!).sort()).toEqual([
      "alive",
      "facing",
      "hp",
      "inCombat",
      "maxHp",
      "spawnProtectUntil",
      "vx",
      "vy",
      "x",
      "y"
    ]);
    expect(Object.keys(Object.values(view.items)[0]!)).toEqual(["available"]);
  });
});

describe("@bighouse/sunny-meadow death and revival", () => {
  const now = 1_700_000_000_000;

  function downedPlayer(overrides: Partial<{ xp: number; coins: number; level: number; stageId: string }> = {}): RoomState {
    const room = { roomId: "room_death", gameId: "sunny-meadow", mode: "default", minPlayers: 1, maxPlayers: 500, config: {}, createdAt: now };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    const seat = { playerId: "p1", displayName: "p1", seat: 0, connected: true, ready: true, joinedAt: now };
    state.players.push(seat);
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, seat, null).state;
    const stageId = overrides.stageId ?? "stage-3";
    Object.assign(state.playerStates.p1!, { xp: 37, coins: 5, level: 7, stageId, ...overrides });
    (state.stageState as { playerStageMap: Record<string, string> }).playerStageMap.p1 = stageId;
    return act(state, "playerHurt", { amount: 99_999 }).state;
  }

  function act(state: RoomState, type: string, payload: Record<string, unknown> = {}, at = now + 1) {
    const action = { playerId: "p1", clientActionId: `${type}-${at}`, expectedVersion: 0, type, payload };
    expect(sunnyMeadowDefinition.validateAction({ state, now: at }, action)).toEqual({ ok: true });
    return sunnyMeadowDefinition.applyAction({ state: structuredClone(state), now: at }, action);
  }

  const player = (state: RoomState) => state.playerStates.p1 as { dead?: boolean; hp: number; xp: number; coins: number; level: number; maxHp: number };

  it("leaves a player down, with experience and coins intact, until they revive", () => {
    const state = downedPlayer();
    expect(player(state)).toMatchObject({ dead: true, hp: 0, xp: 37, coins: 5 });
  });

  it("announces the death with what reviving will cost", () => {
    const room = downedPlayer();
    const fresh = sunnyMeadowDefinition.onPlayerJoin!(
      { state: { ...room, players: [...room.players, { playerId: "p2", displayName: "p2", seat: 1, connected: true, ready: true, joinedAt: now }] }, now },
      { playerId: "p2", displayName: "p2", seat: 1, connected: true, ready: true, joinedAt: now },
      null
    ).state;
    Object.assign(fresh.playerStates.p2!, { xp: 11, coins: 2, level: 7, stageId: "stage-3" });
    (fresh.stageState as { playerStageMap: Record<string, string> }).playerStageMap.p2 = "stage-3";
    const died = sunnyMeadowDefinition.applyAction(
      { state: fresh, now: now + 5 },
      { playerId: "p2", clientActionId: "die", expectedVersion: 0, type: "playerHurt", payload: { amount: 99_999 } }
    );
    expect(died.events).toContainEqual(
      expect.objectContaining({ type: "sunny.playerDied", payload: expect.objectContaining({ playerId: "p2", lostXp: 11, lostCoins: 2 }) })
    );
  });

  it("ignores everything a downed player tries except reviving", () => {
    const state = downedPlayer();
    for (const [type, payload] of [
      ["attackMob", { mobId: "s1_mob_1a" }],
      ["usePotion", {}],
      ["changeStage", { targetStageId: "stage-2" }],
      ["playerHurt", { amount: 5 }],
      ["checkpoint", { x: 10, y: 10 }]
    ] as const) {
      const result = act(state, type, payload);
      expect(result.state).toEqual(state);
      expect(result.events).toEqual([expect.objectContaining({ type: "sunny.actionIgnored" })]);
    }
    expect(sunnyMeadowDefinition.handleSignal!({ state, now }, "p1", { type: "playerPose", payload: { x: 50, y: 50 } })).toBeUndefined();
  });

  it("revives at 60% health and takes the full penalty on mid/high stages", () => {
    const revived = act(downedPlayer(), "revive");
    const p = player(revived.state);
    expect(p.dead).toBeUndefined();
    expect(p).toMatchObject({ xp: 0, coins: 0, level: 7 });
    expect(p.hp).toBe(Math.max(20, Math.round(p.maxHp * 0.6)));
    expect(revived.events).toContainEqual(
      expect.objectContaining({ type: "sunny.playerRespawned", payload: expect.objectContaining({ playerId: "p1", lostXp: 37, lostCoins: 5 }) })
    );
    // Reviving while standing is a harmless no-op.
    const again = act(revived.state, "revive", {}, now + 2);
    expect(again.state).toEqual(revived.state);
  });

  it("protects XP for tutorial levels (Lv. 1-3) and reduces XP loss on early stages", () => {
    // Lv. 2 tutorial player loses 0 XP and only 20% coins on death
    const tutDown = downedPlayer({ level: 2, stageId: "stage-1", xp: 80, coins: 10 });
    const tutRevived = act(tutDown, "revive");
    expect(player(tutRevived.state)).toMatchObject({ xp: 80, coins: 8, level: 2 });

    // Lv. 4 on Stage 1 loses only 20% XP and 30% coins
    expect(deathPenaltyOf({ level: 4, stageId: "stage-1", xp: 100, coins: 10 })).toEqual({ lostXp: 20, lostCoins: 3 });

    // Lv. 5 on Stage 2 loses 35% XP and 50% coins
    expect(deathPenaltyOf({ level: 5, stageId: "stage-2", xp: 100, coins: 10 })).toEqual({ lostXp: 35, lostCoins: 5 });

    // Lv. 6 on Stage 3 takes full penalty
    expect(deathPenaltyOf({ level: 6, stageId: "stage-3", xp: 100, coins: 10 })).toEqual({ lostXp: 100, lostCoins: 10 });
  });

  it("saves the revived, penalised profile when a player leaves while down", () => {
    const state = downedPlayer();
    // They fell far from the stage start.
    Object.assign(state.playerStates.p1!, { x: 3_000, y: 200 });
    const profile = sunnyMeadowDefinition.extractPlayerProfile!({ state, now }, "p1") as {
      xp: number; coins: number; hp: number; level: number; lastX: number; lastY: number;
    };
    expect(profile).toMatchObject({ xp: 0, coins: 0, level: 7 });
    expect(profile.hp).toBeGreaterThan(0);
    // Rejoining must not revive them where they died: the saved position is the stage start.
    const stage = getStageById("stage-3");
    const spawnX = (stage.spawn.x + 0.5) * stage.meta.tileSize;
    expect(Math.abs(profile.lastX - spawnX)).toBeLessThanOrEqual((SPAWN_SPREAD_TILES + 1) * stage.meta.tileSize);
    expect(profile.lastX).not.toBe(3_000);
    // The room state itself is untouched: they are still down until they leave or revive.
    expect(player(state)).toMatchObject({ dead: true, hp: 0 });
  });
});

describe("@bighouse/sunny-meadow difficulty curve, alert telegraph & walk animation", () => {
  it("keeps Stage 1 mobs welcoming with narrow ~2-tile same-floor aggro and generous early XP", () => {
    const tile = VIEWPORT.tileSize;
    const mushroom = MOB_CATALOG.red_mushroom!;
    const hamster = MOB_CATALOG.yellow_hamster!;
    const rabbit = MOB_CATALOG.blue_rabbit!;

    // Stage 1 mobs notice players only within ~2 tiles horizontally and strictly on the same floor
    expect(hamster.aggroRange).toBeLessThanOrEqual(tile * 2.2);
    expect(hamster.aggroVerticalRange).toBeLessThanOrEqual(44);
    expect(mushroom.aggroVerticalRange).toBeLessThanOrEqual(44);
    expect(rabbit.aggroVerticalRange).toBeLessThanOrEqual(44);

    // Yellow hamster is toned down so beginners aren't rushed aggressively
    expect(hamster.dashSpeed).toBeLessThanOrEqual(135);
    expect(hamster.atk).toBeLessThanOrEqual(10);
    expect(mushroom.atk).toBeLessThanOrEqual(8);

    // 2-3 Stage 1 mob kills cleanly reach Lv. 2 (100 XP)
    expect(mushroom.exp + hamster.exp).toBeGreaterThanOrEqual(100);
  });

  it("configures a 0.5s alert telegraph for active mobs and excludes passive patrol mobs", () => {
    expect(MOB_ALERT_TELEGRAPH_SEC).toBe(0.5);
    expect(isActiveMobAi("patrol")).toBe(false);
    expect(isActiveMobAi("dash")).toBe(true);
    expect(isActiveMobAi("hopper")).toBe(true);
    expect(isActiveMobAi("lunge")).toBe(true);
    expect(isActiveMobAi("swoop")).toBe(true);
    expect(isActiveMobAi("fire_drake")).toBe(true);
  });

  it("defines valid 4-frame leg-stride walk animations for hero and all legged mobs", () => {
    expect(WALK_CYCLE_FRAMES).toBe(4);
    const expectedLegged = [
      "hero",
      "red_mushroom",
      "yellow_hamster",
      "blue_rabbit",
      "emerald_frog",
      "orange_fox",
      "crimson_boar",
      "cobalt_golem",
      "violet_spider",
      "scarlet_drake"
    ];
    for (const key of expectedLegged) {
      const spec = LEGGED_SPRITE_CONFIG[key];
      expect(spec, `legged spec for ${key}`).toBeDefined();
      expect(spec!.splitY).toBeGreaterThanOrEqual(80);
      expect(spec!.splitY).toBeLessThan(120);
      expect(spec!.midX).toBeGreaterThan(32);
      expect(spec!.midX).toBeLessThan(96);
    }
    // Legless / flying sprites stay unsplit
    expect(LEGGED_SPRITE_CONFIG.purple_snake).toBeUndefined();
    expect(LEGGED_SPRITE_CONFIG.lime_slime).toBeUndefined();
    expect(LEGGED_SPRITE_CONFIG.indigo_wisp).toBeUndefined();
  });
});

describe("@bighouse/sunny-meadow multiplayer synchronization", () => {
  const now = 1_700_000_000_000;

  function setupTwoPlayers(): RoomState {
    const room = {
      roomId: "room_sync",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    for (const [i, id] of ["pA", "pB"].entries()) {
      const seat = { playerId: id, displayName: id, seat: i, connected: true, ready: true, joinedAt: now };
      state.players.push(seat);
      state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, seat, null).state;
    }
    return state;
  }

  it("reconciles legacy persistent rooms with current stage mobs/items so potions and mob XP never vanish", () => {
    const state = setupTwoPlayers();
    // Simulate a legacy Durable Object created before the stage expansion (missing new zone mobs & potions)
    const stage1 = (state.stageState as { stages: Record<string, { mobs: Record<string, unknown>; items: Record<string, unknown> }> }).stages["stage-1"]!;
    delete stage1.items["s1_iso_po"];
    delete stage1.mobs["s1_iso_mob1"];
    stage1.mobs["s1_obsolete_mob"] = { id: "s1_obsolete_mob", templateId: "red_mushroom", alive: true, hp: 40, maxHp: 40 };

    // Player collects s1_iso_po (potion) -> reconcile restores it automatically and awards +1 potion!
    const beforePotions = (state.playerStates.pA as { potions: number }).potions;
    const pick = sunnyMeadowDefinition.applyAction(
      { state, now: now + 50 },
      { playerId: "pA", clientActionId: "pick_reconciled_potion", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_iso_po" } }
    );
    expect((pick.state.playerStates.pA as { potions: number }).potions).toBe(beforePotions + 1);
    expect(pick.events.some((e) => e.type === "sunny.itemCollected" && e.payload.itemId === "s1_iso_po")).toBe(true);

    // Obsolete mob pruned, new mob restored and attackable
    const pub = sunnyMeadowDefinition.getPublicView({ state: pick.state, now: now + 60 }, "pA") as { mobs: Record<string, unknown> };
    expect(pub.mobs["s1_obsolete_mob"]).toBeUndefined();
    expect(pub.mobs["s1_iso_mob1"]).toBeDefined();
  });

  it("updates persisted mob max HP without refilling live damage or changing the respawn deadline", () => {
    const state = setupTwoPlayers();
    const stage1 = (state.stageState as {
      stages: Record<string, { mobs: Record<string, {
        alive: boolean; hp: number; maxHp: number; respawnAt: number; x: number;
      }> }>;
    }).stages["stage-1"]!;
    const live = stage1.mobs.s1_mob_1a!;
    const dead = stage1.mobs.s1_mob_1b!;
    const newMax = MOB_CATALOG.red_mushroom!.hp;
    const respawnAt = now + 5_000;
    const x = live.x + 10;
    Object.assign(live, { maxHp: newMax + 6, hp: newMax + 5, x });
    Object.assign(dead, { alive: false, maxHp: newMax + 6, hp: 0, respawnAt });

    const timer = sunnyMeadowDefinition.nextTimers!({ state, now })[0]!;
    expect(timer.runAt).toBe(respawnAt);
    expect(live).toMatchObject({ alive: true, maxHp: newMax, hp: newMax - 1, x });
    expect(dead).toMatchObject({ alive: false, maxHp: newMax, hp: 0, respawnAt });
    sunnyMeadowDefinition.applyTimer!({ state, now: respawnAt - 1 }, timer);
    expect(dead).toMatchObject({ alive: false, hp: 0, respawnAt });
    sunnyMeadowDefinition.applyTimer!({ state, now: respawnAt }, timer);
    expect(dead).toMatchObject({ alive: true, maxHp: newMax, hp: newMax, respawnAt: 0 });
    expect(live).toMatchObject({ alive: true, hp: newMax - 1, x });
  });

  it("syncs mob positions from the closest player via handleSignal and rejects farther-player overwrites", () => {
    const state = setupTwoPlayers();
    const mobId = "s1_mob_1a";
    const stage1 = (state.stageState as { stages: Record<string, { mobs: Record<string, { x: number; y: number }> }> }).stages["stage-1"]!;
    const mobHomeX = stage1.mobs[mobId]!.x;
    const mobHomeY = stage1.mobs[mobId]!.y;

    // Place pA right next to the mob and pB 500px away
    Object.assign(state.playerStates.pA!, { x: mobHomeX + 20, y: mobHomeY });
    Object.assign(state.playerStates.pB!, { x: mobHomeX + 520, y: mobHomeY });

    const sigA = sunnyMeadowDefinition.handleSignal!(
      { state: structuredClone(state), now: now + 100 },
      "pA",
      {
        type: "playerPose",
        payload: {
          x: mobHomeX + 20,
          y: mobHomeY,
          vx: 0,
          vy: 0,
          facing: -1,
          animState: "idle",
          mobs: [[mobId, mobHomeX + 44, mobHomeY, 85, 0, 1]]
        }
      }
    );
    expect(sigA).toBeDefined();
    expect(sigA!.recipientPlayerIds).toContain("pB");
    expect(sigA!.payload.mobs).toEqual([[mobId, mobHomeX + 44, mobHomeY, 85, 0, 1]]);
    expect(sigA!.stageState).toBeDefined();

    // Apply pA's stageState update, then verify pB (farther away) cannot overwrite pA's fresh mob position
    state.stageState = sigA!.stageState!;
    const sigB = sunnyMeadowDefinition.handleSignal!(
      { state: structuredClone(state), now: now + 200 },
      "pB",
      {
        type: "playerPose",
        payload: {
          x: mobHomeX + 520,
          y: mobHomeY,
          vx: 0,
          vy: 0,
          facing: -1,
          animState: "idle",
          mobs: [[mobId, mobHomeX - 80, mobHomeY, -60, 0, -1]]
        }
      }
    );
    expect(sigB).toBeDefined();
    expect(sigB!.payload.mobs).toBeUndefined();
  });

  it("allows race-window duplicate pickup for ordinary potions/coins, but blocks duplicates on rare Golden Hearts", () => {
    let state = setupTwoPlayers();

    // Ordinary potion: both pA and pB touch within grace window -> both receive +1 potion
    const beforeA = (state.playerStates.pA as { potions: number }).potions;
    const beforeB = (state.playerStates.pB as { potions: number }).potions;
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 10 },
      { playerId: "pA", clientActionId: "pot_a", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_iso_po" } }
    ).state;
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 200 },
      { playerId: "pB", clientActionId: "pot_b", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_iso_po" } }
    ).state;
    expect((state.playerStates.pA as { potions: number }).potions).toBe(beforeA + 1);
    expect((state.playerStates.pB as { potions: number }).potions).toBe(beforeB + 1);

    // Rare Golden Heart (max_hp): first player gets +20 maxHp, second player's race grab is silently ignored
    const maxHpA = (state.playerStates.pA as { maxHp: number }).maxHp;
    const maxHpB = (state.playerStates.pB as { maxHp: number }).maxHp;
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 300 },
      { playerId: "pA", clientActionId: "gh_a", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_iso_gh" } }
    ).state;
    const ghB = sunnyMeadowDefinition.applyAction(
      { state, now: now + 400 },
      { playerId: "pB", clientActionId: "gh_b", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_iso_gh" } }
    );
    expect((ghB.state.playerStates.pA as { maxHp: number }).maxHp).toBe(maxHpA + 20);
    expect((ghB.state.playerStates.pB as { maxHp: number }).maxHp).toBe(maxHpB);
    expect(ghB.events).toContainEqual(
      expect.objectContaining({ type: "sunny.actionIgnored", payload: expect.objectContaining({ reason: "item_taken" }) })
    );
  });

  it("tracks monotonic weaponSwitchSeq so rapid Q/E weapon cycling never rolls back", () => {
    let state = setupTwoPlayers();
    Object.assign(state.playerStates.pA!, { unlockedWeapons: ["wooden_sword", "leaf_blade", "star_wand"] });

    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 10 },
      { playerId: "pA", clientActionId: "sw1", expectedVersion: 0, type: "switchWeapon", payload: { weaponId: "leaf_blade", switchSeq: 1 } }
    ).state;
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 20 },
      { playerId: "pA", clientActionId: "sw2", expectedVersion: 0, type: "switchWeapon", payload: { weaponId: "star_wand", switchSeq: 2 } }
    ).state;

    const priv = sunnyMeadowDefinition.getPrivateView({ state, now: now + 25 }, "pA") as {
      equippedWeaponId: string;
      weaponSwitchSeq: number;
    };
    expect(priv.equippedWeaponId).toBe("star_wand");
    expect(priv.weaponSwitchSeq).toBe(2);
  });

  it("evaluates moving platforms deterministically from synced server time across all clients", () => {
    const a = compileStageForRuntime(getStageById("stage-4"));
    const b = compileStageForRuntime(getStageById("stage-4"));
    expect(a.movingPlatforms.length).toBeGreaterThan(0);

    const syncedTime = 1_700_000_123_456;
    updateMovingPlatforms(a.movingPlatforms, 1 / 60, syncedTime);
    updateMovingPlatforms(b.movingPlatforms, 1 / 60, syncedTime);
    for (let i = 0; i < a.movingPlatforms.length; i++) {
      expect(a.movingPlatforms[i]!.x).toBeCloseTo(b.movingPlatforms[i]!.x, 5);
      expect(a.movingPlatforms[i]!.y).toBeCloseTo(b.movingPlatforms[i]!.y, 5);
    }
  });
});

describe("@bighouse/sunny-meadow unique weapon visuals, upgraded traits & status system", () => {
  it("gives every weapon a distinct non-reused iconIndex matching its pickup item", () => {
    const iconIndices = WEAPON_ORDER.map((id) => WEAPON_CATALOG[id]!.iconIndex);
    expect(new Set(iconIndices).size).toBe(WEAPON_ORDER.length);
    expect(WEAPON_CATALOG.maple_greatsword!.iconIndex).not.toBe(WEAPON_CATALOG.leaf_blade!.iconIndex);
    expect(WEAPON_CATALOG.crystal_rod!.iconIndex).not.toBe(WEAPON_CATALOG.star_wand!.iconIndex);
    for (const wid of WEAPON_ORDER) {
      const pickup = Object.values(ITEM_CATALOG).find((it) => it.weaponId === wid);
      if (pickup) {
        expect(pickup.iconIndex).toBe(WEAPON_CATALOG[wid]!.iconIndex);
      }
    }
  });

  it("equips upgraded weapons with distinct special abilities (stun halo, 2-tile splash wave, DoTs)", () => {
    expect(WEAPON_CATALOG.golden_hammer!.special?.statuses).toEqual([
      expect.objectContaining({ kind: "stun", durationSec: 1.0 })
    ]);
    expect(WEAPON_CATALOG.maple_greatsword!.special?.splash).toEqual(
      expect.objectContaining({ rangeTiles: 2.0, style: "maple_wave" })
    );
    expect(WEAPON_CATALOG.crystal_rod!.special?.statuses).toEqual([
      expect.objectContaining({ kind: "crystal_dot", durationSec: 4.0 })
    ]);
    expect(WEAPON_CATALOG.thunder_dagger!.special?.statuses?.[0]?.kind).toBe("shock");
    expect(WEAPON_CATALOG.solar_hammer!.special?.statuses?.[0]?.kind).toBe("stun");
    expect(WEAPON_CATALOG.solar_hammer!.special?.splash?.style).toBe("solar_shockwave");
    expect(WEAPON_CATALOG.dragon_blade!.special?.statuses?.[0]?.kind).toBe("burn");
    expect(WEAPON_CATALOG.dragon_blade!.special?.splash?.style).toBe("dragon_flame");
    expect(WEAPON_CATALOG.nebula_staff!.special?.statuses?.map((s) => s.kind)).toEqual(["stun", "burn"]);
    expect(STATUS_METADATA.stun.isDot).toBeFalsy();
    expect(STATUS_METADATA.crystal_dot.isDot).toBe(true);
    expect(STATUS_METADATA.burn.isDot).toBe(true);
  });

  it("applies weapon statuses on server hits, broadcasts them, and resolves splash & DoT kills with XP", () => {
    const now = 1_700_000_500_000;
    const room = {
      roomId: "room-status",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    const p1 = { playerId: "p1", displayName: "테스터", seat: 0, connected: true, ready: true, joinedAt: now };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [p1],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p1, null).state;
    // Give player golden_hammer, maple_greatsword, crystal_rod on stage-3 where mobs have enough HP to test statuses
    Object.assign(state.playerStates.p1!, {
      level: 10,
      baseAtk: 24,
      stageId: "stage-3",
      unlockedWeapons: ["wooden_sword", "golden_hammer", "maple_greatsword", "crystal_rod"],
      equippedWeaponId: "golden_hammer"
    });
    (state.stageState as { playerStageMap: Record<string, string> }).playerStageMap.p1 = "stage-3";

    const stage3Mobs = (state.stageState as { stages: Record<string, { mobs: Record<string, { id: string; hp: number }> }> }).stages["stage-3"]!.mobs;
    const mobIds = Object.keys(stage3Mobs);
    const stunTargetId = mobIds[0]!;
    const dotTargetId = mobIds[1]!;
    stage3Mobs[stunTargetId]!.hp = 400;
    stage3Mobs[dotTargetId]!.hp = 350;

    // 1. Golden Hammer applies 1s stun status and exposes it in sunny.mobHit & publicView
    const stunRes = sunnyMeadowDefinition.applyAction(
      { state, now: now + 10 },
      {
        playerId: "p1",
        clientActionId: "hit_stun",
        expectedVersion: 0,
        type: "attackMob",
        payload: { mobId: stunTargetId, knockDir: 1, damageRoll: 0.5, hitKind: "primary" }
      }
    );
    state = stunRes.state;
    const stunEv = stunRes.events.find((e) => e.type === "sunny.mobHit");
    expect(stunEv?.payload.appliedStatuses).toEqual([expect.objectContaining({ kind: "stun", durationSec: 1.0 })]);
    const pubDuringStun = sunnyMeadowDefinition.getPublicView({ state, now: now + 500 }, "p1") as {
      mobs: Record<string, { statuses?: string[] }>;
    };
    expect(pubDuringStun.mobs[stunTargetId]?.statuses).toContain("stun");
    const pubAfterStun = sunnyMeadowDefinition.getPublicView({ state, now: now + 1200 }, "p1") as {
      mobs: Record<string, { statuses?: string[] }>;
    };
    expect(pubAfterStun.mobs[stunTargetId]?.statuses).toBeUndefined();

    // 2. Maple Greatsword deals scaled 2-tile splash damage
    Object.assign(state.playerStates.p1!, { equippedWeaponId: "maple_greatsword" });
    const hpBeforeSplash = stage3Mobs[stunTargetId]!.hp;
    const splashRes = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1300 },
      {
        playerId: "p1",
        clientActionId: "hit_splash",
        expectedVersion: 0,
        type: "attackMob",
        payload: { mobId: stunTargetId, knockDir: 1, damageRoll: 0.5, hitKind: "splash" }
      }
    );
    state = splashRes.state;
    const splashEv = splashRes.events.find((e) => e.type === "sunny.mobHit");
    expect(splashEv?.payload.hitKind).toBe("splash");
    expect(Number(splashEv?.payload.damage)).toBeGreaterThan(0);
    expect(stage3Mobs[stunTargetId]!.hp).toBeLessThan(hpBeforeSplash);

    // 3. Crystal Rod applies crystal_dot, then DoT tick finishes mob and awards XP
    Object.assign(state.playerStates.p1!, { equippedWeaponId: "crystal_rod" });
    const rodHit = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1400 },
      {
        playerId: "p1",
        clientActionId: "hit_rod",
        expectedVersion: 0,
        type: "attackMob",
        payload: { mobId: dotTargetId, knockDir: 1, damageRoll: 0.5, hitKind: "primary" }
      }
    );
    state = rodHit.state;
    expect(rodHit.events.find((e) => e.type === "sunny.mobHit")?.payload.appliedStatuses).toEqual([
      expect.objectContaining({ kind: "crystal_dot", durationSec: 4.0 })
    ]);

    // Drop target to 5 HP so a Crystal DoT tick finishes it with zero knockback and awards XP!
    (state.stageState as { stages: Record<string, { mobs: Record<string, { hp: number }> }> }).stages["stage-3"]!.mobs[dotTargetId]!.hp = 5;
    const xpBefore = (state.playerStates.p1 as { xp: number }).xp;
    const dotFinish = sunnyMeadowDefinition.applyAction(
      { state, now: now + 2200 },
      {
        playerId: "p1",
        clientActionId: "hit_dot_kill",
        expectedVersion: 0,
        type: "attackMob",
        payload: { mobId: dotTargetId, knockDir: 0, hitKind: "dot", dotStatus: "crystal_dot" }
      }
    );
    const dotEv = dotFinish.events.find((e) => e.type === "sunny.mobHit");
    expect(dotEv?.payload.hitKind).toBe("dot");
    expect(dotEv?.payload.dotStatus).toBe("crystal_dot");
    expect(dotEv?.payload.knockbackX).toBe(0);
    expect(dotFinish.events.some((e) => e.type === "sunny.mobDefeated" && e.payload.mobId === dotTargetId)).toBe(true);
    expect((dotFinish.state.playerStates.p1 as { xp: number }).xp).toBeGreaterThan(xpBefore);
  });
});

describe("@bighouse/sunny-meadow ladder connectivity, ladder-top controls & moving-platform pacing", () => {
  it("validates that every ladder across all 10 stages connects cleanly to both top and bottom platforms", () => {
    for (const stage of ALL_STAGES) {
      const report = validateNormalizedStage(stage);
      expect(report.errors, `${stage.meta.id} validation errors`).toEqual([]);
      expect(report.warnings, `${stage.meta.id} validation warnings`).toEqual([]);

      const compiled = compileStageForRuntime(stage);
      for (const ladder of compiled.ladders) {
        const topPlat = findPlatformAtLadderTop(ladder, compiled.platforms);
        expect(topPlat, `${stage.meta.id} ladder ${ladder.id} must have a connected top platform`).not.toBeNull();
      }
    }

    // Confirm validator catches a broken / disconnected ladder
    const broken = structuredClone(getStageById("stage-1"));
    broken.layers.ladders.byId["s1_broken_lad"] = { id: "s1_broken_lad", x: 1, y: 2, h: 4 };
    broken.layers.ladders.allIds.push("s1_broken_lad");
    const brokenReport = validateNormalizedStage(broken);
    expect(brokenReport.valid).toBe(false);
    expect(brokenReport.errors.some((e) => e.includes("s1_broken_lad"))).toBe(true);
  });

  it("holds stably at the top of a ladder when holding Up, dismounts onto top platform on Left/Right, and jumps cleanly", () => {
    const stage1 = compileStageForRuntime(getStageById("stage-1"));
    const ladder = stage1.ladders[0]!;
    const playerH = 42;
    const topY = ladder.y - playerH;

    // 1. Holding Up past the top rung clamps cleanly and stays on the ladder without falling
    const holdTop = stepOnLadder(ladder, stage1.platforms, {
      y: topY + 2,
      h: playerH,
      moveY: -1,
      moveX: 0,
      jumpPressed: false,
      climbSpeed: 215,
      jumpVelocity: -640,
      dt: 1 / 60
    });
    expect(holdTop).toEqual({ state: "climbing", y: topY, vy: 0, atTop: true });

    // 2. Holding Up + pressing Jump at the top jumps off at full jumpVelocity
    const jumpTop = stepOnLadder(ladder, stage1.platforms, {
      y: topY,
      h: playerH,
      moveY: -1,
      moveX: 1,
      jumpPressed: true,
      climbSpeed: 215,
      jumpVelocity: -640,
      dt: 1 / 60
    });
    expect(jumpTop).toEqual({ state: "jumped", y: topY, vy: -640 });

    // 3. Pressing Right while perched at the top dismounts cleanly onto the connected top platform
    const stepOff = stepOnLadder(ladder, stage1.platforms, {
      y: topY,
      h: playerH,
      moveY: -1,
      moveX: 1,
      jumpPressed: false,
      climbSpeed: 215,
      jumpVelocity: -640,
      dt: 1 / 60
    });
    expect(stepOff.state).toBe("dismount_top");
    if (stepOff.state === "dismount_top") {
      expect(stepOff.y).toBe(topY);
      expect(stepOff.platform.y).toBe(ladder.y);
    }
  });

  it("reduces early moving platforms, avoids flying mobs over early moving zones, and provides stationary center anchors", () => {
    // Stages 1-3 have zero moving platforms; Stage 4 has at most 2
    for (const sid of ["stage-1", "stage-2", "stage-3"]) {
      expect(getStageById(sid).layers.movingPlatforms.allIds.length, `${sid} moving platforms`).toBe(0);
    }
    expect(getStageById("stage-4").layers.movingPlatforms.allIds.length).toBeLessThanOrEqual(2);

    // Every moving platform across all 10 stages has a nearby stationary normal anchor platform
    for (const stage of ALL_STAGES) {
      const mps = stage.layers.movingPlatforms.allIds.map((id) => stage.layers.movingPlatforms.byId[id]!);
      const normalPlats = stage.layers.platforms.allIds
        .map((id) => stage.layers.platforms.byId[id]!)
        .filter((p) => (p.surface ?? "normal") === "normal");

      for (const mp of mps) {
        const xs = mp.waypoints.map((w) => w.x);
        const ys = mp.waypoints.map((w) => w.y);
        const midX = (Math.min(...xs) + Math.max(...xs) + mp.w) * 0.5;
        const midY = (Math.min(...ys) + Math.max(...ys)) * 0.5;
        const hasAnchor = normalPlats.some(
          (p) =>
            (p.id.includes("anchor") || p.id.includes("isl")) &&
            Math.abs(p.x + p.w * 0.5 - midX) <= 7 &&
            Math.abs(p.y - midY) <= 4
        );
        expect(hasAnchor, `${stage.meta.id} moving platform ${mp.id} needs a nearby stationary normal anchor`).toBe(
          true
        );
      }

      // On Stages 1-5, no flying mob spawns inside a moving-platform screen
      if (stage.meta.stageNumber <= 5 && mps.length > 0) {
        const mpScreens = new Set(mps.map((mp) => Math.floor(mp.waypoints[0]!.x / 20)));
        for (const mid of stage.layers.mobSpawns.allIds) {
          const mob = stage.layers.mobSpawns.byId[mid]!;
          const mobScreen = Math.floor(mob.x / 20);
          if (mpScreens.has(mobScreen)) {
            expect(MOB_CATALOG[mob.templateId]?.flying, `${stage.meta.id} ${mob.id} (${mob.templateId})`).toBeFalsy();
          }
        }
      }
    }
  });
});

describe("@bighouse/sunny-meadow idle HP regeneration", () => {
  it("activates gentle HP regen only after 10s of zero input, stops at maxHp, and cancels on input", () => {
    const maxHp = 100;
    const regenPerTick = computeIdleRegenAmount(maxHp);
    // Much smaller than an apple (30) or potion (55)
    expect(regenPerTick).toBeGreaterThanOrEqual(2);
    expect(regenPerTick).toBeLessThan(ITEM_CATALOG.red_apple!.healAmount!);
    expect(regenPerTick).toBeLessThan(PLAYER_CONFIG.minPotionHeal);

    let st = { idleTimer: 0, tickTimer: 0 };
    // 9.5 seconds idle -> not active yet
    let res = stepIdleRegen(st, { hasInput: false, isResting: true, hp: 70, maxHp, dt: 9.5 });
    expect(res.active).toBe(false);
    expect(res.shouldHeal).toBe(false);
    st = { idleTimer: res.idleTimer, tickTimer: res.tickTimer };

    // Crossing 10s -> activates & triggers first gentle heal tick
    res = stepIdleRegen(st, { hasInput: false, isResting: true, hp: 70, maxHp, dt: 0.6 });
    expect(res.active).toBe(true);
    expect(res.shouldHeal).toBe(true);
    st = { idleTimer: res.idleTimer, tickTimer: res.tickTimer };

    // Next 1.0s -> active, waiting for interval
    res = stepIdleRegen(st, { hasInput: false, isResting: true, hp: 73, maxHp, dt: 1.0 });
    expect(res.active).toBe(true);
    expect(res.shouldHeal).toBe(false);
    st = { idleTimer: res.idleTimer, tickTimer: res.tickTimer };

    // At 2.0s interval -> heals again
    res = stepIdleRegen(st, { hasInput: false, isResting: true, hp: 73, maxHp, dt: 1.0 });
    expect(res.active).toBe(true);
    expect(res.shouldHeal).toBe(true);
    st = { idleTimer: res.idleTimer, tickTimer: res.tickTimer };

    // Any player input immediately cancels idle regen state
    res = stepIdleRegen(st, { hasInput: true, isResting: true, hp: 76, maxHp, dt: 0.1 });
    expect(res.active).toBe(false);
    expect(res.shouldHeal).toBe(false);
    expect(res.idleTimer).toBe(0);

    // At full HP, regen never triggers
    res = stepIdleRegen({ idleTimer: 10, tickTimer: 2 }, { hasInput: false, isResting: true, hp: maxHp, maxHp, dt: 0.5 });
    expect(res.active).toBe(false);
    expect(res.shouldHeal).toBe(false);
  });

  it("heals after resting on a ladder and resets that delay when climbing resumes", () => {
    const now = 1_700_000_950_000;
    const room = {
      roomId: "room-ladder-rest", gameId: "sunny-meadow", mode: "default", minPlayers: 1,
      maxPlayers: 500, config: {}, createdAt: now
    };
    const p1 = { playerId: "p1", seat: 0, connected: true, ready: true, joinedAt: now };
    let state: RoomState = {
      room, phase: "active", version: 1, players: [p1],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {}, updatedAt: now
    };
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p1, null).state;
    const player = state.playerStates.p1!;
    player.hp = 80;
    const x = Number(player.x);
    const y = Number(player.y);
    const sendClimb = (elapsed: number, movedY: number, vy: number) => {
      const result = sunnyMeadowDefinition.handleSignal!({ state, now: now + elapsed }, "p1", {
        type: "playerPose",
        payload: { x, y: movedY, vx: 0, vy, animState: "climb" }
      })!;
      Object.assign(player, result.playerStatePatch);
      return result.playerStatePatch;
    };

    expect(sendClimb(9_000, y, 0)).not.toHaveProperty("lastActivityAt");
    const heal = sunnyMeadowDefinition.applyAction({ state, now: now + 10_000 }, {
      playerId: "p1", clientActionId: "heal-from-ladder", expectedVersion: 0, type: "idleRegen", payload: {}
    });
    expect(heal.events).toContainEqual(expect.objectContaining({ type: "sunny.playerHealed" }));
    expect(sendClimb(11_000, y - 8, -80)).toHaveProperty("lastActivityAt", now + 11_000);
    const tooEarly = sunnyMeadowDefinition.applyAction({ state, now: now + 14_000 }, {
      playerId: "p1", clientActionId: "after-ladder-motion", expectedVersion: 0, type: "idleRegen", payload: {}
    });
    expect(tooEarly.events).toContainEqual(expect.objectContaining({
      type: "sunny.actionIgnored", payload: expect.objectContaining({ reason: "not_idle_long_enough" })
    }));
  });

  it("enforces 10s idle delay, clamps at maxHp, and preserves already-recovered HP when interrupted by input or attack", () => {
    const now = 1_700_000_900_000;
    const room = {
      roomId: "room-regen",
      gameId: "sunny-meadow",
      mode: "default",
      minPlayers: 1,
      maxPlayers: 500,
      config: {},
      createdAt: now
    };
    const p1 = { playerId: "p1", displayName: "휴식테스터", seat: 0, connected: true, ready: true, joinedAt: now };
    let state: RoomState = {
      room,
      phase: "active",
      version: 1,
      players: [p1],
      stageState: sunnyMeadowDefinition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, p1, null).state;

    // Player takes 20 damage -> HP drops 100 -> 80
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 1000 },
      { playerId: "p1", clientActionId: "hurt1", expectedVersion: 0, type: "playerHurt", payload: { amount: 20 } }
    ).state;
    expect((state.playerStates.p1 as { hp: number }).hp).toBe(80);

    // Attempting idleRegen after only 5s is ignored
    const tooEarly = sunnyMeadowDefinition.applyAction(
      { state, now: now + 6000 },
      { playerId: "p1", clientActionId: "reg_early", expectedVersion: 0, type: "idleRegen", payload: {} }
    );
    expect((tooEarly.state.playerStates.p1 as { hp: number }).hp).toBe(80);
    expect(tooEarly.events).toContainEqual(
      expect.objectContaining({ type: "sunny.actionIgnored", payload: expect.objectContaining({ reason: "not_idle_long_enough" }) })
    );

    // After 10s idle (now + 11_000), idleRegen heals gently (+3 HP -> 83)
    const tick1 = sunnyMeadowDefinition.applyAction(
      { state, now: now + 11_000 },
      { playerId: "p1", clientActionId: "reg1", expectedVersion: 0, type: "idleRegen", payload: {} }
    );
    state = tick1.state;
    const expectedTick = computeIdleRegenAmount(100);
    expect((state.playerStates.p1 as { hp: number }).hp).toBe(80 + expectedTick);
    expect(tick1.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.playerHealed",
        payload: expect.objectContaining({ reason: "idle_regen", amount: expectedTick })
      })
    );

    // Player gets attacked for 5 damage while regenerating -> regen cancels, already-recovered HP is NOT reverted!
    state = sunnyMeadowDefinition.applyAction(
      { state, now: now + 12_000 },
      { playerId: "p1", clientActionId: "hurt2", expectedVersion: 0, type: "playerHurt", payload: { amount: 5 } }
    ).state;
    expect((state.playerStates.p1 as { hp: number }).hp).toBe(80 + expectedTick - 5);

    // Regen right after taking damage is blocked until another 10s passes
    const afterHurt = sunnyMeadowDefinition.applyAction(
      { state, now: now + 15_000 },
      { playerId: "p1", clientActionId: "reg_blocked", expectedVersion: 0, type: "idleRegen", payload: {} }
    );
    expect((afterHurt.state.playerStates.p1 as { hp: number }).hp).toBe(80 + expectedTick - 5);
    expect(afterHurt.events).toContainEqual(
      expect.objectContaining({ type: "sunny.actionIgnored", payload: expect.objectContaining({ reason: "not_idle_long_enough" }) })
    );

    // Clamping at maxHp: set HP to 99, wait 10s -> heals by +1 to 100 and never exceeds 100
    (state.playerStates.p1 as { hp: number }).hp = 99;
    const clampRes = sunnyMeadowDefinition.applyAction(
      { state, now: now + 22_500 },
      { playerId: "p1", clientActionId: "reg_clamp", expectedVersion: 0, type: "idleRegen", payload: {} }
    );
    expect((clampRes.state.playerStates.p1 as { hp: number }).hp).toBe(100);
    expect(clampRes.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.playerHealed",
        payload: expect.objectContaining({ reason: "idle_regen", amount: 1, hp: 100 })
      })
    );
  });
});
