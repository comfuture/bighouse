import { describe, expect, it } from "vitest";
import { cloneState, type RoomState } from "../src/core/game";
import { __CAMEL__Definition } from "../src/games/__GAME_ID__";

function baseState(): RoomState {
  return {
    room: {
      roomId: "room_unit",
      gameId: "__GAME_ID__",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 2,
      config: {},
      createdAt: 1
    },
    phase: "active",
    version: 2,
    players: [
      { playerId: "p1", seat: 0, connected: true, joinedAt: 1 },
      { playerId: "p2", seat: 1, connected: true, joinedAt: 1 }
    ],
    stageState: {},
    playerStates: {},
    updatedAt: 1
  };
}

describe("__GAME_ID__ adapter", () => {
  it("creates public and private views without leaking private state", () => {
    const state = baseState();
    state.stageState = __CAMEL__Definition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = __CAMEL__Definition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = __CAMEL__Definition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    const publicView = __CAMEL__Definition.getPublicView({ state, now: 1 });
    const privateView = __CAMEL__Definition.getPrivateView({ state, now: 1 }, "p1");

    expect(publicView).toBeTypeOf("object");
    expect(privateView).toBeTypeOf("object");
    expect(JSON.stringify(publicView)).not.toContain("secret-test-value");
  });

  it("validates turn order and applies a valid action", () => {
    const state = baseState();
    state.stageState = __CAMEL__Definition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = __CAMEL__Definition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = __CAMEL__Definition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    expect(
      __CAMEL__Definition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p2", clientActionId: "a1", expectedVersion: 2, type: "exampleAction", payload: {} }
      )
    ).toMatchObject({ ok: false, code: "invalid_turn" });

    const result = __CAMEL__Definition.applyAction(
      { state: cloneState(state), now: 10 },
      { playerId: "p1", clientActionId: "a1", expectedVersion: 2, type: "exampleAction", payload: {} }
    );

    expect(result.events[0]).toMatchObject({
      type: "__GAME_ID__.exampleAction",
      visibility: "public",
      payload: { playerId: "p1" }
    });
  });
});
