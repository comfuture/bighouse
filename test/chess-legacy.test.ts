import { describe, expect, it } from "vitest";
import { chessDefinition, normalizeLegacyChessStage } from "@bighouse/chess/server";
import type { ClientGameAction, JsonObject, RoomState } from "../src/core/game";

function chessRoom(stageState: JsonObject): RoomState {
  return {
    room: {
      roomId: "legacy-chess",
      gameId: "chess",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: {},
      createdAt: 1
    },
    phase: "active",
    version: 2,
    players: [
      { playerId: "white", seat: 0, connected: true, ready: true, joinedAt: 1 },
      { playerId: "black", seat: 1, connected: true, ready: true, joinedAt: 1 }
    ],
    stageState,
    playerStates: { white: { color: "white" }, black: { color: "black" } },
    updatedAt: 1
  };
}

const afterE4 = "rnbqkbnr/pppppppp/8/8/4P3/8/PPPP1PPP/RNBQKBNR b KQkq - 0 1";
const clocks = { white: 7_000, black: 5_000 };

function move(state: RoomState, now: number, playerId: string, from: string, to: string): void {
  const action: ClientGameAction = {
    playerId,
    clientActionId: `move-${now}`,
    expectedVersion: state.version,
    type: "move",
    payload: { from, to }
  };
  expect(chessDefinition.validateAction({ state, now }, action)).toEqual({ ok: true });
  chessDefinition.applyAction({ state, now }, action);
}

describe("legacy persisted Chess stages", () => {
  it("keeps the same position and absolute deadline without renewing a running clock", () => {
    const legacy = { fen: afterE4, turn: "b", clocks, turnDeadline: 15_000, moveCount: 1, history: ["e4"] };
    const normalized = normalizeLegacyChessStage(legacy);
    expect(normalized).toMatchObject({
      fen: afterE4,
      moveHistory: [{ from: "e2", to: "e4" }],
      clocks,
      clockStartedAt: 10_000,
      outcome: null
    });
    expect(normalizeLegacyChessStage(normalized)).toBe(normalized);
    expect(legacy).not.toHaveProperty("clockStartedAt");
    const state = chessRoom(normalized);
    expect(chessDefinition.getPublicView({ state, now: 12_000 })).toMatchObject({
      currentPlayerId: "black", activeClockStartedAt: 10_000, turnDeadline: 15_000, moveCount: 1
    });
    expect(chessDefinition.nextTimers({ state, now: 12_000 })[0]).toMatchObject({ runAt: 15_000 });
    move(state, 12_000, "black", "e7", "e5");
    expect(chessDefinition.getPublicView({ state, now: 12_000 })).toMatchObject({
      currentPlayerId: "white", activeClockStartedAt: 12_000, turnDeadline: 19_000,
      clocks: { white: 7_000, black: 3_000 }, history: ["e4", "e5"]
    });
  });

  it("retains the outcome and no timer of a finished legacy timeout", () => {
    const state = chessRoom(normalizeLegacyChessStage({
      fen: afterE4, clocks: { white: 7_000, black: 0 }, result: "timeout", winnerPlayerId: "white",
      moveCount: 1, history: ["e4"]
    }));
    state.phase = "finished";
    const view = chessDefinition.getPublicView({ state, now: 20_000 });
    expect(view).toMatchObject({ result: "timeout", winnerPlayerId: "white", history: ["e4"] });
    expect(view).not.toHaveProperty("turnDeadline");
    expect(view).not.toHaveProperty("currentPlayerId");
    expect(chessDefinition.nextTimers({ state, now: 20_000 })).toEqual([]);
  });

  it("recovers threefold repetition from a provably matching SAN history", () => {
    const state = chessRoom(normalizeLegacyChessStage({
      fen: "rnbqkb1r/pppppppp/5n2/8/8/8/PPPPPPPP/RNBQKBNR b KQkq - 7 4",
      history: ["Nf3", "Nf6", "Ng1", "Ng8", "Nf3", "Nf6", "Ng1"],
      clocks, activeClockStartedAt: 10_000, moveCount: 7
    }));
    move(state, 12_000, "black", "f6", "g8");
    expect(chessDefinition.getPublicView({ state, now: 12_000 })).toMatchObject({
      result: "draw", drawReason: "threefold_repetition", moveCount: 8
    });
  });

  it("keeps the persisted FEN when legal-looking historical moves reach a different position", () => {
    const state = chessRoom(normalizeLegacyChessStage({
      fen: afterE4, clocks, activeClockStartedAt: 10_000, moveCount: 1, history: ["d4"],
      moveHistory: [{ from: "d2", to: "d4" }]
    }));
    expect(state.stageState).toMatchObject({ replayBaseFen: afterE4, moveHistory: [] });
    move(state, 12_000, "black", "e7", "e5");
    state.stageState = JSON.parse(JSON.stringify(state.stageState));
    // This white bishop could not move from the standard start without the persisted e4.
    move(state, 13_000, "white", "f1", "c4");
    expect(chessDefinition.getPublicView({ state, now: 13_000 })).toMatchObject({
      currentPlayerId: "black", moveCount: 3,
      lastMove: { from: "f1", to: "c4" }
    });
  });
});
