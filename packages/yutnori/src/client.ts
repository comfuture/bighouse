import "./style.css";
import type { GameClientContext, GameClientSnapshot, MountedGameClient } from "@bighouse/game-sdk/client";
import { createGameUi } from "@bighouse/ui";
import { BOARD_EDGES, BOARD_NODES, getLegalMoves } from "./board";
import { simulateMovePlan, mandatoryThrows, THROW_RESULT_HOLD_MS } from "./rules";
import { createThrowScene } from "./scene";
import { createPieceMarkup } from "./pieces";
import { createBoardMotion } from "./motion";
import { createThrowAudio } from "./audio";
import { stickFaceMarkup } from "./stick-face";
import { OUTCOME_LABELS, type LegalMove, type TeamId, type YutnoriPublicView, type YutSuggestion, type YutThrow, type PlanChoice } from "./types";
export { gameMetadata } from "./client-metadata";

const nodeMap = new Map(BOARD_NODES.map((node) => [node.nodeId, node]));
const teamName = (team: TeamId): string => team === "A" ? "청팀 A" : "홍팀 B";
const locationName = (node: string): string => node === "finished" ? "완주" : node === "reserve" ? "대기" : node === "c" ? "중앙" : node === "o0" ? "출발점" : node.startsWith("o") ? `${node.slice(1)}번 밭` : `지름길 ${node.slice(1)}번 밭`;
const escape = (value: unknown): string => String(value ?? "").replace(/[&<>"']/g, (char) => ({ "&": "&amp;", "<": "&lt;", ">": "&gt;", '"': "&quot;", "'": "&#39;" })[char]!);
const moveKey = (move: Pick<LegalMove, "rollId" | "pieceId" | "pathId">): string => `${move.rollId}:${move.pieceId}:${move.pathId}`;

/** The key survives UI-only updates and remounts but changes for a new match. */
export function turnNotificationKey(view: YutnoriPublicView, playerId: string): string | undefined {
  return view.currentPlayerId === playerId && !view.winnerTeamId ? `${view.matchId}:${view.turn.turnId}:${playerId}` : undefined;
}
type TeamPreview = { matchId: string; turnId: number; expectedVersion: number; revision: number; moves: PlanChoice[]; playerId: string };
type PlanSuggestion = Omit<TeamPreview, "revision"> & { planRevision: number; proposal: PlanChoice[] };
type ContextualSuggestion = YutSuggestion & { expectedVersion?: number; planRevision?: number; moves?: PlanChoice[]; move?: { rollId: string; pieceId: string; pathId: string } };
export function validSuggestions(events: NonNullable<GameClientSnapshot["events"]>, view: YutnoriPublicView, now: number, version?: number, revision = 0, prefix: PlanChoice[] = []): ContextualSuggestion[] {
  const latest = new Map<string, ContextualSuggestion>();
  if (mandatoryThrows(view) > 0 || view.turn.throwsRemaining > 0) return [];
  for (const event of events) {
    if (event.type !== "yutnori.suggestion" || now - event.createdAt > 30_000) continue;
    const suggestion = event.payload as unknown as ContextualSuggestion;
    if (suggestion.matchId !== view.matchId || suggestion.turnId !== view.turn.turnId) continue;
    if (!view.teams.find((team) => team.teamId === view.turn.teamId)?.playerIds.includes(suggestion.playerId)) continue;
    if (suggestion.expectedVersion !== undefined && suggestion.expectedVersion !== version) continue;
    if ((suggestion.planRevision ?? 0) !== revision || JSON.stringify(suggestion.moves ?? []) !== JSON.stringify(prefix)) continue;
    try {
      const result = prefix.length ? simulateMovePlan(view, prefix, now) : undefined;
      if (result?.complete) continue;
      const stage = result?.stage ?? view;
      if (getLegalMoves(stage).some((move) => moveKey(move) === moveKey(suggestion))) latest.set(suggestion.playerId, suggestion);
    } catch { /* A stale prefix cannot suggest a move on another board. */ }
  }
  return [...latest.values()];
}
/** Proposals belong to one exact controller draft; never reinterpret a stale proposal. */
export function validPlanSuggestions(events: NonNullable<GameClientSnapshot["events"]>, view: YutnoriPublicView, now: number, version: number, revision: number, prefix: PlanChoice[]): PlanSuggestion[] {
  const latest = new Map<string, PlanSuggestion>();
  if (mandatoryThrows(view) > 0 || view.turn.throwsRemaining > 0) return [];
  const teammates = view.teams.find((team) => team.teamId === view.turn.teamId)?.playerIds ?? [];
  for (const event of events) {
    if (event.type !== "yutnori.planSuggestion" || now - event.createdAt > 30_000) continue;
    const proposal = event.payload as unknown as PlanSuggestion;
    if (proposal.matchId !== view.matchId || proposal.turnId !== view.turn.turnId || proposal.expectedVersion !== version || proposal.planRevision !== revision) continue;
    if (proposal.playerId === view.currentPlayerId || !teammates.includes(proposal.playerId)) continue;
    if (!Array.isArray(proposal.moves) || !Array.isArray(proposal.proposal) || JSON.stringify(proposal.moves) !== JSON.stringify(prefix) || proposal.proposal.length <= prefix.length || JSON.stringify(proposal.proposal.slice(0, prefix.length)) !== JSON.stringify(prefix)) continue;
    try { if (simulateMovePlan(view, proposal.proposal, now).complete) latest.set(proposal.playerId, proposal); } catch { /* An invalid or stale suggestion never changes the board. */ }
  }
  return [...latest.values()];
}
export function selectedLegalMove(view: YutnoriPublicView, rollId?: string, pieceId?: string, pathId?: string): LegalMove | undefined {
  return view.legalMoves.find((move) => move.rollId === rollId && move.pieceId === pieceId && move.pathId === pathId);
}

export function mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient {
  let snapshot: GameClientSnapshot = context;
  let view = context.publicView as unknown as YutnoriPublicView;
  let displayView = view;
  let draftMoves: PlanChoice[] = [];
  let teammateMoves: PlanChoice[] = [];
  let teammateBaseKey = "";
  let proposalsOpen = false;
  const seenProposalEvents = new Set<string>();
  let sentProposalKey = "";
  let previewMoves: LegalMove[] = [];
  let displayedChoices: PlanChoice[] = [];
  let planRevision = 0;
  let receivedPreview: TeamPreview | undefined;
  let branchChoices: LegalMove[] = [];
  let previewTimer: ReturnType<typeof setTimeout> | undefined;
  let previewRenewTimer: ReturnType<typeof setTimeout> | undefined;
  let draftComplete = false;
  let draftStopReason = "incomplete";
  let pieceId: string | undefined;
  let pending = false;
  let message = "";
  let clockOffset = context.serverTime - Date.now();
  let refreshTimer: ReturnType<typeof setTimeout> | undefined;
  let vibrationEnabled = true;
  let soundMuted = false;
  let notifiedTurn = "";
  const storageKey = `bighouse:yutnori:turn:${context.room.roomId}:${context.playerId}`;
  try { soundMuted = localStorage.getItem("bighouse:yutnori:sound") === "off"; vibrationEnabled = localStorage.getItem("bighouse:yutnori:vibration") !== "off"; notifiedTurn = sessionStorage.getItem(storageKey) ?? ""; } catch { /* Storage can be unavailable in private browsing. */ }
  const surface = document.createElement("section");
  surface.className = "game-contained-surface yut-game";
  surface.setAttribute("aria-label", "윷놀이 게임");
  surface.innerHTML = `
    <header class="yut-header"><div><span class="yut-toy-logo" aria-hidden="true"><i></i><i></i><i></i></span><h1>윷놀이</h1><span class="yut-eyebrow">개인전 · 팀전</span></div></header>
    <div class="yut-turn" data-role="turn" aria-live="polite" aria-atomic="true"></div>
    <div class="yut-options"><span>● 청팀 · ■ 홍팀 · 겹친 말은 함께 이동</span><label class="yut-vibration"><input type="checkbox" data-role="vibration" ${vibrationEnabled ? "checked" : ""}> 차례 진동</label><label class="yut-sound"><input type="checkbox" data-role="sound" ${soundMuted ? "" : "checked"}> 효과음</label></div>
    <div class="yut-layout"><div class="yut-table-column"><div class="yut-board-wrap"><div class="yut-board" data-role="board" aria-label="29개 밭으로 이루어진 윷판"></div></div><div class="yut-board-caption"><span data-role="board-hint">말을 누르고 가고 싶은 곳을 골라요</span><span data-role="ghost-hint" hidden>빈 말은 원래 자리예요</span></div><section class="yut-action-card" data-role="actions"></section><section class="yut-plan-suggestions" data-role="plan-suggestions" aria-label="팀 구성원의 제안"></section></div>
    <aside class="yut-console" aria-label="윷 던지기와 말 이동"><section class="yut-throw-card"><div class="yut-section-heading"><span>윷 던지기</span><span class="yut-live">모두에게 공유</span></div><div class="yut-scene-summary" data-role="scene-summary" aria-label="최근 윷 결과"></div><div class="yut-outcome" data-role="outcome" aria-live="polite"></div><div class="yut-throw-controls" data-role="throw-controls"></div><p class="yut-face-legend" data-role="face-legend"></p></section><section class="yut-suggestions" data-role="suggestions" aria-label="팀원 이동 제안"></section></aside></div>
    <div class="yut-throw-overlay" data-role="throw-overlay" role="status" aria-live="polite" aria-label="모두 함께 보는 윷 던지기" hidden>
      <div class="yut-throw-presentation"><div class="yut-overlay-header"><span>윷 던지기</span><span data-role="overlay-player"></span></div><div class="yut-scene" data-role="scene" role="img" aria-label="네 개의 윷가락"></div><div class="yut-overlay-result" data-role="overlay-result" aria-live="polite"></div><p class="yut-overlay-note">모두 같은 윷을 보고 있어요</p></div>
    </div>
    <div class="yut-teams yut-teams-bottom" data-role="teams" aria-label="팀별 대기 말과 완주 현황"></div>
    <div class="yut-message" data-role="message" role="status"></div>
    <footer class="yut-footer"><details><summary>윷놀이 규칙</summary><div class="yut-rules"><p>각 팀의 네 말을 모두 완주시키면 승리합니다. 도 1칸 · 개 2칸 · 걸 3칸 · 윷 4칸 · 모 5칸입니다. <span data-role="backdo-rule"></span></p><p>대기 말도 결과 하나를 사용해 출발합니다. 같은 팀 말은 함께 업고, 상대 말이 있는 밭에 정확히 도착하면 모두 잡습니다. 윷·모는 이동권으로 보관하고 한 번 더 던집니다. 도·개·걸·윷·모·빽도는 원하는 순서로 사용합니다. 말을 누르고 목적지를 골라 본 뒤 마지막에 한 번만 확정하세요. 잡으면 같은 조작자의 새 차례가 시작되고, 보관한 이동권을 유지한 채 먼저 윷을 던집니다.</p><p>모서리나 중앙에 정확히 멈춘 말은 다음 이동에서 지름길을 고를 수 있습니다. 출발점을 지나야 완주하며, 남는 걸음은 상관없습니다. <span data-role="backdo-discard-rule"></span></p><p>2:2 팀전은 1·3번과 2·4번 자리가 한 팀입니다. 팀끼리 번갈아 진행하고, 같은 팀의 조작자도 번갈아 맡습니다. 팀원은 제안하고 현재 조작자가 최종 이동을 확정합니다.</p></div></details><details><summary>진행 기록</summary><ol data-role="history" class="yut-history"></ol></details></footer>`;
  container.replaceChildren(surface);
  const el = (role: string): HTMLElement => surface.querySelector<HTMLElement>(`[data-role="${role}"]`)!;
  const scene = createThrowScene(el("scene"));
  const throwAudio = createThrowAudio(soundMuted);
  const gameUi = createGameUi(container, context, context, { theme: "playful" });
  const boardMotion = createBoardMotion(el("board"));
  let hasRendered = false;
  const serverNow = (): number => Date.now() + clockOffset;
  const name = (id: string): string => snapshot.room.players.find((player) => player.playerId === id)?.displayName ?? "플레이어";
  const myTeam = (): TeamId | undefined => view.teams.find((team) => team.playerIds.includes(snapshot.playerId))?.teamId;
  const active = (): boolean => snapshot.phase === "active" && !snapshot.room.activeInterruption && snapshot.connected !== false && !view.winnerTeamId;
  const controller = (): boolean => active() && view.currentPlayerId === snapshot.playerId;
  const teammate = (): boolean => active() && view.turn.teamId === myTeam() && view.currentPlayerId !== snapshot.playerId;
  const animating = (): boolean => !!view.lastThrow && serverNow() < view.lastThrow.startedAt + view.lastThrow.durationMs + THROW_RESULT_HOLD_MS;
  const movementAnimating = (): boolean => !!view.lastMoveSequence && serverNow() < view.lastMoveSequence.startedAt + view.lastMoveSequence.durationMs;
  const canSelect = (): boolean => (controller() || teammate()) && !pending && !animating() && !movementAnimating() && mandatoryThrows(view) === 0 && view.turn.throwsRemaining === 0;
  function latestTeamPreview(): TeamPreview | undefined {
    if (!teammate()) return;
    let latest: TeamPreview | undefined;
    for (const event of snapshot.events ?? []) {
      if (event.type !== "yutnori.preview" || serverNow() - event.createdAt > 30_000) continue;
      const preview = event.payload as unknown as TeamPreview;
      if (preview.matchId !== view.matchId || preview.turnId !== view.turn.turnId || preview.expectedVersion !== snapshot.version || preview.playerId !== view.currentPlayerId || !Array.isArray(preview.moves)) continue;
      if (!latest || preview.revision >= latest.revision) latest = preview;
    }
    return latest;
  }
  function preparePreview(): void {
    displayView = view;
    previewMoves = [];
    draftComplete = false;
    draftStopReason = "incomplete";
    receivedPreview = latestTeamPreview();
    if (teammate()) {
      const baseKey = JSON.stringify([view.matchId, view.turn.turnId, snapshot.version, receivedPreview?.revision ?? 0, receivedPreview?.moves ?? []]);
      if (baseKey !== teammateBaseKey) {
        if (teammateMoves.length) message = "조작자의 선택이 바뀌었어요. 새 말판에서 이어서 골라주세요.";
        teammateMoves = []; sentProposalKey = ""; branchChoices = []; cancelDrag();
        teammateBaseKey = baseKey;
      }
    }
    displayedChoices = controller() ? draftMoves : teammate() ? [...(receivedPreview?.moves ?? []), ...teammateMoves] : [];
    if (!displayedChoices.length) return;
    try {
      const result = simulateMovePlan(view, displayedChoices, serverNow());
      displayView = { ...result.stage, legalMoves: getLegalMoves(result.stage), serverNow: serverNow() };
      previewMoves = result.moves;
      draftComplete = result.complete;
      draftStopReason = result.stopReason;
    } catch {
      if (controller()) draftMoves = [];
      else teammateMoves = [];
      displayedChoices = [];
      message = "말판이 바뀌었어요. 지금 자리에서 다시 골라주세요.";
    }
  }
  function sharePreview(changed = true): void {
    clearTimeout(previewTimer);
    clearTimeout(previewRenewTimer);
    if (!controller() || !context.sendSignal || (view.teams.find((team) => team.teamId === myTeam())?.playerIds.length ?? 0) < 2) return;
    if (changed) planRevision = Math.max(Date.now(), planRevision + 1);
    const version = snapshot.version;
    const turnId = view.turn.turnId;
    previewTimer = setTimeout(() => {
      if (!controller() || version !== snapshot.version || turnId !== view.turn.turnId) return;
      context.sendSignal?.({ type: "previewPlan", payload: { matchId: view.matchId, turnId, expectedVersion: version, revision: planRevision, moves: draftMoves.map((choice) => ({ ...choice })) } });
      // A cleared draft still has a revision that teammates must retain for proposals.
      previewRenewTimer = setTimeout(() => sharePreview(false), 12_000);
    }, 550);
  }
  function addDestination(move: LegalMove): void {
    if (!canSelect() || draftComplete) return;
    const choice = { rollId: move.rollId, pieceId: move.pieceId, pathId: move.pathId };
    branchChoices = [];
    (controller() ? draftMoves : teammateMoves).push(choice);
    sentProposalKey = "";
    preparePreview();
    if (!displayView.legalMoves.some((entry) => entry.pieceId === pieceId)) pieceId = undefined;
    message = "";
    sharePreview();
    render();
    focusNextChoice();
  }
  function focusNextChoice(): void {
    const candidates = [...surface.querySelectorAll<HTMLButtonElement>("[data-piece]:not(:disabled)")];
    const target = draftComplete ? surface.querySelector<HTMLButtonElement>(teammate() ? '[data-command="plan-propose"]' : '[data-command="plan-commit"]') : candidates.find((element) => element.dataset.piece === pieceId) ?? candidates[0];
    target?.focus({ preventScroll: true });
  }
  function chooseDestination(destination: string): void {
    if (!canSelect() || !pieceId || draftComplete) return;
    const moves = displayView.legalMoves.filter((move) => move.pieceId === pieceId && move.destination === destination);
    if (moves.length === 1) addDestination(moves[0]!);
    else if (moves.length > 1) { branchChoices = moves; render(); surface.querySelector<HTMLButtonElement>("[data-move]")?.focus({ preventScroll: true }); }
  }
  function notifyTurn(): void {
    if (!active()) return;
    const key = turnNotificationKey(view, snapshot.playerId);
    if (!key || key === notifiedTurn) return;
    notifiedTurn = key;
    try { sessionStorage.setItem(storageKey, key); } catch { /* Session memory still prevents repeated feedback. */ }
    if (vibrationEnabled && typeof navigator.vibrate === "function") {
      try { navigator.vibrate([100, 65, 100]); } catch { /* Unsupported/blocked vibration never blocks a turn. */ }
    }
  }
  function submit(type: string, payload: Record<string, unknown> = {}): void {
    if (!controller() || pending || animating() || movementAnimating()) return;
    pending = true;
    message = "서버에서 확인하고 있어요…";
    render();
    context.sendAction({ type, payload });
  }
  function pieceButton(id: string, team: TeamId, text: string, enabled: boolean, extra = ""): string {
    return `<button type="button" class="yut-piece team-${team} ${pieceId === id ? "is-selected" : ""} ${extra}" data-piece="${escape(id)}" ${enabled ? "" : "disabled"} aria-label="${escape(`${teamName(team)} ${text}`)}" aria-pressed="${pieceId === id}">${escape(text)}</button>`;
  }
  function renderTeams(): void {
    el("teams").innerHTML = (["A", "B"] as const).map((id) => {
      const team = displayView.teams.find((item) => item.teamId === id);
      const pieces = displayView.pieces.filter((piece) => piece.teamId === id);
      const roster = (team?.playerIds ?? []).flatMap((playerId) => {
        const player = snapshot.room.players.find((entry) => entry.playerId === playerId);
        return player ? [player] : [];
      });
      return `<section class="yut-team team-${id} ${displayView.turn.teamId === id && active() ? "is-current" : ""}"><div class="yut-team-top"><strong><span class="yut-team-dot">${id}</span>${teamName(id)}${myTeam() === id ? " <small>우리 팀</small>" : ""}</strong><span class="yut-score">${team?.finishedCount ?? 0}<small> / 4 완주</small></span></div><div class="yut-roster">${roster.length ? roster.map((player) => `<span class="${displayView.currentPlayerId === player.playerId && active() ? "is-controller" : ""}">${escape(player.displayName)}${player.playerId === snapshot.playerId ? " (나)" : ""}${snapshot.phase === "waiting" ? (player.ready ? " · 준비" : " · 대기") : displayView.currentPlayerId === player.playerId ? " · 조작 중" : ""}</span>`).join("<span class='yut-roster-divider'>→</span>") : "참가자를 기다리고 있어요"}</div><div class="yut-reserve"><span>대기</span><div>${pieces.filter((piece) => piece.nodeId === "reserve").map((piece) => pieceButton(piece.pieceId, id, piece.pieceId.replace(/^[AB][-_]?/, ""), canSelect() && !draftComplete && id === displayView.turn.teamId && displayView.legalMoves.some((move) => move.pieceId === piece.pieceId))).join("") || "<span class='yut-empty'>—</span>"}${displayedChoices.length ? view.pieces.filter((piece) => piece.teamId === id && piece.nodeId === "reserve" && displayView.pieces.find((entry) => entry.pieceId === piece.pieceId)?.nodeId !== "reserve").map((piece) => `<span class="yut-piece team-${id} is-origin-ghost" aria-label="${escape(piece.pieceId)} 원래 대기 자리">${escape(piece.pieceId.replace(/^[AB][-_]?/, ""))}</span>`).join("") : ""}</div><span class="yut-finished" aria-label="완주한 말">${"●".repeat(team?.finishedCount ?? 0)}${"○".repeat(4 - (team?.finishedCount ?? 0))}</span></div></section>`;
    }).join("");
  }
  function renderBoard(): void {
    const candidates = pieceId && !draftComplete ? displayView.legalMoves.filter((move) => move.pieceId === pieceId) : [];
    const selectedNode = displayView.pieces.find((piece) => piece.pieceId === pieceId)?.nodeId;
    const pathMarkup = previewMoves.map((move) => {
      const firstChoice = displayedChoices.findIndex((choice) => !("discard" in choice) && choice.rollId === move.rollId);
      const stageBefore = firstChoice > 0 ? simulateMovePlan(view, displayedChoices.slice(0, firstChoice), serverNow()).stage : view;
      const source = stageBefore.pieces.find((piece) => piece.pieceId === move.pieceId)?.nodeId ?? "reserve";
      const nodes = [source, ...move.path].map((id) => nodeMap.get(id === "reserve" || id === "finished" ? "o0" : id)).filter((node) => !!node);
      return `<polyline class="yut-path-preview" points="${nodes.map((node) => `${node.x},${node.y}`).join(" ")}"/>`;
    }).join("");
    const arrow = (node: string, route: string, d: string): string => {
      const chosen = selectedNode === node && candidates.some((move) => move.pathId === route);
      return `<path class="yut-route-arrow ${chosen ? "is-chosen" : ""}" data-fork="${node}" data-route="${route}" d="${d}" marker-end="url(#${chosen ? "yut-route-selected" : "yut-route-muted"})"/>`;
    };
    const directions = `<g class="yut-direction-guides"><path class="yut-route-arrow" data-direction="start" d="M96 89 L96 80" marker-end="url(#yut-route-muted)"/>${arrow("o5", "outer", "M86 13 L83 13 L79 13")}${arrow("o5", "diagonalA", "M86 13 L83 13 L80 16")}${arrow("o10", "outer", "M13 14 L13 17 L13 21")}${arrow("o10", "diagonalB", "M13 14 L13 17 L17 21")}${arrow("c", "diagonalA", "M50 55 L50 58 L46.5 61.5")}${arrow("c", "diagonalB", "M50 55 L50 58 L53.5 61.5")}</g>`;
    const markers = '<defs><marker id="yut-route-muted" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 .5 L3 2 L0 3.5" fill="none" stroke="#acb9ca" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"/></marker><marker id="yut-route-selected" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 .5 L3 2 L0 3.5" fill="none" stroke="#3864e8" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>';
    const lines = BOARD_EDGES.map(([a, b]) => { const from = nodeMap.get(a)!; const to = nodeMap.get(b)!; return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`; }).join("");
    const ghosts = displayedChoices.length ? view.pieces.filter((piece) => nodeMap.has(piece.nodeId) && displayView.pieces.find((entry) => entry.pieceId === piece.pieceId)?.nodeId !== piece.nodeId).filter((piece, index, pieces) => pieces.findIndex((item) => item.stackId === piece.stackId) === index).map((piece) => {
      const node = nodeMap.get(piece.nodeId)!;
      const ids = view.pieces.filter((entry) => entry.stackId === piece.stackId).map((entry) => entry.pieceId);
      return `<span class="yut-origin-ghost team-${piece.teamId}" style="left:${node.x}%;top:${node.y}%" aria-label="${escape(`${piece.pieceId} 원래 자리`)}">${createPieceMarkup(piece.teamId, ids)}</span>`;
    }).join("") : "";
    function targetLabels(moves: LegalMove[]): string {
      return [...new Set(moves.map((move) => {
        const roll = displayView.turn.pending.find((entry) => entry.rollId === move.rollId)!;
        return `${OUTCOME_LABELS[roll.outcome]} ${roll.steps}`;
      }))].join(" · ");
    }
    function destinationChip(destination: string, label: string): string {
      const moves = candidates.filter((move) => move.destination === destination);
      if (!moves.length) return "";
      return `<button type="button" class="yut-offboard-target" data-destination="${destination}" ${canSelect() ? "" : "disabled"}>${label} <span>${escape(targetLabels(moves))}</span></button>`;
    }
    const proposalGhosts = currentPlanSuggestions().map((suggestion, proposalIndex) => {
      const proposed = simulateMovePlan(view, suggestion.proposal, serverNow()).stage;
      const pieces = proposed.pieces.filter((piece) => piece.teamId === view.turn.teamId && nodeMap.has(piece.nodeId) && displayView.pieces.find((entry) => entry.pieceId === piece.pieceId)?.nodeId !== piece.nodeId);
      return pieces.filter((piece, index) => pieces.findIndex((entry) => entry.stackId === piece.stackId) === index).map((piece) => {
        const node = nodeMap.get(piece.nodeId)!;
        const ids = proposed.pieces.filter((entry) => entry.stackId === piece.stackId).map((entry) => entry.pieceId);
        return `<span class="yut-proposal-ghost team-${piece.teamId}" data-proposal-player="${escape(suggestion.playerId)}" style="left:${node.x}%;top:${node.y}%;--proposal-index:${proposalIndex}" aria-label="${escape(`${name(suggestion.playerId)} 님의 제안: ${ids.join(", ")} ${locationName(piece.nodeId)}`)}">${createPieceMarkup(piece.teamId, ids)}<span class="yut-proposal-name">${escape(name(suggestion.playerId))}</span></span>`;
      }).join("");
    }).join("");
    el("board").innerHTML = `<svg class="yut-board-lines" viewBox="0 0 100 100" aria-hidden="true">${markers}<g>${lines}</g>${directions}${pathMarkup}</svg>${ghosts}${proposalGhosts}${BOARD_NODES.map((node) => {
      const pieces = displayView.pieces.filter((piece) => piece.nodeId === node.nodeId);
      const first = pieces[0];
      const targets = candidates.filter((move) => move.destination === node.nodeId);
      const special = ["o0", "o5", "o10", "o15", "c"].includes(node.nodeId);
      const pieceEnabled = first && canSelect() && !draftComplete && first.teamId === displayView.turn.teamId && displayView.legalMoves.some((move) => move.pieceId === first.pieceId);
      const targetEnabled = targets.length > 0 && canSelect();
      const label = `${locationName(node.nodeId)}${first ? `, ${teamName(first.teamId)} 말 ${pieces.length}개` : ""}${targets.length ? `, ${targetLabels(targets)} 이동 가능` : ""}`;
      return `<div data-node="${node.nodeId}" class="yut-node ${special ? "is-special" : ""} ${targets.length ? "is-target" : ""}" style="left:${node.x}%;top:${node.y}%"><button type="button" class="yut-node-button ${first ? `team-${first.teamId} has-piece` : ""} ${first && pieces.some((piece) => piece.pieceId === pieceId) ? "is-selected" : ""}" ${targetEnabled ? `data-destination="${node.nodeId}"` : first ? `data-piece="${escape(first.pieceId)}"` : ""} ${pieceEnabled || targetEnabled ? "" : "disabled"} aria-label="${escape(label)}">${first ? createPieceMarkup(first.teamId, pieces.map((piece) => piece.pieceId)) : targets.length ? "◎" : special ? "◉" : ""}${targets.length ? `<span class="yut-destination-label">${escape(targetLabels(targets))}</span>` : ""}</button></div>`;
    }).join("")}<div class="yut-offboard-targets">${destinationChip("reserve", "대기로")}${destinationChip("finished", "완주!")}</div>${branchChoices.length ? `<div class="yut-route-picker" role="group" aria-label="이 자리로 가는 결과와 길 선택"><strong>어떤 패로 갈까요?</strong>${branchChoices.map((move) => { const roll = displayView.turn.pending.find((entry) => entry.rollId === move.rollId)!; return `<button type="button" data-move="${escape(moveKey(move))}">${OUTCOME_LABELS[roll.outcome]} ${roll.steps} <span>${move.pathId === "diagonalA" || move.pathId === "diagonalB" ? "지름길" : move.pathId === "back" ? "뒤로" : "바깥길"}</span></button>`; }).join("")}<button type="button" class="is-close" data-command="close-routes">닫기</button></div>` : ""}`;
  }
  function moveDescription(move: LegalMove): string {
    const path = move.pathId === "diagonalA" || move.pathId === "diagonalB" ? "지름길" : move.pathId === "back" ? "뒤로" : "바깥길";
    return `${path} → ${locationName(move.destination)}${move.capturedPieceIds.length ? ` · ${move.capturedPieceIds.length}개 잡기 · 우리 팀 새 차례` : ""}${move.stackedPieceIds.length ? ` · ${move.stackedPieceIds.length}개 업기` : ""}${move.completedPieceIds.length ? ` · ${move.completedPieceIds.length}개 완주` : ""}`;
  }
  function currentSuggestions(): ContextualSuggestion[] {
    return validSuggestions(snapshot.events ?? [], view, serverNow(), snapshot.version, controller() ? planRevision : receivedPreview?.revision ?? 0, displayedChoices);
  }
  function currentPlanSuggestions(): PlanSuggestion[] {
    return controller() ? validPlanSuggestions(snapshot.events ?? [], view, serverNow(), snapshot.version, planRevision, draftMoves) : [];
  }
  function renderPlanSuggestions(): void {
    const suggestions = currentPlanSuggestions();
    for (const suggestion of suggestions) {
      const event = [...(snapshot.events ?? [])].reverse().find((entry) => entry.type === "yutnori.planSuggestion" && entry.payload === (suggestion as unknown));
      if (event && !seenProposalEvents.has(event.id)) {
        seenProposalEvents.add(event.id);
        proposalsOpen = true;
      }
    }
    while (seenProposalEvents.size > 128) seenProposalEvents.delete(seenProposalEvents.values().next().value!);
    const panel = el("plan-suggestions");
    panel.hidden = !controller() || (view.teams.find((team) => team.teamId === myTeam())?.playerIds.length ?? 0) < 2;
    panel.innerHTML = `<button type="button" class="yut-proposals-toggle" data-command="toggle-proposals" aria-expanded="${proposalsOpen}">팀 구성원의 제안 <span>${suggestions.length}</span><span aria-hidden="true">${proposalsOpen ? "⌃" : "⌄"}</span></button><div class="yut-proposals-panel" role="dialog" aria-label="팀 구성원의 제안" aria-modal="false" ${proposalsOpen ? "" : "hidden"}>${suggestions.length ? suggestions.map((suggestion) => {
      const result = simulateMovePlan(view, suggestion.proposal, serverNow());
      const description = suggestion.proposal.map((choice) => { const roll = view.turn.pending.find((item) => item.rollId === choice.rollId)!; if ("discard" in choice) return `${OUTCOME_LABELS[roll.outcome]} 넘기기`; const move = result.moves.find((item) => item.rollId === choice.rollId)!; return `${OUTCOME_LABELS[roll.outcome]} · ${choice.pieceId} ${locationName(move.destination)}`; }).join(" → ");
      return `<article class="yut-plan-proposal"><div><strong>${escape(name(suggestion.playerId))} 님의 제안</strong><p>${escape(description)}</p><small>${result.complete ? "적용하면 바로 이동해요" : "모든 결과를 골라야 보낼 수 있어요"}</small></div><button type="button" data-apply-proposal="${escape(suggestion.playerId)}" ${canSelect() ? "" : "disabled"}>적용</button></article>`;
    }).join("") : '<p class="yut-empty">팀원의 제안이 오면 반투명 말로 함께 보여요.</p>'}</div>`;
  }
  function renderActions(): void {
    const hint = snapshot.phase === "waiting" ? "모두 모이면 한 판 시작해요!"
      : animating() ? "윷이 내려오고 있어요!" : movementAnimating() ? "말들이 길을 따라 가고 있어요!"
      : view.turn.throwsRemaining > 0 ? "먼저 윷을 한 번 더 던져요!"
      : !controller() && !teammate() ? `${name(view.currentPlayerId)} 님이 고르고 있어요`
      : draftComplete ? draftStopReason === "capture" ? "잡았다! 이대로 갈까요?" : "좋아요, 이대로 갈까요?"
      : pieceId ? "가고 싶은 곳을 눌러요" : "움직일 말을 먼저 눌러요";
    el("board-hint").textContent = displayedChoices.length ? (controller() ? "아직 미리보기예요 · 마지막에 한 번만 확정!" : teammateMoves.length ? "내 제안 미리보기 · 다 고르면 제안 보내기" : `${name(view.currentPlayerId)} 님의 미리보기 · 이어서 골라보세요`) : hint;
    el("actions").innerHTML = `<div class="yut-hand" aria-label="사용할 결과 패">${view.turn.pending.map((roll) => {
      const order = displayedChoices.findIndex((choice) => choice.rollId === roll.rollId);
      const canDiscard = order < 0 && !draftComplete && !displayView.legalMoves.some((move) => move.rollId === roll.rollId);
      return `<div class="yut-hand-tile ${order >= 0 ? "is-used" : ""}" data-roll="${escape(roll.rollId)}"><strong>${OUTCOME_LABELS[roll.outcome]}</strong><span>${roll.steps > 0 ? "+" : ""}${roll.steps}</span>${order >= 0 ? `<small>${order + 1}</small>` : canDiscard && (controller() || teammate()) && canSelect() ? `<button type="button" data-discard="${escape(roll.rollId)}">쓸 말 없음 · 넘기기</button>` : ""}</div>`;
    }).join("") || '<span class="yut-hand-empty">윷을 던지면 패가 생겨요</span>'}</div><div class="yut-board-actions"><p class="yut-hint">${escape(hint)}</p>${(controller() && draftMoves.length) || (teammate() && teammateMoves.length) ? `<button type="button" class="yut-undo" data-command="plan-undo" ${canSelect() ? "" : "disabled"} aria-label="마지막 선택 되돌리기">↶ 되돌리기</button><button type="button" class="yut-confirm" data-command="${teammate() ? "plan-propose" : "plan-commit"}" ${canSelect() && (teammate() ? draftComplete && sentProposalKey !== JSON.stringify(displayedChoices) : draftComplete) ? "" : "disabled"}>${teammate() ? sentProposalKey === JSON.stringify(displayedChoices) ? "제안 보냈어요" : "제안 보내기" : draftStopReason === "capture" ? "잡고 한 번 더!" : "이대로 가자!"}</button>` : ""}</div>`;
    const suggestions = currentSuggestions();
    el("suggestions").hidden = !active() || view.turn.teamId !== myTeam();
    el("suggestions").innerHTML = `<div class="yut-section-heading"><span>우리 팀 생각</span><span>팀에만 보여요</span></div>${suggestions.length ? suggestions.map((suggestion) => { const move = displayView.legalMoves.find((entry) => moveKey(entry) === moveKey(suggestion))!; return `<button type="button" class="yut-suggestion" data-suggestion="${escape(moveKey(move))}" ${controller() && canSelect() && !draftComplete ? "" : "disabled"}><strong>${escape(name(suggestion.playerId))}: 여기로 가자!</strong><span>${escape(moveDescription(move))}</span><small>눌러서 미리보기에 더하기</small></button>`; }).join("") : `<p class="yut-empty">${teammate() ? "말과 목적지를 골라 보고 제안 보내기를 눌러요." : "팀원과 같은 말판을 보며 골라요."}</p>`}`;
  }
  function render(): void {
    if (!view.turn || !view.pieces || !view.teams) return;
    preparePreview();
    el("board").classList.toggle("is-plan-preview", displayedChoices.length > 0);
    el("ghost-hint").hidden = displayedChoices.length === 0;
    const focused = surface.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    const focusAttribute = ["data-piece", "data-destination", "data-move", "data-discard", "data-command", "data-suggestion", "data-apply-proposal"].find((attribute) => focused?.hasAttribute(attribute));
    const focusValue = focusAttribute ? focused?.getAttribute(focusAttribute) : undefined;
    const title = snapshot.connected === false ? "다시 연결하고 있어요" : snapshot.room.activeInterruption ? "참가자가 나가서 게임을 잠시 멈췄어요" : view.winnerTeamId ? `${teamName(view.winnerTeamId)} 승리!` : snapshot.phase === "waiting" ? `${snapshot.room.mode === "team-2v2" ? "2:2 팀전 · 4명" : "개인전 · 2명"}이 함께 준비해요` : controller() ? "내 차례예요!" : `${name(view.currentPlayerId)} 님의 차례`;
    el("turn").classList.toggle("is-mine", controller());
    el("turn").innerHTML = `<span class="yut-turn-mark">${controller() ? "✦" : "◎"}</span><div><strong>${escape(title)}</strong><span>${snapshot.phase === "waiting" ? `현재 ${snapshot.room.players.length}/${snapshot.room.maxPlayers}명 · 팀별 네 말` : `${teamName(view.turn.teamId)} · ${view.turn.turnId}번째 차례${teammate() ? " · 이동을 제안할 수 있어요" : ""}`}</span></div><span class="yut-turn-count">던지기 <b>${view.turn.throwsRemaining}</b>회</span>`;
    el("face-legend").textContent = view.rules.backDo
      ? "×××는 둥근 면 · 평평한 면은 민무늬 · 빨간 원 가락만 평평하면 빽도"
      : "×××는 둥근 면 · 평평한 면은 민무늬 · 빽도 없음";
    el("backdo-rule").textContent = view.rules.backDo
      ? "빽도는 지나온 길로 1칸 뒤로 갑니다."
      : "이 방은 빽도를 사용하지 않습니다. 표식과 관계없이 평평한 면이 하나면 도입니다.";
    el("backdo-discard-rule").textContent = view.rules.backDo ? "움직일 말이 없는 빽도는 결과를 소진합니다." : "";
    const throwing = view.lastThrow && serverNow() < view.lastThrow.startedAt + view.lastThrow.durationMs;
    el("throw-overlay").hidden = !animating();
    el("overlay-player").textContent = view.lastThrow ? `${name(view.lastThrow.playerId)} 님` : "";
    el("overlay-result").innerHTML = !view.lastThrow || throwing ? '<strong class="is-throwing">어떤 수가 나올까요?</strong><span>윷이 멈추는 순간을 기다려요</span>' : `<strong>${OUTCOME_LABELS[view.lastThrow.outcome]}</strong><span>${view.lastThrow.steps === -1 ? "한 칸 뒤로" : `${view.lastThrow.steps}칸 앞으로`}${view.lastThrow.steps >= 4 ? " · 한 번 더" : ""}</span>`;
    el("scene-summary").innerHTML = `<div class="yut-summary-sticks" aria-hidden="true">${Array.from({ length: 4 }, (_, index) => `<span class="yut-summary-stick ${view.lastThrow?.faces[index] ? "is-flat" : "is-round"}">${stickFaceMarkup(view.lastThrow?.faces[index] ?? false, index)}</span>`).join("")}</div>`;
    renderTeams();
    renderBoard();
    el("outcome").innerHTML = view.lastThrow ? `<strong>${OUTCOME_LABELS[view.lastThrow.outcome]}</strong><span>${view.lastThrow.steps === -1 ? "한 칸 뒤로" : `${view.lastThrow.steps}칸 앞으로`}${view.lastThrow.steps >= 4 ? " · 한 번 더" : ""}</span>` : "<strong>준비</strong><span>윷을 던져 시작하세요</span>";
    el("throw-controls").innerHTML = `<button type="button" class="yut-throw-button" data-command="throw" ${controller() && view.turn.throwsRemaining > 0 && !draftMoves.length && !pending && !animating() && !movementAnimating() ? "" : "disabled"}>${pending ? "확인 중…" : animating() ? "윷이 내려오고 있어요" : mandatoryThrows(view) > 0 ? "새 차례 · 윷 던지기" : "윷 던지기"}</button>`;
    renderActions();
    renderPlanSuggestions();
    el("message").textContent = message;
    el("history").innerHTML = (snapshot.events ?? []).filter((event) => event.type.startsWith("yutnori.") && event.type !== "yutnori.suggestion" && event.type !== "yutnori.preview" && event.type !== "yutnori.planSuggestion" && event.payload.matchId === view.matchId).slice(-12).reverse().map((event) => {
      const data = event.payload;
      const description = event.type === "yutnori.thrown" ? `${name(String(data.playerId))}: ${OUTCOME_LABELS[data.outcome as keyof typeof OUTCOME_LABELS] ?? "윷 던지기"}` : event.type === "yutnori.moved" ? `${name(String(data.playerId))}: 말 이동` : event.type === "yutnori.captured" ? "상대 말을 잡아 추가 던지기!" : event.type === "yutnori.turnChanged" ? "다음 차례 시작" : event.type === "yutnori.finished" ? "네 말 완주 · 게임 종료" : event.type === "yutnori.rollDiscarded" ? "이동할 수 없는 결과 소진" : "윷판 업데이트";
      return `<li>${escape(description)}</li>`;
    }).join("") || "<li>이 기기에서 함께한 진행 기록이 표시됩니다.</li>";
    gameUi.setResult({ open: snapshot.phase === "finished" && !!view.winnerTeamId && !movementAnimating(), kicker: "네 말, 모두 집으로", title: view.winnerTeamId ? `${teamName(view.winnerTeamId)} 승리!` : "", message: `청팀 ${view.teams.find((team) => team.teamId === "A")?.finishedCount ?? 0}/4 · 홍팀 ${view.teams.find((team) => team.teamId === "B")?.finishedCount ?? 0}/4 완주. ${snapshot.rematchRequests.includes(snapshot.playerId) ? "다른 참가자의 재대전 응답을 기다리고 있어요." : "다 함께 한 판 더 즐겨볼까요?"}`, primaryLabel: snapshot.rematchRequests.includes(snapshot.playerId) ? "응답 기다리는 중" : "한 판 더", secondaryLabel: "나가기", primaryDisabled: snapshot.rematchRequests.includes(snapshot.playerId) });
    if (focusAttribute && focusValue) [...surface.querySelectorAll<HTMLElement>(`[${focusAttribute}]`)].find((element) => element.getAttribute(focusAttribute) === focusValue)?.focus({ preventScroll: true });
    clearTimeout(refreshTimer);
    const rollEnd = view.lastThrow ? view.lastThrow.startedAt + view.lastThrow.durationMs : 0;
    const remaining = rollEnd + THROW_RESULT_HOLD_MS - serverNow();
    if (remaining > 0) refreshTimer = setTimeout(render, Math.max(0, rollEnd > serverNow() ? rollEnd - serverNow() : remaining) + 30);
    else if (movementAnimating()) refreshTimer = setTimeout(render, view.lastMoveSequence!.startedAt + view.lastMoveSequence!.durationMs - serverNow() + 30);
    else if (currentSuggestions().length || currentPlanSuggestions().length || receivedPreview) refreshTimer = setTimeout(render, 1_000);
  }
  let suppressClick = false;
  function onClick(event: Event): void {
    if (suppressClick) { suppressClick = false; event.preventDefault(); return; }
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!target || target.disabled) return;
    if (target.dataset.piece && canSelect() && !draftComplete) { pieceId = target.dataset.piece; branchChoices = []; message = ""; render(); }
    if (target.dataset.destination) chooseDestination(target.dataset.destination);
    if (target.dataset.move && canSelect()) { const move = displayView.legalMoves.find((entry) => moveKey(entry) === target.dataset.move); if (move) addDestination(move); }
    if (target.dataset.suggestion && controller() && canSelect()) {
      const valid = currentSuggestions().some((suggestion) => moveKey(suggestion) === target.dataset.suggestion);
      const move = displayView.legalMoves.find((entry) => moveKey(entry) === target.dataset.suggestion);
      if (valid && move) addDestination(move);
    }
    if (target.dataset.discard && (controller() || teammate()) && canSelect() && !draftComplete && !displayView.legalMoves.some((move) => move.rollId === target.dataset.discard)) {
      (controller() ? draftMoves : teammateMoves).push({ rollId: target.dataset.discard, discard: true }); sentProposalKey = "";
      branchChoices = []; preparePreview(); sharePreview(); render(); focusNextChoice();
    }
    if (target.dataset.command === "throw" && view.turn.throwsRemaining > 0) submit("throwYut");
    if (target.dataset.command === "close-routes") { branchChoices = []; render(); }
    if (target.dataset.command === "plan-undo" && (controller() || teammate()) && canSelect()) { const undone = (controller() ? draftMoves : teammateMoves).pop(); sentProposalKey = ""; if (undone && !("discard" in undone)) pieceId = undone.pieceId; branchChoices = []; preparePreview(); sharePreview(); message = ""; render(); focusNextChoice(); }
    if (target.dataset.command === "toggle-proposals") { proposalsOpen = !proposalsOpen; render(); }
    if (target.dataset.applyProposal && controller() && canSelect()) {
      const suggestion = currentPlanSuggestions().find((entry) => entry.playerId === target.dataset.applyProposal);
      if (suggestion) submit("commitMoves", { matchId: view.matchId, turnId: view.turn.turnId, moves: suggestion.proposal.map((choice) => ({ ...choice })) });
    }
    if (target.dataset.command === "plan-propose" && teammate() && canSelect() && teammateMoves.length && draftComplete && sentProposalKey !== JSON.stringify(displayedChoices)) {
      context.sendSignal?.({ type: "suggestPlan", payload: { matchId: view.matchId, turnId: view.turn.turnId, expectedVersion: snapshot.version, planRevision: receivedPreview?.revision ?? 0, moves: (receivedPreview?.moves ?? []).map((choice) => ({ ...choice })), proposal: displayedChoices.map((choice) => ({ ...choice })) } });
      sentProposalKey = JSON.stringify(displayedChoices); message = "팀원에게 제안을 보냈어요! 조작자가 적용하면 바로 이동해요."; render();
    }
    if (target.dataset.command === "plan-commit" && controller() && canSelect() && draftComplete) submit("commitMoves", { matchId: view.matchId, turnId: view.turn.turnId, moves: draftMoves.map((choice) => ({ ...choice })) });
  }
  let drag: { pointerId: number; pieceId: string; x: number; y: number; active: boolean; sprite?: HTMLElement } | undefined;
  function pointerDown(event: PointerEvent): void {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("[data-piece]");
    if (!target || target.disabled || !canSelect() || draftComplete || event.button !== 0) return;
    drag = { pointerId: event.pointerId, pieceId: target.dataset.piece!, x: event.clientX, y: event.clientY, active: false };
  }
  function pointerMove(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    if (!drag.active && Math.hypot(event.clientX - drag.x, event.clientY - drag.y) > 8) {
      // Capturing pointerdown retargets a normal tap away from its button.
      // Capture only once movement establishes an actual drag.
      surface.setPointerCapture?.(event.pointerId);
      drag.active = true; pieceId = drag.pieceId; branchChoices = []; render();
      const piece = displayView.pieces.find((entry) => entry.pieceId === pieceId);
      if (!piece) { cancelDrag(); return; }
      const sprite = document.createElement("div"); sprite.className = `yut-drag-piece team-${piece.teamId}`;
      sprite.innerHTML = createPieceMarkup(piece.teamId, displayView.pieces.filter((entry) => entry.stackId === piece.stackId).map((entry) => entry.pieceId));
      surface.append(sprite); drag.sprite = sprite;
    }
    if (drag.sprite) { drag.sprite.style.left = `${event.clientX}px`; drag.sprite.style.top = `${event.clientY}px`; event.preventDefault(); }
  }
  function pointerUp(event: PointerEvent): void {
    if (!drag || drag.pointerId !== event.pointerId) return;
    const wasDragging = drag.active;
    drag.sprite?.remove(); drag = undefined;
    if (surface.hasPointerCapture?.(event.pointerId)) surface.releasePointerCapture(event.pointerId);
    if (!wasDragging) return;
    suppressClick = true;
    const target = document.elementFromPoint(event.clientX, event.clientY)?.closest<HTMLElement>("[data-destination]");
    if (target?.dataset.destination) chooseDestination(target.dataset.destination);
    setTimeout(() => { suppressClick = false; }, 0);
  }
  function cancelDrag(): void {
    if (drag && surface.hasPointerCapture?.(drag.pointerId)) surface.releasePointerCapture(drag.pointerId);
    drag?.sprite?.remove();
    drag = undefined;
  }
  function onVibrationChange(event: Event): void {
    vibrationEnabled = (event.target as HTMLInputElement).checked;
    try { localStorage.setItem("bighouse:yutnori:vibration", vibrationEnabled ? "on" : "off"); } catch { /* The in-memory setting remains usable. */ }
  }
  function onSoundChange(event: Event): void {
    soundMuted = !(event.target as HTMLInputElement).checked;
    throwAudio.setMuted(soundMuted);
    if (!soundMuted) throwAudio.unlock();
    try { localStorage.setItem("bighouse:yutnori:sound", soundMuted ? "off" : "on"); } catch { /* Retain in memory. */ }
  }
  const unlockAudio = (): void => throwAudio.unlock();
  document.addEventListener("pointerdown", unlockAudio, { capture: true });
  document.addEventListener("keydown", unlockAudio, { capture: true });
  surface.addEventListener("click", onClick);
  surface.addEventListener("pointerdown", pointerDown);
  surface.addEventListener("pointermove", pointerMove);
  surface.addEventListener("pointerup", pointerUp);
  surface.addEventListener("pointercancel", cancelDrag);
  el("sound").addEventListener("change", onSoundChange);
  el("vibration").addEventListener("change", onVibrationChange);
  function update(next: GameClientSnapshot): void {
    const previous = view;
    if (snapshot.version !== next.version) planRevision = 0;
    if (snapshot.version !== next.version || next.actionError?.revision !== snapshot.actionError?.revision || next.connected === false || next.room.activeInterruption || next.phase !== snapshot.phase || (next.publicView as unknown as YutnoriPublicView).turn.turnId !== view.turn.turnId) { cancelDrag(); draftMoves = []; teammateMoves = []; sentProposalKey = ""; branchChoices = []; clearTimeout(previewTimer); clearTimeout(previewRenewTimer); pending = false; message = next.actionError?.revision !== snapshot.actionError?.revision ? (next.actionError?.message ?? "") : ""; }
    if (next.serverTime !== snapshot.serverTime) clockOffset = next.serverTime - Date.now();
    snapshot = next;
    view = next.publicView as unknown as YutnoriPublicView;
    if (view.matchId !== previous.matchId || view.turn.turnId !== previous.turn.turnId) { pieceId = undefined; planRevision = 0; branchChoices = []; message = ""; }
    preparePreview();
    if (pieceId && !displayView.legalMoves.some((move) => move.pieceId === pieceId)) pieceId = undefined;
    // Public event and snapshot delivery converge on the same authoritative roll.
    for (const event of next.events ?? []) {
      if (event.type === "yutnori.thrown" && event.payload.matchId === view.matchId && event.payload.rollId === view.lastThrow?.rollId) scene.show(event.payload as unknown as YutThrow, serverNow());
    }
    if (view.lastThrow) { scene.show(view.lastThrow, serverNow()); throwAudio.play(view.lastThrow, serverNow()); }
    gameUi.update(next);
    notifyTurn();
    render();
    if (hasRendered && previous !== view) boardMotion.play(previous, view);
    hasRendered = true;
  }
  update(context);
  return { update, destroy() { clearTimeout(refreshTimer); clearTimeout(previewTimer); clearTimeout(previewRenewTimer); cancelDrag(); surface.removeEventListener("pointerdown", pointerDown); surface.removeEventListener("pointermove", pointerMove); surface.removeEventListener("pointerup", pointerUp); surface.removeEventListener("pointercancel", cancelDrag); surface.removeEventListener("click", onClick); el("vibration").removeEventListener("change", onVibrationChange); document.removeEventListener("pointerdown", unlockAudio, { capture: true }); document.removeEventListener("keydown", unlockAudio, { capture: true }); el("sound").removeEventListener("change", onSoundChange); throwAudio.destroy(); scene.destroy(); boardMotion.destroy(); gameUi.destroy(); surface.remove(); } };
}
