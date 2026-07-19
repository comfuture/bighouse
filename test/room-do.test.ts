import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import { resolveBotTurnDelayMs, type RoomDO } from "../src/do/room";

type RoomDOTestAccess = {
  scheduleDisconnect(playerId: string, delayMs?: number): Promise<void>;
  confirmDisconnect(playerId: string): Promise<void>;
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

  it("lets the host add and remove ready bot players before starting", async () => {
    const room = env.ROOM_DO.getByName("room:test-bot-seats") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-bot-seats",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 3
    });
    await room.join({ playerId: "host" });

    await expect(room.tryAddBot({ hostPlayerId: "guest", difficulty: "low" })).resolves.toMatchObject({
      ok: false,
      error: { code: "forbidden" }
    });

    const withBot = await room.addBot({ hostPlayerId: "host", difficulty: "high" });
    expect(withBot).toMatchObject({ phase: "waiting", playerCount: 2, readyCount: 1, hostPlayerId: "host", version: 2 });
    const snapshot = await room.getSnapshot("host");
    const bot = snapshot.players.find((player) => player.kind === "bot");
    expect(bot).toMatchObject({
      connected: true,
      ready: true,
      botDifficulty: "high"
    });

    await expect(room.tryTransferHost("host", bot!.playerId)).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_action" }
    });

    await expect(room.startGame("host")).resolves.toMatchObject({ phase: "active", playerCount: 2, readyCount: 0 });
  });

  it("adds multiple bot players atomically without partially filling the room", async () => {
    const room = env.ROOM_DO.getByName("room:test-bot-batch") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-bot-batch",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 4
    });
    await room.join({ playerId: "host" });

    await expect(room.tryAddBot({ hostPlayerId: "host", difficulty: "high", count: 4 })).resolves.toMatchObject({
      ok: false,
      error: { code: "room_full" }
    });
    await expect(room.tryAddBot({ hostPlayerId: "host", difficulty: "medium", count: 0 })).resolves.toMatchObject({
      ok: false,
      error: { code: "invalid_action" }
    });
    expect(await room.getSummary()).toMatchObject({ version: 1, playerCount: 1, readyCount: 0 });

    const summary = await room.addBot({ hostPlayerId: "host", difficulty: "high", count: 3 });
    expect(summary).toMatchObject({ version: 2, playerCount: 4, readyCount: 3 });
    const snapshot = await room.getSnapshot("host");
    const bots = snapshot.players.filter((player) => player.kind === "bot");
    expect(bots).toHaveLength(3);
    expect(bots.map((bot) => bot.seat)).toEqual([1, 2, 3]);
    expect(bots.map((bot) => bot.displayName)).toEqual(["Bot 1", "Bot 2", "Bot 3"]);
    expect(bots.every((bot) => bot.ready && bot.connected && bot.botDifficulty === "high")).toBe(true);
  });

  it("does not require bot readiness when restarting a waiting room", async () => {
    const room = env.ROOM_DO.getByName("room:test-bot-ready-after-reset") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-bot-ready-after-reset",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 3
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.setReady("guest", true);
    await room.addBot({ hostPlayerId: "host", difficulty: "medium" });
    await room.startGame("host");
    const active = await room.getSnapshot("host");
    const bot = active.players.find((player) => player.kind === "bot");
    expect(bot).toBeTruthy();

    const winningMoves = [
      ["host", 0, 0],
      ["guest", 0, 1],
      [bot!.playerId, 0, 2],
      ["host", 1, 0],
      ["guest", 1, 1],
      [bot!.playerId, 1, 2],
      ["host", 2, 0],
      ["guest", 2, 1],
      [bot!.playerId, 2, 2],
      ["host", 3, 0],
      ["guest", 3, 1],
      [bot!.playerId, 3, 2],
      ["host", 4, 0]
    ] as const;
    let version = active.version;
    for (const [playerId, x, y] of winningMoves) {
      const result = await room.submitAction({
        playerId,
        clientActionId: `bot-ready-reset-${playerId}-${x}-${y}`,
        expectedVersion: version,
        type: "placeStone",
        payload: { x, y }
      });
      version = result.version;
    }

    await expect(room.leaveFinishedGame("guest")).resolves.toMatchObject({
      phase: "waiting",
      playerCount: 2,
      readyCount: 0,
      hostPlayerId: "host"
    });
    const waiting = await room.getSnapshot("host");
    expect(waiting.players.find((player) => player.playerId === bot!.playerId)).toMatchObject({ ready: false });
    await expect(room.startGame("host")).resolves.toMatchObject({ phase: "active", playerCount: 2 });
  });

  it("enforces bot room capacity and removal authority", async () => {
    const room = env.ROOM_DO.getByName("room:test-bot-remove") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-bot-remove",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });

    await expect(room.tryAddBot({ hostPlayerId: "host", difficulty: "medium" })).resolves.toMatchObject({
      ok: false,
      error: { code: "room_full" }
    });

    await room.leave("guest");
    await room.addBot({ hostPlayerId: "host", difficulty: "low" });
    const snapshot = await room.getSnapshot("host");
    const bot = snapshot.players.find((player) => player.kind === "bot");
    expect(bot).toBeTruthy();

    await expect(room.tryRemoveBot({ hostPlayerId: "guest", botPlayerId: bot!.playerId })).resolves.toMatchObject({
      ok: false,
      error: { code: "forbidden" }
    });
    await expect(room.removeBot({ hostPlayerId: "host", botPlayerId: bot!.playerId })).resolves.toMatchObject({
      phase: "waiting",
      playerCount: 1
    });
    await expect(room.tryRemoveBot({ hostPlayerId: "host", botPlayerId: bot!.playerId })).resolves.toMatchObject({
      ok: false,
      error: { code: "player_not_found" }
    });
  });

  it("removes waiting players on leave and closes empty waiting rooms", async () => {
    const room = env.ROOM_DO.getByName("room:test-waiting-leave") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-waiting-leave",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });

    await expect(room.leave("guest")).resolves.toMatchObject({ phase: "waiting", playerCount: 1, hostPlayerId: "host" });
    const afterGuest = await room.getSnapshot("host");
    expect(afterGuest.players.map((player) => player.playerId)).toEqual(["host"]);

    await expect(room.leave("host")).resolves.toMatchObject({ phase: "closed", playerCount: 0 });
    const row = await env.DB.prepare("SELECT status, player_count, closed_at FROM room_index WHERE room_id = ?")
      .bind("test-waiting-leave")
      .first<{ status: string; player_count: number; closed_at: string | null }>();
    expect(row).toMatchObject({ status: "closed", player_count: 0 });
    expect(row?.closed_at).toBeTruthy();
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

  it("runs scheduled gomoku bot turns through the room action pipeline", async () => {
    const roomStub = env.ROOM_DO.getByName("room:test-gomoku-bot-turn");
    const room = roomStub as unknown as RoomDO;
    await room.initialize({
      roomId: "test-gomoku-bot-turn",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: { botTurnDelayMs: 1 }
    });
    await room.join({ playerId: "host" });
    await room.addBot({ hostPlayerId: "host", difficulty: "high" });
    await room.startGame("host");
    const beforeMove = await room.getSnapshot("host");
    const bot = beforeMove.players.find((player) => player.kind === "bot");
    expect(bot).toBeTruthy();

    await room.submitAction({
      playerId: "host",
      clientActionId: "host-first-move",
      expectedVersion: beforeMove.version,
      type: "placeStone",
      payload: { x: 7, y: 7 }
    });

    await new Promise((resolve) => setTimeout(resolve, 550));
    await expect(runDurableObjectAlarm(roomStub)).resolves.toBe(true);
    const afterBot = await room.getSnapshot("host");
    expect(afterBot.version).toBe(beforeMove.version + 2);
    expect(afterBot.publicView).toMatchObject({
      moveCount: 2,
      currentPlayerId: "host",
      lastMove: { playerId: bot!.playerId }
    });
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

    await testRoom.scheduleDisconnect("guest", -1);
    await room.submitAction({
      playerId: "host",
      clientActionId: "disconnect-grace-move",
      expectedVersion: 4,
      type: "placeStone",
      payload: { x: 0, y: 0 }
    });

    await testRoom.confirmDisconnect("guest");
    const snapshot = await room.getSnapshot("host");
    expect(snapshot.players.some((player) => player.playerId === "guest")).toBe(false);
    expect(snapshot.activeInterruption).toMatchObject({ reason: "player_left", playerId: "guest", hostPlayerId: "host" });
  });

  it("interrupts active games when a player leaves and lets the host restart", async () => {
    const room = env.ROOM_DO.getByName("room:test-active-leave") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-active-leave",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 3
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.join({ playerId: "third" });
    await room.setReady("guest", true);
    await room.setReady("third", true);
    await room.startGame("host");

    const interrupted = await room.leave("guest");
    expect(interrupted).toMatchObject({ phase: "active", playerCount: 2, hostPlayerId: "host" });
    const snapshot = await room.getSnapshot("host");
    expect(snapshot.players.map((player) => player.playerId)).toEqual(["host", "third"]);
    expect(snapshot.activeInterruption).toMatchObject({
      reason: "player_left",
      playerId: "guest",
      hostPlayerId: "host"
    });
    await expect(
      room.trySubmitAction({
        playerId: "host",
        clientActionId: "blocked-after-leave",
        expectedVersion: snapshot.version,
        type: "placeStone",
        payload: { x: 0, y: 0 }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "game_interrupted" } });

    const restarted = await room.restartGame("host");
    expect(restarted).toMatchObject({ phase: "active", playerCount: 2, hostPlayerId: "host" });
    const restartedSnapshot = await room.getSnapshot("third");
    expect(restartedSnapshot.activeInterruption).toBeUndefined();
    expect(restartedSnapshot.publicView).toMatchObject({ moveCount: 0 });
  });

  it("transfers host before prompting restart when the active host leaves", async () => {
    const room = env.ROOM_DO.getByName("room:test-active-host-leave") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-active-host-leave",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 3
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.join({ playerId: "third" });
    await room.setReady("guest", true);
    await room.setReady("third", true);
    await room.startGame("host");

    const interrupted = await room.leave("host");
    expect(interrupted).toMatchObject({ phase: "active", playerCount: 2, hostPlayerId: "guest" });
    const snapshot = await room.getSnapshot("guest");
    expect(snapshot.activeInterruption).toMatchObject({
      reason: "player_left",
      playerId: "host",
      hostPlayerId: "guest"
    });
    await expect(room.tryRestartGame("host")).resolves.toMatchObject({ ok: false, error: { code: "forbidden" } });
    await expect(room.restartGame("guest")).resolves.toMatchObject({ phase: "active", playerCount: 2, hostPlayerId: "guest" });
  });

  it("allows replacement players to join an interrupted active game before restart", async () => {
    const room = env.ROOM_DO.getByName("room:test-active-leave-replacement") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-active-leave-replacement",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.join({ playerId: "guest" });
    await room.setReady("guest", true);
    await room.startGame("host");

    await room.leave("guest");
    await expect(room.tryRestartGame("host")).resolves.toMatchObject({ ok: false, error: { code: "not_enough_players" } });
    await expect(room.join({ playerId: "replacement" })).resolves.toMatchObject({ phase: "active", playerCount: 2, hostPlayerId: "host" });
    const waitingForRestart = await room.getSnapshot("replacement");
    expect(waitingForRestart.activeInterruption).toMatchObject({ playerId: "guest", hostPlayerId: "host" });
    await expect(room.restartGame("host")).resolves.toMatchObject({ phase: "active", playerCount: 2, hostPlayerId: "host" });
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

  it("closes finished rooms when only bots remain after the host leaves", async () => {
    const room = env.ROOM_DO.getByName("room:test-finished-host-leaves-bot") as unknown as RoomDO;
    await room.initialize({
      roomId: "test-finished-host-leaves-bot",
      gameId: "gomoku",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "host" });
    await room.addBot({ hostPlayerId: "host", difficulty: "medium" });
    await room.startGame("host");
    const active = await room.getSnapshot("host");
    const bot = active.players.find((player) => player.kind === "bot");
    expect(bot).toBeTruthy();

    const winningMoves = [
      ["host", 0, 0],
      [bot!.playerId, 0, 1],
      ["host", 1, 0],
      [bot!.playerId, 1, 1],
      ["host", 2, 0],
      [bot!.playerId, 2, 1],
      ["host", 3, 0],
      [bot!.playerId, 3, 1],
      ["host", 4, 0]
    ] as const;
    let version = active.version;
    for (const [playerId, x, y] of winningMoves) {
      const result = await room.submitAction({
        playerId,
        clientActionId: `host-leaves-bot-${playerId}-${x}-${y}`,
        expectedVersion: version,
        type: "placeStone",
        payload: { x, y }
      });
      version = result.version;
    }

    await expect(room.leaveFinishedGame("host")).resolves.toMatchObject({ phase: "closed", playerCount: 1 });
    const row = await env.DB.prepare("SELECT status, player_count, closed_at FROM room_index WHERE room_id = ?")
      .bind("test-finished-host-leaves-bot")
      .first<{ status: string; player_count: number; closed_at: string | null }>();
    expect(row).toMatchObject({ status: "closed", player_count: 1 });
    expect(row?.closed_at).toBeTruthy();
  });

  it("keeps production bot turn delays perceptible even when room config is zero", () => {
    expect(resolveBotTurnDelayMs(0, "high", "production")).toBe(500);
    expect(resolveBotTurnDelayMs(1, "medium", "production")).toBe(500);
    expect(resolveBotTurnDelayMs(undefined, "low", "production")).toBe(1_600);
    expect(resolveBotTurnDelayMs(0, "high", "test")).toBe(0);
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
    await expect(room.join({ playerId: "guest" })).resolves.toMatchObject({ phase: "waiting", playerCount: 1 });

    await expect(room.cleanupIfStale({ now: Date.now() + 60_000 })).resolves.toMatchObject({
      cleaned: false,
      reason: "not_idle",
      summary: { phase: "waiting" }
    });
  });
});
