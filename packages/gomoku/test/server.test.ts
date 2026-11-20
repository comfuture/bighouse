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

type Stone = "black" | "white" | null;
type TestStage = { board: Stone[][]; moveCount: number; status: { kind: string; playerId?: string; deadline?: number } };

function startedState(): { state: RoomState; stage: TestStage } {
  const state = baseState();
  state.stageState = gomokuDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
  state.playerStates.p1 = gomokuDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
  state.playerStates.p2 = gomokuDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
  return { state, stage: state.stageState as unknown as TestStage };
}

function place(state: RoomState, playerId: string, payload: unknown, now = 10) {
  const action = { playerId, clientActionId: "t", expectedVersion: state.version, type: "placeStone", payload: payload as never };
  const validation = gomokuDefinition.validateAction({ state: cloneState(state), now }, action);
  return { validation, apply: () => gomokuDefinition.applyAction({ state: cloneState(state), now }, action) };
}

function row(stage: TestStage, y: number, stone: Stone, xs: number[]): void {
  for (const x of xs) stage.board[y]![x] = stone;
}

describe("gomoku rules", () => {
  it("starts with the first seat to move and a turn deadline", () => {
    const { state, stage } = startedState();
    expect(stage.status).toEqual({ kind: "playing", playerId: "p1", deadline: 30_001 });
    expect(gomokuDefinition.nextTimers({ state, now: 1 })).toEqual([
      { id: "turn-timeout", kind: "turn_timeout", runAt: 30_001, payload: { playerId: "p1" } }
    ]);
  });

  it("rejects malformed coordinates instead of coercing them", () => {
    const { state } = startedState();
    for (const payload of [null, {}, { x: null, y: false }, { x: "3", y: [4] }, { x: 1.5, y: 2 }, { x: 15, y: 0 }, { x: -1, y: 0 }]) {
      expect(place(state, "p1", payload).validation).toMatchObject({ ok: false, code: "invalid_action" });
    }
    expect(place(state, "p1", { x: 0, y: 0 }).validation).toEqual({ ok: true });
  });

  it("allows a five even when the same stone forms two open threes", () => {
    const { state, stage } = startedState();
    row(stage, 7, "black", [3, 4, 5, 6]);
    stage.board[6]![7] = "black";
    stage.board[8]![7] = "black";
    stage.board[6]![6] = "black";
    stage.board[8]![8] = "black";
    const move = place(state, "p1", { x: 7, y: 7 });
    expect(move.validation).toEqual({ ok: true });
    expect(move.apply().state.stageState).toMatchObject({ status: { kind: "won", winnerPlayerId: "p1" } });
  });

  it("passes the turn when the deadline timer fires, and ignores a stale timer", () => {
    const { state } = startedState();
    const stale = gomokuDefinition.applyTimer!(
      { state: cloneState(state), now: 40_000 },
      { id: "turn-timeout", kind: "turn_timeout", runAt: 12_345 }
    );
    expect(stale.events).toEqual([]);
    expect(stale.state.stageState).toMatchObject({ status: { kind: "playing", playerId: "p1" } });

    const fired = gomokuDefinition.applyTimer!(
      { state: cloneState(state), now: 30_001 },
      { id: "turn-timeout", kind: "turn_timeout", runAt: 30_001 }
    );
    expect(fired.state.stageState).toMatchObject({ status: { kind: "playing", playerId: "p2", deadline: 60_001 } });
    expect(fired.events).toEqual([expect.objectContaining({ type: "gomoku.turnSkipped", payload: { playerId: "p1" } })]);
  });

  it("ends in a draw when the last empty cell is filled without a five", () => {
    const { state, stage } = startedState();
    // Pairs of each colour, shifted two cells per row: no line of five in any direction.
    for (let y = 0; y < 15; y += 1) {
      for (let x = 0; x < 15; x += 1) {
        stage.board[y]![x] = (x + 2 * y) % 4 < 2 ? "black" : "white";
      }
    }
    stage.board[0]![0] = null;
    const result = place(state, "p1", { x: 0, y: 0 }).apply();
    expect(result.state.phase).toBe("finished");
    expect(result.state.stageState).toMatchObject({ status: { kind: "draw" } });
    expect(result.events).toContainEqual(expect.objectContaining({ type: "gomoku.gameDrawn" }));
    expect(gomokuDefinition.nextTimers({ state: result.state, now: 20 })).toEqual([]);
  });

  it("rejects moves once the game is over", () => {
    const { state, stage } = startedState();
    stage.status = { kind: "won", playerId: undefined } as never;
    expect(place(state, "p1", { x: 0, y: 0 }).validation).toMatchObject({ ok: false, code: "invalid_action" });
  });
});

describe("gomoku bot player", () => {
  function botMove(setup: (stage: TestStage) => void) {
    const { state, stage } = startedState();
    state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "high" };
    setup(stage);
    const action = gomokuDefinition.selectBotAction!({ state, now: 10, player: state.players[0]!, difficulty: "high" });
    expect(place(state, "p1", action!.payload).validation).toEqual({ ok: true });
    return action;
  }

  it("blocks an opponent four when it has no win of its own", () => {
    const action = botMove((stage) => {
      row(stage, 0, "white", [0, 1, 2, 3]);
      row(stage, 5, "black", [0, 1]);
    });
    expect(action).toEqual({ type: "placeStone", payload: { x: 4, y: 0 } });
  });

  it("takes its own five before blocking the opponent's", () => {
    const action = botMove((stage) => {
      row(stage, 0, "white", [0, 1, 2, 3]);
      row(stage, 1, "black", [0, 1, 2, 3]);
    });
    expect(action).toEqual({ type: "placeStone", payload: { x: 4, y: 1 } });
  });
});
