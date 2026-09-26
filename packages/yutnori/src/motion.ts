import "./motion.css";
import { createPieceMarkup } from "./pieces";
import type { TeamId, YutPiece, YutnoriPublicView } from "./types";

type Point = { x: number; y: number };
export type MoveMotionPlan = {
  key: string;
  teamId: TeamId;
  pieceIds: string[];
  nodes: string[];
  captured: YutPiece[][];
  stacked: YutPiece[];
  duration: number;
};

/** Only a new authoritative move in the same match is eligible for animation. */
export function moveMotionPlan(previous: YutnoriPublicView, next: YutnoriPublicView): MoveMotionPlan | undefined {
  const move = next.lastMove;
  if (!move || previous.matchId !== next.matchId || move.matchId !== next.matchId ||
      previous.lastMove?.rollId === move.rollId || !move.path.length) return;
  const lead = previous.pieces.find((piece) => piece.pieceId === move.pieceId);
  if (!lead) return;
  const captured = new Map<string, YutPiece[]>();
  for (const piece of previous.pieces.filter((entry) => move.capturedPieceIds.includes(entry.pieceId))) {
    captured.set(piece.stackId, [...(captured.get(piece.stackId) ?? []), piece]);
  }
  return {
    key: `${move.matchId}:${move.turnId}:${move.rollId}`, teamId: lead.teamId,
    pieceIds: [...move.pieceIds], nodes: [lead.nodeId, ...move.path],
    captured: [...captured.values()], stacked: previous.pieces.filter((piece) => move.stackedPieceIds.includes(piece.pieceId)),
    duration: Math.min(1250, Math.max(360, move.path.length * 180))
  };
}

export function createBoardMotion(board: HTMLElement): { play(previous: YutnoriPublicView, next: YutnoriPublicView): void; destroy(): void } {
  const parent = board.parentElement!;
  const surface = board.closest<HTMLElement>(".yut-game") ?? parent;
  const layer = document.createElement("div");
  layer.className = "yut-motion-layer";
  layer.setAttribute("aria-hidden", "true");
  parent.append(layer);
  let active: Animation[] = [];
  let hideSelectors: string[] = [];
  let epoch = 0;
  let latestKey = "";
  const media = typeof matchMedia === "function" ? matchMedia("(prefers-reduced-motion: reduce)") : undefined;
  function unhide(): void { surface.querySelectorAll(".yut-motion-hidden").forEach((element) => element.classList.remove("yut-motion-hidden")); }
  function hideFinalPieces(): void {
    unhide();
    for (const selector of hideSelectors) surface.querySelectorAll(selector).forEach((element) => element.classList.add("yut-motion-hidden"));
  }
  function clear(): void {
    epoch++;
    for (const animation of active) animation.cancel();
    active = [];
    hideSelectors = [];
    unhide();
    layer.replaceChildren();
  }
  // UI-only updates can replace board nodes without interrupting the independent overlay.
  const observer = typeof MutationObserver === "function" ? new MutationObserver(() => { if (hideSelectors.length) hideFinalPieces(); }) : undefined;
  observer?.observe(surface, { childList: true, subtree: true });
  const stop = (): void => { if (document.hidden || media?.matches) clear(); };
  document.addEventListener("visibilitychange", stop);
  media?.addEventListener("change", stop);
  window.addEventListener("resize", clear);
  function point(nodeId: string, teamId: TeamId, pieceId?: string): Point {
    const selector = nodeId === "reserve" ? `.yut-team.team-${teamId} ${pieceId ? `[data-piece="${pieceId}"]` : ".yut-reserve"}`
      : nodeId === "finished" ? `.yut-team.team-${teamId} .yut-finished` : `[data-node="${nodeId}"]`;
    const target = surface.querySelector<HTMLElement>(selector) ?? surface.querySelector<HTMLElement>(`.yut-team.team-${teamId} .yut-reserve`) ?? board;
    const rect = target.getBoundingClientRect();
    const origin = parent.getBoundingClientRect();
    return { x: rect.left + rect.width / 2 - origin.left, y: rect.top + rect.height / 2 - origin.top };
  }
  function sprite(teamId: TeamId, ids: string[], size: number): HTMLElement {
    const element = document.createElement("span");
    element.className = `yut-motion-sprite team-${teamId}`;
    element.innerHTML = createPieceMarkup(teamId, ids);
    element.style.width = `${size}px`;
    element.style.height = `${size}px`;
    element.style.margin = `${-size / 2}px`;
    layer.append(element);
    return element;
  }
  function transform(position: Point, lift = 0, rotate = 0, scale = 1): string {
    return `translate(${position.x}px, ${position.y - lift}px) rotate(${rotate}deg) scale(${scale})`;
  }
  async function playSequence(previous: YutnoriPublicView, next: YutnoriPublicView): Promise<void> {
    const sequence = next.lastMoveSequence!;
    const elapsed = Math.max(0, next.serverNow - sequence.startedAt);
    if (elapsed >= sequence.durationMs || media?.matches || document.hidden || typeof layer.animate !== "function") return;
    const generation = epoch;
    const offset = next.serverNow - Date.now();
    const size = board.querySelector(".yut-node")?.getBoundingClientRect().width ?? 36;
    const pieces = previous.pieces.map((piece) => ({ ...piece }));
    const groups = new Map<string, HTMLElement>();
    function groupKey(piece: YutPiece): string { return `${piece.teamId}:${piece.stackId}`; }
    function redraw(): void {
      layer.replaceChildren(); groups.clear();
      for (const piece of pieces) {
        if (piece.nodeId === "reserve" || piece.nodeId === "finished" || groups.has(groupKey(piece))) continue;
        const members = pieces.filter((item) => groupKey(item) === groupKey(piece));
        const element = sprite(piece.teamId, members.map((item) => item.pieceId), size);
        element.style.transform = transform(point(piece.nodeId, piece.teamId));
        groups.set(groupKey(piece), element);
      }
    }
    function applyVisualMove(move: NonNullable<YutnoriPublicView["lastMove"]>): void {
      for (const piece of pieces) {
        if (move.capturedPieceIds.includes(piece.pieceId)) { piece.nodeId = "reserve"; piece.stackId = piece.pieceId; }
        if (move.pieceIds.includes(piece.pieceId) || move.stackedPieceIds.includes(piece.pieceId)) {
          piece.nodeId = move.destination;
          piece.stackId = move.destination === "reserve" || move.destination === "finished" ? piece.pieceId : move.pieceId;
        }
      }
    }
    hideSelectors = [".yut-board .has-piece", ...sequence.moves.flatMap((move) => [...move.pieceIds, ...move.capturedPieceIds]).map((id) => `.yut-team [data-piece="${id}"]`)];
    hideFinalPieces(); redraw();
    for (const move of sequence.moves) {
      if (epoch !== generation) return;
      const travelDuration = Math.min(1250, Math.max(360, move.path.length * 180));
      const duration = travelDuration + (move.capturedPieceIds.length ? 650 : 100);
      const stepElapsed = Math.max(0, Date.now() + offset - (move.startedAt ?? sequence.startedAt));
      if (stepElapsed >= duration) { applyVisualMove(move); redraw(); continue; }
      const lead = pieces.find((piece) => piece.pieceId === move.pieceId);
      if (!lead) continue;
      const moving = groups.get(groupKey(lead)) ?? sprite(lead.teamId, move.pieceIds, size);
      const points = [lead.nodeId, ...move.path].map((node) => point(node, lead.teamId, node === "reserve" ? lead.pieceId : undefined));
      const frames: Keyframe[] = [{ transform: transform(points[0]!), offset: 0 }];
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!; const to = points[i]!;
        frames.push({ transform: transform({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 12, 0, 1.08), offset: (i - .5) / (points.length - 1) });
        frames.push({ transform: transform(to), offset: i / (points.length - 1) });
      }
      const stepAnimations: Animation[] = [];
      const animate = (element: HTMLElement, keyframes: Keyframe[], time: number, delay = 0): void => {
        const animation = element.animate(keyframes, { duration: time, delay, fill: "both", easing: "linear" });
        animation.currentTime = stepElapsed; active.push(animation); stepAnimations.push(animation);
      };
      // Keep the arrival visible through the short settlement/capture interval.
      const fraction = travelDuration / duration;
      animate(moving, [...frames.map((frame) => ({ ...frame, offset: (frame.offset ?? 0) * fraction })), { transform: transform(points.at(-1)!), offset: 1 }], duration);
      const capturedGroups = new Set<string>();
      for (const victim of pieces.filter((piece) => move.capturedPieceIds.includes(piece.pieceId))) {
        const key = groupKey(victim); if (capturedGroups.has(key)) continue; capturedGroups.add(key);
        const element = groups.get(key); if (!element) continue;
        const from = point(victim.nodeId, victim.teamId); const to = point("reserve", victim.teamId, victim.pieceId);
        const side = victim.teamId === "A" ? -1 : 1;
        animate(element, [
          { transform: transform(from), opacity: 1, offset: 0 },
          { transform: transform({ x: from.x + side * 28, y: from.y }, 42, side * 28, 1.14), opacity: 1, offset: .22 },
          { transform: transform({ x: (from.x + to.x) / 2 + side * 45, y: (from.y + to.y) / 2 }, 70, side * 140, .9), opacity: .9, offset: .6 },
          { transform: transform(to, 0, side * 240, .5), opacity: 0, offset: 1 }
        ], 650, travelDuration);
      }
      await Promise.all(stepAnimations.map((animation) => animation.finished.catch(() => undefined)));
      if (epoch !== generation) return;
      for (const animation of stepAnimations) { animation.cancel(); active = active.filter((entry) => entry !== animation); }
      applyVisualMove(move); redraw();
    }
    if (epoch === generation) clear();
  }
  return {
    play(previous, next) {
      if (previous.matchId !== next.matchId) { clear(); latestKey = ""; return; }
      const sequence = next.lastMoveSequence;
      if (sequence && sequence.sequenceId !== previous.lastMoveSequence?.sequenceId) {
        if (latestKey === sequence.sequenceId) return;
        latestKey = sequence.sequenceId; clear();
        void playSequence(previous, next);
        return;
      }
      const plan = moveMotionPlan(previous, next);
      if (!plan) return;
      if (latestKey === plan.key) return;
      latestKey = plan.key;
      clear();
      if (media?.matches || document.hidden || typeof layer.animate !== "function") return;
      const move = next.lastMove!;
      const elapsed = Math.max(0, next.serverNow - (move.startedAt ?? next.serverNow));
      const total = plan.duration + (plan.captured.length ? 650 : 100);
      if (elapsed >= total) return;
      const generation = epoch;
      const size = board.querySelector(".yut-node")?.getBoundingClientRect().width ?? 36;
      const points = plan.nodes.map((node) => point(node, plan.teamId, node === "reserve" ? plan.pieceIds[0] : undefined));
      const frames: Keyframe[] = [{ transform: transform(points[0]!), offset: 0 }];
      for (let i = 1; i < points.length; i++) {
        const from = points[i - 1]!;
        const to = points[i]!;
        frames.push({ transform: transform({ x: (from.x + to.x) / 2, y: (from.y + to.y) / 2 }, 12, 0, 1.08), offset: (i - .5) / (points.length - 1) });
        frames.push({ transform: transform(to), offset: i / (points.length - 1) });
      }
      hideSelectors = move.destination === "reserve" ? plan.pieceIds.map((id) => `.yut-team [data-piece="${id}"]`)
        : move.destination === "finished" ? [] : [`[data-node="${move.destination}"] .has-piece`];
      hideSelectors.push(...move.capturedPieceIds.map((id) => `.yut-team [data-piece="${id}"]`));
      const launch = (element: HTMLElement, keyframes: Keyframe[], duration: number, delay = 0): void => {
        const animation = element.animate(keyframes, { duration, delay, easing: "linear", fill: "both" });
        animation.currentTime = elapsed;
        active.push(animation);
      };
      if (plan.stacked.length) {
        const stationary = sprite(plan.teamId, plan.stacked.map((piece) => piece.pieceId), size);
        stationary.style.transform = transform(points.at(-1)!);
      }
      launch(sprite(plan.teamId, plan.pieceIds, size), frames, plan.duration);
      for (const [index, victims] of plan.captured.entries()) {
        const victim = victims[0]!;
        const from = point(victim.nodeId, victim.teamId);
        const to = point("reserve", victim.teamId, victim.pieceId);
        const side = victim.teamId === "A" ? -1 : 1;
        launch(sprite(victim.teamId, victims.map((piece) => piece.pieceId), size), [
          { transform: transform(from), opacity: 1, offset: 0 },
          { transform: transform({ x: from.x + side * 28, y: from.y }, 42, side * 28, 1.14), opacity: 1, offset: .22 },
          { transform: transform({ x: (from.x + to.x) / 2 + side * 45, y: (from.y + to.y) / 2 }, 70, side * 140, .9), opacity: .9, offset: .6 },
          { transform: transform(to, 0, side * 240, .5), opacity: 0, offset: 1 }
        ], 650, plan.duration + index * 30);
      }
      hideFinalPieces();
      void Promise.all(active.map((animation) => animation.finished.catch(() => undefined))).then(() => { if (generation === epoch) clear(); });
    },
    destroy() { observer?.disconnect(); document.removeEventListener("visibilitychange", stop); media?.removeEventListener("change", stop); window.removeEventListener("resize", clear); clear(); layer.remove(); }
  };
}
