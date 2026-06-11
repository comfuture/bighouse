import { cloneState, type RoomState } from "@bighouse/game-sdk/server";
import { describe, expect, it } from "vitest";
import { gomokuDefinition } from "../src/server";

function baseState(): RoomState {
  return {
    room: {
      roomId: "room_unit",
      gameId: "gomoku",
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

describe("gomoku bot player", () => {
  it("selects a defensive move before attacking", () => {
    const state = baseState();
    state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "high" };
    state.stageState = gomokuDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = gomokuDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = gomokuDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
    const stage = state.stageState as { currentPlayerId?: string; board: Array<Array<"black" | "white" | null>> };
    stage.currentPlayerId = "p1";
    stage.board[0]![0] = "white";
    stage.board[0]![1] = "white";
    stage.board[0]![2] = "white";
    stage.board[0]![3] = "white";
    stage.board[1]![0] = "black";
    stage.board[1]![1] = "black";
    stage.board[1]![2] = "black";
    stage.board[1]![3] = "black";

    const action = gomokuDefinition.selectBotAction!({
      state,
      now: 10,
      player: state.players[0]!,
      difficulty: "high"
    });

    expect(action).toEqual({ type: "placeStone", payload: { x: 4, y: 0 } });
    expect(
      gomokuDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p1", clientActionId: "bot-defense", expectedVersion: 2, type: action!.type, payload: action!.payload }
      )
    ).toEqual({ ok: true });
  });
});
