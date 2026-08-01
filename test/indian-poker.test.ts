import { env } from "cloudflare:workers";
import { runDurableObjectAlarm } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";

type PublicViewForTest = {
  phase: "idle" | "betting" | "reveal" | "gameOver";
  round: number;
  pot: number;
  ante: number;
  chips: Record<string, number>;
  bets: Record<string, number>;
  toCall: Record<string, number>;
  currentPlayerId?: string;
  revealed: boolean;
  cards?: Record<string, string>;
  roundResult?: { winnerPlayerId?: string; pot: number; reason: string };
  nextRoundRequests: string[];
  winnerPlayerId?: string;
  lastAggressorPlayerId?: string;
  raiseCount: number;
  maxRaises: number;
};

type PrivateViewForTest = {
  opponentPlayerId?: string;
  opponentCard: string | null;
  myCard: string | null | "hidden";
  myCardRevealed: boolean;
  availableActions: string[];
};

function publicOf(snapshot: { publicView: unknown }): PublicViewForTest {
  return snapshot.publicView as PublicViewForTest;
}

function privateOf(snapshot: { privateView: unknown }): PrivateViewForTest {
  return snapshot.privateView as PrivateViewForTest;
}

/**
 * Bot turns run on a real Durable Object alarm, and the runtime may fire it
 * before the test helper gets a chance to. Poll for the outcome instead of
 * asserting on who triggered the alarm.
 */
async function waitForRoom(
  roomStub: DurableObjectStub,
  room: RoomDO,
  predicate: (view: PublicViewForTest) => boolean,
  label: string
): Promise<PublicViewForTest> {
  for (let attempt = 0; attempt < 20; attempt += 1) {
    const view = publicOf(await room.getSnapshot("host"));
    if (predicate(view)) return view;
    await new Promise((resolve) => setTimeout(resolve, 120));
    await runDurableObjectAlarm(roomStub);
  }
  throw new Error(`timed out waiting for ${label}`);
}

async function seatTwoPlayers(name: string): Promise<RoomDO> {
  const room = env.ROOM_DO.getByName(`room:${name}`) as unknown as RoomDO;
  await room.initialize({
    roomId: name,
    gameId: "indian-poker",
    mode: "default",
    minPlayers: 2,
    maxPlayers: 2
  });
  await room.join({ playerId: "p1" });
  await room.join({ playerId: "p2" });
  await room.setReady("p2", true);
  await room.startGame("p1");
  return room;
}

describe("Indian Poker through RoomDO", () => {
  it("holds an idle table until the game starts", async () => {
    const room = env.ROOM_DO.getByName("room:ip-waiting") as unknown as RoomDO;
    await room.initialize({
      roomId: "ip-waiting",
      gameId: "indian-poker",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2
    });
    await room.join({ playerId: "p1" });

    const snapshot = await room.getSnapshot("p1");
    expect(snapshot.phase).toBe("waiting");
    expect(publicOf(snapshot)).toMatchObject({ phase: "idle", round: 0, pot: 0, revealed: false });
    expect(publicOf(snapshot).cards).toBeUndefined();
    expect(privateOf(snapshot)).toMatchObject({ myCard: null, opponentCard: null });
  });

  it("deals one readable card per forehead and hides each player's own card", async () => {
    const room = await seatTwoPlayers("ip-deal");
    const p1 = await room.getSnapshot("p1");
    const p2 = await room.getSnapshot("p2");

    expect(p1.phase).toBe("active");
    expect(publicOf(p1)).toMatchObject({
      phase: "betting",
      round: 1,
      pot: 10,
      chips: { p1: 95, p2: 95 },
      toCall: { p1: 0, p2: 0 },
      currentPlayerId: "p1",
      revealed: false
    });

    const p1View = privateOf(p1);
    const p2View = privateOf(p2);
    expect(p1View.myCard).toBe("hidden");
    expect(p2View.myCard).toBe("hidden");
    expect(p1View.opponentPlayerId).toBe("p2");
    expect(p2View.opponentPlayerId).toBe("p1");
    // Each player reads the card the other one cannot see.
    expect(p1View.opponentCard).toBeTruthy();
    expect(p2View.opponentCard).toBeTruthy();
    expect(p1View.opponentCard).not.toBe(p2View.opponentCard);

    // Neither the shared table nor the other seat may expose a player's own card.
    expect(JSON.stringify(p1.publicView)).not.toContain(p1View.opponentCard!);
    expect(JSON.stringify(p1.publicView)).not.toContain(p2View.opponentCard!);
    expect(JSON.stringify(p1View)).not.toContain(p2View.opponentCard!);
    expect(p1View.availableActions).toEqual(["check", "bet", "die"]);
    expect(p2View.availableActions).toEqual([]);
  });

  it("rejects stale versions, duplicate action ids, and out-of-turn bets", async () => {
    const room = await seatTwoPlayers("ip-guards");
    const start = await room.getSnapshot("p1");

    await expect(
      room.trySubmitAction({
        playerId: "p2",
        clientActionId: "wrong-turn",
        expectedVersion: start.version,
        type: "bet",
        payload: { amount: 10 }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_turn" } });

    const ack = await room.submitAction({
      playerId: "p1",
      clientActionId: "bet-1",
      expectedVersion: start.version,
      type: "bet",
      payload: { amount: 10 }
    });
    expect(ack.version).toBe(start.version + 1);
    expect(ack.events[0]).toMatchObject({ type: "indian-poker.bet", visibility: "public" });

    // Replaying the same client action id must not move chips twice.
    const replay = await room.submitAction({
      playerId: "p1",
      clientActionId: "bet-1",
      expectedVersion: start.version,
      type: "bet",
      payload: { amount: 10 }
    });
    expect(replay.version).toBe(ack.version);
    expect(publicOf(await room.getSnapshot("p1"))).toMatchObject({ pot: 20, chips: { p1: 85, p2: 95 } });

    await expect(
      room.trySubmitAction({
        playerId: "p2",
        clientActionId: "stale-call",
        expectedVersion: start.version,
        type: "call",
        payload: {}
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "stale_action" } });
  });

  it("opens both cards on a call and pays the pot to the higher rank", async () => {
    const room = await seatTwoPlayers("ip-showdown");
    const start = await room.getSnapshot("p1");
    const bet = await room.submitAction({
      playerId: "p1",
      clientActionId: "open",
      expectedVersion: start.version,
      type: "bet",
      payload: { amount: 20 }
    });
    const call = await room.submitAction({
      playerId: "p2",
      clientActionId: "answer",
      expectedVersion: bet.version,
      type: "call",
      payload: {}
    });
    expect(call.events.some((candidate) => candidate.type === "indian-poker.showdown")).toBe(true);

    const p1 = await room.getSnapshot("p1");
    const view = publicOf(p1);
    expect(view.phase).toBe("reveal");
    expect(view.revealed).toBe(true);
    expect(view.roundResult?.pot).toBe(50);
    // Both foreheads are public now, including the player's own card.
    expect(Object.keys(view.cards ?? {}).sort()).toEqual(["p1", "p2"]);
    expect(privateOf(p1).myCardRevealed).toBe(true);
    expect(privateOf(p1).myCard).toBe(view.cards?.p1);

    const winner = view.roundResult?.winnerPlayerId;
    const total = (view.chips.p1 ?? 0) + (view.chips.p2 ?? 0);
    expect(total).toBe(200);
    if (winner) {
      expect(view.chips[winner]).toBe(125);
    } else {
      expect(view.chips).toEqual({ p1: 100, p2: 100 });
    }

    // The round is over, so betting is closed.
    await expect(
      room.trySubmitAction({
        playerId: "p1",
        clientActionId: "late-bet",
        expectedVersion: call.version,
        type: "bet",
        payload: { amount: 5 }
      })
    ).resolves.toMatchObject({ ok: false, error: { code: "invalid_action" } });
  });

  it("keeps the room and both chip stacks when dealing another round", async () => {
    const room = await seatTwoPlayers("ip-next-round");
    const start = await room.getSnapshot("p1");
    const fold = await room.submitAction({
      playerId: "p1",
      clientActionId: "fold",
      expectedVersion: start.version,
      type: "die",
      payload: {}
    });

    const afterFold = publicOf(await room.getSnapshot("p1"));
    expect(afterFold.chips).toEqual({ p1: 95, p2: 105 });

    const firstRequest = await room.submitAction({
      playerId: "p1",
      clientActionId: "again-p1",
      expectedVersion: fold.version,
      type: "nextRound",
      payload: {}
    });
    // One request is not enough: the table waits for both players.
    const waiting = publicOf(await room.getSnapshot("p1"));
    expect(waiting).toMatchObject({ phase: "reveal", round: 1, nextRoundRequests: ["p1"] });

    await room.submitAction({
      playerId: "p2",
      clientActionId: "again-p2",
      expectedVersion: firstRequest.version,
      type: "nextRound",
      payload: {}
    });

    const round2 = await room.getSnapshot("p1");
    // Same room, same durable state: only the new ante leaves the stacks.
    expect(round2.roomId).toBe("ip-next-round");
    expect(round2.phase).toBe("active");
    expect(publicOf(round2)).toMatchObject({
      phase: "betting",
      round: 2,
      pot: 10,
      chips: { p1: 90, p2: 100 },
      currentPlayerId: "p2"
    });
    expect(publicOf(round2).cards).toBeUndefined();
    expect(privateOf(round2).myCard).toBe("hidden");
  });

  it("finishes the room and records a winner when a player cannot ante again", async () => {
    const room = await seatTwoPlayers("ip-match-end");
    let version = (await room.getSnapshot("p1")).version;
    let guard = 0;

    // Play all-in rounds until one stack is empty.
    while (guard < 60) {
      guard += 1;
      const snapshot = await room.getSnapshot("p1");
      const view = publicOf(snapshot);
      if (snapshot.phase === "finished") break;
      version = snapshot.version;

      const actor = view.currentPlayerId;
      expect(actor).toBeTruthy();
      const action =
        view.phase === "reveal"
          ? { type: "nextRound", payload: {} }
          : (view.toCall[actor!] ?? 0) > 0
            ? { type: "call", payload: {} }
            : { type: "bet", payload: { amount: view.chips[actor!] ?? 1 } };

      const result = await room.submitAction({
        playerId: actor!,
        clientActionId: `end-${guard}`,
        expectedVersion: version,
        type: action.type,
        payload: action.payload as Record<string, unknown>
      });
      version = result.version;
    }

    const finished = await room.getSnapshot("p1");
    expect(finished.phase).toBe("finished");
    const view = publicOf(finished);
    expect(view.phase).toBe("gameOver");
    expect(view.winnerPlayerId).toBeTruthy();
    expect(view.chips[view.winnerPlayerId!]).toBe(200);

    const results = await env.DB.prepare(
      "SELECT winner_player_id, status FROM match_results WHERE room_id = ?"
    )
      .bind("ip-match-end")
      .all<{ winner_player_id: string | null; status: string }>();
    expect(results.results[0]).toMatchObject({ status: "finished" });
    expect(results.results[0]?.winner_player_id).toBeTruthy();

    // The finished room opens the standard rematch flow with fresh stacks.
    await room.requestPlayAgain("p1");
    await room.requestPlayAgain("p2");
    const rematch = await room.getSnapshot("p1");
    expect(rematch.phase).toBe("active");
    expect(publicOf(rematch)).toMatchObject({ round: 1, chips: { p1: 95, p2: 95 } });
  });

  it("lets a bot take both betting turns and the round handshake", async () => {
    const roomStub = env.ROOM_DO.getByName("room:ip-bot");
    const room = roomStub as unknown as RoomDO;
    await room.initialize({
      roomId: "ip-bot",
      gameId: "indian-poker",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: { botTurnDelayMs: 1 }
    });
    await room.join({ playerId: "host" });
    await room.addBot({ hostPlayerId: "host", difficulty: "medium" });
    await room.startGame("host");

    const started = await room.getSnapshot("host");
    const bot = started.players.find((player) => player.kind === "bot");
    expect(bot).toBeTruthy();
    expect(publicOf(started).currentPlayerId).toBe("host");

    const fold = await room.submitAction({
      playerId: "host",
      clientActionId: "bot-fold",
      expectedVersion: started.version,
      type: "die",
      payload: {}
    });

    // The reveal handshake must name a pending player, otherwise RoomDO would
    // never schedule the bot and the table would stall here forever.
    const reveal = publicOf(await room.getSnapshot("host"));
    expect(reveal.phase).toBe("reveal");
    expect(reveal.currentPlayerId).toBe("host");

    await room.submitAction({
      playerId: "host",
      clientActionId: "bot-again",
      expectedVersion: fold.version,
      type: "nextRound",
      payload: {}
    });
    const awaitingBot = publicOf(await room.getSnapshot("host"));
    expect(awaitingBot.currentPlayerId).toBe(bot!.playerId);

    // The bot answers the handshake, which deals round 2 with the stacks intact.
    const round2 = await waitForRoom(roomStub, room, (view) => view.round === 2, "the bot to deal round 2");
    expect(round2.phase).toBe("betting");
    expect(round2.chips.host).toBe(90);
    expect(round2.chips[bot!.playerId]).toBe(100);
    // Round 2 opens on the bot's seat, so its next turn is a betting action.
    expect(round2.currentPlayerId).toBe(bot!.playerId);

    const afterBotBet = await waitForRoom(
      roomStub,
      room,
      (view) => view.currentPlayerId === "host" || view.phase === "reveal",
      "the bot to take its betting turn"
    );
    expect(afterBotBet.round).toBe(2);
  });
});
