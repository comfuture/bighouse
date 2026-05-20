import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";

type RoomDOTestAccess = {
  scheduleDisconnect(playerId: string, delayMs?: number): Promise<void>;
};

type OneCardPublicViewForTest = {
  discardPile: string[];
  activeAttackCount: number;
  activeAttackCard?: string;
  chosenSuit?: "S" | "H" | "C" | "D";
};

function findOneCardAction(
  publicView: OneCardPublicViewForTest,
  hand: string[]
): { type: "playCard"; payload: { card: string; chosenSuit?: string } } | { type: "drawCard"; payload: Record<string, never> } {
  const playable = hand.find((card) => isPlayableOneCard(publicView, card));
  if (!playable) {
    return { type: "drawCard", payload: {} };
  }
  const rank = playable === "BJ" || playable === "CJ" ? playable : playable.slice(0, -1);
  return playable === "BJ" || playable === "CJ" || rank === "7"
    ? { type: "playCard", payload: { card: playable, chosenSuit: "S" } }
    : { type: "playCard", payload: { card: playable } };
}

function isPlayableOneCard(publicView: OneCardPublicViewForTest, card: string): boolean {
  const topCard = publicView.discardPile.at(-1);
  if (!topCard) return true;

  const isCardJoker = card === "BJ" || card === "CJ";
  const cardSuit = isCardJoker ? "J" : card.slice(-1);
  const cardRank = isCardJoker ? card : card.slice(0, -1);

  if (publicView.activeAttackCount > 0 && publicView.activeAttackCard) {
    const attackCard = publicView.activeAttackCard;
    const isAttackJoker = attackCard === "BJ" || attackCard === "CJ";
    const attackRank = isAttackJoker ? attackCard : attackCard.slice(0, -1);
    if (attackRank === "2") return cardRank === "2" || cardRank === "A" || isCardJoker;
    if (attackRank === "A") return cardRank === "A" || isCardJoker;
    if (attackCard === "BJ") return card === "CJ";
    return false;
  }

  if (isCardJoker) return true;
  const isTopJoker = topCard === "BJ" || topCard === "CJ";
  const topSuit = isTopJoker ? "J" : topCard.slice(-1);
  const topRank = isTopJoker ? topCard : topCard.slice(0, -1);
  if ((isTopJoker || topRank === "7") && publicView.chosenSuit) {
    return cardSuit === publicView.chosenSuit;
  }
  return cardSuit === topSuit || cardRank === topRank;
}

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
    expect(started).toMatchObject({ phase: "active", playerCount: 2, readyCount: 0, version: 4 });

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
      readyCount: 0
    });
  });

  it("allows existing players to reconnect but rejects new players after waiting", async () => {
    const room = env.ROOM_DO.getByName("room:test-join-phase") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-join-phase",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.setReady("guest", true);
    await room.startGame("host");

    await expect(room.tryJoin({ playerId: "late-active" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_room_phase" }
    });
    await expect(room.join({ playerId: "host" })).resolves.toMatchObject({ phase: "active", playerCount: 2 });

    const winningMoves = [
      ["host", 0, 0],
      ["guest", 0, 1],
      ["host", 1, 0],
      ["guest", 1, 1],
      ["host", 2, 0],
      ["guest", 2, 1],
      ["host", 3, 0],
      ["guest", 3, 1],
      ["host", 4, 0]
    ] as const;
    let version = 4;
    for (const [playerId, x, y] of winningMoves) {
      const result = await room.submitAction({
        playerId,
        clientActionId: `phase-${playerId}-${x}-${y}`,
        expectedVersion: version,
        type: "placeStone",
        payload: { x, y }
      });
      version = result.version;
    }

    await expect(room.tryJoin({ playerId: "late-finished" })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_room_phase" }
    });
    await expect(room.join({ playerId: "guest" })).resolves.toMatchObject({ phase: "finished", playerCount: 2 });
    await room.leaveFinishedGame("host");
    await expect(room.join({ playerId: "replacement" })).resolves.toMatchObject({ phase: "waiting", playerCount: 2 });
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

  it("starts one card rooms and accepts validated card actions", async () => {
    const room = env.ROOM_DO.getByName("room:test-onecard") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-onecard",
      gameId: "onecard",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 4,
      config: { seed: "onecard-roomdo-test" }
    });
    await room.join({ playerId: "p1" });
    await room.join({ playerId: "p2" });
    const waitingSnapshot = await room.getSnapshot("p1");
    expect(waitingSnapshot.publicView).toMatchObject({ discardPile: [], deckCount: 0 });
    expect(waitingSnapshot.privateView).toMatchObject({ hand: [] });

    await room.setReady("p2", true);
    await expect(room.startGame("p1")).resolves.toMatchObject({ phase: "active", playerCount: 2 });

    const p1 = await room.getSnapshot("p1");
    const p2 = await room.getSnapshot("p2");
    expect(p1.privateView).toMatchObject({ hand: expect.any(Array) });
    expect(p2.privateView).toMatchObject({ hand: expect.any(Array) });
    expect((p1.privateView as { hand: string[] }).hand).toHaveLength(7);
    expect((p2.privateView as { hand: string[] }).hand).toHaveLength(7);
    expect(JSON.stringify(p1.publicView)).not.toContain((p1.privateView as { hand: string[] }).hand[0]!);

    await expect(
      room.trySubmitAction({
        playerId: "p1",
        clientActionId: "bad-suit",
        expectedVersion: p1.version,
        type: "playCard",
        payload: { card: "BJ", chosenSuit: "X" }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_action" } });

    const playable = findOneCardAction(p1.publicView as OneCardPublicViewForTest, (p1.privateView as { hand: string[] }).hand);
    const ack = await room.submitAction({
      playerId: "p1",
      clientActionId: "onecard-action-1",
      expectedVersion: p1.version,
      type: playable.type,
      payload: playable.payload
    });
    expect(ack.version).toBe(p1.version + 1);
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

  it("keeps durable disconnect grace pending when game timers are rescheduled", async () => {
    const roomStub = env.ROOM_DO.getByName("room:test-disconnect-grace");
    const room = roomStub as unknown as RoomDO;
    const testRoom = roomStub as unknown as RoomDOTestAccess;
    await room.initialize({
      roomId: "test-disconnect-grace",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.setReady("guest", true);
    await room.startGame("host");

    await testRoom.scheduleDisconnect("guest", 100);
    await room.submitAction({
      playerId: "host",
      clientActionId: "disconnect-grace-move",
      expectedVersion: 4,
      type: "placeStone",
      payload: { x: 0, y: 0 }
    });

    await new Promise((resolve) => setTimeout(resolve, 110));
    await expect(runDurableObjectAlarm(roomStub)).resolves.toBe(true);
    const snapshot = await room.getSnapshot("host");
    expect(snapshot.players.find((player) => player.playerId === "guest")).toMatchObject({ connected: false });
  });

  it("supports rematch requests and finished-game leaves", async () => {
    const room = env.ROOM_DO.getByName("room:test-rematch") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-rematch",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.setReady("guest", true);
    await room.startGame("host");

    const winningMoves = [
      ["host", 0, 0],
      ["guest", 0, 1],
      ["host", 1, 0],
      ["guest", 1, 1],
      ["host", 2, 0],
      ["guest", 2, 1],
      ["host", 3, 0],
      ["guest", 3, 1],
      ["host", 4, 0]
    ] as const;
    let version = 4;
    for (const [playerId, x, y] of winningMoves) {
      const result = await room.submitAction({
        playerId,
        clientActionId: `${playerId}-${x}-${y}`,
        expectedVersion: version,
        type: "placeStone",
        payload: { x, y }
      });
      version = result.version;
    }

    const finished = await room.getSnapshot("host");
    expect(finished.phase).toBe("finished");
    expect(finished.publicView).toMatchObject({ winnerPlayerId: "host" });

    await room.requestPlayAgain("host");
    await expect(room.getSnapshot("guest")).resolves.toMatchObject({ rematchRequests: ["host"] });
    const rematched = await room.requestPlayAgain("guest");
    expect(rematched).toMatchObject({ phase: "active", playerCount: 2, readyCount: 0 });
    const resetSnapshot = await room.getSnapshot("host");
    expect(resetSnapshot).toMatchObject({ phase: "active", rematchRequests: [] });
    expect(resetSnapshot.publicView).toMatchObject({ moveCount: 0 });
  });

  it("resets to waiting and transfers host when the finished-game host leaves", async () => {
    const room = env.ROOM_DO.getByName("room:test-finished-leave") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-finished-leave",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.setReady("guest", true);
    await room.startGame("host");

    const winningMoves = [
      ["host", 0, 0],
      ["guest", 0, 1],
      ["host", 1, 0],
      ["guest", 1, 1],
      ["host", 2, 0],
      ["guest", 2, 1],
      ["host", 3, 0],
      ["guest", 3, 1],
      ["host", 4, 0]
    ] as const;
    let version = 4;
    for (const [playerId, x, y] of winningMoves) {
      const result = await room.submitAction({
        playerId,
        clientActionId: `leave-${playerId}-${x}-${y}`,
        expectedVersion: version,
        type: "placeStone",
        payload: { x, y }
      });
      version = result.version;
    }

    const waiting = await room.leaveFinishedGame("host");
    expect(waiting).toMatchObject({ phase: "waiting", playerCount: 1, readyCount: 0, hostPlayerId: "guest" });
    const snapshot = await room.getSnapshot("guest");
    expect(snapshot.players).toHaveLength(1);
    expect(snapshot.players[0]).toMatchObject({ playerId: "guest", seat: 0, ready: false });
    expect(snapshot.publicView).toMatchObject({ moveCount: 0 });
  });

  it("closes stale rooms with no live clients", async () => {
    const room = env.ROOM_DO.getByName("room:test-stale-room") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-stale-room",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });

    await expect(room.cleanupIfStale({ now: Date.now() + 60_000 })).resolves.toMatchObject({
      cleaned: false,
      reason: "not_idle"
    });
    const result = await room.cleanupIfStale({ now: Date.now() + 5 * 60_000 + 1 });
    expect(result).toMatchObject({
      cleaned: true,
      reason: "stale_no_connections",
      summary: { phase: "closed", playerCount: 2 }
    });

    const row = await env.DB.prepare("SELECT status, closed_at FROM room_index WHERE room_id = ?")
      .bind("test-stale-room")
      .first<{ status: string; closed_at: string | null }>();
    expect(row?.status).toBe("closed");
    expect(row?.closed_at).toBeTruthy();
  });

  it("does not close stale rooms after a player reconnects", async () => {
    const room = env.ROOM_DO.getByName("room:test-stale-reconnect") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-stale-reconnect",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.leave("host");
    await room.leave("guest");
    await room.join({ playerId: "guest" });

    await expect(room.cleanupIfStale({ now: Date.now() + 60_000 })).resolves.toMatchObject({
      cleaned: false,
      reason: "not_idle",
      summary: { phase: "waiting" }
    });
  });
});
