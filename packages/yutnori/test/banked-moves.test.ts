import type { ClientGameAction, JsonObject, RoomState } from "@bighouse/game-sdk/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLegalMoves } from "../src/board";
import { hasImmediateRoll, mandatoryThrows, moveDuration, rollDisposition, simulateMovePlan, THROW_RESULT_HOLD_MS } from "../src/rules";
import { THROW_DURATION_MS, yutnoriDefinition as game } from "../src/server";
import type { MoveChoice, YutnoriStage, YutRoll } from "../src/types";

function fixture() {
  const state: RoomState = {
    room: { roomId: "batch-unit", gameId: "yutnori", mode: "team-2v2", minPlayers: 4, maxPlayers: 4, config: {}, createdAt: 1 },
    phase: "active", version: 1, updatedAt: 1, playerStates: {}, stageState: {},
    players: ["p0", "p1", "p2", "p3"].map((playerId, seat) => ({ playerId, seat, joinedAt: 1, ready: true, connected: true }))
  };
  state.stageState = game.initialStageState({ room: state.room, players: state.players, now: 100 });
  const stage = state.stageState as unknown as YutnoriStage;
  const context = { state, now: 100 };
  const action = (type: string, payload: JsonObject = {}): ClientGameAction => ({ type, payload, playerId: stage.currentPlayerId, expectedVersion: state.version, clientActionId: "unit" });
  const apply = (type: string, payload: JsonObject = {}) => {
    const input = action(type, payload);
    expect(game.validateAction(context, input)).toEqual({ ok: true });
    return game.applyAction(context, input);
  };
  const ready = () => {
    if (stage.lastMoveSequence) context.now = Math.max(context.now, stage.lastMoveSequence.startedAt + stage.lastMoveSequence.durationMs);
    if (stage.lastThrow) context.now = Math.max(context.now, stage.lastThrow.startedAt + stage.lastThrow.durationMs + THROW_RESULT_HOLD_MS);
  };
  const bank = (...outcomes: Array<"yut" | "mo">) => {
    stage.turn.pending = outcomes.map((outcome, index) => ({ rollId: `bank${index}`, outcome, steps: outcome === "yut" ? 4 : 5, disposition: "banked" }));
    stage.turn.throwsRemaining = 0;
  };
  const payload = (moves: MoveChoice[]): JsonObject => ({ matchId: stage.matchId, turnId: stage.turn.turnId, moves });
  return { state, stage, context, action, apply, ready, bank, payload };
}
const choice = (rollId: string, pieceId = "A1", pathId = "outer"): MoveChoice => ({ rollId, pieceId, pathId });
function rigThrows(...bits: number[]) {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint32Array).set([bits.shift() ?? 2, 7]); return array; });
}
afterEach(() => vi.restoreAllMocks());

describe("banked result lifecycle", () => {
  it("banks yut/mo, retains their extra throws, and requires the ordinary final result immediately", () => {
    rigThrows(15, 0, 2);
    const { stage, context, apply, ready, action, payload } = fixture();
    apply("throwYut");
    expect(stage.turn.pending[0]).toMatchObject({ outcome: "yut", disposition: "banked" });
    expect(stage.turn.throwsRemaining).toBe(1);
    context.now += THROW_DURATION_MS;
    expect(game.validateAction(context, action("throwYut"))).toMatchObject({ code: "throw_in_progress" });
    ready();
    expect(game.validateAction(context, action("commitMoves", payload([choice(stage.turn.pending[0]!.rollId)]))).ok).toBe(false);
    apply("throwYut"); ready();
    expect(stage.turn.pending.map((roll) => roll.outcome)).toEqual(["yut", "mo"]);
    expect(stage.turn.throwsRemaining).toBe(1);
    apply("throwYut"); ready();
    expect(stage.turn.pending[2]).toMatchObject({ outcome: "do", disposition: "immediate" });
    expect(hasImmediateRoll(stage)).toBe(true);
    expect(game.validateAction(context, action("commitMoves", payload(stage.turn.pending.slice(0, 2).map((roll) => choice(roll.rollId))))).ok).toBe(false);
    apply("movePiece", choice(stage.turn.pending[2]!.rollId));
    expect(stage.pieces[0]!.nodeId).toBe("o1");
    expect(stage.turn.pending.map((roll) => roll.outcome)).toEqual(["yut", "mo"]);
    expect(stage.currentPlayerId).toBe("p0");
  });

  it("never permits individual confirmation of banked moves", () => {
    const { stage, bank, action, context } = fixture(); bank("yut");
    expect(game.validateAction(context, action("movePiece", choice("bank0")))).toMatchObject({ code: "banked_plan_required" });
    expect(stage.pieces[0]!.nodeId).toBe("reserve");
  });

  it("uses fallback dispositions and zero mandatory throws for legacy persisted state", () => {
    const { stage } = fixture();
    delete stage.turn.mandatoryThrows;
    expect(mandatoryThrows(stage)).toBe(0);
    for (const [outcome, disposition] of [["yut", "banked"], ["mo", "banked"], ["do", "immediate"], ["backDo", "immediate"]] as const) {
      expect(rollDisposition({ rollId: outcome, outcome, steps: 1 })).toBe(disposition);
    }
  });
});

describe("atomic ordered move plans", () => {
  it("previews a cloned prefix, commits all moves in chosen order, and schedules sequential timing", () => {
    const { state, stage, context, bank, payload, apply } = fixture(); bank("yut", "mo");
    const before = structuredClone(state);
    const first = choice("bank1");
    const preview = simulateMovePlan(stage, [first], context.now);
    expect(preview.complete).toBe(false);
    expect(preview.stopReason).toBe("incomplete");
    expect(preview.stage.pieces[0]!.nodeId).toBe("o5");
    expect(state).toEqual(before);
    const second = choice("bank0", "A1", "diagonalA");
    const result = apply("commitMoves", payload([first, second]));
    expect(stage.pieces[0]!.nodeId).toBe("a3");
    expect(stage.turn.pending).toEqual([]);
    expect(stage.currentPlayerId).toBe("p1");
    expect(state.version).toBe(1);
    const sequence = stage.lastMoveSequence!;
    expect(sequence.moves.map((move) => move.rollId)).toEqual(["bank1", "bank0"]);
    expect(sequence.moves[0]!.startedAt).toBe(context.now);
    expect(sequence.moves[1]!.startedAt).toBe(context.now + moveDuration(sequence.moves[0]!));
    expect(sequence.durationMs).toBe(sequence.moves.reduce((sum, move) => sum + moveDuration(move), 0));
    expect(stage.lastMove).toEqual(sequence.moves[1]);
    expect(result.events.filter((event) => event.type === "yutnori.moved").map((event) => event.payload.rollId)).toEqual(["bank1", "bank0"]);
  });

  it("rejects partial, duplicate, stale, enemy-piece and impossible sequential plans without mutation", () => {
    const { state, stage, context, action, bank, payload } = fixture(); bank("yut", "mo");
    const before = structuredClone(state);
    const invalid = [
      payload([choice("bank0")]),
      payload([choice("bank0"), choice("bank0")]),
      payload([choice("bank0"), choice("bank1", "A1", "diagonalA")]),
      payload([choice("bank0", "B1"), choice("bank1")]),
      { ...payload([choice("bank0"), choice("bank1")]), matchId: "stale" },
      { ...payload([choice("bank0"), choice("bank1")]), turnId: stage.turn.turnId - 1 },
      payload([]), { ...payload([choice("bank0")]), moves: [{ rollId: "bank0", pathId: 7 }] }
    ];
    for (const entry of invalid) expect(game.validateAction(context, action("commitMoves", entry)).ok).toBe(false);
    expect(state).toEqual(before);
  });

  it("applies stack membership changes to subsequent moves in the same plan", () => {
    const { stage, bank, payload, apply } = fixture(); bank("yut", "mo");
    stage.pieces[1]!.nodeId = "o4";
    apply("commitMoves", payload([choice("bank0"), choice("bank1", "A2")]));
    expect(stage.pieces.slice(0, 2).map((piece) => piece.nodeId)).toEqual(["o9", "o9"]);
    expect(stage.lastMoveSequence!.moves[1]!.pieceIds).toEqual(["A1", "A2"]);
  });

  it("locks every actor action and suggestion until the entire sequence ends", () => {
    const { stage, context, action, bank, payload, apply, ready } = fixture(); bank("yut", "mo");
    apply("commitMoves", payload([choice("bank0"), choice("bank1")]));
    const sequence = stage.lastMoveSequence!;
    context.now = sequence.startedAt + sequence.durationMs - 1;
    expect(game.validateAction(context, action("throwYut"))).toMatchObject({ code: "throw_in_progress" });
    expect(game.handleSignal!(context, "p3", { type: "suggestMove", payload: {} })).toBeUndefined();
    ready();
    expect(game.validateAction(context, action("throwYut"))).toEqual({ ok: true });
  });

  it("stops at victory even when other banked tokens remain", () => {
    const { state, stage, bank, payload, apply } = fixture(); bank("yut", "mo");
    for (const piece of stage.pieces.slice(0, 4)) { piece.nodeId = "o19"; piece.stackId = "A1"; }
    const plan = simulateMovePlan(stage, [choice("bank0")], 100);
    expect(plan.stopReason).toBe("victory");
    expect(plan.complete).toBe(true);
    apply("commitMoves", payload([choice("bank0")]));
    expect(state.phase).toBe("finished");
    expect(stage.turn.pending.map((roll) => roll.rollId)).toEqual(["bank1"]);
  });
});

describe("capture creates a mandatory new own turn", () => {
  it("stops a batch at capture, carries banked tokens, and requires its bonus throw before further moves", () => {
    rigThrows(2);
    const { stage, context, bank, action, payload, apply, ready } = fixture(); bank("mo", "yut");
    stage.pieces[4]!.nodeId = "o5";
    const first = choice("bank0");
    expect(simulateMovePlan(stage, [first], context.now).stopReason).toBe("capture");
    expect(game.validateAction(context, action("commitMoves", payload([first, choice("bank1")]))).ok).toBe(false);
    const result = apply("commitMoves", payload([first]));
    expect(stage.turn).toMatchObject({ turnId: 2, teamId: "A", controllerPlayerId: "p0", normalTurnIndex: 0, throwsRemaining: 1, mandatoryThrows: 1 });
    expect(stage.turn.pending.map((roll) => roll.rollId)).toEqual(["bank1"]);
    expect(result.events.find((event) => event.type === "yutnori.turnChanged")).toMatchObject({ payload: { reason: "capture", previousTurnId: 1, turnId: 2 } });
    expect(stage.lastMove!.turnId).toBe(1);
    expect(game.validateAction(context, action("throwYut"))).toMatchObject({ code: "throw_in_progress" });
    ready();
    for (const type of ["movePiece", "commitMoves", "discardRoll"]) expect(game.validateAction(context, action(type, payload([choice("bank1")])))).toMatchObject({ code: "capture_throw_required" });
    apply("throwYut"); ready();
    expect(stage.turn.mandatoryThrows).toBe(0);
    const immediate = stage.turn.pending.find((roll) => rollDisposition(roll) === "immediate")!;
    expect(game.validateAction(context, action("commitMoves", payload([choice("bank1")]))).ok).toBe(false);
    apply("movePiece", choice(immediate.rollId)); ready();
    apply("commitMoves", payload([choice("bank1")])); ready();
    expect(stage.turn).toMatchObject({ teamId: "B", turnId: 3, normalTurnIndex: 1, controllerPlayerId: "p1" });
    apply("throwYut"); ready();
    apply("movePiece", choice(stage.turn.pending[0]!.rollId, "B1"));
    expect(stage.turn).toMatchObject({ teamId: "A", turnId: 4, normalTurnIndex: 2, controllerPlayerId: "p2" });
  });

  it("starts a new own turn after an immediate capture and preserves existing banked results", () => {
    const { stage, bank, apply } = fixture(); bank("yut");
    stage.turn.pending.push({ rollId: "instant", outcome: "do", steps: 1, disposition: "immediate" });
    stage.pieces[4]!.nodeId = "o1";
    apply("movePiece", choice("instant"));
    expect(stage.turn.turnId).toBe(2);
    expect(stage.turn.pending.map((roll) => roll.rollId)).toEqual(["bank0"]);
    expect(stage.currentPlayerId).toBe("p0");
    expect(mandatoryThrows(stage)).toBe(1);
  });

  it("a mandatory bonus that rolls yut becomes banked and earns another throw", () => {
    rigThrows(15);
    const { stage, apply, ready } = fixture();
    stage.turn.pending = [{ rollId: "do", outcome: "do", steps: 1 }];
    stage.turn.throwsRemaining = 0;
    stage.pieces[4]!.nodeId = "o1";
    apply("movePiece", choice("do")); ready();
    apply("throwYut");
    expect(stage.turn).toMatchObject({ turnId: 2, controllerPlayerId: "p0", mandatoryThrows: 0, throwsRemaining: 1 });
    expect(stage.turn.pending[0]).toMatchObject({ outcome: "yut", disposition: "banked" });
  });
});
