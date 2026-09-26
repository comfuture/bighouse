import type { ClientGameAction, JsonObject, RoomState } from "@bighouse/game-sdk/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { BOARD_NODES, getLegalMoves, piecePaths } from "../src/board";
import { outcomeFromFaces, THROW_DURATION_MS, yutnoriDefinition as game } from "../src/server";
import type { YutnoriStage, YutPiece } from "../src/types";
import { mandatoryThrows, rollDisposition, simulateMovePlan, THROW_RESULT_HOLD_MS } from "../src/rules";

function setup(count = 2) {
  const state: RoomState = {
    room: { roomId: "test", gameId: "yutnori", mode: count === 4 ? "team-2v2" : "solo", minPlayers: count, maxPlayers: count, config: {}, createdAt: 1 },
    phase: "active", version: 1, updatedAt: 1,
    players: Array.from({ length: count }, (_, seat) => ({ playerId: `p${seat}`, seat, ready: true, connected: true, joinedAt: 1 })),
    stageState: {}, playerStates: {}
  };
  state.stageState = game.initialStageState({ room: state.room, players: state.players, now: 100 });
  const stage = state.stageState as unknown as YutnoriStage;
  const context = { state, now: 100 };
  function action(type: string, payload: JsonObject = {}, playerId = stage.currentPlayerId): ClientGameAction {
    return { type, payload, playerId, expectedVersion: state.version, clientActionId: "test-action" };
  }
  function apply(type: string, payload: JsonObject = {}) {
    const input = action(type, payload);
    expect(game.validateAction(context, input)).toEqual({ ok: true });
    return game.applyAction(context, input);
  }
  function pending(steps: number, rollId = "r") {
    stage.turn.pending.push({ rollId, steps, outcome: steps === -1 ? "backDo" : steps === 5 ? "mo" : steps === 4 ? "yut" : steps === 3 ? "geol" : steps === 2 ? "gae" : "do" });
    stage.turn.throwsRemaining = 0;
  }
  function move(pieceId = "A1", pathId?: string, rollId = "r") {
    if (stage.lastMoveSequence) context.now = Math.max(context.now, stage.lastMoveSequence.startedAt + stage.lastMoveSequence.durationMs);
    const candidate = getLegalMoves(stage).find((entry) => entry.pieceId === pieceId && entry.rollId === rollId && (!pathId || entry.pathId === pathId));
    expect(candidate).toBeDefined();
    return apply("movePiece", { rollId, pieceId, pathId: candidate!.pathId });
  }
  return { state, stage, context, action, apply, pending, move };
}
function placed(nodeId: string, routeId: YutPiece["routeId"] = "outer"): YutPiece {
  return { pieceId: "A1", teamId: "A", stackId: "A1", nodeId, routeId, history: [] };
}
afterEach(() => vi.restoreAllMocks());

describe("29-node board and explicit routes", () => {
  it("has 29 unique positions and enters the first point using a result", () => {
    expect(new Set(BOARD_NODES.map((node) => node.nodeId)).size).toBe(29);
    expect(piecePaths(placed("reserve"), 5)[0]!.path).toEqual(["o1", "o2", "o3", "o4", "o5"]);
  });
  it("only offers a shortcut when starting exactly on a corner", () => {
    expect(piecePaths(placed("o4"), 3)[0]!.path).toEqual(["o5", "o6", "o7"]);
    expect(piecePaths(placed("o5"), 3).map((route) => route.path)).toEqual([["o6", "o7", "o8"], ["a1", "a2", "c"]]);
    expect(piecePaths(placed("o10"), 3).map((route) => route.path)).toEqual([["o11", "o12", "o13"], ["b1", "b2", "c"]]);
  });
  it("continues across center in the arrival direction, or chooses an exit when starting there", () => {
    expect(piecePaths(placed("a2", "diagonalA"), 3)[0]!.path).toEqual(["c", "a3", "a4"]);
    expect(piecePaths(placed("b2", "diagonalB"), 3)[0]!.path).toEqual(["c", "b3", "b4"]);
    expect(piecePaths(placed("c", "diagonalA"), 3).map((path) => path.destination)).toEqual(["o15", "o0"]);
  });
  it("requires passing the exit; arriving on o0 alone does not finish", () => {
    expect(piecePaths(placed("o19"), 1)[0]!.destination).toBe("o0");
    expect(piecePaths(placed("o19"), 5)[0]!.path).toEqual(["o0", "finished"]);
    expect(piecePaths(placed("b4", "diagonalB"), 2)[0]!.destination).toBe("finished");
  });
  it("reverses actual history through the center, shortcut exit, and initial entry", () => {
    const piece = placed("o5");
    const shortcut = piecePaths(piece, 5).find((path) => path.pathId === "diagonalA")!;
    Object.assign(piece, { nodeId: shortcut.destination, routeId: shortcut.routeId, history: shortcut.history });
    for (const expected of ["a3", "c", "a2", "a1", "o5"]) {
      const back = piecePaths(piece, -1)[0]!;
      expect(back.destination).toBe(expected);
      Object.assign(piece, { nodeId: back.destination, routeId: back.routeId, history: back.history });
    }
    const entered = piecePaths(placed("reserve"), 1)[0]!;
    expect(piecePaths({ ...placed("o1"), history: entered.history }, -1)[0]!.destination).toBe("reserve");
    expect(piecePaths(placed("reserve"), -1)).toEqual([]);
    expect(piecePaths(placed("finished"), -1)).toEqual([]);
  });
  it("restores the arrival route after backing onto center from a different chosen exit", () => {
    const piece = placed("c", "diagonalA");
    piece.history = [{ nodeId: "a2", routeId: "diagonalA" }];
    const route = piecePaths(piece, 1).find((entry) => entry.pathId === "diagonalB")!;
    const back = piecePaths({ ...piece, nodeId: route.destination, routeId: route.routeId, history: route.history }, -1)[0]!;
    expect(back.destination).toBe("c");
    expect(back.routeId).toBe("diagonalA");
    const backAgain = piecePaths({ ...piece, nodeId: back.destination, routeId: back.routeId, history: back.history }, -1)[0]!;
    expect(backAgain.destination).toBe("a2");
  });
});

describe("authoritative throws", () => {
  it("classifies every one of the sixteen face combinations with marked stick zero", () => {
    for (let bits = 0; bits < 16; bits++) {
      const faces = [1, 2, 4, 8].map((mask) => !!(bits & mask));
      const count = faces.filter(Boolean).length;
      const expected = bits === 1 ? "backDo" : ["mo", "do", "gae", "geol", "yut"][count];
      expect(outcomeFromFaces(faces, true).outcome).toBe(expected);
      expect(outcomeFromFaces(faces, false).outcome).toBe(["mo", "do", "gae", "geol", "yut"][count]);
    }
  });
  it.each([0, 15])("grants another throw for bit pattern %s, preserving controller", (bits) => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint32Array).set([bits, 73]); return array; });
    const { stage, context, action, apply } = setup();
    apply("throwYut");
    expect(stage.turn.throwsRemaining).toBe(1);
    expect(stage.currentPlayerId).toBe("p0");
    expect(stage.lastThrow!.visualSeed).toBe(73);
    expect(game.validateAction(context, action("throwYut"))).toMatchObject({ ok: false, code: "throw_in_progress" });
    context.now += THROW_DURATION_MS + THROW_RESULT_HOLD_MS;
    apply("throwYut");
    expect(stage.turn.pending).toHaveLength(2);
    expect(stage.turn.pending[0]!.rollId).not.toBe(stage.turn.pending[1]!.rollId);
  });
  it("locks movement until the shared animation ends and rejects client outcomes", () => {
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint32Array).set([2, 0]); return array; });
    const { stage, context, action, apply } = setup();
    expect(game.validateAction(context, action("throwYut", { faces: [true, true, true, true] }))).toMatchObject({ ok: false });
    apply("throwYut");
    expect(stage.turn.throwsRemaining).toBe(0);
    const move = getLegalMoves(stage)[0]!;
    expect(game.validateAction(context, action("movePiece", { ...move }))).toMatchObject({ code: "throw_in_progress" });
    context.now += THROW_DURATION_MS + THROW_RESULT_HOLD_MS;
    apply("movePiece", { ...move });
    expect(stage.currentPlayerId).toBe("p1");
  });
});

describe("turns, stacks, capture and winning", () => {
  it("starts eight reserve pieces, resets match id, and respects backDo configuration", () => {
    const { stage, state } = setup(4);
    expect(stage.teams.map((team) => team.playerIds)).toEqual([["p0", "p2"], ["p1", "p3"]]);
    expect(stage.pieces).toHaveLength(8);
    state.room.config.backDo = false;
    const reset = game.initialStageState({ room: state.room, players: state.players, now: 100 }) as unknown as YutnoriStage;
    expect(reset.matchId).not.toBe(stage.matchId);
    expect(reset.rules.backDo).toBe(false);
  });
  it("rotates A0 B0 A1 B1 in team mode", () => {
    const { stage, pending, apply } = setup(4);
    const controllers = [stage.currentPlayerId];
    for (let i = 0; i < 4; i++) {
      pending(-1);
      apply("discardRoll", { rollId: "r" });
      controllers.push(stage.currentPlayerId);
    }
    expect(controllers).toEqual(["p0", "p1", "p2", "p3", "p0"]);
  });
  it("lets the operator consume results in any order and refuses to discard a legal result", () => {
    const { stage, pending, move, context, action } = setup();
    pending(2, "first"); pending(1, "second");
    expect(game.validateAction(context, action("discardRoll", { rollId: "first" }))).toMatchObject({ ok: false });
    move("A1", undefined, "second");
    expect(stage.currentPlayerId).toBe("p0");
    expect(stage.turn.pending.map((roll) => roll.rollId)).toEqual(["first"]);
    move("A1", undefined, "first");
    expect(stage.pieces[0]!.nodeId).toBe("o3");
    expect(stage.currentPlayerId).toBe("p1");
  });
  it("discards unusable backDo, but not when another piece can reverse", () => {
    const { stage, pending, apply, context, action } = setup();
    pending(-1);
    apply("discardRoll", { rollId: "r" });
    expect(stage.currentPlayerId).toBe("p1");
    pending(-1, "back");
    Object.assign(stage.pieces[4]!, { nodeId: "o1", history: [{ nodeId: "reserve", routeId: "outer" }] });
    expect(game.validateAction(context, action("discardRoll", { rollId: "back" }))).toMatchObject({ ok: false });
  });
  it("stacks allies, moves the whole stack from any member, captures whole enemy stack once", () => {
    const { stage, pending, move } = setup();
    pending(1, "one"); pending(1, "two"); pending(1, "three");
    move("A1", undefined, "one"); move("A2", undefined, "two");
    expect(stage.pieces[0]!.stackId).toBe(stage.pieces[1]!.stackId);
    Object.assign(stage.pieces[4]!, { nodeId: "o2", stackId: "B1" });
    Object.assign(stage.pieces[5]!, { nodeId: "o2", stackId: "B1" });
    const result = move("A1", undefined, "three");
    expect(stage.pieces.slice(0, 2).map((piece) => piece.nodeId)).toEqual(["o2", "o2"]);
    expect(stage.pieces.slice(4, 6).map((piece) => piece.nodeId)).toEqual(["reserve", "reserve"]);
    expect(stage.pieces[4]!.stackId).not.toBe(stage.pieces[5]!.stackId);
    expect(stage.turn.throwsRemaining).toBe(1);
    expect(result.events.some((entry) => entry.type === "yutnori.captured" && entry.payload.rollId === "three")).toBe(true);
  });
  it("does not capture passed squares, and adds capture throws to unused throws", () => {
    const { stage, pending, move } = setup();
    pending(3);
    stage.turn.throwsRemaining = 2;
    stage.pieces[4]!.nodeId = "o1";
    stage.pieces[5]!.nodeId = "o3";
    move();
    expect(stage.pieces[4]!.nodeId).toBe("o1");
    expect(stage.pieces[5]!.nodeId).toBe("reserve");
    expect(stage.turn.throwsRemaining).toBe(3);
  });
  it("finishes a four-piece stack and ends immediately even with unused rolls/throws", () => {
    const { stage, state, pending, move, action, context } = setup(4);
    for (const piece of stage.pieces.slice(0, 4)) Object.assign(piece, { nodeId: "o0", stackId: "A1" });
    pending(1); pending(4, "extra"); stage.turn.throwsRemaining = 2;
    const result = move();
    expect(state.phase).toBe("finished");
    expect(stage.teams[0]!.finishedCount).toBe(4);
    expect(stage.winnerTeamId).toBe("A");
    expect(state.closedAt).toBeUndefined();
    expect(result.events.at(-1)).toMatchObject({ type: "yutnori.finished", visibility: "system", payload: { winnerPlayerIds: ["p0", "p2"] } });
    expect(game.validateAction(context, action("throwYut"))).toMatchObject({ ok: false, code: "invalid_phase" });
  });
  it("adopts arriving stack history and splits a stack when backDo returns to reserve", () => {
    const { stage, pending, move } = setup();
    pending(1, "a"); pending(1, "b"); pending(-1, "c");
    move("A1", undefined, "a"); move("A2", undefined, "b"); move("A1", undefined, "c");
    expect(stage.pieces.slice(0, 2).map((piece) => [piece.nodeId, piece.stackId])).toEqual([["reserve", "A1"], ["reserve", "A2"]]);
  });
});

describe("validation and private team suggestions", () => {
  it("rejects noncontrollers, consumed tokens, enemy pieces and invented paths without mutation", () => {
    const { stage, state, context, pending, action } = setup(4);
    pending(1);
    const before = structuredClone(state);
    for (const input of [action("throwYut", {}, "p2"), action("movePiece", { rollId: "used", pieceId: "A1", pathId: "outer" }), action("movePiece", { rollId: "r", pieceId: "B1", pathId: "outer" }), action("movePiece", { rollId: "r", pieceId: "A1", pathId: "invented" }), action("fake")]) {
      expect(game.validateAction(context, input).ok).toBe(false);
    }
    expect(state).toEqual(before);
    expect(game.getPrivateView(context, "p2")).toEqual({});
    expect(game.getPublicView(context)).toMatchObject({ matchId: stage.matchId, currentPlayerId: "p0", legalMoves: expect.any(Array) });
  });
  it("routes suggestions only to teammates without mutation; rejects obsolete match/turn/move", () => {
    const { stage, state, context, pending } = setup(4);
    pending(1);
    const signal = { type: "suggestMove", payload: { matchId: stage.matchId, turnId: stage.turn.turnId, rollId: "r", pieceId: "A1", pathId: "outer" } };
    const before = structuredClone(state);
    expect(game.handleSignal!(context, "p2", signal)).toMatchObject({ recipientPlayerIds: ["p0", "p2"], type: "yutnori.suggestion", payload: { playerId: "p2" } });
    expect(game.handleSignal!(context, "p1", signal)).toBeUndefined();
    expect(game.handleSignal!(context, "p0", signal)).toBeUndefined();
    for (const patch of [{ matchId: "old" }, { turnId: 2 }, { rollId: "used" }, { pieceId: "B1" }]) {
      expect(game.handleSignal!(context, "p2", { ...signal, payload: { ...signal.payload, ...patch } })).toBeUndefined();
    }
    expect(state).toEqual(before);
    state.activeInterruption = { reason: "player_left", playerId: "p3", hostPlayerId: "p0", createdAt: 200 };
    expect(game.handleSignal!(context, "p2", signal)).toBeUndefined();
  });
});

describe("complete games", () => {
  it.each([2, 4])("preserves board invariants through a complete %s-player game", (count) => {
    let seed = 7189;
    const random = () => { seed = (Math.imul(seed, 1664525) + 1013904223) >>> 0; return seed; };
    vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint32Array).set([random() >>> 16, random()]); return array; });
    const { stage, state, context, apply } = setup(count);
    for (let step = 0; step < 2000 && state.phase === "active"; step++) {
      context.now = Math.max(context.now + THROW_DURATION_MS + THROW_RESULT_HOLD_MS, (stage.lastMoveSequence?.startedAt ?? 0) + (stage.lastMoveSequence?.durationMs ?? 0));
      const moves = getLegalMoves(stage);
      const immediate = stage.turn.pending.find((roll) => rollDisposition(roll) === "immediate");
      const immediateMoves = moves.filter((move) => move.rollId === immediate?.rollId);
      if (mandatoryThrows(stage) > 0) apply("throwYut");
      else if (immediateMoves.length > 0) {
        const move = immediateMoves[random() % immediateMoves.length]!;
        apply("movePiece", { rollId: move.rollId, pieceId: move.pieceId, pathId: move.pathId });
      } else if (immediate) apply("discardRoll", { rollId: immediate.rollId });
      else if (stage.turn.throwsRemaining > 0) apply("throwYut");
      else {
        const choices = [];
        let plan = simulateMovePlan(stage, choices, context.now);
        while (!plan.complete) {
          const candidates = getLegalMoves(plan.stage);
          const move = candidates[random() % candidates.length]!;
          choices.push({ rollId: move.rollId, pieceId: move.pieceId, pathId: move.pathId });
          plan = simulateMovePlan(stage, choices, context.now);
        }
        apply("commitMoves", { matchId: stage.matchId, turnId: stage.turn.turnId, moves: choices });
      }
      for (const node of BOARD_NODES) {
        const occupants = stage.pieces.filter((piece) => piece.nodeId === node.nodeId);
        expect(new Set(occupants.map((piece) => piece.teamId)).size).toBeLessThanOrEqual(1);
        expect(new Set(occupants.map((piece) => piece.stackId)).size).toBeLessThanOrEqual(1);
        expect(new Set(occupants.map((piece) => JSON.stringify(piece.history))).size).toBeLessThanOrEqual(1);
      }
      expect(stage.turn.throwsRemaining).toBeGreaterThanOrEqual(0);
      expect(stage.currentPlayerId).toBe(stage.turn.controllerPlayerId);
      expect(state.version).toBe(1);
    }
    expect(state.phase).toBe("finished");
    expect(stage.teams.find((team) => team.teamId === stage.winnerTeamId)!.finishedCount).toBe(4);
  });
});
