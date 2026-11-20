import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";
import { cleanupStaleRooms } from "../src/maintenance/stale-rooms";
import { D1Repository } from "../src/storage/d1";

describe("Sunny Meadow Bighouse integration (persistent world + D1 profile persistence)", () => {
  it("registers sunny-meadow in GET /games, supports drop-in/drop-out active rooms, and persists level/XP/stage/position in D1", async () => {
    // 1. Registered in GET /games
    const gamesRes = await SELF.fetch("http://example.com/games");
    expect(gamesRes.status).toBe(200);
    const gamesBody = (await gamesRes.json()) as { games: Array<{ gameId: string; maxPlayers: number }> };
    const sunny = gamesBody.games.find((g) => g.gameId === "sunny-meadow");
    expect(sunny).toBeDefined();
    expect(sunny!.maxPlayers).toBeGreaterThanOrEqual(500);

    // 2. Create room -> starts immediately in active phase (no waiting lobby lock!)
    const createRes = await SELF.fetch("http://example.com/games/sunny-meadow/lobbies/default/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "hero_alice", displayName: "앨리스" })
    });
    expect(createRes.status).toBe(200);
    const created = (await createRes.json()) as { roomId: string; doName: string; summary: { phase: string } };
    expect(created.summary.phase).toBe("active");

    // 3. Second player drops right into the ACTIVE room without waiting
    const joinRes = await SELF.fetch(`http://example.com/rooms/${created.roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "hero_bob", displayName: "밥" })
    });
    expect(joinRes.status).toBe(200);

    // Active room stays listed in lobby while capacity remains
    const listRes = await SELF.fetch("http://example.com/games/sunny-meadow/lobbies/default/rooms");
    expect(listRes.status).toBe(200);
    const listBody = (await listRes.json()) as { rooms: Array<{ roomId: string; playerCount: number }> };
    expect(listBody.rooms.some((r) => r.roomId === created.roomId && r.playerCount === 2)).toBe(true);

    const roomDo = env.ROOM_DO.getByName(created.doName) as unknown as RoomDO;

    // 4. Alice hunts enough Stage 1 mobs to gain XP and Level Up, then moves to Stage 2 and updates position
    const stage1Mobs = ["s1_mob_1a", "s1_mob_1b", "s1_mob_2a", "s1_mob_2b"];
    let actSeq = 0;
    for (const mobId of stage1Mobs) {
      for (let swing = 0; swing < 6; swing++) {
        actSeq += 1;
        const res = await roomDo.trySubmitAction({
          playerId: "hero_alice",
          clientActionId: `alice_act_${actSeq}`,
          expectedVersion: 0, // persistent world accepts concurrent actions without stale_action!
          type: "attackMob",
          payload: { mobId, knockDir: 1 }
        });
        if (!res.ok) break;
      }
    }

    const aliceSnap1 = await roomDo.getSnapshot("hero_alice");
    const alicePriv1 = aliceSnap1.privateView as { level: number; xp: number; maxHp: number; baseAtk: number };
    expect(alicePriv1.level).toBeGreaterThanOrEqual(2);
    expect(alicePriv1.maxHp).toBeGreaterThan(100);
    expect(alicePriv1.baseAtk).toBeGreaterThan(6);

    // Move Alice to Stage 2 and save a custom checkpoint position
    const stageRes = await roomDo.trySubmitAction({
      playerId: "hero_alice",
      clientActionId: "alice_to_stage2",
      expectedVersion: 0,
      type: "changeStage",
      payload: { targetStageId: "stage-2" }
    });
    expect(stageRes.ok).toBe(true);

    const cpRes = await roomDo.trySubmitAction({
      playerId: "hero_alice",
      clientActionId: "alice_cp_1",
      expectedVersion: 0,
      type: "checkpoint",
      payload: { x: 1420, y: 630 }
    });
    expect(cpRes.ok).toBe(true);

    // 5. Alice leaves -> room stays ACTIVE for Bob (no activeInterruption!) and Alice's profile is persisted in D1
    const afterLeaveSummary = await roomDo.leave("hero_alice");
    expect(afterLeaveSummary.phase).toBe("active");
    expect(afterLeaveSummary.activeInterruption).toBeUndefined();
    expect(afterLeaveSummary.playerCount).toBe(1);

    const repo = new D1Repository(env.DB);
    const saved = await repo.getPlayerProfile("sunny-meadow", "hero_alice");
    expect(saved).not.toBeNull();
    expect(saved!.profile.level).toBe(alicePriv1.level);
    expect(saved!.profile.lastStageId).toBe("stage-2");
    expect(saved!.profile.lastX).toBe(1420);
    expect(saved!.profile.lastY).toBe(630);

    // 6. Alice joins a BRAND NEW room -> D1 restores exact Level, XP, Stage 2, and (1420, 630)!
    const newRoomRes = await SELF.fetch("http://example.com/games/sunny-meadow/lobbies/default/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "hero_alice", displayName: "앨리스" })
    });
    expect(newRoomRes.status).toBe(200);
    const newRoom = (await newRoomRes.json()) as { doName: string };
    const newRoomDo = env.ROOM_DO.getByName(newRoom.doName) as unknown as RoomDO;
    const restoredSnap = await newRoomDo.getSnapshot("hero_alice");
    const restored = restoredSnap.privateView as {
      level: number;
      xp: number;
      stageId: string;
      x: number;
      y: number;
    };
    expect(restored.level).toBe(alicePriv1.level);
    expect(restored.xp).toBe(alicePriv1.xp);
    expect(restored.stageId).toBe("stage-2");
    expect(restored.x).toBe(1420);
    expect(restored.y).toBe(630);
  });

  it("persists cooperative XP for both contributors and allows simultaneous item pickup in live RoomDO", async () => {
    const createRes = await SELF.fetch("http://example.com/games/sunny-meadow/lobbies/default/rooms", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "coop_p1", displayName: "용사1" })
    });
    const created = (await createRes.json()) as { roomId: string; doName: string };
    await SELF.fetch(`http://example.com/rooms/${created.roomId}/join`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "coop_p2", displayName: "용사2" })
    });

    const roomDo = env.ROOM_DO.getByName(created.doName) as unknown as RoomDO;

    // Both players grab the same coin nearly simultaneously
    const p1Coin = await roomDo.trySubmitAction({
      playerId: "coop_p1",
      clientActionId: "c1",
      expectedVersion: 0,
      type: "collectItem",
      payload: { itemId: "s1_it_1c1" }
    });
    const p2Coin = await roomDo.trySubmitAction({
      playerId: "coop_p2",
      clientActionId: "c2",
      expectedVersion: 0,
      type: "collectItem",
      payload: { itemId: "s1_it_1c1" }
    });
    expect(p1Coin.ok).toBe(true);
    expect(p2Coin.ok).toBe(true);

    // p1 hits mob first, p2 finishes it -> BOTH earn XP and persist to D1!
    await roomDo.trySubmitAction({
      playerId: "coop_p1",
      clientActionId: "hit_p1",
      expectedVersion: 0,
      type: "attackMob",
      payload: { mobId: "s1_mob_1a", knockDir: 1, damageRoll: 0.5 }
    });
    for (let i = 0; i < 4; i++) {
      const r = await roomDo.trySubmitAction({
        playerId: "coop_p2",
        clientActionId: `hit_p2_${i}`,
        expectedVersion: 0,
        type: "attackMob",
        payload: { mobId: "s1_mob_1a", knockDir: 1, damageRoll: 0.5 }
      });
      if (!r.ok) break;
    }

    const repo = new D1Repository(env.DB);
    const prof1 = await repo.getPlayerProfile("sunny-meadow", "coop_p1");
    const prof2 = await repo.getPlayerProfile("sunny-meadow", "coop_p2");
    expect(Number(prof1?.profile.xp ?? 0)).toBeGreaterThan(0);
    expect(Number(prof2?.profile.xp ?? 0)).toBeGreaterThan(0);
    expect(Number(prof1?.profile.coins ?? 0)).toBe(1);
    expect(Number(prof2?.profile.coins ?? 0)).toBe(1);
  });

  it("provisions 3 permanent named rooms that never disappear when empty or after stale cleanup", async () => {
    const listRes1 = await SELF.fetch("http://example.com/games/sunny-meadow/lobbies/default/rooms");
    expect(listRes1.status).toBe(200);
    const list1 = (await listRes1.json()) as {
      rooms: Array<{ roomId: string; roomName?: string; isFixed?: boolean; playerCount: number; status: string }>;
    };

    const fixedIds = list1.rooms.filter((r) => r.isFixed).map((r) => ({ id: r.roomId, name: r.roomName }));
    expect(fixedIds).toEqual([
      { id: "room_sunny_clover", name: "클로버 초원 (채널 1)" },
      { id: "room_sunny_acorn", name: "도토리 숲 (채널 2)" },
      { id: "room_sunny_starlight", name: "별빛 언덕 (채널 3)" }
    ]);

    // Join the first fixed named room, then leave so it has 0 players
    const joinRes = await SELF.fetch("http://example.com/rooms/room_sunny_clover/join", {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ playerId: "solo_traveler", displayName: "나그네" })
    });
    expect(joinRes.status).toBe(200);
    const joined = (await joinRes.json()) as { doName: string; summary: { roomName?: string; fixed?: boolean; playerCount: number } };
    expect(joined.summary.roomName).toBe("클로버 초원 (채널 1)");
    expect(joined.summary.fixed).toBe(true);
    expect(joined.summary.playerCount).toBe(1);

    const cloverDo = env.ROOM_DO.getByName(joined.doName) as unknown as RoomDO;
    const afterLeave = await cloverDo.leave("solo_traveler");
    expect(afterLeave.phase).toBe("active");
    expect(afterLeave.playerCount).toBe(0);

    // Run stale room cleanup far in the future -> fixed rooms MUST NOT be closed!
    const cleanup = await cleanupStaleRooms(env, { now: Date.now() + 24 * 60 * 60 * 1000 });
    expect(cleanup.cleaned).toBe(0);

    // Lobby still lists all 3 named fixed rooms with 0 players, ready to join
    const listRes2 = await SELF.fetch("http://example.com/games/sunny-meadow/lobbies/default/rooms");
    expect(listRes2.status).toBe(200);
    const list2 = (await listRes2.json()) as {
      rooms: Array<{ roomId: string; roomName?: string; isFixed?: boolean; playerCount: number; status: string }>;
    };
    const clover = list2.rooms.find((r) => r.roomId === "room_sunny_clover");
    expect(clover).toBeDefined();
    expect(clover!.roomName).toBe("클로버 초원 (채널 1)");
    expect(clover!.isFixed).toBe(true);
    expect(clover!.playerCount).toBe(0);
    expect(clover!.status).toBe("active");
  });
});
