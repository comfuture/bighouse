// @vitest-environment happy-dom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { createBoardMotion, moveMotionPlan } from "../src/motion";
import type { YutnoriPublicView, YutPiece } from "../src/types";

type AnimationCall = { element: HTMLElement; frames: Keyframe[]; options: KeyframeAnimationOptions; animation: Animation; finish(): void };
const calls: AnimationCall[] = [];
const controllers: ReturnType<typeof createBoardMotion>[] = [];
let media: EventTarget & { matches: boolean; addEventListener: ReturnType<typeof vi.fn>; removeEventListener: ReturnType<typeof vi.fn> };
let hidden = false;
let originalAnimate: PropertyDescriptor | undefined;

function piece(pieceId: string, nodeId: string, stackId = pieceId): YutPiece {
  return { pieceId, nodeId, stackId, teamId: pieceId.startsWith("A") ? "A" : "B", routeId: "outer", history: [] };
}
function views(capture = true) {
  const previous: YutnoriPublicView = {
    matchId: "match-1", rules: { backDo: true, finish: "pass-exit" },
    teams: [{ teamId: "A", playerIds: ["a", "c"], finishedCount: 0 }, { teamId: "B", playerIds: ["b", "d"], finishedCount: 0 }],
    pieces: [piece("A1", "o1", "A1"), piece("A2", "o1", "A1"), piece("A3", "reserve"), piece("A4", "reserve"), piece("B1", "o3", "B1"), piece("B2", "o3", "B1"), piece("B3", "reserve"), piece("B4", "reserve")],
    currentPlayerId: "a", turn: { turnId: 1, teamId: "A", controllerPlayerId: "a", throwsRemaining: 0, pending: [] },
    legalMoves: [], serverNow: 1000
  };
  const next = structuredClone(previous);
  next.lastMove = { matchId: "match-1", turnId: 1, playerId: "a", startedAt: 1000, rollId: "roll-1", pieceId: "A1", pieceIds: ["A1", "A2"], pathId: "outer", path: ["o2", "o3"], destination: "o3", capturedPieceIds: capture ? ["B1", "B2"] : [], completedPieceIds: [], stackedPieceIds: [] };
  next.pieces[0]!.nodeId = "o3"; next.pieces[1]!.nodeId = "o3";
  if (capture) for (const entry of next.pieces.filter((item) => item.teamId === "B")) { entry.nodeId = "reserve"; entry.stackId = entry.pieceId; }
  return { previous, next };
}
function rect(element: Element, x: number, y: number, width = 20, height = 20) {
  vi.spyOn(element, "getBoundingClientRect").mockReturnValue({ x, y, left: x, top: y, width, height, right: x + width, bottom: y + height, toJSON: () => ({}) });
}
function surface() {
  const host = document.createElement("div");
  host.className = "yut-game";
  host.innerHTML = `<div class="yut-team team-A"><div class="yut-reserve"><button data-piece="A1"></button><button data-piece="A2"></button></div><div class="yut-finished"></div></div><div class="yut-team team-B"><div class="yut-reserve"><button data-piece="B1"></button><button data-piece="B2"></button></div><div class="yut-finished"></div></div><div class="yut-board-wrap"><div class="yut-board"><div class="yut-node" data-node="o1"></div><div class="yut-node" data-node="o2"></div><div class="yut-node" data-node="o3"><button class="has-piece"></button></div></div></div>`;
  document.body.append(host);
  const board = host.querySelector<HTMLElement>(".yut-board")!;
  rect(board.parentElement!, 100, 50, 300, 300);
  rect(board, 100, 50, 300, 300);
  rect(board.querySelector('[data-node="o1"]')!, 110, 60);
  rect(board.querySelector('[data-node="o2"]')!, 160, 100);
  rect(board.querySelector('[data-node="o3"]')!, 210, 140);
  rect(host.querySelector('[data-piece="A1"]')!, 100, 350);
  rect(host.querySelector('[data-piece="B1"]')!, 280, 350);
  const motion = createBoardMotion(board);
  controllers.push(motion);
  return { host, board, motion, layer: host.querySelector<HTMLElement>(".yut-motion-layer")! };
}

beforeEach(() => {
  hidden = false;
  calls.length = 0;
  const target = new EventTarget();
  media = Object.assign(target, { matches: false, addEventListener: vi.fn(target.addEventListener.bind(target)), removeEventListener: vi.fn(target.removeEventListener.bind(target)) });
  vi.stubGlobal("matchMedia", vi.fn(() => media));
  vi.spyOn(document, "hidden", "get").mockImplementation(() => hidden);
  originalAnimate = Object.getOwnPropertyDescriptor(HTMLElement.prototype, "animate");
  Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: function(this: HTMLElement, frames: Keyframe[], options: KeyframeAnimationOptions) {
    let resolve!: () => void;
    const finished = new Promise<void>((done) => { resolve = done; });
    const animation = { currentTime: 0, finished, cancel: vi.fn(() => resolve()) } as unknown as Animation;
    calls.push({ element: this, frames, options, animation, finish: resolve });
    return animation;
  } });
});
afterEach(() => {
  controllers.splice(0).forEach((controller) => controller.destroy());
  document.body.replaceChildren();
  if (originalAnimate) Object.defineProperty(HTMLElement.prototype, "animate", originalAnimate);
  else delete (HTMLElement.prototype as unknown as Record<string, unknown>).animate;
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe("authoritative move motion plans", () => {
  it("includes the original node, full path, stack and captured stack groups", () => {
    const { previous, next } = views();
    const plan = moveMotionPlan(previous, next)!;
    expect(plan).toMatchObject({ key: "match-1:1:roll-1", teamId: "A", pieceIds: ["A1", "A2"], nodes: ["o1", "o2", "o3"], duration: 360 });
    expect(plan.captured.map((group) => group.map((entry) => entry.pieceId))).toEqual([["B1", "B2"]]);
    expect(plan.stacked).toEqual([]);
    previous.pieces[2]!.nodeId = "o3";
    next.lastMove!.stackedPieceIds = ["A3"];
    expect(moveMotionPlan(previous, next)!.stacked.map((entry) => entry.pieceId)).toEqual(["A3"]);
  });
  it("skips duplicate rolls, rematches and moves belonging to an obsolete match", () => {
    const { previous, next } = views();
    expect(moveMotionPlan(next, structuredClone(next))).toBeUndefined();
    expect(moveMotionPlan(previous, { ...next, matchId: "new-match" })).toBeUndefined();
    expect(moveMotionPlan(previous, { ...next, lastMove: { ...next.lastMove!, matchId: "old-match" } })).toBeUndefined();
    expect(moveMotionPlan(previous, { ...next, lastMove: { ...next.lastMove!, path: [] } })).toBeUndefined();
  });
  it("handles entering, finishing and backtracking paths without inventing board positions", () => {
    const { previous, next } = views(false);
    previous.pieces[0]!.nodeId = "reserve";
    next.lastMove!.path = ["o1"];
    expect(moveMotionPlan(previous, next)!.nodes).toEqual(["reserve", "o1"]);
    previous.pieces[0]!.nodeId = "o0";
    next.lastMove!.path = ["finished"];
    expect(moveMotionPlan(previous, next)!.nodes).toEqual(["o0", "finished"]);
    previous.pieces[0]!.nodeId = "c";
    next.lastMove!.path = ["a2"];
    expect(moveMotionPlan(previous, next)!.nodes).toEqual(["c", "a2"]);
  });
});

describe("board animation lifecycle", () => {
  it("hops through each path node and delays captured-stack flight until arrival", () => {
    const { previous, next } = views();
    next.serverNow = 1200;
    const { motion, host, layer } = surface();
    motion.play(previous, next);
    expect(calls).toHaveLength(2);
    expect(calls[0]!.frames.map((frame) => frame.offset)).toEqual([0, .25, .5, .75, 1]);
    expect(calls[0]!.frames[0]!.transform).toBe("translate(20px, 20px) rotate(0deg) scale(1)");
    expect(calls[0]!.frames[1]!.transform).toBe("translate(45px, 28px) rotate(0deg) scale(1.08)");
    expect(calls[0]!.frames.at(-1)!.transform).toBe("translate(120px, 100px) rotate(0deg) scale(1)");
    expect(calls[1]!.options).toMatchObject({ duration: 650, delay: 360, fill: "both" });
    expect(calls[1]!.frames.at(-1)).toMatchObject({ transform: "translate(190px, 310px) rotate(240deg) scale(0.5)", opacity: 0 });
    expect(calls.every((entry) => entry.animation.currentTime === 200)).toBe(true);
    expect(layer.querySelectorAll(".yut-stack-count")).toHaveLength(2);
    expect(host.querySelector('[data-node="o3"] .has-piece')!.classList.contains("yut-motion-hidden")).toBe(true);
    expect(host.querySelector('[data-piece="B1"]')!.classList.contains("yut-motion-hidden")).toBe(true);
  });
  it("keeps the stationary stack visible until the moving allies arrive", () => {
    const { previous, next } = views(false);
    previous.pieces[2]!.nodeId = "o3";
    next.lastMove!.stackedPieceIds = ["A3"];
    const { motion, layer } = surface();
    motion.play(previous, next);
    expect(calls).toHaveLength(1);
    expect(layer.querySelectorAll(".yut-motion-sprite")).toHaveLength(2);
    expect((layer.firstElementChild as HTMLElement).style.transform).toBe("translate(120px, 100px) rotate(0deg) scale(1)");
  });
  it("preserves its overlay during UI rerenders without replaying the same move", async () => {
    const { previous, next } = views();
    const { motion, board, layer } = surface();
    motion.play(previous, next);
    const sprite = layer.firstElementChild;
    board.innerHTML = '<div data-node="o3"><button class="has-piece">A × 2</button></div>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    motion.play(next, structuredClone(next));
    motion.play(previous, structuredClone(next));
    expect(layer.firstElementChild).toBe(sprite);
    expect(calls).toHaveLength(2);
    expect(board.querySelector(".has-piece")!.classList.contains("yut-motion-hidden")).toBe(true);
    expect(calls.every((entry) => !(entry.animation.cancel as ReturnType<typeof vi.fn>).mock.calls.length)).toBe(true);
  });
  it("restores final board pieces only after both moving and capture animations finish", async () => {
    const { previous, next } = views();
    const { motion, host, layer } = surface();
    motion.play(previous, next);
    calls[0]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(layer.childElementCount).toBe(2);
    calls[1]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(layer.childElementCount).toBe(0);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
  });
  it("skips reduced-motion, unsupported animation and already-completed timelines", () => {
    const { previous, next } = views();
    const { motion, layer, host } = surface();
    media.matches = true;
    motion.play(previous, next);
    expect(calls).toHaveLength(0);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
    media.matches = false;
    motion.play(previous, { ...next, serverNow: 5000, lastMove: { ...next.lastMove!, rollId: "expired" } });
    expect(calls).toHaveLength(0);
    Object.defineProperty(HTMLElement.prototype, "animate", { configurable: true, value: undefined });
    motion.play(previous, { ...next, lastMove: { ...next.lastMove!, rollId: "unsupported" } });
    expect(layer.childElementCount).toBe(0);
  });
  it.each(["resize", "visibility", "reduced"])("cancels safely when %s changes", (reason) => {
    const { previous, next } = views();
    const { motion, host, layer } = surface();
    motion.play(previous, next);
    if (reason === "resize") window.dispatchEvent(new Event("resize"));
    if (reason === "visibility") { hidden = true; document.dispatchEvent(new Event("visibilitychange")); }
    if (reason === "reduced") { media.matches = true; media.dispatchEvent(new Event("change")); }
    expect(calls.every((entry) => (entry.animation.cancel as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(layer.childElementCount).toBe(0);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
  });
  it("clears the previous match's overlay when a rematch snapshot arrives", () => {
    const { previous, next } = views();
    const { motion, host, layer } = surface();
    motion.play(previous, next);
    const rematch = { ...previous, matchId: "match-2" };
    motion.play(next, rematch);
    expect(layer.childElementCount).toBe(0);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
    expect(calls.every((entry) => (entry.animation.cancel as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
  });
  it("destroys animations, the overlay and event listeners, and disconnects the DOM observer", async () => {
    const { previous, next } = views();
    const { motion, host, board, layer } = surface();
    motion.play(previous, next);
    motion.destroy();
    expect(layer.isConnected).toBe(false);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
    expect(calls.every((entry) => (entry.animation.cancel as ReturnType<typeof vi.fn>).mock.calls.length === 1)).toBe(true);
    expect(media.removeEventListener).toHaveBeenCalledWith("change", expect.any(Function));
    board.innerHTML = '<div data-node="o3"><span class="has-piece"></span></div>';
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(board.querySelector(".has-piece")!.classList.contains("yut-motion-hidden")).toBe(false);
  });
});

describe("confirmed move sequence playback", () => {
  it("animates committed moves in order and restores the final board only after the whole sequence", async () => {
    const { previous, next } = views(false);
    const first = { ...next.lastMove!, path: ["o2"], destination: "o2", startedAt: 1000 };
    const second = { ...next.lastMove!, rollId: "roll-2", path: ["o3"], destination: "o3", startedAt: 1460 };
    next.lastMove = second;
    next.lastMoveSequence = { sequenceId: "sequence-1", startedAt: 1000, durationMs: 920, moves: [first, second] };
    const { motion, host, layer } = surface();
    motion.play(previous, next);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.frames[0]!.transform).toContain("translate(20px, 20px)");
    motion.play(next, structuredClone(next));
    expect(calls).toHaveLength(1);
    calls[0]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(calls).toHaveLength(2);
    expect(calls[1]!.frames[0]!.transform).toContain("translate(70px, 60px)");
    expect(host.querySelectorAll(".yut-motion-hidden").length).toBeGreaterThan(0);
    calls[1]!.finish();
    await new Promise((resolve) => setTimeout(resolve, 0));
    expect(layer.childElementCount).toBe(0);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
  });
  it("skips elapsed sequence steps and cancels in-flight sequences on a new match", () => {
    const { previous, next } = views(false);
    const first = { ...next.lastMove!, path: ["o2"], destination: "o2", startedAt: 1000 };
    const second = { ...next.lastMove!, rollId: "roll-2", path: ["o3"], destination: "o3", startedAt: 1460 };
    next.lastMove = second;
    next.lastMoveSequence = { sequenceId: "sequence-1", startedAt: 1000, durationMs: 920, moves: [first, second] };
    next.serverNow = 1600;
    const { motion, layer, host } = surface();
    motion.play(previous, next);
    expect(calls).toHaveLength(1);
    expect(calls[0]!.frames[0]!.transform).toContain("translate(70px, 60px)");
    expect(Number(calls[0]!.animation.currentTime)).toBeGreaterThanOrEqual(140);
    motion.play(next, { ...previous, matchId: "new-match" });
    expect(layer.childElementCount).toBe(0);
    expect(host.querySelectorAll(".yut-motion-hidden")).toHaveLength(0);
    expect(calls[0]!.animation.cancel).toHaveBeenCalled();
  });
});
