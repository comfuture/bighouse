import type { ClientGameAction, JsonObject, RoomState } from "@bighouse/game-sdk/server";
import { afterEach, describe, expect, it, vi } from "vitest";
import { getLegalMoves } from "../src/board";
import { mandatoryThrows, moveDuration, simulateMovePlan, THROW_RESULT_HOLD_MS } from "../src/rules";
import { THROW_DURATION_MS, yutnoriDefinition as game } from "../src/server";
import type { MoveChoice, PlanChoice, YutnoriStage } from "../src/types";

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
  const payload = (moves: PlanChoice[]): JsonObject => ({ matchId: stage.matchId, turnId: stage.turn.turnId, moves });
  return { state, stage, context, action, apply, ready, bank, payload };
}
const choice = (rollId: string, pieceId = "A1", pathId = "outer"): MoveChoice => ({ rollId, pieceId, pathId });
function rigThrows(...bits: number[]) {
  vi.spyOn(crypto, "getRandomValues").mockImplementation((array) => { (array as Uint32Array).set([bits.shift() ?? 2, 7]); return array; });
}
afterEach(() => vi.restoreAllMocks());

describe("banked result lifecycle", () => {
  it("collects all results after taking yut/mo extra throws, then permits a mixed ordered plan", () => {
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
    expect(stage.turn.pending[2]).toMatchObject({ outcome: "do", disposition: "banked" });
    expect(game.validateAction(context, action("commitMoves", payload(stage.turn.pending.slice(0, 2).map((roll) => choice(roll.rollId))))).ok).toBe(false);
    const ordered = [stage.turn.pending[0]!, stage.turn.pending[2]!, stage.turn.pending[1]!];
    apply("commitMoves", payload(ordered.map((roll) => choice(roll.rollId))));
    expect(stage.lastMoveSequence!.moves.map((move) => move.rollId)).toEqual(ordered.map((roll) => roll.rollId));
    expect(stage.turn.pending).toHaveLength(0);
    expect(stage.currentPlayerId).toBe("p1");
  });

  it("retains safe legacy movePiece support for any available result", () => {
    const { stage, bank, apply } = fixture(); bank("yut");
    apply("movePiece", choice("bank0"));
    expect(stage.pieces[0]!.nodeId).toBe("o4");
  });

  it("plans legacy results without dispositions and defaults missing mandatory throws to zero", () => {
    const { stage, bank } = fixture(); bank("mo");
    delete stage.turn.mandatoryThrows;
    delete stage.turn.pending[0]!.disposition;
    stage.turn.pending.push({ rollId: "gae", outcome: "gae", steps: 2 });
    expect(mandatoryThrows(stage)).toBe(0);
    const plan = simulateMovePlan(stage, [choice("bank0"), choice("gae", "A1", "diagonalA")], 100);
    expect(plan.complete).toBe(true);
    expect(plan.stage.pieces[0]!.nodeId).toBe("a2");
  });
});

describe("atomic ordered move plans", () => {
  it("supports either mo→gae or gae→mo without imposing legacy disposition priority", () => {
    const { state, stage, bank, payload, apply } = fixture(); bank("mo");
    stage.turn.pending.push({ rollId: "gae", outcome: "gae", steps: 2, disposition: "immediate" });
    const before = structuredClone(state);
    const moFirst = [choice("bank0"), choice("gae", "A1", "diagonalA")];
    const gaeFirst = [choice("gae"), choice("bank0")];
    expect(simulateMovePlan(stage, moFirst, 100).stage.pieces[0]!.nodeId).toBe("a2");
    expect(simulateMovePlan(stage, gaeFirst, 100).stage.pieces[0]!.nodeId).toBe("o7");
    expect(state).toEqual(before);
    apply("commitMoves", payload(moFirst));
    expect(stage.pieces[0]!.nodeId).toBe("a2");
    expect(stage.lastMoveSequence!.moves.map((move) => move.rollId)).toEqual(["bank0", "gae"]);
  });

  it("requires earned throws before legacy moves, discards, batches or signals", () => {
    const { stage, bank, action, context, payload } = fixture(); bank("mo");
    stage.turn.throwsRemaining = 1;
    stage.turn.pending.push({ rollId: "back", outcome: "backDo", steps: -1, disposition: "immediate" });
    for (const input of [action("movePiece", choice("bank0")), action("discardRoll", { rollId: "back" }), action("commitMoves", payload([{ rollId: "back", discard: true }, choice("bank0")]))]) {
      expect(game.validateAction(context, input)).toMatchObject({ code: "extra_throw_required" });
    }
    expect(game.validateAction(context, action("throwYut"))).toEqual({ ok: true });
  });

  it("discards an unusable backDo at its selected point in the atomic plan", () => {
    const { state, stage, bank, payload, apply } = fixture(); bank("mo");
    stage.turn.pending.push({ rollId: "back", outcome: "backDo", steps: -1 });
    const before = structuredClone(state);
    const choices: PlanChoice[] = [{ rollId: "back", discard: true }, choice("bank0")];
    const plan = simulateMovePlan(stage, choices, 100);
    expect(plan).toMatchObject({ complete: true, discardedRollIds: ["back"] });
    expect(plan.stage.pieces[0]!.nodeId).toBe("o5");
    expect(state).toEqual(before);
    expect(() => simulateMovePlan(stage, [choice("bank0"), { rollId: "back", discard: true }], 100)).toThrow();
    expect(simulateMovePlan(stage, [choice("bank0"), choice("back", "A1", "back")], 100).stage.pieces[0]!.nodeId).toBe("o4");
    const result = apply("commitMoves", payload(choices));
    expect(result.events.slice(0, 2).map((event) => event.type)).toEqual(["yutnori.rollDiscarded", "yutnori.moved"]);
    expect(stage.lastMoveSequence!.moves).toHaveLength(1);
  });

  it("can complete a discard-only turn, while rejecting a legal or duplicate discard", () => {
    const { state, stage, bank, payload, apply, context, action } = fixture(); bank();
    stage.turn.pending.push({ rollId: "back", outcome: "backDo", steps: -1 });
    const result = apply("commitMoves", payload([{ rollId: "back", discard: true }]));
    expect(stage.turn.pending).toEqual([]);
    expect(stage.currentPlayerId).toBe("p1");
    expect(stage.lastMoveSequence).toMatchObject({ durationMs: 0, moves: [] });
    expect(result.events.map((event) => event.type)).toEqual(["yutnori.rollDiscarded", "yutnori.turnChanged"]);
    expect(state.version).toBe(1);
    bank("mo");
    expect(game.validateAction(context, action("commitMoves", payload([{ rollId: "bank0", discard: true }]))).ok).toBe(false);
    stage.turn.pending.push({ rollId: "back2", outcome: "backDo", steps: -1 });
    expect(game.validateAction(context, action("commitMoves", payload([{ rollId: "back2", discard: true }, { rollId: "back2", discard: true }]))).ok).toBe(false);
  });
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
  it("carries every unused result across capture and rejects moves beyond the capture boundary", () => {
    const { stage, bank, apply, payload, action, context } = fixture(); bank("mo");
    stage.turn.pending.push({ rollId: "gae", outcome: "gae", steps: 2 }, { rollId: "back", outcome: "backDo", steps: -1 });
    stage.pieces[4]!.nodeId = "o5";
    const before = structuredClone(stage);
    expect(game.validateAction(context, action("commitMoves", payload([choice("bank0"), choice("gae")]))).ok).toBe(false);
    expect(stage).toEqual(before);
    apply("commitMoves", payload([choice("bank0")]));
    expect(stage.turn).toMatchObject({ turnId: 2, teamId: "A", mandatoryThrows: 1, throwsRemaining: 1 });
    expect(stage.turn.pending.map((roll) => roll.rollId)).toEqual(["gae", "back"]);
  });
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
    const immediate = stage.turn.pending.find((roll) => roll.outcome === "do")!;
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

describe("private team plan previews", () => {
  it("relays a teammate's multiple-choice proposal privately without mutating authoritative state", () => {
    const { state, bank, context, payload } = fixture(); bank("mo", "yut", "mo");
    const prefix = [choice("bank0")];
    const proposal = [...prefix, choice("bank1", "A1", "diagonalA"), choice("bank2", "A2")];
    const before = structuredClone(state);
    const publicBefore = game.getPublicView(context);
    const signal = { type: "suggestPlan", payload: { ...payload(prefix), expectedVersion: state.version, planRevision: 3, proposal } };
    expect(game.handleSignal!(context, "p2", signal)).toEqual({ recipientPlayerIds: ["p0", "p2"], type: "yutnori.planSuggestion", payload: { ...signal.payload, playerId: "p2" } });
    expect(state).toEqual(before);
    expect(game.getPublicView(context)).toEqual(publicBefore);
  });

  it("rejects legal incomplete proposals and accepts a complete plan from an empty prefix", () => {
    const { state, bank, context, payload } = fixture(); bank("mo", "yut", "mo");
    const base = { expectedVersion: state.version, planRevision: 0 };
    expect(game.handleSignal!(context, "p2", { type: "suggestPlan", payload: { ...payload([]), ...base, proposal: [choice("bank0")] } })).toBeUndefined();
    const proposal = [choice("bank0"), choice("bank1", "A1", "diagonalA")];
    expect(game.handleSignal!(context, "p2", { type: "suggestPlan", payload: { ...payload([choice("bank0")]), ...base, proposal } })).toBeUndefined();
    proposal.push(choice("bank2", "A2"));
    expect(game.handleSignal!(context, "p2", { type: "suggestPlan", payload: { ...payload([]), ...base, proposal } })).toMatchObject({ payload: { moves: [], proposal } });
  });

  it("rejects plan suggestions from other roles or with stale context, changed prefixes or illegal extensions", () => {
    const { state, bank, context, payload } = fixture(); bank("mo", "yut", "mo");
    const signal = { type: "suggestPlan", payload: { ...payload([choice("bank0")]), expectedVersion: state.version, planRevision: 3, proposal: [choice("bank0"), choice("bank1", "A1", "diagonalA")] } };
    for (const playerId of ["p0", "p1", "p3", "outsider"]) expect(game.handleSignal!(context, playerId, signal)).toBeUndefined();
    for (const patch of [
      { expectedVersion: 0 }, { turnId: 99 }, { matchId: "old" }, { planRevision: -1 }, { planRevision: 1.5 },
      { proposal: [] }, { proposal: [choice("bank0")] }, { proposal: null },
      { proposal: [choice("bank1"), choice("bank0")] },
      { proposal: [choice("bank0", "A2"), choice("bank1")] },
      { proposal: [choice("bank0"), choice("bank0")] },
      { proposal: [choice("bank0"), choice("bank1", "B1")] },
      { proposal: [choice("bank0"), { rollId: "bank1", discard: true, pieceId: "A1" }] }
    ]) expect(game.handleSignal!(context, "p2", { ...signal, payload: { ...signal.payload, ...patch } })).toBeUndefined();
  });

  it("allows capture as a proposal endpoint but rejects any continuation and presentation or throw locks", () => {
    const { state, stage, bank, context, payload } = fixture(); bank("mo", "yut");
    stage.pieces[4]!.nodeId = "o5";
    const signal = { type: "suggestPlan", payload: { ...payload([]), expectedVersion: state.version, planRevision: 0, proposal: [choice("bank0")] } };
    expect(game.handleSignal!(context, "p2", signal)).toMatchObject({ type: "yutnori.planSuggestion" });
    expect(game.handleSignal!(context, "p2", { ...signal, payload: { ...signal.payload, proposal: [choice("bank0"), choice("bank1")] } })).toBeUndefined();
    stage.turn.throwsRemaining = 1;
    expect(game.handleSignal!(context, "p2", signal)).toBeUndefined();
    stage.turn.throwsRemaining = 0; stage.turn.mandatoryThrows = 1;
    expect(game.handleSignal!(context, "p2", signal)).toBeUndefined();
    stage.turn.mandatoryThrows = 0;
    stage.lastMoveSequence = { sequenceId: "playing", startedAt: context.now, durationMs: 500, moves: [] };
    expect(game.handleSignal!(context, "p2", signal)).toBeUndefined();
  });

  it("preserves explicit discard prefixes and normalizes JSON key order in proposals", () => {
    const { state, stage, bank, context, payload } = fixture(); bank("mo");
    stage.turn.pending.push({ rollId: "back", outcome: "backDo", steps: -1 });
    const signal = { type: "suggestPlan", payload: { ...payload([{ rollId: "back", discard: true }]), expectedVersion: state.version, planRevision: 1, proposal: [{ discard: true, rollId: "back" }, choice("bank0")] } };
    expect(game.handleSignal!(context, "p2", signal)).toMatchObject({ payload: { moves: [{ rollId: "back", discard: true }], proposal: [{ rollId: "back", discard: true }, choice("bank0")] } });
    expect(game.handleSignal!(context, "p2", { ...signal, payload: { ...signal.payload, proposal: [choice("bank0"), { rollId: "back", discard: true }] } })).toBeUndefined();
  });

  it("relays a controller's valid prefix or clear without changing board, version or public view", () => {
    const { state, stage, bank, context, payload } = fixture(); bank("mo", "yut");
    const before = structuredClone(state);
    const publicBefore = game.getPublicView(context);
    const signal = { type: "previewPlan", payload: { ...payload([choice("bank0")]), expectedVersion: state.version, revision: 3 } };
    expect(game.handleSignal!(context, "p0", signal)).toMatchObject({ recipientPlayerIds: ["p0", "p2"], type: "yutnori.preview", payload: { playerId: "p0", revision: 3, expectedVersion: 1, moves: [choice("bank0")] } });
    expect(game.handleSignal!(context, "p0", { ...signal, payload: { ...signal.payload, moves: [], revision: 4 } })).toMatchObject({ payload: { moves: [], revision: 4 } });
    expect(state).toEqual(before);
    expect(game.getPublicView(context)).toEqual(publicBefore);
    expect(stage.pieces[0]!.nodeId).toBe("reserve");
  });

  it("rejects unauthorized, stale, malformed, impossible and capture-overrun previews", () => {
    const { state, stage, bank, context, payload } = fixture(); bank("mo", "yut");
    const signal = { type: "previewPlan", payload: { ...payload([choice("bank0")]), expectedVersion: state.version, revision: 1 } };
    for (const playerId of ["p1", "p2", "p3", "outsider"]) expect(game.handleSignal!(context, playerId, signal)).toBeUndefined();
    for (const patch of [{ expectedVersion: 0 }, { turnId: 99 }, { matchId: "old" }, { revision: -1 }, { revision: 1.5 }, { moves: [choice("bank0", "B1")] }, { moves: [{ rollId: "bank0", discard: true, pieceId: "A1" }] }]) {
      expect(game.handleSignal!(context, "p0", { ...signal, payload: { ...signal.payload, ...patch } })).toBeUndefined();
    }
    stage.pieces[4]!.nodeId = "o5";
    expect(game.handleSignal!(context, "p0", { ...signal, payload: { ...signal.payload, moves: [choice("bank0"), choice("bank1")] } })).toBeUndefined();
    stage.turn.throwsRemaining = 1;
    expect(game.handleSignal!(context, "p0", signal)).toBeUndefined();
  });

  it("validates teammate destination suggestions on the simulated prefix, never the original board", () => {
    const { state, stage, bank, context, payload } = fixture(); bank("mo", "yut");
    const before = structuredClone(state);
    const signal = { type: "suggestMove", payload: { ...payload([choice("bank0")]), expectedVersion: state.version, planRevision: 3, move: choice("bank1", "A1", "diagonalA") } };
    expect(getLegalMoves(stage).some((move) => move.rollId === "bank1" && move.pathId === "diagonalA")).toBe(false);
    expect(game.handleSignal!(context, "p2", signal)).toMatchObject({ recipientPlayerIds: ["p0", "p2"], type: "yutnori.suggestion", payload: { playerId: "p2", planRevision: 3, expectedVersion: 1, moves: [choice("bank0")], rollId: "bank1", pieceId: "A1", pathId: "diagonalA" } });
    for (const playerId of ["p0", "p1", "p3"]) expect(game.handleSignal!(context, playerId, signal)).toBeUndefined();
    for (const patch of [{ expectedVersion: 0 }, { planRevision: -1 }, { moves: [] }, { move: choice("bank0") }, { move: choice("bank1", "B1") }]) {
      expect(game.handleSignal!(context, "p2", { ...signal, payload: { ...signal.payload, ...patch } })).toBeUndefined();
    }
    expect(state).toEqual(before);
  });

  it("supports an explicit unusable-result prefix in previews and suggestions", () => {
    const { state, stage, bank, context, payload } = fixture(); bank("mo");
    stage.turn.pending.push({ rollId: "back", outcome: "backDo", steps: -1 });
    const prefix = { ...payload([{ rollId: "back", discard: true }]), expectedVersion: state.version };
    expect(game.handleSignal!(context, "p0", { type: "previewPlan", payload: { ...prefix, revision: 1 } })).toMatchObject({ payload: { moves: [{ rollId: "back", discard: true }] } });
    expect(game.handleSignal!(context, "p2", { type: "suggestMove", payload: { ...prefix, planRevision: 1, move: choice("bank0") } })).toMatchObject({ payload: { rollId: "bank0" } });
  });
});
