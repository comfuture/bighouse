import { env } from "cloudflare:workers";
import { runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";
import type { RoomState } from "../src/core/game";
import type { YutnoriStage } from "../packages/yutnori/src/types";

type RoomStub = ReturnType<typeof env.ROOM_DO.getByName>;
async function createNearFinish(mode: "solo" | "team-2v2") {
  const id = `yut-result-${crypto.randomUUID()}`;
  const room = env.ROOM_DO.getByName(`room:${id}`) as unknown as RoomDO;
  const count = mode === "solo" ? 2 : 4;
  await room.initialize({ roomId: id, gameId: "yutnori", mode, minPlayers: count, maxPlayers: count });
  for (let i = 0; i < count; i++) await room.join({ playerId: `p${i}` });
  for (let i = 1; i < count; i++) await room.setReady(`p${i}`, true);
  await room.startGame("p0");
  await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => {
    const row = ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one();
    const state = JSON.parse(row.state_json) as RoomState;
    const stage = state.stageState as unknown as YutnoriStage;
    for (const piece of stage.pieces.filter((entry) => entry.teamId === "A")) {
      piece.nodeId = "o0"; piece.stackId = "A1";
    }
    stage.turn.pending = [{ rollId: "winning-roll", outcome: "do", steps: 1 }];
    stage.turn.throwsRemaining = 0;
    ctx.storage.sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
  });
  const before = await room.getSnapshot("p0");
  const ack = await room.submitAction({ playerId: "p0", clientActionId: "winning-move", expectedVersion: before.version, type: "movePiece", payload: { rollId: "winning-roll", pieceId: "A1", pathId: "outer" } });
  return { id, room, ack, matchId: before.publicView.matchId };
}

async function results(roomId: string) {
  return (await env.DB.prepare("SELECT winner_player_id, result_json, status FROM match_results WHERE room_id = ?").bind(roomId).all<{ winner_player_id: string | null; result_json: string; status: string }>()).results;
}

describe("Yutnori match results", () => {
  it("persists a solo winner and preserves its result across rematch", async () => {
    const { id, room, ack, matchId } = await createNearFinish("solo");
    expect(ack.events.find((event) => event.type === "yutnori.finished")?.payload.winnerPlayerId).toBe("p0");
    const stored = await results(id);
    expect(stored).toHaveLength(1);
    expect(stored[0]).toMatchObject({ winner_player_id: "p0", status: "finished" });
    expect(JSON.parse(stored[0]!.result_json)).toMatchObject({ winnerPlayerId: "p0" });
    await room.requestPlayAgain("p0");
    expect((await room.getSummary()).phase).toBe("finished");
    await room.requestPlayAgain("p1");
    const rematch = await room.getSnapshot("p0");
    expect(rematch.phase).toBe("active");
    expect(rematch.publicView.matchId).not.toBe(matchId);
    expect(rematch.publicView.winnerPlayerId).toBeUndefined();
    expect(await results(id)).toEqual(stored);
  });

  it("persists the entire winning team rather than naming its final operator as sole winner", async () => {
    const { id, room, ack, matchId } = await createNearFinish("team-2v2");
    const finished = await room.getSnapshot("p0");
    expect(finished.publicView).toMatchObject({ winnerTeamId: "A", winnerPlayerIds: ["p0", "p2"] });
    expect(finished.publicView.winnerPlayerId).toBeUndefined();
    const event = ack.events.find((entry) => entry.type === "yutnori.finished")!;
    expect(event.payload.winnerPlayerId).toBeUndefined();
    const stored = await results(id);
    expect(stored).toHaveLength(1);
    expect(stored[0]!.winner_player_id).toBeNull();
    expect(JSON.parse(stored[0]!.result_json)).toMatchObject({ winnerPlayerId: null, winnerTeamId: "A", winnerPlayerIds: ["p0", "p2"], matchId });
    await room.leaveFinishedGame("p2");
    const waiting = await room.getSnapshot("p0");
    expect(waiting.phase).toBe("waiting");
    expect(waiting.players).toHaveLength(3);
    expect(waiting.publicView.winnerTeamId).toBeUndefined();
    expect(await results(id)).toEqual(stored);
  });
});

describe("team matchmaking retries", () => {
  it("leaves tickets pending after a failed start so a retry can recover", async () => {
    const matcher = env.MATCHMAKER_DO.getByName(`yut-failed-start-${crypto.randomUUID()}`);
    const base = { gameId: "yutnori", mode: "team-2v2" };
    for (let i = 0; i < 3; i++) await matcher.enqueue({ ...base, playerId: `r${i}` });
    const failure = await runInDurableObject(matcher, async (instance, ctx) => {
      const enqueue = (instance as unknown as { enqueueTicket(input: { gameId: string; mode: string; playerId: string }): Promise<unknown> }).enqueueTicket;
      const failingRoom = {
        initialize: async () => undefined,
        join: async () => undefined,
        setReady: async () => undefined,
        startGame: async () => { throw new Error("injected start failure"); }
      };
      const harness = { ctx, env: { ...env, ROOM_DO: { getByName: () => failingRoom } } };
      Object.setPrototypeOf(harness, Object.getPrototypeOf(instance));
      try {
        await enqueue.call(harness, { ...base, playerId: "r3" });
        return "no failure";
      } catch (error) {
        return (error as Error).message;
      }
    });
    expect(failure).toBe("injected start failure");
    expect(await matcher.pendingCount("yutnori", "team-2v2")).toBe(4);
    const queued = await runInDurableObject(matcher, (_instance, ctx) => ctx.storage.sql.exec<{ ticket_id: string; status: string }>("SELECT ticket_id, status FROM queue").toArray());
    expect(queued.every((row) => row.status === "pending")).toBe(true);
    for (const row of queued) expect(await env.DB.prepare("SELECT status FROM match_tickets WHERE ticket_id = ?").bind(row.ticket_id).first("status")).toBe("pending");
    const recovered = await matcher.enqueue({ ...base, playerId: "r3" });
    expect(recovered.matchedRoomId).toBeTruthy();
    expect(await matcher.pendingCount("yutnori", "team-2v2")).toBe(0);
  });

  it("reuses a pending ticket and waits for four unique players before starting", async () => {
    const matcher = env.MATCHMAKER_DO.getByName(`yut-retry-${crypto.randomUUID()}`);
    const input = { gameId: "yutnori", mode: "team-2v2", playerId: "m0" };
    const [first, repeat] = await Promise.all([matcher.enqueue(input), matcher.enqueue(input)]);
    expect(repeat.ticket.ticketId).toBe(first.ticket.ticketId);
    expect(await matcher.pendingCount("yutnori", "team-2v2")).toBe(1);
    const second = await matcher.enqueue({ ...input, playerId: "m1" });
    const third = await matcher.enqueue({ ...input, playerId: "m2" });
    expect(second.matchedRoomId).toBeUndefined();
    expect(third.matchedRoomId).toBeUndefined();
    expect((await matcher.enqueue(input)).ticket.ticketId).toBe(first.ticket.ticketId);
    for (const ticket of [first.ticket, second.ticket, third.ticket]) {
      expect(await env.DB.prepare("SELECT status FROM match_tickets WHERE ticket_id = ?").bind(ticket.ticketId).first("status")).toBe("pending");
    }
    const fourth = await matcher.enqueue({ ...input, playerId: "m3" });
    expect(fourth.matchedRoomId).toBeTruthy();
    const room = env.ROOM_DO.getByName(`room:${fourth.matchedRoomId}`) as unknown as RoomDO;
    const state = await room.getSnapshot("m0");
    expect(state.phase).toBe("active");
    expect(state.players.map((player) => player.playerId)).toEqual(["m0", "m1", "m2", "m3"]);
    expect(await matcher.pendingCount("yutnori", "team-2v2")).toBe(0);
    for (const ticket of [first.ticket, second.ticket, third.ticket, fourth.ticket]) {
      expect(await env.DB.prepare("SELECT status FROM match_tickets WHERE ticket_id = ?").bind(ticket.ticketId).first("status")).toBe("matched");
    }
  });
});
