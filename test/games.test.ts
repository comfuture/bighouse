import { describe, expect, it } from "vitest";
import { cloneState, privateEventsFor, publicEvents, type RoomState } from "../src/core/game";
import { cardDemoDefinition } from "../src/games/card-demo";
import { moveDestinationHints } from "@bighouse/chess/move-hints";
import { chessDefinition } from "@bighouse/chess/server";
import { gomokuDefinition } from "@bighouse/gomoku/server";

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
  it("initializes chess with public board state and private colors", () => {
    const state = baseState("chess");
    state.stageState = chessDefinition.initialStageState({ room: state.room, players: state.players, now: 1_000 });
    state.playerStates.p1 = chessDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = chessDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    expect(chessDefinition.getPublicView({ state, now: 1_000 })).toMatchObject({
      turn: "w",
      currentPlayerId: "p1",
      clocks: { white: 900_000, black: 900_000 },
      activeClockStartedAt: 1_000,
      turnDeadline: 901_000,
      moveCount: 0,
      check: false,
      checkmate: false,
      stalemate: false
    });
    expect(chessDefinition.getPrivateView({ state, now: 1 }, "p1")).toEqual({ color: "white" });
    expect(chessDefinition.getPrivateView({ state, now: 1 }, "p2")).toEqual({ color: "black" });
    expect(JSON.stringify(chessDefinition.getPublicView({ state, now: 1 }))).not.toContain("\"color\":\"white\"");
  });

  it("rejects malformed chess move payloads without throwing", () => {
    const state = baseState("chess");
    state.stageState = chessDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = chessDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = chessDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    expect(
      chessDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p1", clientActionId: "bad-payload", expectedVersion: 2, type: "move", payload: null as unknown as Record<string, unknown> }
      )
    ).toMatchObject({ ok: false, code: "invalid_action", message: "Payload must be an object" });
  });

  it("applies chess moves and rejects invalid turns", () => {
    const state = baseState("chess");
    state.stageState = chessDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = chessDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = chessDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    expect(
      chessDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p2", clientActionId: "bad-turn", expectedVersion: 2, type: "move", payload: { from: "e7", to: "e5" } }
      )
    ).toMatchObject({ ok: false, code: "invalid_turn" });

    expect(
      chessDefinition.validateAction(
        { state: cloneState(state), now: 10 },
        { playerId: "p1", clientActionId: "good", expectedVersion: 2, type: "move", payload: { from: "e2", to: "e4" } }
      )
    ).toEqual({ ok: true });

    const result = chessDefinition.applyAction(
      { state: cloneState(state), now: 10 },
      { playerId: "p1", clientActionId: "good", expectedVersion: 2, type: "move", payload: { from: "e2", to: "e4" } }
    );
    expect(result.events[0]).toMatchObject({
      type: "chess.moveMade",
      visibility: "public",
      payload: { playerId: "p1", from: "e2", to: "e4", san: "e4" }
    });
    expect(chessDefinition.getPublicView({ state: result.state, now: 10 })).toMatchObject({
      currentPlayerId: "p2",
      turn: "b",
      clocks: { white: 899_991, black: 900_000 },
      activeClockStartedAt: 10,
      turnDeadline: 900_010,
      moveCount: 1,
      history: ["e4"],
      lastMove: { from: "e2", to: "e4" }
    });

    const secondResult = chessDefinition.applyAction(
      { state: cloneState(result.state), now: 1_010 },
      { playerId: "p2", clientActionId: "good-2", expectedVersion: 3, type: "move", payload: { from: "e7", to: "e5" } }
    );
    expect(chessDefinition.getPublicView({ state: secondResult.state, now: 1_010 })).toMatchObject({
      currentPlayerId: "p1",
      turn: "w",
      clocks: { white: 899_991, black: 899_000 },
      activeClockStartedAt: 1_010,
      turnDeadline: 901_001,
      moveCount: 2,
      history: ["e4", "e5"]
    });
  });

  it("finishes chess when a turn timer expires", () => {
    const state = baseState("chess");
    state.stageState = chessDefinition.initialStageState({ room: state.room, players: state.players, now: 1_000 });
    state.playerStates.p1 = chessDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = chessDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });

    const result = chessDefinition.applyTimer!(
      { state: cloneState(state), now: 901_000 },
      { id: "turn-timeout", kind: "turn_timeout", runAt: 901_000, payload: { playerId: "p1", color: "white" } }
    );

    expect(result.state).toMatchObject({ phase: "finished" });
    expect(chessDefinition.getPublicView({ state: result.state, now: 901_000 })).toMatchObject({
      result: "timeout",
      winnerPlayerId: "p2",
      clocks: { white: 0, black: 900_000 }
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "chess.gameWon",
      visibility: "system",
      payload: { winnerPlayerId: "p2", reason: "timeout" }
    }));
  });

  it("finishes chess on checkmate", () => {
    let state = baseState("chess");
    state.stageState = chessDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = chessDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = chessDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
    const moves = [
      ["p1", "f2", "f3"],
      ["p2", "e7", "e5"],
      ["p1", "g2", "g4"],
      ["p2", "d8", "h4"]
    ] as const;

    let result = { state, events: [] as Array<{ type: string }> };
    for (const [playerId, from, to] of moves) {
      result = chessDefinition.applyAction(
        { state: cloneState(result.state), now: 10 },
        { playerId, clientActionId: `${from}-${to}`, expectedVersion: 2, type: "move", payload: { from, to } }
      );
      state = result.state;
    }

    expect(result.state).toMatchObject({ phase: "finished" });
    expect(chessDefinition.getPublicView({ state: result.state, now: 10 })).toMatchObject({
      result: "checkmate",
      check: true,
      checkmate: true,
      winnerPlayerId: "p2"
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "chess.gameWon",
      visibility: "system",
      payload: { winnerPlayerId: "p2", reason: "checkmate" }
    }));
  });

  it("selects legal chess bot promotions with a promotion payload", () => {
    const state = baseState("chess");
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

  it("preserves chess move history for threefold repetition draws", () => {
    let state = baseState("chess");
    state.stageState = chessDefinition.initialStageState({ room: state.room, players: state.players, now: 1 });
    state.playerStates.p1 = chessDefinition.initialPlayerState(state.players[0]!, { room: state.room, now: 1 });
    state.playerStates.p2 = chessDefinition.initialPlayerState(state.players[1]!, { room: state.room, now: 1 });
    const moves = [
      ["p1", "g1", "f3"],
      ["p2", "g8", "f6"],
      ["p1", "f3", "g1"],
      ["p2", "f6", "g8"],
      ["p1", "g1", "f3"],
      ["p2", "g8", "f6"],
      ["p1", "f3", "g1"],
      ["p2", "f6", "g8"]
    ] as const;

    let result = { state, events: [] as Array<{ type: string }> };
    for (const [index, [playerId, from, to]] of moves.entries()) {
      result = chessDefinition.applyAction(
        { state: cloneState(result.state), now: 10 + index },
        { playerId, clientActionId: `${from}-${to}-${index}`, expectedVersion: 2 + index, type: "move", payload: { from, to } }
      );
      state = result.state;
    }

    expect(result.state).toMatchObject({ phase: "finished" });
    expect(chessDefinition.getPublicView({ state: result.state, now: 20 })).toMatchObject({
      result: "draw",
      drawReason: "threefold_repetition"
    });
    expect(result.events).toContainEqual(expect.objectContaining({
      type: "chess.gameDrawn",
      visibility: "system",
      payload: { reason: "threefold_repetition" }
    }));
  });

  it("marks chess destinations that expose the king as unsafe hints", () => {
    const hints = moveDestinationHints("k3r3/8/8/8/8/8/4R3/4K3 w - - 0 1", "e2");

    expect(hints.legal).toContain("e8");
    expect(hints.unsafe).toContain("d2");
    expect(hints.unsafe).toContain("f2");
    expect(hints.legal).not.toContain("d2");
  });

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

  it("selects a defensive gomoku bot move before attacking", () => {
    const state = baseState("gomoku");
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
