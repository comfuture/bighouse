import { cloneState, type RoomState } from "@bighouse/game-sdk/server";
import { describe, expect, it } from "vitest";
import { chessDefinition } from "../src/server";

function baseState(): RoomState {
  return {
    room: {
      roomId: "room_unit",
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
      { playerId: "p1", seat: 0, connected: true, ready: true, joinedAt: 1 },
      { playerId: "p2", seat: 1, connected: true, ready: true, joinedAt: 1 }
    ],
    stageState: {},
    playerStates: {},
    updatedAt: 1
  };
}

describe("chess bot player", () => {
  it("selects legal promotions with a promotion payload", () => {
    const state = baseState();
    state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "high" };
    state.stageState = {
      fen: "4k3/P7/8/8/8/8/8/4K3 w - - 0 1",
      board: [],
      currentPlayerId: "p1",
      turn: "w",
      clocks: { white: 900_000, black: 900_000 },
      moveCount: 0,
      history: [],
      moveHistory: [],
      check: false,
      checkmate: false,
      stalemate: false
    };
    state.playerStates.p1 = { color: "white" };
    state.playerStates.p2 = { color: "black" };

    const action = chessDefinition.selectBotAction!({
      state,
      now: 10,
      player: state.players[0]!,
      difficulty: "high"
    });

    expect(action).toEqual({
      type: "move",
      payload: { from: "a7", to: "a8", promotion: "q" }
    });
    expect(
      chessDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p1", clientActionId: "bot-promotion", expectedVersion: 2, type: action!.type, payload: action!.payload }
      )
    ).toEqual({ ok: true });
  });
});
