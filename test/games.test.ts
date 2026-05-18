import { describe, expect, it } from "vitest";
import "../src/games";
import { cloneState, privateEventsFor, publicEvents, type RoomState } from "../src/core/game";
import { cardDemoDefinition } from "../src/games/card-demo";
import { gomokuDefinition } from "../src/games/gomoku";

function baseState(gameId: string): RoomState {
  return {
    room: {
      roomId: "room_unit",
      gameId,
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

describe("game adapters", () => {
  it("applies gomoku moves and rejects invalid turns", () => {
    const state = baseState("gomoku");
    state.stageState = gomokuDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = gomokuDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = gomokuDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    expect(
      gomokuDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p2", clientActionId: "a1", expectedVersion: 2, type: "placeStone", payload: { x: 0, y: 0 } }
      )
    ).toMatchObject({ ok: false, code: "invalid_turn" });

    const result = gomokuDefinition.applyAction(
      { state: cloneState(state), now: 10 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "placeStone", payload: { x: 0, y: 0 } }
    );
    expect(result.events[0]).toMatchObject({
      type: "gomoku.stonePlaced",
      visibility: "public",
      payload: { playerId: "p1", x: 0, y: 0, stone: "black" }
    });
    expect(gomokuDefinition.getPublicView({ state: result.state, now: 10 })).toMatchObject({
      lastMove: { playerId: "p1", x: 0, y: 0, stone: "black" }
    });
  });

  it("rejects gomoku double-three moves", () => {
    const state = baseState("gomoku");
    state.stageState = gomokuDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = gomokuDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = gomokuDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
    const stage = state.stageState as { board: Array<Array<"black" | "white" | null>> };
    stage.board[7]![6] = "black";
    stage.board[7]![8] = "black";
    stage.board[6]![7] = "black";
    stage.board[8]![7] = "black";

    expect(
      gomokuDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p1", clientActionId: "double-three", expectedVersion: 2, type: "placeStone", payload: { x: 7, y: 7 } }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Move violates double-three rule" });
  });

  it("finishes gomoku when a player reaches five stones", () => {
    const state = baseState("gomoku");
    state.stageState = gomokuDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = gomokuDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = gomokuDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
    const stage = state.stageState as { board: Array<Array<"black" | "white" | null>> };
    stage.board[0]![0] = "black";
    stage.board[0]![1] = "black";
    stage.board[0]![2] = "black";
    stage.board[0]![3] = "black";

    const result = gomokuDefinition.applyAction(
      { state: cloneState(state), now: 10 },
      { playerId: "p1", clientActionId: "win", expectedVersion: 2, type: "placeStone", payload: { x: 4, y: 0 } }
    );

    expect(result.state).toMatchObject({ phase: "finished" });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "gomoku.gameWon",
      visibility: "system",
      payload: { winnerPlayerId: "p1" }
    }));
  });

  it("keeps card hands private while broadcasting submitted cards", () => {
    const state = baseState("card-demo");
    state.room.maxPlayers = 4;
    state.stageState = cardDemoDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = cardDemoDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = cardDemoDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    const publicView = cardDemoDefinition.getPublicView({ state, now: 1 });
    expect(JSON.stringify(publicView)).not.toContain("AS");
    expect(cardDemoDefinition.getPrivateView({ state, now: 1 }, "p1")).toMatchObject({ hand: ["AS", "7H", "3C"] });

    const result = cardDemoDefinition.applyAction(
      { state: cloneState(state), now: 10 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "playCard", payload: { card: "AS" } }
    );
    expect(publicEvents(result.events)).toHaveLength(1);
    expect(privateEventsFor(result.events, "p2")).toHaveLength(0);
    expect(result.events[0]).toMatchObject({
      type: "card.played",
      visibility: "public",
      payload: { playerId: "p1", card: "AS" }
    });
  });
});
