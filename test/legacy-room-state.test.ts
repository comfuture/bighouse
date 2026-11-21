import { env } from "cloudflare:workers";
import { runDurableObjectAlarm, runInDurableObject } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { JsonObject, RoomState, TimerIntent } from "../src/core/game";
import type { RoomDO } from "../src/do/room";

async function activeRoom(gameId: string) {
  const roomId = `legacy-${gameId}-${crypto.randomUUID()}`;
  const stub = env.ROOM_DO.getByName(`room:${roomId}`);
  const room = stub as unknown as RoomDO;
  await room.initialize({ roomId, gameId, mode: "default", minPlayers: 2, maxPlayers: 2 });
  await room.join({ playerId: "p1" });
  await room.join({ playerId: "p2" });
  await room.setReady("p2", true);
  await room.startGame("p1");
  return { stub, room };
}

type RoomStub = Awaited<ReturnType<typeof activeRoom>>["stub"];

function seedLegacy(
  stub: RoomStub,
  edit: (state: RoomState) => void,
  timer?: TimerIntent
) {
  return runInDurableObject(stub, async (_instance, ctx) => {
    const sql = ctx.storage.sql;
    const state = JSON.parse(sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one().state_json) as RoomState;
    edit(state);
    sql.exec("UPDATE room_state SET state_json = ? WHERE id = 1", JSON.stringify(state));
    sql.exec("DELETE FROM timers");
    if (timer) {
      sql.exec(
        "INSERT INTO timers (id, kind, run_at, payload_json) VALUES (?, ?, ?, ?)",
        timer.id, timer.kind, timer.runAt, JSON.stringify(timer.payload)
      );
      // Force via runDurableObjectAlarm so the fixture cannot race a real alarm.
      await ctx.storage.setAlarm(Date.now() + 60_000);
    } else {
      await ctx.storage.deleteAlarm();
    }
    return state;
  });
}

describe("RoomDO snapshots and actions on stored pre-#31 rooms", () => {
  it("restores a Gomoku board and accepts the stored player's next move without bumping version on read", async () => {
    const { stub, room } = await activeRoom("gomoku");
    const deadline = Date.now() + 60_000;
    const board = Array.from({ length: 15 }, () => Array<string | null>(15).fill(null));
    board[7]![7] = "black";
    const legacy = await seedLegacy(stub, (state) => {
      state.stageState = {
        boardSize: 15, board, moveCount: 1, currentPlayerId: "p2", turnDeadline: deadline,
        lastMove: { playerId: "p1", x: 7, y: 7, stone: "black" }
      };
    });
    const before = await room.getSnapshot("p2");
    expect(before).toMatchObject({
      version: legacy.version,
      phase: "active",
      players: legacy.players,
      publicView: {
        board, moveCount: 1, currentPlayerId: "p2",
        status: { kind: "playing", playerId: "p2", deadline }
      }
    });
    const saved = await runInDurableObject(stub, (_instance, ctx) => JSON.parse(
      ctx.storage.sql.exec<{ state_json: string }>("SELECT state_json FROM room_state WHERE id = 1").one().state_json
    ) as RoomState);
    expect(saved).toMatchObject({ version: legacy.version, updatedAt: legacy.updatedAt });
    expect(saved.stageState.status).toEqual({ kind: "playing", playerId: "p2", deadline });
    await expect(room.submitAction({
      playerId: "p2", clientActionId: "legacy-stone", expectedVersion: before.version,
      type: "placeStone", payload: { x: 8, y: 7 }
    })).resolves.toMatchObject({ version: before.version + 1 });
    board[7]![8] = "white";
    expect((await room.getSnapshot("p1")).publicView).toMatchObject({
      board, moveCount: 2, currentPlayerId: "p1"
    });
  });

  it("does not invent a timer for a legacy Gomoku opening and starts the normal clock after the first move", async () => {
    const { stub, room } = await activeRoom("gomoku");
    const legacy = await seedLegacy(stub, (state) => {
      state.stageState = {
        boardSize: 15, board: Array.from({ length: 15 }, () => Array<null>(15).fill(null)), moveCount: 0
      };
    });
    const before = await room.getSnapshot("p1");
    expect(before.publicView.status).toEqual({ kind: "playing", playerId: "p1", deadline: null });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(false);
    await expect(room.submitAction({
      playerId: "p1", clientActionId: "legacy-opening", expectedVersion: legacy.version,
      type: "placeStone", payload: { x: 7, y: 7 }
    })).resolves.toMatchObject({ version: legacy.version + 1 });
    const after = await room.getSnapshot("p2");
    expect(after.publicView.status).toEqual({ kind: "playing", playerId: "p2", deadline: expect.any(Number) });
    const alarm = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.getAlarm());
    expect(alarm).toBe((after.publicView.status as JsonObject).deadline);
  });

  it("fires an existing Tank Battle alarm as the first reader, preserving terrain, players and turn order", async () => {
    const { stub, room } = await activeRoom("tank-battle");
    const deadline = Date.now() - 1000;
    const legacy = await seedLegacy(stub, (state) => {
      const { turn: _turn, ...stage } = state.stageState;
      state.stageState = {
        ...stage, turnPhase: "aiming", currentPlayerId: "p1", turnDeadline: deadline, turnNumber: 5
      };
    }, {
      id: "tank-battle-turn-timeout", kind: "turn_timeout", runAt: deadline,
      payload: { playerId: "p1", turnNumber: 5 }
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    expect(await room.getSnapshot("p2")).toMatchObject({
      version: legacy.version + 1,
      players: legacy.players,
      publicView: {
        terrain: legacy.stageState.terrain, turnPhase: "aiming", currentPlayerId: "p2", turnNumber: 6
      }
    });
  });

  it.each(["pending", "already applied"] as const)("restores a Tank Battle shot that is %s without applying its effects twice", async (variant) => {
    const { stub, room } = await activeRoom("tank-battle");
    const first = await room.getSnapshot("p1");
    await room.submitAction({
      playerId: "p1", clientActionId: "stage-the-shot", expectedVersion: first.version,
      type: "fire", payload: { angle: 45, power: 60, item: "none" }
    });
    const deadline = Date.now() - 1000;
    let resolved: JsonObject;
    const legacy = await seedLegacy(stub, (state) => {
      const { turn, ...stage } = state.stageState;
      const { resolution } = turn as JsonObject;
      resolved = resolution as JsonObject;
      state.stageState = {
        ...stage, turnPhase: "resolving", currentPlayerId: "p1", resolutionDeadline: deadline,
        pendingNextPlayerId: "p2",
        ...(variant === "pending"
          ? { pendingResolution: resolved }
          : {
              terrain: resolved.terrain, tanks: resolved.tanks,
              lastShot: {
                ...(stage.lastShot as JsonObject),
                damage: resolved.damage,
                resolved: undefined
              }
            })
      };
    }, {
      id: "tank-battle-shot-resolution", kind: "turn_timeout", runAt: deadline,
      payload: { reason: "shot_resolution", turnNumber: 1 }
    });
    const before = await room.getSnapshot("p2");
    expect(before).toMatchObject({
      version: legacy.version,
      publicView: { terrain: legacy.stageState.terrain, turnPhase: "resolving", lastShot: { id: 1 } }
    });
    await expect(runDurableObjectAlarm(stub)).resolves.toBe(true);
    expect(await room.getSnapshot("p2")).toMatchObject({
      version: legacy.version + 1,
      publicView: {
        terrain: resolved!.terrain,
        turnPhase: "aiming", currentPlayerId: "p2", turnNumber: 2,
        lastShot: { id: 1, resolved: true, damage: resolved!.damage }
      }
    });
    const alarmEvents = await runInDurableObject(stub, (_instance, ctx) => ctx.storage.sql
      .exec<{ event_json: string }>("SELECT event_json FROM event_log WHERE version = ?", legacy.version + 1)
      .toArray().map((row) => JSON.parse(row.event_json).type as string));
    expect(alarmEvents.filter((type) => type === "tankBattle.turnChanged")).toHaveLength(1);
    expect(alarmEvents.includes("tankBattle.shotResolved")).toBe(variant === "pending");
    if (variant === "already applied") expect(alarmEvents).toEqual(["tankBattle.turnChanged"]);
  });

  it("retains the Chess position, SAN history and absolute running-clock deadline, then accepts two moves", async () => {
    const { stub, room } = await activeRoom("chess");
    const clockStartedAt = Date.now() - 1000;
    const fen = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
    const deadline = clockStartedAt + 60_000;
    const legacy = await seedLegacy(stub, (state) => {
      state.stageState = {
        fen, turn: "b", history: ["e4"], moveCount: 1, currentPlayerId: "p2",
        clocks: { white: 57_000, black: 60_000 }, activeClockStartedAt: clockStartedAt,
        turnDeadline: deadline, check: false, checkmate: false, stalemate: false
      };
    });
    const before = await room.getSnapshot("p2");
    expect(before).toMatchObject({
      version: legacy.version, players: legacy.players,
      publicView: {
        fen, history: ["e4"], moveCount: 1, currentPlayerId: "p2",
        activeClockStartedAt: clockStartedAt, turnDeadline: deadline, clocks: { white: 57_000, black: 60_000 }
      }
    });
    const ack = await room.submitAction({
      playerId: "p2", clientActionId: "legacy-black-move", expectedVersion: before.version,
      type: "move", payload: { from: "e7", to: "e5" }
    });
    await expect(room.submitAction({
      playerId: "p1", clientActionId: "legacy-white-move", expectedVersion: ack.version,
      type: "move", payload: { from: "g1", to: "f3" }
    })).resolves.toMatchObject({ version: ack.version + 1 });
    expect((await room.getSnapshot("p2")).publicView).toMatchObject({
      history: ["e4", "e5", "Nf3"], moveCount: 3, currentPlayerId: "p2"
    });
  });
});
