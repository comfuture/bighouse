import { describe, expect, it } from "vitest";
import { MOB_CATALOG, VIEWPORT } from "../src/catalogs";
import { validateNormalizedStage } from "../src/map-schema";
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
    const duringProtect = sunnyMeadowDefinition.validateAction({ state, now: respawnTime + 1000 }, {
      playerId: "p_0",
      clientActionId: "atk_during_blink",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId: targetMobId, knockDir: 1 }
    });
    expect(duringProtect.ok).toBe(false);
    if (!duringProtect.ok) {
      expect(duringProtect.code).toBe("spawn_protected");
    }

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
    const pickADup = sunnyMeadowDefinition.validateAction({ state, now: now + 250 }, {
      playerId: "pA",
      clientActionId: "pick_a_dup",
      expectedVersion: state.version,
      type: "collectItem",
      payload: { itemId: coinId }
    });
    expect(pickADup.ok).toBe(false);

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
    const expiredHit = sunnyMeadowDefinition.validateAction({ state, now: t + 2000 }, {
      playerId: "pC",
      clientActionId: "coop_c_too_late",
      expectedVersion: state.version,
      type: "attackMob",
      payload: { mobId, knockDir: 1 }
    });
    expect(expiredHit.ok).toBe(false);
  });
});
