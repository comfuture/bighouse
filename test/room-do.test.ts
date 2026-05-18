import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";

describe("RoomDO", () => {
  it("handles join, duplicate action ids, stale versions, and invalid turns", async () => {
    const room = env.ROOM_DO.getByName("room:test-gomoku") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-gomoku",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "p1" });
    const joined = await room.join({ playerId: "p2" });
    expect(joined).toMatchObject({ phase: "waiting", playerCount: 2, readyCount: 0, hostPlayerId: "p1", version: 2 });
    await room.setReady("p2", true);
    const started = await room.startGame("p1");
    expect(started).toMatchObject({ phase: "active", playerCount: 2, readyCount: 1, version: 4 });

    const ack = await room.submitAction({
      playerId: "p1",
      clientActionId: "move-1",
      expectedVersion: 4,
      type: "placeStone",
      payload: { x: 0, y: 0 }
    });
    expect(ack.version).toBe(5);
    expect(ack.events[0]).toMatchObject({ type: "gomoku.stonePlaced", visibility: "public" });

    const duplicate = await room.submitAction({
      playerId: "p1",
      clientActionId: "move-1",
      expectedVersion: 2,
      type: "placeStone",
      payload: { x: 0, y: 0 }
    });
    expect(duplicate.version).toBe(ack.version);

    await expect(
      room.trySubmitAction({
        playerId: "p2",
        clientActionId: "stale-1",
        expectedVersion: 4,
        type: "placeStone",
        payload: { x: 1, y: 0 }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "stale_action" } });

    await expect(
      room.trySubmitAction({
        playerId: "p1",
        clientActionId: "invalid-turn-1",
        expectedVersion: 5,
        type: "placeStone",
        payload: { x: 1, y: 0 }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_turn" } });
  });

  it("requires ready players and host authority before starting", async () => {
    const room = env.ROOM_DO.getByName("room:test-ready-host") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-ready-host",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });

    await expect(room.tryStartGame("guest")).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });
    await expect(room.tryStartGame("host")).resolves.toMatchObject({ ok: false, error: { code: "players_not_ready" } });

    await room.setReady("guest", true);
    await room.transferHost("host", "guest");
    await expect(room.tryStartGame("host")).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });
    await expect(room.tryStartGame("guest")).resolves.toMatchObject({ ok: false, error: { code: "players_not_ready" } });
    await room.setReady("host", true);
    await expect(room.startGame("guest")).resolves.toMatchObject({
      phase: "active",
      hostPlayerId: "guest",
      readyCount: 1
    });
  });

  it("returns private card state only to the matching player", async () => {
    const room = env.ROOM_DO.getByName("room:test-card") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-card",
      gameId: "card-demo",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 4
    });
    await room.join({ playerId: "p1" });
    await room.join({ playerId: "p2" });
    await room.setReady("p2", true);
    await room.startGame("p1");

    const p1 = await room.getSnapshot("p1");
    const p2 = await room.getSnapshot("p2");
    expect(JSON.stringify(p1.publicView)).not.toContain("AS");
    expect(p1.privateView).toMatchObject({ hand: ["AS", "7H", "3C"] });
    expect(p2.privateView).toMatchObject({ hand: ["KD", "5S", "2H"] });

    const ack = await room.submitAction({
      playerId: "p1",
      clientActionId: "play-as",
      expectedVersion: 4,
      type: "playCard",
      payload: { card: "AS" }
    });
    expect(ack.events).toHaveLength(1);
    expect(ack.events[0]).toMatchObject({ type: "card.played", visibility: "public", payload: { card: "AS" } });
  });

  it("schedules and runs the room alarm for gomoku turn timers", async () => {
    const roomStub = env.ROOM_DO.getByName("room:test-alarm");
    const room = roomStub as unknown as RoomDO;
    await room.initialize({
      roomId: "test-alarm",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "p1" });
    await room.join({ playerId: "p2" });
    await room.setReady("p2", true);
    await room.startGame("p1");
    await room.submitAction({
      playerId: "p1",
      clientActionId: "move-1",
      expectedVersion: 4,
      type: "placeStone",
      payload: { x: 0, y: 0 }
    });

    await expect(runDurableObjectAlarm(roomStub)).resolves.toBe(true);
  });
});
