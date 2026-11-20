import { describe, expect, it } from "vitest";
import { ITEM_CATALOG, MOB_CATALOG, VIEWPORT } from "../src/catalogs";
import { compileStageForRuntime, validateNormalizedStage } from "../src/map-schema";
import { updateMovingPlatforms } from "../src/physics";
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
import { sunnyMeadowDefinition } from "../src/server";
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

  function downedPlayer(): RoomState {
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
    Object.assign(state.playerStates.p1!, { xp: 37, coins: 5, level: 3 });
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
    Object.assign(fresh.playerStates.p2!, { xp: 11, coins: 2 });
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

  it("revives at 60% health and takes the experience toward the next level and all coins", () => {
    const revived = act(downedPlayer(), "revive");
    const p = player(revived.state);
    expect(p.dead).toBeUndefined();
    expect(p).toMatchObject({ xp: 0, coins: 0, level: 3 });
    expect(p.hp).toBe(Math.max(20, Math.round(p.maxHp * 0.6)));
    expect(revived.events).toContainEqual(
      expect.objectContaining({ type: "sunny.playerRespawned", payload: expect.objectContaining({ playerId: "p1", lostXp: 37, lostCoins: 5 }) })
    );
    // Reviving while standing is a harmless no-op.
    const again = act(revived.state, "revive", {}, now + 2);
    expect(again.state).toEqual(revived.state);
  });

  it("saves the revived, penalised profile when a player leaves while down", () => {
    const state = downedPlayer();
    // They fell far from the stage start.
    Object.assign(state.playerStates.p1!, { x: 3_000, y: 200 });
    const profile = sunnyMeadowDefinition.extractPlayerProfile!({ state, now }, "p1") as {
      xp: number; coins: number; hp: number; level: number; lastX: number; lastY: number;
    };
    expect(profile).toMatchObject({ xp: 0, coins: 0, level: 3 });
    expect(profile.hp).toBeGreaterThan(0);
    // Rejoining must not revive them where they died: the saved position is the stage start.
    const stage = getStageById("stage-1");
    const spawnX = (stage.spawn.x + 0.5) * stage.meta.tileSize;
    expect(Math.abs(profile.lastX - spawnX)).toBeLessThanOrEqual((SPAWN_SPREAD_TILES + 1) * stage.meta.tileSize);
    expect(profile.lastX).not.toBe(3_000);
    // The room state itself is untouched: they are still down until they leave or revive.
    expect(player(state)).toMatchObject({ dead: true, hp: 0 });
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
