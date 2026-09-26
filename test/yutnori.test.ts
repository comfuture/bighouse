import { env } from "cloudflare:workers";
import { SELF, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";
type RoomStub = ReturnType<typeof env.ROOM_DO.getByName>;
import type { RoomState } from "../src/core/game";
import type { YutnoriPublicView, YutnoriStage } from "../packages/yutnori/src/types";

async function createRoom(mode: "solo" | "team-2v2" = "team-2v2") {
  const id = `room_yut_${crypto.randomUUID().replaceAll("-", "")}`;
  const room = env.ROOM_DO.getByName(`room:${id}`) as unknown as RoomDO;
  const count = mode === "solo" ? 2 : 4;
  await room.initialize({ roomId: id, gameId: "yutnori", mode, minPlayers: count, maxPlayers: count });
  for (let i = 0; i < count; i++) await room.join({ playerId: `p${i}`, displayName: `Player ${i}` });
  for (let i = 1; i < count; i++) await room.setReady(`p${i}`, true);
  await room.startGame("p0");
  return { id, room };
}

async function seedMove(room: RoomDO) {
  await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => {
    const row = ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one();
    const state = JSON.parse(row.state_json) as RoomState;
    const stage = state.stageState as unknown as YutnoriStage;
    stage.turn.pending = [{ rollId: "fixture-roll", outcome: "gae", steps: 2 }];
    stage.turn.throwsRemaining = 0;
    delete stage.lastThrow;
    ctx.storage.sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
  });
}

describe("Yutnori room integration", () => {
  it("enforces mode seats through HTTP and rejects unknown modes/forged limits", async () => {
    for (const [mode, body] of [
      ["unknown", { playerId: "host" }],
      ["team-2v2", { playerId: "host", minPlayers: 2, maxPlayers: 4 }],
      ["solo", { playerId: "host", minPlayers: 3, maxPlayers: 3 }]
    ] as const) {
      const response = await SELF.fetch(`https://bighouse.test/games/yutnori/lobbies/${mode}/rooms`, { method: "POST", body: JSON.stringify(body) });
      expect(response.status).toBe(400);
    }
    const response = await SELF.fetch("https://bighouse.test/games/yutnori/lobbies/team-2v2/rooms", { method: "POST", body: JSON.stringify({ playerId: "host", config: { backDo: false } }) });
    expect(response.status).toBe(200);
    const body = await response.json() as { summary: { minPlayers: number; maxPlayers: number }; roomId: string };
    expect(body.summary).toMatchObject({ minPlayers: 4, maxPlayers: 4 });
    const room = env.ROOM_DO.getByName(`room:${body.roomId}`) as unknown as RoomDO;
    await room.join({ playerId: "second" });
    await room.join({ playerId: "third" });
    await room.setReady("second", true);
    await room.setReady("third", true);
    await expect(room.tryStartGame("host")).resolves.toMatchObject({ ok: false, error: { code: "not_enough_players" } });
    const snapshot = await room.getSnapshot("host");
    expect(snapshot.supportsBots).toBe(false);
    expect(snapshot.teams?.[0]?.playerIds).toEqual(["host", "third"]);
    expect((snapshot.publicView as unknown as YutnoriPublicView).rules.backDo).toBe(false);
    await expect(room.tryAddBot({ hostPlayerId: "host", difficulty: "low" })).resolves.toMatchObject({ ok: false, error: { code: "invalid_action" } });
  });

  it("persists exactly one throw for duplicate action IDs and restores the same public faces", async () => {
    const { room } = await createRoom("solo");
    const before = await room.getSnapshot("p0");
    const action = { playerId: "p0", clientActionId: "one-throw", expectedVersion: before.version, type: "throwYut", payload: {} };
    const first = await room.submitAction(action);
    const second = await room.submitAction(action);
    expect(second).toEqual(first);
    const viewA = await room.getSnapshot("p0");
    const viewB = await room.getSnapshot("p1");
    expect(viewA.version).toBe(before.version + 1);
    expect(viewA.publicView.lastThrow).toEqual(viewB.publicView.lastThrow);
    expect((viewA.publicView.lastThrow as { faces: boolean[] }).faces).toHaveLength(4);
    await expect(room.trySubmitAction({ ...action, clientActionId: "stale" })).resolves.toMatchObject({ ok: false, error: { code: "stale_action" } });
    await expect(room.trySubmitAction({ ...action, clientActionId: "double", expectedVersion: viewA.version })).resolves.toMatchObject({ ok: false, error: { code: "invalid_action" } });
  });

  it("relays suggestions only to teammates without version changes, rejects spoofing and throttles repeats", async () => {
    const { room } = await createRoom();
    await seedMove(room);
    const before = await room.getSnapshot("p0");
    const view = before.publicView as unknown as YutnoriPublicView;
    const move = view.legalMoves[0]!;
    const peers = await Promise.all([0, 1, 2, 3].map(async (index) => {
      const response = await room.fetch(new Request(`https://bighouse.test/ws?playerId=p${index}`, { headers: { Upgrade: "websocket" } }));
      const ws = response.webSocket!;
      ws.accept();
      const messages: Array<{ type: string; payload: Record<string, any> }> = [];
      ws.addEventListener("message", (event) => { messages.push(JSON.parse(String(event.data))); });
      return { ws, messages };
    }));
    try {
      const signal = { type: "suggestMove", payload: { matchId: view.matchId, turnId: view.turn.turnId, rollId: move.rollId, pieceId: move.pieceId, pathId: move.pathId } };
      peers[2]!.ws.send(JSON.stringify({ type: "gameSignal", playerId: "p2", signal }));
      await expect.poll(() => peers[0]!.messages.some((m) => m.type === "privateEvent" && m.payload.event.type === "yutnori.suggestion")).toBe(true);
      await expect.poll(() => peers[2]!.messages.some((m) => m.type === "ack" && m.payload.command === "gameSignal")).toBe(true);
      for (const peer of peers) peer.ws.send(JSON.stringify({ type: "ping", nonce: "barrier" }));
      await expect.poll(() => peers.every((peer) => peer.messages.some((m) => m.type === "pong"))).toBe(true);
      expect(peers[1]!.messages.some((m) => m.type === "privateEvent")).toBe(false);
      expect(peers[3]!.messages.some((m) => m.type === "privateEvent")).toBe(false);
      const after = await room.getSnapshot("p0");
      expect(after.version).toBe(before.version);
      expect(after.publicView.pieces).toEqual(before.publicView.pieces);
      peers[1]!.ws.send(JSON.stringify({ type: "gameSignal", playerId: "p2", signal }));
      await expect.poll(() => peers[1]!.messages.some((m) => m.type === "error" && m.payload.code === "forbidden")).toBe(true);
      expect(await runInDurableObject(room as unknown as RoomStub, (instance) => { try { instance.sendGameSignal("p1", signal); return false; } catch { return true; } })).toBe(true);
      // Set the rate-limit fixture to now so socket timing does not make this assertion flaky.
      await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => { ctx.storage.sql.exec("UPDATE signal_limits SET sent_at = ? WHERE player_id = 'p2'", Date.now()); });
      expect(await runInDurableObject(room as unknown as RoomStub, (instance) => { try { instance.sendGameSignal("p2", signal); return false; } catch { return true; } })).toBe(true);
      await room.submitAction({ playerId: "p0", clientActionId: "move", expectedVersion: after.version, type: "movePiece", payload: { rollId: move.rollId, pieceId: move.pieceId, pathId: move.pathId } });
      expect(await runInDurableObject(room as unknown as RoomStub, (instance) => { try { instance.sendGameSignal("p2", signal); return false; } catch { return true; } })).toBe(true);
    } finally { peers.forEach((peer) => peer.ws.close()); }
  });

  it("routes team chat through engine membership and stores the original audience", async () => {
    const { room } = await createRoom();
    const before = await room.getSnapshot("p0");
    expect(before.teams?.find((team) => team.teamId === "A")?.playerIds).toEqual(["p0", "p2"]);
    const peers = await Promise.all([0, 1, 2, 3].map(async (index) => {
      const response = await room.fetch(new Request(`https://bighouse.test/ws?playerId=p${index}`, { headers: { Upgrade: "websocket" } }));
      const ws = response.webSocket!;
      ws.accept();
      const messages: Array<{ type: string; payload: Record<string, any> }> = [];
      ws.addEventListener("message", (event) => { messages.push(JSON.parse(String(event.data))); });
      return { ws, messages };
    }));
    try {
      peers[2]!.ws.send(JSON.stringify({ type: "chat", playerId: "p2", channel: "team", expectedTeam: { teamId: "A", playerIds: ["p0", "p2"] }, teamId: "B", body: "우리 팀 전략" }));
      await expect.poll(() => peers[0]!.messages.some((m) => m.type === "chat" && m.payload.message.visibility === "team")).toBe(true);
      await expect.poll(() => peers[2]!.messages.some((m) => m.type === "ack" && m.payload.command === "chat")).toBe(true);
      for (const peer of peers) peer.ws.send(JSON.stringify({ type: "ping", nonce: "team-barrier" }));
      await expect.poll(() => peers.every((peer) => peer.messages.some((m) => m.type === "pong"))).toBe(true);
      expect(peers[1]!.messages.some((m) => m.type === "chat")).toBe(false);
      expect(peers[3]!.messages.some((m) => m.type === "chat")).toBe(false);
      const received = peers[0]!.messages.find((m) => m.type === "chat")!.payload.message;
      expect(received).toMatchObject({ teamId: "A", playerId: "p2", visibility: "team", body: "우리 팀 전략" });
      const saved = await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => ctx.storage.sql.exec<{ team_id: string; recipient_player_ids_json: string }>("SELECT team_id, recipient_player_ids_json FROM team_chat_audiences").one());
      expect(saved.team_id).toBe("A");
      expect(JSON.parse(saved.recipient_player_ids_json)).toEqual(["p0", "p2"]);
      expect((await room.getSnapshot("p0")).version).toBe(before.version);
      peers[2]!.ws.send(JSON.stringify({ type: "chat", playerId: "p2", channel: "team", targetPlayerId: "p1", body: "invalid mixed target" }));
      await expect.poll(() => peers[2]!.messages.some((m) => m.type === "error" && m.payload.code === "bad_request")).toBe(true);
      peers[2]!.ws.send(JSON.stringify({ type: "chat", playerId: "p2", channel: "team", expectedTeam: { teamId: "A", playerIds: ["p2", "former-teammate"] }, body: "stale draft" }));
      await expect.poll(() => peers[2]!.messages.some((m) => m.type === "error" && m.payload.message.includes("Your team has changed"))).toBe(true);
      expect(peers[0]!.messages.some((m) => m.type === "chat" && m.payload.message.body === "stale draft")).toBe(false);
      peers[0]!.ws.send(JSON.stringify({ type: "chat", playerId: "p0", body: "모두 안녕하세요" }));
      await expect.poll(() => peers.every((peer) => peer.messages.some((m) => m.type === "chat" && m.payload.message.body === "모두 안녕하세요"))).toBe(true);
      await room.leave("p2");
      peers[0]!.ws.send(JSON.stringify({ type: "chat", playerId: "p0", channel: "team", body: "interrupted" }));
      await expect.poll(() => peers[0]!.messages.some((m) => m.type === "error" && m.payload.code === "invalid_action")).toBe(true);
    } finally { peers.forEach((peer) => peer.ws.close()); }
  });

  it("shares team plans privately and leaves all movement authority with the thrower", async () => {
    const { room } = await createRoom();
    await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => {
      const state = JSON.parse(ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one().state_json) as RoomState;
      const stage = state.stageState as unknown as YutnoriStage;
      stage.turn.throwsRemaining = 0;
      stage.turn.pending = [{ rollId: "mo", outcome: "mo", steps: 5 }, { rollId: "gae", outcome: "gae", steps: 2 }];
      ctx.storage.sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
    });
    const before = await room.getSnapshot("p0");
    const view = before.publicView as unknown as YutnoriPublicView;
    const peers = await Promise.all([0, 1, 2, 3].map(async (index) => {
      const response = await room.fetch(new Request(`https://bighouse.test/ws?playerId=p${index}`, { headers: { Upgrade: "websocket" } }));
      const ws = response.webSocket!; ws.accept();
      const messages: Array<{ type: string; payload: Record<string, any> }> = [];
      ws.addEventListener("message", (event) => { messages.push(JSON.parse(String(event.data))); });
      return { ws, messages };
    }));
    try {
      const prefix = [{ rollId: "mo", pieceId: "A1", pathId: "outer" }];
      const base = { matchId: view.matchId, turnId: view.turn.turnId, expectedVersion: before.version, moves: prefix };
      const preview = { type: "previewPlan", payload: { ...base, revision: 1 } };
      peers[0]!.ws.send(JSON.stringify({ type: "gameSignal", playerId: "p0", signal: preview }));
      await expect.poll(() => peers[2]!.messages.some((m) => m.type === "privateEvent" && m.payload.event.type === "yutnori.preview")).toBe(true);
      const proposal = [...prefix, { rollId: "gae", pieceId: "A1", pathId: "diagonalA" }];
      const suggestion = { type: "suggestPlan", payload: { ...base, planRevision: 1, proposal } };
      peers[2]!.ws.send(JSON.stringify({ type: "gameSignal", playerId: "p2", signal: suggestion }));
      await expect.poll(() => peers[0]!.messages.some((m) => m.type === "privateEvent" && m.payload.event.type === "yutnori.planSuggestion")).toBe(true);
      for (const peer of peers) peer.ws.send(JSON.stringify({ type: "ping", nonce: "preview-barrier" }));
      await expect.poll(() => peers.every((peer) => peer.messages.some((m) => m.type === "pong"))).toBe(true);
      expect(peers[1]!.messages.some((m) => m.type === "privateEvent")).toBe(false);
      expect(peers[3]!.messages.some((m) => m.type === "privateEvent")).toBe(false);
      const after = await room.getSnapshot("p0");
      expect(after.version).toBe(before.version);
      expect(after.publicView.pieces).toEqual(before.publicView.pieces);
      const proposedAction = { playerId: "p2", clientActionId: "teammate-cannot-commit", expectedVersion: after.version, type: "commitMoves", payload: { matchId: view.matchId, turnId: view.turn.turnId, moves: proposal } };
      expect((await room.trySubmitAction(proposedAction)).ok).toBe(false);
      expect(await runInDurableObject(room as unknown as RoomStub, (instance) => {
        try { instance.sendGameSignal("p1", preview); return false; } catch { return true; }
      })).toBe(true);
      expect(await runInDurableObject(room as unknown as RoomStub, (instance) => {
        try { instance.sendGameSignal("p0", { ...preview, payload: { ...preview.payload, expectedVersion: before.version - 1 } }); return false; } catch { return true; }
      })).toBe(true);
      await room.submitAction({ ...proposedAction, playerId: "p0", clientActionId: "thrower-confirms-proposal" });
      const confirmed = await room.getSnapshot("p0");
      expect(confirmed.version).toBe(before.version + 1);
      expect((confirmed.publicView as unknown as YutnoriPublicView).pieces.find((piece) => piece.pieceId === "A1")?.nodeId).toBe("a2");
    } finally { peers.forEach((peer) => peer.ws.close()); }
  });

  it.each([
    { order: ["mo", "gae"], paths: ["outer", "diagonalA"], destination: "a2" },
    { order: ["gae", "mo"], paths: ["outer", "outer"], destination: "o7" }
  ])("commits mixed results in player-chosen order: $order", async ({ order, paths, destination }) => {
    const { room } = await createRoom("solo");
    await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => {
      const state = JSON.parse(ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one().state_json) as RoomState;
      const stage = state.stageState as unknown as YutnoriStage;
      stage.turn.throwsRemaining = 0;
      // Persisted pre-upgrade dispositions must no longer enforce an order.
      stage.turn.pending = [
        { rollId: "mo", outcome: "mo", steps: 5, disposition: "banked" },
        { rollId: "gae", outcome: "gae", steps: 2, disposition: "immediate" }
      ];
      ctx.storage.sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
    });
    const before = await room.getSnapshot("p0");
    const view = before.publicView as unknown as YutnoriPublicView;
    const action = {
      playerId: "p0", clientActionId: "mixed-order", expectedVersion: before.version, type: "commitMoves",
      payload: { matchId: view.matchId, turnId: view.turn.turnId, moves: order.map((rollId, i) => ({ rollId, pieceId: "A1", pathId: paths[i]! })) }
    };
    const first = await room.submitAction(action);
    expect(await room.submitAction(action)).toEqual(first);
    const after = await room.getSnapshot("p0");
    const stage = after.publicView as unknown as YutnoriPublicView;
    expect(after.version).toBe(before.version + 1);
    expect(stage.pieces.find((piece) => piece.pieceId === "A1")?.nodeId).toBe(destination);
    expect(stage.lastMoveSequence?.moves.map((move) => move.rollId)).toEqual(order);
    expect(stage.turn.pending).toEqual([]);
    expect(stage.currentPlayerId).toBe("p1");
  });

  it("commits ordered moves once, starts a capture turn, and preserves every kind of unspent result", async () => {
    const { room } = await createRoom();
    await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => {
      const state = JSON.parse(ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one().state_json) as RoomState;
      const stage = state.stageState as unknown as YutnoriStage;
      stage.turn.throwsRemaining = 0;
      stage.turn.pending = [
        { rollId: "stored-yut", outcome: "yut", steps: 4, disposition: "banked" },
        { rollId: "stored-mo", outcome: "mo", steps: 5, disposition: "banked" },
        { rollId: "keep-yut", outcome: "yut", steps: 4, disposition: "banked" },
        { rollId: "keep-gae", outcome: "gae", steps: 2, disposition: "immediate" }
      ];
      stage.pieces.find((piece) => piece.pieceId === "B1")!.nodeId = "o9";
      ctx.storage.sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
    });
    const before = await room.getSnapshot("p0");
    const view = before.publicView as unknown as YutnoriPublicView;
    const moves = [{ rollId: "stored-yut", pieceId: "A1", pathId: "outer" }, { rollId: "stored-mo", pieceId: "A1", pathId: "outer" }];
    const action = { playerId: "p0", clientActionId: "commit-once", expectedVersion: before.version, type: "commitMoves", payload: { matchId: view.matchId, turnId: view.turn.turnId, moves } };
    const invalid = await room.trySubmitAction({ ...action, clientActionId: "past-capture", payload: { ...action.payload, moves: [...moves, { rollId: "keep-yut", pieceId: "A1", pathId: "outer" }] } });
    expect(invalid.ok).toBe(false);
    expect((await room.getSnapshot("p0")).version).toBe(before.version);
    const first = await room.submitAction(action);
    expect(await room.submitAction(action)).toEqual(first);
    const after = await room.getSnapshot("p0");
    const committed = after.publicView as unknown as YutnoriPublicView;
    expect(after.version).toBe(before.version + 1);
    expect(committed.lastMoveSequence?.moves.map((move) => move.rollId)).toEqual(["stored-yut", "stored-mo"]);
    expect(committed.turn).toMatchObject({ turnId: 2, teamId: "A", controllerPlayerId: "p0", mandatoryThrows: 1, throwsRemaining: 1 });
    expect(committed.turn.pending.map((roll) => roll.rollId)).toEqual(["keep-yut", "keep-gae"]);
    expect(committed.pieces.find((piece) => piece.pieceId === "A1")?.nodeId).toBe("o9");
    expect(committed.pieces.find((piece) => piece.pieceId === "B1")?.nodeId).toBe("reserve");
    expect((await room.trySubmitAction({ ...action, clientActionId: "during-motion", expectedVersion: after.version, type: "throwYut", payload: {} })).ok).toBe(false);
    await runInDurableObject(room as unknown as RoomStub, (_instance, ctx) => {
      const state = JSON.parse(ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one().state_json) as RoomState;
      const stage = state.stageState as unknown as YutnoriStage;
      stage.lastMoveSequence!.startedAt = Date.now() - stage.lastMoveSequence!.durationMs - 1;
      ctx.storage.sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
    });
    expect((await room.trySubmitAction({ ...action, clientActionId: "skip-required-throw", expectedVersion: after.version, payload: { matchId: view.matchId, turnId: 2, moves: [{ rollId: "keep-yut", pieceId: "A1", pathId: "outer" }] } })).ok).toBe(false);
    await room.submitAction({ playerId: "p0", clientActionId: "capture-throw", expectedVersion: after.version, type: "throwYut", payload: {} });
    const resumed = (await room.getSnapshot("p0")).publicView as unknown as YutnoriPublicView;
    expect(resumed.turn.mandatoryThrows).toBe(0);
    expect(resumed.turn.pending.some((roll) => roll.rollId === "keep-yut")).toBe(true);
    expect(resumed.turn.pending.some((roll) => roll.rollId === "keep-gae")).toBe(true);
    expect(resumed.currentPlayerId).toBe("p0");
  });

  it("waits for four team tickets, then resets teams after interruption/restart", async () => {
    const matcher = env.MATCHMAKER_DO.getByName(`yut-match-${crypto.randomUUID()}`);
    let matchedRoomId: string | undefined;
    for (let i = 0; i < 4; i++) {
      const result = await matcher.enqueue({ gameId: "yutnori", mode: "team-2v2", playerId: `m${i}` });
      if (i < 3) expect(result.matchedRoomId).toBeUndefined();
      else matchedRoomId = result.matchedRoomId;
    }
    expect(matchedRoomId).toBeTruthy();
    const room = env.ROOM_DO.getByName(`room:${matchedRoomId}`) as unknown as RoomDO;
    const snapshot = await room.getSnapshot("m0");
    expect(snapshot.players).toHaveLength(4);
    expect(snapshot.minPlayers).toBe(4);
    expect(snapshot.phase).toBe("active");
    const oldMatch = (await room.getSnapshot("m0")).publicView.matchId;
    await room.leave("m2");
    await expect(room.tryRestartGame("m0")).resolves.toMatchObject({ ok: false, error: { code: "not_enough_players" } });
    await room.join({ playerId: "replacement" });
    await room.restartGame("m0");
    const restarted = await room.getSnapshot("m0");
    expect(restarted.activeInterruption).toBeUndefined();
    expect(restarted.publicView.matchId).not.toBe(oldMatch);
    expect(JSON.stringify(restarted.publicView.teams)).not.toContain('"m2"');
  });
});
