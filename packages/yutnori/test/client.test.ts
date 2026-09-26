// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { GameClientContext } from "@bighouse/game-sdk/client";
import { mountGame, selectedLegalMove, validSuggestions, validPlanSuggestions } from "../src/client";
import { getLegalMoves } from "../src/board";
import type { YutnoriPublicView } from "../src/types";
vi.mock("../src/scene", () => ({ createThrowScene: () => ({ show: vi.fn(), destroy: vi.fn() }) }));

const now = 2_000_000;
const clients: ReturnType<typeof mountGame>[] = [];
function fixture(playerId = "a"): GameClientContext {
  const view: YutnoriPublicView = {
    matchId: "match-1", rules: { backDo: true, finish: "pass-exit" },
    teams: [{ teamId: "A", playerIds: ["a", "c"], finishedCount: 0 }, { teamId: "B", playerIds: ["b", "d"], finishedCount: 0 }],
    pieces: (["A", "B"] as const).flatMap((teamId) => Array.from({ length: 4 }, (_, i) => ({ pieceId: `${teamId}${i + 1}`, teamId, nodeId: "reserve", stackId: `${teamId}${i + 1}`, routeId: "outer" as const, history: [] }))),
    currentPlayerId: "a", turn: { turnId: 1, teamId: "A", controllerPlayerId: "a", throwsRemaining: 0, pending: [{ rollId: "r1", outcome: "do", steps: 1 }] }, legalMoves: [], serverNow: now
  };
  view.legalMoves = getLegalMoves(view);
  return {
    playerId, version: 1, uiRevision: 0, serverTime: now, phase: "active", publicView: view, privateView: {}, rematchRequests: [], chatMessages: [], events: [], connected: true,
    room: { roomId: "room-1", gameId: "yutnori", mode: "team-2v2", minPlayers: 4, maxPlayers: 4, supportsBots: false, players: ["a", "b", "c", "d"].map((id, seat) => ({ playerId: id, displayName: `이름 ${id}`, seat, connected: true, ready: true, joinedAt: now })) },
    sendAction: vi.fn(), sendSignal: vi.fn(), setReady: vi.fn(), startGame: vi.fn(), restartGame: vi.fn(), addBot: vi.fn(), removeBot: vi.fn(), transferHost: vi.fn(), sendChat: vi.fn(), shareRoom: vi.fn(), leaveRoom: vi.fn(), requestPlayAgain: vi.fn(), leaveFinishedGame: vi.fn()
  };
}
function mount(context: GameClientContext) {
  const container = document.createElement("div");
  document.body.append(container);
  const game = mountGame(container, context);
  clients.push(game);
  return { game, container, click: (selector: string) => container.querySelector<HTMLButtonElement>(selector)!.click() };
}
beforeEach(() => { vi.useFakeTimers(); vi.setSystemTime(now); sessionStorage.clear(); localStorage.clear(); });
afterEach(() => { clients.splice(0).forEach((game) => game.destroy()); document.body.replaceChildren(); vi.useRealTimers(); vi.restoreAllMocks(); });

describe("yutnori game client", () => {
  it("renders all 29 nodes and requires explicit confirmation after choosing a piece and path", () => {
    const context = fixture();
    const { container, click } = mount(context);
    expect(container.querySelectorAll(".yut-node")).toHaveLength(29);
    click('[data-piece="A1"]');
    expect(context.sendAction).not.toHaveBeenCalled();
    click('[data-destination="o1"]');
    expect(context.sendAction).not.toHaveBeenCalled();
    expect(container.querySelector(".yut-path-preview")).not.toBeNull();
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "commitMoves", payload: { matchId: "match-1", turnId: 1, moves: [{ rollId: "r1", pieceId: "A1", pathId: "outer" }] } });
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledTimes(1);
  });
  it("recovers pending controls after a rejected action and disables them during disconnect", () => {
    const context = fixture();
    (context.publicView as unknown as YutnoriPublicView).turn.pending = [];
    (context.publicView as unknown as YutnoriPublicView).turn.throwsRemaining = 1;
    const { game, container, click } = mount(context);
    click('[data-command="throw"]');
    expect(container.querySelector<HTMLButtonElement>('[data-command="throw"]')!.disabled).toBe(true);
    game.update({ ...context, actionError: { revision: 1, message: "다시 시도하세요" } });
    expect(container.querySelector<HTMLButtonElement>('[data-command="throw"]')!.disabled).toBe(false);
    expect(container.textContent).toContain("다시 시도하세요");
    game.update({ ...context, connected: false });
    expect(container.querySelector<HTMLButtonElement>('[data-command="throw"]')!.disabled).toBe(true);
  });
  it("sends teammate selection as a private signal, never a game action", () => {
    const context = fixture("c");
    const { click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o1"]');
    expect(context.sendSignal).not.toHaveBeenCalled();
    click('[data-command="plan-propose"]');
    expect(context.sendSignal).toHaveBeenCalledWith({ type: "suggestPlan", payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 0, moves: [], proposal: [{ rollId: "r1", pieceId: "A1", pathId: "outer" }] } });
    expect(context.sendAction).not.toHaveBeenCalled();
  });
  it("accepting a teammate suggestion previews it and still requires explicit confirmation", () => {
    const context = fixture();
    context.events = [{ id: "e1", type: "yutnori.suggestion", visibility: "private", playerId: "a", createdAt: now, payload: { matchId: "match-1", turnId: 1, rollId: "r1", pieceId: "A1", pathId: "outer", playerId: "c" } }];
    const { container, click } = mount(context);
    click('[data-suggestion="r1:A1:outer"]');
    expect(context.sendAction).not.toHaveBeenCalled();
    expect(container.querySelector(".yut-path-preview")).not.toBeNull();
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledTimes(1);
  });
  it("filters suggestions from an old turn, consumed roll, opposite team, and expired signal", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    const event = { id: "e1", type: "yutnori.suggestion", visibility: "private" as const, playerId: "a", createdAt: now, payload: { matchId: "match-1", turnId: 1, rollId: "r1", pieceId: "A1", pathId: "outer", playerId: "c" } };
    expect(validSuggestions([event], view, now)).toHaveLength(1);
    expect(validSuggestions([{ ...event, payload: { ...event.payload, turnId: 0 } }], view, now)).toEqual([]);
    expect(validSuggestions([{ ...event, payload: { ...event.payload, playerId: "b" } }], view, now)).toEqual([]);
    expect(validSuggestions([{ ...event, payload: { ...event.payload, rollId: "used" } }], view, now)).toEqual([]);
    expect(validSuggestions([event], view, now + 30_001)).toEqual([]);
    expect(selectedLegalMove(view, "used", "A1", "outer")).toBeUndefined();
  });
  it("notifies each own turn once across UI revisions and same-session remount, and honors opt-out", () => {
    const vibrate = vi.fn();
    Object.defineProperty(navigator, "vibrate", { value: vibrate, configurable: true });
    const context = fixture();
    const { game } = mount(context);
    expect(vibrate).toHaveBeenCalledTimes(1);
    game.update({ ...context, uiRevision: 3 });
    expect(vibrate).toHaveBeenCalledTimes(1);
    mount(context);
    expect(vibrate).toHaveBeenCalledTimes(1);
    const next = fixture();
    const nextView = next.publicView as unknown as YutnoriPublicView;
    nextView.turn.turnId = 5;
    game.update({ ...next, version: 2 });
    expect(vibrate).toHaveBeenCalledTimes(2);
    localStorage.setItem("bighouse:yutnori:vibration", "off");
    nextView.turn.turnId = 9;
    mount(next);
    expect(vibrate).toHaveBeenCalledTimes(2);
  });
  it("unlocks after the shared throw timeline even when chat-only snapshots keep the old server timestamp", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.lastThrow = { matchId: view.matchId, rollId: "r1", turnId: 1, playerId: "a", faces: [false, true, false, false], outcome: "do", steps: 1, visualSeed: 1, startedAt: now, durationMs: 1800 };
    const { container, game } = mount(context);
    expect(container.querySelector<HTMLButtonElement>('[data-command="throw"]')!.disabled).toBe(true);
    vi.advanceTimersByTime(1000);
    game.update({ ...context, uiRevision: 1 });
    vi.advanceTimersByTime(850);
    expect(container.querySelector<HTMLButtonElement>('[data-command="throw"]')!.disabled).toBe(true);
    vi.advanceTimersByTime(800);
    expect(container.querySelector<HTMLButtonElement>('[data-piece="A1"]')!.disabled).toBe(false);
  });
  it("plans stored rolls in the chosen order on a virtual board, then confirms once", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "y", outcome: "yut", steps: 4, disposition: "banked" }, { rollId: "m", outcome: "mo", steps: 5, disposition: "banked" }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    expect(view.pieces[0]!.nodeId).toBe("reserve");
    expect(container.querySelector('[data-node="o5"] .has-piece')).not.toBeNull();
    expect(context.sendAction).not.toHaveBeenCalled();
    expect(container.querySelector<HTMLButtonElement>('[data-command="plan-commit"]')!.disabled).toBe(true);
    click('[data-destination="a3"]');
    expect(container.querySelector('[data-node="a3"] .has-piece')).not.toBeNull();
    expect(context.sendAction).not.toHaveBeenCalled();
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "commitMoves", payload: { matchId: "match-1", turnId: 1, moves: [{ rollId: "m", pieceId: "A1", pathId: "outer" }, { rollId: "y", pieceId: "A1", pathId: "diagonalA" }] } });
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledTimes(1);
  });
  it("banks yut/mo and requires their extra throw before planning any moves", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "y", outcome: "yut", steps: 4, disposition: "banked" }];
    view.turn.throwsRemaining = 1;
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    expect(container.querySelector<HTMLButtonElement>('[data-piece="A1"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-piece="A1"]')!.disabled).toBe(true);
    expect(container.textContent).toContain("먼저 윷을 한 번 더 던져요");
    click('[data-command="throw"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "throwYut", payload: {} });
  });
  it("can undo a completed bank plan and does not send a game action", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "y", outcome: "yut", steps: 4, disposition: "banked" }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o4"]');
    expect(container.querySelector('[data-node="o4"] .has-piece')).not.toBeNull();
    click('[data-command="plan-undo"]');
    expect(container.querySelector('[data-node="o4"] .has-piece')).toBeNull();
    expect(context.sendAction).not.toHaveBeenCalled();
  });
  it("offers ordinary and yut/mo destinations together and lets mo precede gae", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "g", outcome: "gae", steps: 2, disposition: "immediate" }, { rollId: "m", outcome: "mo", steps: 5, disposition: "banked" }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]');
    expect(container.querySelector('[data-destination="o2"]')!.textContent).toContain("개 2");
    expect(container.querySelector('[data-destination="o5"]')!.textContent).toContain("모 5");
    click('[data-destination="o5"]'); click('[data-destination="a2"]');
    expect(view.pieces[0]!.nodeId).toBe("reserve");
    expect(container.querySelector('[data-node="a2"] .has-piece')).not.toBeNull();
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "commitMoves", payload: { matchId: "match-1", turnId: 1, moves: [{ rollId: "m", pieceId: "A1", pathId: "outer" }, { rollId: "g", pieceId: "A1", pathId: "diagonalA" }] } });
  });
  it("stops a plan at a capture while retaining unused banked rolls for the new own turn", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "y", outcome: "yut", steps: 4, disposition: "banked" }, { rollId: "m", outcome: "mo", steps: 5, disposition: "banked" }];
    view.pieces[4]!.nodeId = "o4";
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o4"]');
    expect(container.querySelector<HTMLButtonElement>('[data-command="plan-commit"]')!.disabled).toBe(false);
    expect(container.querySelectorAll("[data-destination]")).toHaveLength(0);
    expect(container.textContent).toContain("잡고 한 번 더!");
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "commitMoves", payload: { matchId: "match-1", turnId: 1, moves: [{ rollId: "y", pieceId: "A1", pathId: "outer" }] } });
  });
  it("requires the capture's new-turn throw before using retained banked results", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "y", outcome: "yut", steps: 4, disposition: "banked" }];
    view.turn.mandatoryThrows = 1;
    view.turn.throwsRemaining = 1;
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    expect(container.querySelector<HTMLButtonElement>('[data-piece="A1"]')!.disabled).toBe(true);
    expect(container.querySelector<HTMLButtonElement>('[data-command="throw"]')!.disabled).toBe(false);
    click('[data-command="throw"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "throwYut", payload: {} });
  });
  it("keeps the winning move visible until its animation finishes before showing the result dialog", () => {
    const context = fixture();
    context.phase = "finished";
    const view = context.publicView as unknown as YutnoriPublicView;
    view.winnerTeamId = "A";
    view.lastMoveSequence = { sequenceId: "win", startedAt: now, durationMs: 1000, moves: [] };
    const { container } = mount(context);
    const dialog = container.querySelector("bighouse-game-result-dialog") as HTMLElement & { state: { open: boolean } };
    expect(dialog.state.open).toBe(false);
    vi.advanceTimersByTime(1050);
    expect(dialog.state.open).toBe(true);
  });
  it("shows three crosses only on round faces and a red dot only on the marked flat face", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.lastThrow = { matchId: "match-1", rollId: "old", turnId: 1, playerId: "a", faces: [true, false, true, false], outcome: "gae", steps: 2, startedAt: now - 5000, durationMs: 1800, visualSeed: 1 };
    const { container } = mount(context);
    const sticks = container.querySelectorAll(".yut-summary-stick");
    expect(sticks[0]!.querySelector(".yut-backdo-dot")).not.toBeNull();
    expect(sticks[0]!.textContent).not.toContain("×");
    expect(sticks[1]!.querySelectorAll(".yut-stick-crosses i")).toHaveLength(3);
    expect(sticks[2]!.innerHTML).toBe("");
    expect(sticks[3]!.querySelectorAll(".yut-stick-crosses i")).toHaveLength(3);
    expect(container.querySelector(".yut-face-legend")!.textContent).toContain("×××는 둥근 면");
  });
  it("shows directional and fork arrows without visual place-name helper labels", () => {
    const { container } = mount(fixture());
    const board = container.querySelector('[data-role="board"]')!;
    expect(board.querySelectorAll(".yut-node-label")).toHaveLength(0);
    expect(board.textContent).not.toContain("지름길");
    expect(board.querySelector('[data-direction="start"]')).not.toBeNull();
    expect(board.querySelectorAll('[data-fork="o5"]')).toHaveLength(2);
    expect(board.querySelectorAll('[data-fork="o10"]')).toHaveLength(2);
    expect(board.querySelectorAll('[data-fork="c"]')).toHaveLength(2);
    expect(board.querySelectorAll('[data-fork="o15"]')).toHaveLength(0);
    expect(board.querySelector('[data-node="o0"] button')!.getAttribute("aria-label")).toContain("출발점");
  });
  it("shows distinct stack layers and count directly on the occupied board node", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.pieces[0]!.nodeId = "o3";
    view.pieces[1]!.nodeId = "o3";
    view.pieces[1]!.stackId = "A1";
    const { container } = mount(context);
    const node = container.querySelector('[data-node="o3"]')!;
    expect(node.querySelectorAll(".yut-piece-layer")).toHaveLength(1);
    expect(node.querySelector(".yut-stack-count")!.textContent).toBe("2");
    expect(node.querySelector(".yut-piece-face")!.textContent).toBe("A");
  });
  it("opens a shared large throw scene, reveals the result, then dismisses without replay on reconnect", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.lastThrow = { matchId: view.matchId, rollId: "r1", turnId: 1, playerId: "a", faces: [false, true, false, false], outcome: "do", steps: 1, visualSeed: 1, startedAt: now, durationMs: 1800 };
    const { container } = mount(context);
    expect(container.querySelector<HTMLElement>('[data-role="throw-overlay"]')!.hidden).toBe(false);
    expect(container.querySelector('[data-role="overlay-result"]')!.textContent).toContain("어떤 수");
    vi.advanceTimersByTime(1850);
    expect(container.querySelector('[data-role="overlay-result"]')!.textContent).toContain("1칸 앞으로");
    vi.advanceTimersByTime(800);
    expect(container.querySelector<HTMLElement>('[data-role="throw-overlay"]')!.hidden).toBe(true);
    const reconnected = mount({ ...context, serverTime: now + 2650 });
    expect(reconnected.container.querySelector<HTMLElement>('[data-role="throw-overlay"]')!.hidden).toBe(true);
  });
  it("reflects the disabled back-do rule in both face legend and game rules", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.rules.backDo = false;
    const { container } = mount(context);
    expect(container.querySelector(".yut-face-legend")!.textContent).toContain("빽도 없음");
    expect(container.querySelector(".yut-rules")!.textContent).toContain("이 방은 빽도를 사용하지 않습니다");
    expect(container.querySelector(".yut-rules")!.textContent).not.toContain("빽도는 지나온 길");
    expect(container.querySelector(".yut-rules")!.textContent).not.toContain("움직일 말이 없는 빽도");
  });
  it("uses published team membership and order for the waiting room roster", () => {
    const context = fixture();
    context.phase = "waiting";
    const view = context.publicView as unknown as YutnoriPublicView;
    view.teams[0]!.playerIds = ["c", "a"];
    const { container } = mount(context);
    const roster = container.querySelector(".yut-team.team-A .yut-roster")!.textContent!;
    expect(roster.indexOf("이름 c")).toBeLessThan(roster.indexOf("이름 a"));
    expect(roster).not.toContain("이름 b");
  });
  it("describes the server rollDiscarded event in the progress history", () => {
    const context = fixture();
    context.events = [{ id: "discard1", type: "yutnori.rollDiscarded", visibility: "public", createdAt: now, payload: { matchId: "match-1", turnId: 1, rollId: "r0" } }];
    const { container } = mount(context);
    expect(container.querySelector(".yut-history")!.textContent).toContain("이동할 수 없는 결과 소진");
  });
  it("preserves keyboard focus after selecting a reserve piece", () => {
    const { container, click } = mount(fixture());
    const piece = container.querySelector<HTMLButtonElement>('[data-piece="A1"]')!;
    piece.focus();
    click('[data-piece="A1"]');
    expect(document.activeElement).toBe(container.querySelector('[data-piece="A1"]'));
  });
  it("publishes a debounced private draft and shares the same virtual board with teammates", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "m", outcome: "mo", steps: 5 }, { rollId: "g", outcome: "gae", steps: 2 }];
    view.legalMoves = getLegalMoves(view);
    const { click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    expect(context.sendSignal).not.toHaveBeenCalled();
    vi.advanceTimersByTime(550);
    const signal = vi.mocked(context.sendSignal!).mock.calls[0]![0];
    expect(signal.type).toBe("previewPlan");
    expect(signal.payload).toMatchObject({ expectedVersion: 1, moves: [{ rollId: "m", pieceId: "A1", pathId: "outer" }] });
    const partner = { ...context, playerId: "c", sendSignal: vi.fn(), events: [{ id: "preview1", type: "yutnori.preview", visibility: "private" as const, playerId: "c", createdAt: now + 550, payload: { ...signal.payload, playerId: "a" } }] };
    const peer = mount(partner);
    expect(peer.container.querySelector('[data-node="o5"] .has-piece')).not.toBeNull();
    expect(peer.container.textContent).toContain("이어서");
    peer.click('[data-piece="A1"]'); peer.click('[data-destination="a2"]'); peer.click('[data-command="plan-propose"]');
    expect(partner.sendSignal).toHaveBeenCalledWith({ type: "suggestPlan", payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: signal.payload.revision, moves: signal.payload.moves, proposal: [{ rollId: "m", pieceId: "A1", pathId: "outer" }, { rollId: "g", pieceId: "A1", pathId: "diagonalA" }] } });
    expect(context.sendAction).not.toHaveBeenCalled();
  });
  it("rejects team suggestions with the wrong board version, revision, or draft prefix", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "m", outcome: "mo", steps: 5 }, { rollId: "g", outcome: "gae", steps: 2 }];
    const prefix = [{ rollId: "m", pieceId: "A1", pathId: "outer" }];
    const event = { id: "s1", type: "yutnori.suggestion", visibility: "private" as const, createdAt: now, payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 7, moves: prefix, playerId: "c", rollId: "g", pieceId: "A1", pathId: "diagonalA" } };
    expect(validSuggestions([event], view, now, 1, 7, prefix)).toHaveLength(1);
    expect(validSuggestions([event], view, now, 2, 7, prefix)).toHaveLength(0);
    expect(validSuggestions([event], view, now, 1, 8, prefix)).toHaveLength(0);
    expect(validSuggestions([event], view, now, 1, 7, [])).toHaveLength(0);
  });
  it("discards an unusable back-do inside the draft before mo and commits both atomically", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "b", outcome: "backDo", steps: -1 }, { rollId: "m", outcome: "mo", steps: 5 }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-discard="b"]');
    expect(context.sendAction).not.toHaveBeenCalled();
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    expect(container.querySelector<HTMLButtonElement>('[data-command="plan-commit"]')!.disabled).toBe(false);
    click('[data-command="plan-commit"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "commitMoves", payload: { matchId: "match-1", turnId: 1, moves: [{ rollId: "b", discard: true }, { rollId: "m", pieceId: "A1", pathId: "outer" }] } });
  });
  it("offers a real backwards destination after mo rather than discarding the now usable back-do", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "b", outcome: "backDo", steps: -1 }, { rollId: "m", outcome: "mo", steps: 5 }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    expect(container.querySelector('[data-discard="b"]')).toBeNull();
    expect(container.querySelector('[data-destination="o4"]')!.textContent).toContain("빽도 -1");
    click('[data-destination="o4"]');
    expect(container.querySelector('[data-node="o4"] .has-piece')).not.toBeNull();
    expect(container.querySelector<HTMLButtonElement>('[data-command="plan-commit"]')!.disabled).toBe(false);
  });
  it("uses a small chooser only when multiple results reach the same destination", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending.push({ rollId: "r2", outcome: "do", steps: 1 });
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o1"]');
    expect(container.querySelectorAll(".yut-route-picker [data-move]")).toHaveLength(2);
    expect(context.sendAction).not.toHaveBeenCalled();
    click('[data-move="r2:A1:outer"]');
    expect(container.querySelector(".yut-route-picker")).toBeNull();
    expect(container.querySelector('[data-node="o1"] .has-piece')).not.toBeNull();
  });
  it("keeps original pieces as ghosts and restores their positions on undo", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.pieces[0]!.nodeId = "o3";
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    expect(container.querySelector<HTMLElement>('[data-role="ghost-hint"]')!.hidden).toBe(true);
    click('[data-piece="A1"]'); click('[data-destination="o4"]');
    expect(container.querySelector(".yut-origin-ghost")!.getAttribute("aria-label")).toContain("A1 원래 자리");
    expect(view.pieces[0]!.nodeId).toBe("o3");
    expect(document.activeElement).toBe(container.querySelector('[data-command="plan-commit"]'));
    click('[data-command="plan-undo"]');
    expect(container.querySelector(".yut-origin-ghost")).toBeNull();
    expect(container.querySelector('[data-node="o3"] .has-piece')).not.toBeNull();
    expect(document.activeElement).toBe(container.querySelector('[data-piece="A1"]'));
  });
  it("moves keyboard focus to the virtual piece between moves and final confirmation at the end", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "m", outcome: "mo", steps: 5 }, { rollId: "g", outcome: "gae", steps: 2 }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    expect(document.activeElement).toBe(container.querySelector('[data-node="o5"] [data-piece="A1"]'));
    click('[data-destination="a2"]');
    expect(document.activeElement).toBe(container.querySelector('[data-command="plan-commit"]'));
  });
  it("clears a drag and pending preview publication when the authoritative board changes", () => {
    const context = fixture();
    const { container, game, click } = mount(context);
    const piece = container.querySelector('[data-piece="A1"]')!;
    piece.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    container.querySelector(".yut-game")!.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 1, clientX: 40, clientY: 40 }));
    expect(container.querySelector(".yut-drag-piece")).not.toBeNull();
    game.update({ ...context, version: 2 });
    expect(container.querySelector(".yut-drag-piece")).toBeNull();
    click('[data-piece="A1"]'); click('[data-destination="o1"]');
    game.update({ ...context, version: 3 });
    vi.advanceTimersByTime(600);
    expect(context.sendSignal).not.toHaveBeenCalled();
  });

  it("does not capture ordinary taps and releases capture when an actual drag is cancelled", () => {
    const { container, game } = mount(fixture());
    const surface = container.querySelector<HTMLElement>(".yut-game")!;
    let captured: number | undefined;
    const setCapture = vi.fn((id: number) => { captured = id; });
    const releaseCapture = vi.fn(() => { captured = undefined; });
    Object.assign(surface, { setPointerCapture: setCapture, hasPointerCapture: (id: number) => captured === id, releasePointerCapture: releaseCapture });
    const piece = container.querySelector('[data-piece="A1"]')!;
    piece.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    expect(setCapture).not.toHaveBeenCalled();
    piece.dispatchEvent(new PointerEvent("pointerup", { bubbles: true, pointerId: 1, button: 0, clientX: 10, clientY: 10 }));
    expect(releaseCapture).not.toHaveBeenCalled();
    piece.dispatchEvent(new PointerEvent("pointerdown", { bubbles: true, pointerId: 2, button: 0, clientX: 10, clientY: 10 }));
    surface.dispatchEvent(new PointerEvent("pointermove", { bubbles: true, pointerId: 2, clientX: 30, clientY: 30 }));
    expect(setCapture).toHaveBeenCalledWith(2);
    game.update({ ...fixture(), version: 2 });
    expect(releaseCapture).toHaveBeenCalledWith(2);
    expect(container.querySelector(".yut-drag-piece")).toBeNull();
  });

  it("lets a teammate compose and undo several moves before sending a completed proposal", () => {
    const context = fixture("c");
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "m", outcome: "mo", steps: 5 }, { rollId: "g", outcome: "gae", steps: 2 }];
    view.legalMoves = getLegalMoves(view);
    const { container, click } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    expect(container.querySelector<HTMLButtonElement>('[data-command="plan-propose"]')!.disabled).toBe(true);
    expect(context.sendSignal).not.toHaveBeenCalled();
    click('[data-destination="a2"]');
    expect(container.querySelector<HTMLButtonElement>('[data-command="plan-propose"]')!.disabled).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('[data-command="plan-propose"]'));
    click('[data-command="plan-undo"]');
    expect(container.querySelector('[data-node="o5"] .has-piece')).not.toBeNull();
    click('[data-destination="o7"]'); click('[data-command="plan-propose"]');
    expect(context.sendSignal).toHaveBeenCalledWith({ type: "suggestPlan", payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 0, moves: [], proposal: [{ rollId: "m", pieceId: "A1", pathId: "outer" }, { rollId: "g", pieceId: "A1", pathId: "outer" }] } });
    click('[data-command="plan-propose"]');
    expect(context.sendSignal).toHaveBeenCalledTimes(1);
    expect(context.sendAction).not.toHaveBeenCalled();
    expect(view.pieces[0]!.nodeId).toBe("reserve");
  });
  it("shows a teammate proposal as a separate ghost and applying commits it directly once", () => {
    const context = fixture();
    const proposal = [{ rollId: "r1", pieceId: "A1", pathId: "outer" }];
    context.events = [{ id: "p1", type: "yutnori.planSuggestion", visibility: "private", createdAt: now, payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 0, moves: [], proposal, playerId: "c" } }];
    const { container, click } = mount(context);
    expect(container.querySelectorAll('.yut-proposal-ghost[data-proposal-player="c"]')).toHaveLength(1);
    expect(container.querySelector('[data-node="o1"] .has-piece')).toBeNull();
    expect(container.querySelector('[data-piece="A1"]')).not.toBeNull();
    expect(context.sendAction).not.toHaveBeenCalled();
    expect(container.querySelector('.yut-proposals-panel')!.hasAttribute("hidden")).toBe(false);
    expect(container.querySelector('.yut-plan-proposal')!.textContent).toContain("적용하면 바로 이동해요");
    click('[data-apply-proposal="c"]');
    expect(context.sendAction).toHaveBeenCalledWith({ type: "commitMoves", payload: { matchId: "match-1", turnId: 1, moves: proposal } });
    click('[data-apply-proposal="c"]');
    expect(context.sendAction).toHaveBeenCalledTimes(1);
  });
  it("invalidates proposal ghosts when the controller changes the draft", () => {
    const context = fixture();
    context.events = [{ id: "p1", type: "yutnori.planSuggestion", visibility: "private", createdAt: now, payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 0, moves: [], proposal: [{ rollId: "r1", pieceId: "A1", pathId: "outer" }], playerId: "c" } }];
    const { container, click } = mount(context);
    click('[data-piece="A2"]'); click('[data-destination="o1"]');
    expect(container.querySelector(".yut-proposal-ghost")).toBeNull();
    expect(container.querySelector("[data-apply-proposal]")).toBeNull();
    expect(context.sendAction).not.toHaveBeenCalled();
  });
  it("clears a teammate's local suffix when a new controller preview arrives", () => {
    const context = fixture("c");
    const view = context.publicView as unknown as YutnoriPublicView;
    view.turn.pending = [{ rollId: "m", outcome: "mo", steps: 5 }, { rollId: "g", outcome: "gae", steps: 2 }];
    view.legalMoves = getLegalMoves(view);
    const { container, click, game } = mount(context);
    click('[data-piece="A1"]'); click('[data-destination="o5"]');
    game.update({ ...context, events: [{ id: "new", type: "yutnori.preview", visibility: "private", createdAt: now, payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, revision: 8, playerId: "a", moves: [{ rollId: "m", pieceId: "A2", pathId: "outer" }] } }] });
    expect(container.querySelector('[data-command="plan-undo"]')).toBeNull();
    expect(container.querySelector('[data-node="o5"] .yut-piece-face')!.textContent).toBe("A2");
    expect(container.querySelector('[data-piece="A1"]')).not.toBeNull();
    expect(container.textContent).toContain("조작자의 선택이 바뀌었어요");
    expect(context.sendSignal).not.toHaveBeenCalled();
  });
  it("rejects incomplete, stale, unauthorized and expired plan proposals", () => {
    const context = fixture();
    const view = context.publicView as unknown as YutnoriPublicView;
    const event = { id: "p", type: "yutnori.planSuggestion", visibility: "private" as const, createdAt: now, payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 0, playerId: "c", moves: [], proposal: [{ rollId: "r1", pieceId: "A1", pathId: "outer" }] } };
    expect(validPlanSuggestions([event], view, now, 1, 0, [])).toHaveLength(1);
    expect(validPlanSuggestions([event], view, now, 2, 0, [])).toHaveLength(0);
    expect(validPlanSuggestions([event], view, now, 1, 1, [])).toHaveLength(0);
    expect(validPlanSuggestions([event], view, now + 30_001, 1, 0, [])).toHaveLength(0);
    expect(validPlanSuggestions([{ ...event, payload: { ...event.payload, playerId: "b" } }], view, now, 1, 0, [])).toHaveLength(0);
    view.turn.pending.push({ rollId: "r2", outcome: "gae", steps: 2 });
    expect(validPlanSuggestions([event], view, now, 1, 0, [])).toHaveLength(0);
  });

  it("opens new proposal events without stealing focus and respects a manually collapsed panel", () => {
    const context = fixture();
    const { container, click, game } = mount(context);
    const piece = container.querySelector<HTMLButtonElement>('[data-piece="A1"]')!;
    piece.focus();
    const proposal = { id: "proposal1", type: "yutnori.planSuggestion", visibility: "private" as const, createdAt: now, payload: { matchId: "match-1", turnId: 1, expectedVersion: 1, planRevision: 0, moves: [], proposal: [{ rollId: "r1", pieceId: "A1", pathId: "outer" }], playerId: "c" } };
    game.update({ ...context, events: [proposal] });
    expect(container.querySelector('.yut-proposals-panel')!.hasAttribute("hidden")).toBe(false);
    expect(document.activeElement).toBe(container.querySelector('[data-piece="A1"]'));
    click('[data-command="toggle-proposals"]');
    vi.advanceTimersByTime(1500);
    game.update({ ...context, events: [proposal], uiRevision: 2 });
    expect(container.querySelector('.yut-proposals-panel')!.hasAttribute("hidden")).toBe(true);
    game.update({ ...context, events: [proposal, { ...proposal, id: "proposal2", createdAt: now + 1500 }] });
    expect(container.querySelector('.yut-proposals-panel')!.hasAttribute("hidden")).toBe(false);
  });

  it("places reserve and finish team panels below the board and action area", () => {
    const { container } = mount(fixture());
    const teams = container.querySelector('[data-role="teams"]')!;
    const layout = container.querySelector('.yut-layout')!;
    const footer = container.querySelector('.yut-footer')!;
    expect(layout.compareDocumentPosition(teams) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(teams.compareDocumentPosition(footer) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    expect(teams.querySelector<HTMLButtonElement>('[data-piece="A1"]')!.disabled).toBe(false);
  });

});
