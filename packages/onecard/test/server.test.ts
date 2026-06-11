import { cloneState, type RoomState } from "@bighouse/game-sdk/server";
import { describe, expect, it } from "vitest";
import { oneCardDefinition } from "../src/server";

function baseState(numPlayers = 2): RoomState {
  const players = Array.from({ length: numPlayers }, (_, i) => ({
    playerId: `p${i + 1}`,
    seat: i,
    connected: true,
    ready: true,
    joinedAt: 1
  }));
  return {
    room: {
      roomId: "room_unit",
      gameId: "onecard",
      mode: "default",
      minPlayers: 2,
      maxPlayers: 4,
      config: {},
      createdAt: 1
    },
    phase: "active",
    version: 2,
    players,
    stageState: {},
    playerStates: {},
    updatedAt: 1
  };
}

describe("one card bot player", () => {
  it("selects defense cards when under attack", () => {
    const state = baseState(2);
    state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "medium" };
    state.stageState = {
      discardPile: ["5S", "2S"],
      deck: ["9D", "10C", "QH"],
      deckCount: 3,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 2,
      activeAttackCard: "2S",
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["AS", "5S", "9H"] };
    state.playerStates.p2 = { hand: ["3C", "4C", "6C", "8C"] };

    const action = oneCardDefinition.selectBotAction!({
      state,
      now: 1,
      player: state.players[0]!,
      difficulty: "medium"
    });

    expect(action).toEqual({ type: "playCard", payload: { card: "AS" } });
    expect(
      oneCardDefinition.validateAction(
        { state: cloneState(state), now: 1 },
        { playerId: "p1", clientActionId: "bot-defense", expectedVersion: 2, type: action!.type, payload: action!.payload }
      )
    ).toEqual({ ok: true });
  });

  it("saves attack cards when a safer card is playable", () => {
    const state = baseState(2);
    state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "medium" };
    state.stageState = {
      discardPile: ["5S"],
      deck: ["9D", "10C", "QH"],
      deckCount: 3,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 0,
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["AS", "5H", "9H"] };
    state.playerStates.p2 = { hand: ["3C", "4C", "6C", "8C"] };

    const action = oneCardDefinition.selectBotAction!({
      state,
      now: 1,
      player: state.players[0]!,
      difficulty: "medium"
    });

    expect(action).toEqual({ type: "playCard", payload: { card: "5H" } });
  });

  it("selects color joker defense with a chosen suit", () => {
    const state = baseState(2);
    state.players[0] = { ...state.players[0]!, kind: "bot", botDifficulty: "high" };
    state.stageState = {
      discardPile: ["5S", "BJ"],
      deck: ["9D", "10C", "QH"],
      deckCount: 3,
      currentPlayerId: "p1",
      turnDirection: "clockwise",
      activeAttackCount: 5,
      activeAttackCard: "BJ",
      eliminatedPlayerIds: [],
      hasExtraTurn: false
    };
    state.playerStates.p1 = { hand: ["CJ", "9H", "10H"] };
    state.playerStates.p2 = { hand: ["3C"] };

    const action = oneCardDefinition.selectBotAction!({
      state,
      now: 1,
      player: state.players[0]!,
      difficulty: "high"
    });

    expect(action).toEqual({ type: "playCard", payload: { card: "CJ", chosenSuit: "H" } });
  });
});
