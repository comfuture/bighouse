import { describe, expect, it } from "vitest";
import type { RoomState } from "@bighouse/game-sdk/server";
import { ITEM_CATALOG, PLAYER_CONFIG } from "../src/catalogs";
import { validateNormalizedStage } from "../src/map-schema";
import { computeItemRespawnMs } from "../src/progression";
import {
  IDLE_REST_DELAY_MS,
  isConsecutiveSameSpotPickup,
  isPlayerInIdleRestMode,
  sunnyMeadowDefinition
} from "../src/server";
import { ALL_STAGES, getStageById } from "../src/stages/index";
import type { ServerItemState, SunnyMeadowWorldState, WorldPlayerState } from "../src/types";

function createTestRoom(now: number, playerIds = ["p1"]) {
  const room = {
    roomId: "room-respawn-policy",
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
  for (let i = 0; i < playerIds.length; i++) {
    const id = playerIds[i]!;
    const seat = {
      playerId: id,
      displayName: `용사${i + 1}`,
      seat: i,
      connected: true,
      ready: true,
      joinedAt: now
    };
    state.players.push(seat);
    state = sunnyMeadowDefinition.onPlayerJoin!({ state, now }, seat, null).state;
  }
  return state;
}

describe("@bighouse/sunny-meadow item respawn & anti-abuse policy", () => {
  it("gives treasure chests a much longer respawn cooldown and enforces a high crowd-scaled floor", () => {
    const chestSec = ITEM_CATALOG.treasure_chest!.respawnSec;
    const heartSec = ITEM_CATALOG.golden_heart!.respawnSec;
    const potionSec = ITEM_CATALOG.sweet_potion!.respawnSec;
    const appleSec = ITEM_CATALOG.red_apple!.respawnSec;
    const coinSec = ITEM_CATALOG.star_coin!.respawnSec;

    expect(chestSec).toBeGreaterThanOrEqual(240);
    expect(chestSec).toBeGreaterThanOrEqual(heartSec * 4);
    expect(chestSec).toBeGreaterThanOrEqual(potionSec * 4);
    expect(potionSec).toBeGreaterThan(appleSec);
    expect(appleSec).toBeGreaterThan(coinSec);

    // Even in a 100-player room, treasure chests never shrink below 180s (3 min)
    const soloChestMs = computeItemRespawnMs(chestSec, 1, "chest");
    const crowdChestMs = computeItemRespawnMs(chestSec, 100, "chest");
    expect(soloChestMs).toBe(chestSec * 1000);
    expect(crowdChestMs).toBeGreaterThanOrEqual(180_000);
    expect(crowdChestMs).toBeLessThan(soloChestMs);
  });

  it("spawns red_apple and sweet_potion from candidate position pools with rarer active counts and relocates them on respawn", () => {
    for (const stage of ALL_STAGES) {
      const report = validateNormalizedStage(stage);
      expect(report.valid, `${stage.meta.id}: ${report.errors.join(", ")}`).toBe(true);

      const spawns = stage.layers.itemSpawns.allIds.map((id) => stage.layers.itemSpawns.byId[id]!);
      const apples = spawns.filter((s) => s.templateId === "red_apple");
      const potions = spawns.filter((s) => s.templateId === "sweet_potion");

      expect(apples.length, `${stage.meta.id} active apples`).toBeGreaterThanOrEqual(2);
      expect(potions.length, `${stage.meta.id} active potions`).toBeGreaterThanOrEqual(2);

      for (const a of apples) {
        expect(a.candidatePositions?.length ?? 0).toBeGreaterThan(apples.length);
      }
      for (const p of potions) {
        expect(p.candidatePositions?.length ?? 0).toBeGreaterThan(potions.length);
      }
    }

    const now = 1_700_010_000_000;
    let state = createTestRoom(now, ["p1"]);
    const world = state.stageState as unknown as SunnyMeadowWorldState;
    const stage1 = getStageById("stage-1");
    const stage1Items = world.stages["stage-1"]!.items;

    // Initial pooled apples occupy distinct valid candidate positions
    const appleItems = Object.values(stage1Items).filter((it) => it.templateId === "red_apple");
    const initialIndices = new Set(appleItems.map((it) => it.candidateIndex));
    expect(initialIndices.size).toBe(appleItems.length);
    for (const it of appleItems) {
      expect(typeof it.x).toBe("number");
      expect(typeof it.y).toBe("number");
    }

    // Collect one pooled apple and let it respawn -> it MUST relocate to a different unoccupied candidate!
    const target = appleItems[0]!;
    const prevIdx = target.candidateIndex!;
    const prevX = target.x!;
    const prevY = target.y!;
    const occupiedByOthers = new Set(
      appleItems.filter((it) => it.id !== target.id).map((it) => it.candidateIndex)
    );

    const pick = sunnyMeadowDefinition.applyAction(
      { state, now: now + 100 },
      { playerId: "p1", clientActionId: "pick_ap", expectedVersion: 0, type: "collectItem", payload: { itemId: target.id } }
    );
    state = pick.state;
    const collectedItem = (state.stageState as unknown as SunnyMeadowWorldState).stages["stage-1"]!.items[target.id]!;
    expect(collectedItem.available).toBe(false);
    expect(collectedItem.respawnAt).toBe(now + 100 + ITEM_CATALOG.red_apple!.respawnSec * 1000);

    const respawnNow = collectedItem.respawnAt + 50;
    const timers = sunnyMeadowDefinition.nextTimers({ state, now: now + 200 });
    expect(timers.length).toBe(1);
    const tick = sunnyMeadowDefinition.applyTimer!({ state, now: respawnNow }, timers[0]!);
    state = tick.state;

    const respawned = (state.stageState as unknown as SunnyMeadowWorldState).stages["stage-1"]!.items[target.id]!;
    expect(respawned.available).toBe(true);
    expect(respawned.candidateIndex).not.toBe(prevIdx);
    expect(occupiedByOthers.has(respawned.candidateIndex)).toBe(false);
    expect(respawned.x !== prevX || respawned.y !== prevY).toBe(true);

    // Public view & respawn event broadcast the updated coordinates to clients
    const respawnEvent = tick.events.find((e) => e.type === "sunny.itemsRespawned");
    expect(respawnEvent?.payload).toMatchObject({
      stageId: "stage-1",
      itemIds: [target.id],
      items: [{ id: target.id, x: respawned.x, y: respawned.y }]
    });

    const pub = sunnyMeadowDefinition.getPublicView({ state, now: respawnNow }, "p1") as {
      items: Record<string, ServerItemState>;
    };
    expect(pub.items[target.id]).toEqual({ available: true, x: respawned.x, y: respawned.y });

    // Confirm coordinates correspond to a real candidate tile center in stage-1
    const spawnDef = stage1.layers.itemSpawns.byId[target.id]!;
    const cp = spawnDef.candidatePositions![respawned.candidateIndex!]!;
    expect(respawned.x).toBe((cp.x + 0.5) * stage1.meta.tileSize);
    expect(respawned.y).toBe((cp.y + 0.5) * stage1.meta.tileSize);
  });

  it("blocks item collection after 10s idle rest mode until the player actively moves or acts again", () => {
    const now = 1_700_020_000_000;
    let state = createTestRoom(now, ["p1"]);

    // Stationary idle pose signals do NOT refresh active input
    const psBefore = state.playerStates.p1 as unknown as WorldPlayerState;
    const idleSig = sunnyMeadowDefinition.handleSignal!(
      { state, now: now + 9_500 },
      "p1",
      {
        type: "playerPose",
        payload: { x: psBefore.x, y: psBefore.y, vx: 0, vy: 0, facing: 1, animState: "idle" }
      }
    );
    if (idleSig?.playerStatePatch) {
      Object.assign(state.playerStates.p1!, idleSig.playerStatePatch);
    }

    // After 10s without active input, player enters rest mode and cannot collect items
    expect(isPlayerInIdleRestMode(state.playerStates.p1 as unknown as WorldPlayerState, now + IDLE_REST_DELAY_MS)).toBe(true);
    const blocked = sunnyMeadowDefinition.applyAction(
      { state, now: now + PLAYER_CONFIG.idleRegenDelaySec * 1000 + 200 },
      { playerId: "p1", clientActionId: "idle_pick", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c1" } }
    );
    expect((blocked.state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(0);
    expect(blocked.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.actionIgnored",
        payload: expect.objectContaining({ action: "collectItem", reason: "idle_rest_mode" })
      })
    );

    // Taking passive mob damage alone does NOT break idle rest mode for item collection
    const hurt = sunnyMeadowDefinition.applyAction(
      { state, now: now + 11_000 },
      { playerId: "p1", clientActionId: "hurt_while_afk", expectedVersion: 0, type: "playerHurt", payload: { amount: 5 } }
    );
    state = hurt.state;
    const stillBlocked = sunnyMeadowDefinition.applyAction(
      { state, now: now + 11_100 },
      { playerId: "p1", clientActionId: "still_idle_pick", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c1" } }
    );
    expect((stillBlocked.state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(0);
    expect(stillBlocked.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.actionIgnored",
        payload: expect.objectContaining({ action: "collectItem", reason: "idle_rest_mode" })
      })
    );

    // Resuming active movement immediately exits rest mode and allows item collection again
    const activeSig = sunnyMeadowDefinition.handleSignal!(
      { state, now: now + 12_000 },
      "p1",
      {
        type: "playerPose",
        payload: { x: psBefore.x + 24, y: psBefore.y, vx: 180, vy: 0, facing: 1, animState: "walk" }
      }
    );
    expect(activeSig?.playerStatePatch).toHaveProperty("lastActiveInputAt", now + 12_000);
    Object.assign(state.playerStates.p1!, activeSig!.playerStatePatch);

    const allowed = sunnyMeadowDefinition.applyAction(
      { state, now: now + 12_050 },
      { playerId: "p1", clientActionId: "active_pick", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c1" } }
    );
    expect((allowed.state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(1);
    expect(allowed.events).toContainEqual(expect.objectContaining({ type: "sunny.itemCollected", payload: expect.objectContaining({ itemId: "s1_it_1c1" }) }));
  });

  it("prevents consecutive same-location same-item pickup even while active, and resets once another item is collected", () => {
    const now = 1_700_030_000_000;
    let state = createTestRoom(now, ["p1"]);

    // 1. Collect fixed star_coin s1_it_1c1
    const first = sunnyMeadowDefinition.applyAction(
      { state, now: now + 100 },
      { playerId: "p1", clientActionId: "c1_first", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c1" } }
    );
    state = first.state;
    expect((state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(1);

    // 2. Respawn s1_it_1c1 and keep player active (wiggling to defeat the 10s idle timer)
    const world = state.stageState as unknown as SunnyMeadowWorldState;
    const respawnAt = world.stages["stage-1"]!.items["s1_it_1c1"]!.respawnAt + 50;
    const timers = sunnyMeadowDefinition.nextTimers({ state, now: now + 200 });
    state = sunnyMeadowDefinition.applyTimer!({ state, now: respawnAt }, timers[0]!).state;
    expect((state.stageState as unknown as SunnyMeadowWorldState).stages["stage-1"]!.items["s1_it_1c1"]!.available).toBe(true);

    const ps = state.playerStates.p1 as unknown as WorldPlayerState;
    const wiggle = sunnyMeadowDefinition.handleSignal!(
      { state, now: respawnAt + 10 },
      "p1",
      { type: "playerPose", payload: { x: ps.x + 12, y: ps.y, vx: 90, vy: 0, facing: 1, animState: "walk" } }
    );
    Object.assign(state.playerStates.p1!, wiggle!.playerStatePatch);

    // 3. Trying to collect s1_it_1c1 consecutively at the same spot MUST be blocked!
    const camped = sunnyMeadowDefinition.applyAction(
      { state, now: respawnAt + 20 },
      { playerId: "p1", clientActionId: "c1_camp", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c1" } }
    );
    expect((camped.state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(1);
    expect(camped.events).toContainEqual(
      expect.objectContaining({
        type: "sunny.actionIgnored",
        payload: expect.objectContaining({ action: "collectItem", reason: "consecutive_same_spot_pickup" })
      })
    );
    expect(
      (camped.state.stageState as unknown as SunnyMeadowWorldState).stages["stage-1"]!.items["s1_it_1c1"]!.available
    ).toBe(true);

    // 4. Collecting a different coin elsewhere (s1_it_1c2) succeeds and unlocks s1_it_1c1 again
    const other = sunnyMeadowDefinition.applyAction(
      { state, now: respawnAt + 100 },
      { playerId: "p1", clientActionId: "c2_other", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c2" } }
    );
    state = other.state;
    expect((state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(2);

    const revisit = sunnyMeadowDefinition.applyAction(
      { state, now: respawnAt + 200 },
      { playerId: "p1", clientActionId: "c1_revisit", expectedVersion: 0, type: "collectItem", payload: { itemId: "s1_it_1c1" } }
    );
    expect((revisit.state.playerStates.p1 as unknown as WorldPlayerState).coins).toBe(3);

    // Pure helper sanity check: same template at a different location (>48px) is allowed
    expect(
      isConsecutiveSameSpotPickup(
        { stageId: "stage-1", itemId: "s1_apple_pool_1", templateId: "red_apple", x: 300, y: 500, at: now },
        { stageId: "stage-1", itemId: "s1_apple_pool_1", templateId: "red_apple", x: 820, y: 400 }
      )
    ).toBe(false);
    // Same template at the exact same spot (even a different pool ID) is blocked
    expect(
      isConsecutiveSameSpotPickup(
        { stageId: "stage-1", itemId: "s1_apple_pool_1", templateId: "red_apple", x: 300, y: 500, at: now },
        { stageId: "stage-1", itemId: "s1_apple_pool_2", templateId: "red_apple", x: 300, y: 500 }
      )
    ).toBe(true);
  });
});
