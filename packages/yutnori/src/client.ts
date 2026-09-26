import "./style.css";
import type { GameClientContext, GameClientSnapshot, MountedGameClient } from "@bighouse/game-sdk/client";
import { createGameUi } from "@bighouse/ui";
import { BOARD_EDGES, BOARD_NODES, getLegalMoves } from "./board";
import { simulateMovePlan, rollDisposition, mandatoryThrows, THROW_RESULT_HOLD_MS } from "./rules";
import { createThrowScene } from "./scene";
import { createPieceMarkup } from "./pieces";
import { createBoardMotion } from "./motion";
import { createThrowAudio } from "./audio";
import { stickFaceMarkup } from "./stick-face";
import { OUTCOME_LABELS, type LegalMove, type TeamId, type YutnoriPublicView, type YutSuggestion, type YutThrow } from "./types";
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
export function validSuggestions(events: NonNullable<GameClientSnapshot["events"]>, view: YutnoriPublicView, now: number): YutSuggestion[] {
  const latest = new Map<string, YutSuggestion>();
  if (mandatoryThrows(view) > 0 || view.turn.throwsRemaining > 0) return [];
  for (const event of events) {
    if (event.type !== "yutnori.suggestion" || now - event.createdAt > 30_000) continue;
    const suggestion = event.payload as unknown as YutSuggestion;
    if (suggestion.matchId !== view.matchId || suggestion.turnId !== view.turn.turnId) continue;
    if (!view.teams.find((team) => team.teamId === view.turn.teamId)?.playerIds.includes(suggestion.playerId)) continue;
    const suggestedRoll = view.turn.pending.find((roll) => roll.rollId === suggestion.rollId);
    if (!suggestedRoll || (view.turn.pending.some((roll) => rollDisposition(roll) === "immediate") && rollDisposition(suggestedRoll) === "banked")) continue;
    if (view.legalMoves.some((move) => moveKey(move) === moveKey(suggestion))) latest.set(suggestion.playerId, suggestion);
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
  let draftMoves: Array<{ rollId: string; pieceId: string; pathId: string }> = [];
  let draftComplete = false;
  let draftStopReason = "incomplete";
  let rollId: string | undefined;
  let pieceId: string | undefined;
  let pathId: string | undefined;
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
    <div class="yut-teams" data-role="teams"></div>
    <div class="yut-options"><span>● 청팀 · ■ 홍팀 · 겹친 말은 함께 이동</span><label class="yut-vibration"><input type="checkbox" data-role="vibration" ${vibrationEnabled ? "checked" : ""}> 차례 진동</label><label class="yut-sound"><input type="checkbox" data-role="sound" ${soundMuted ? "" : "checked"}> 효과음</label></div>
    <div class="yut-layout"><div class="yut-table-column"><div class="yut-board-wrap"><div class="yut-board" data-role="board" aria-label="29개 밭으로 이루어진 윷판"></div></div><div class="yut-board-caption"><span>말을 선택하고 이동할 곳을 고르세요</span><span>A 청팀 · B 홍팀</span></div></div>
    <aside class="yut-console" aria-label="윷 던지기와 말 이동"><section class="yut-throw-card"><div class="yut-section-heading"><span>윷 던지기</span><span class="yut-live">모두에게 공유</span></div><div class="yut-scene-summary" data-role="scene-summary" aria-label="최근 윷 결과"></div><div class="yut-outcome" data-role="outcome" aria-live="polite"></div><div class="yut-throw-controls" data-role="throw-controls"></div><p class="yut-face-legend" data-role="face-legend"></p></section><section class="yut-action-card" data-role="actions"></section><section class="yut-suggestions" data-role="suggestions" aria-label="팀원 이동 제안"></section></aside></div>
    <div class="yut-throw-overlay" data-role="throw-overlay" role="status" aria-live="polite" aria-label="모두 함께 보는 윷 던지기" hidden>
      <div class="yut-throw-presentation"><div class="yut-overlay-header"><span>윷 던지기</span><span data-role="overlay-player"></span></div><div class="yut-scene" data-role="scene" role="img" aria-label="네 개의 윷가락"></div><div class="yut-overlay-result" data-role="overlay-result" aria-live="polite"></div><p class="yut-overlay-note">모두 같은 윷을 보고 있어요</p></div>
    </div>
    <div class="yut-message" data-role="message" role="status"></div>
    <footer class="yut-footer"><details><summary>윷놀이 규칙</summary><div class="yut-rules"><p>각 팀의 네 말을 모두 완주시키면 승리합니다. 도 1칸 · 개 2칸 · 걸 3칸 · 윷 4칸 · 모 5칸입니다. <span data-role="backdo-rule"></span></p><p>대기 말도 결과 하나를 사용해 출발합니다. 같은 팀 말은 함께 업고, 상대 말이 있는 밭에 정확히 도착하면 모두 잡습니다. 윷·모는 이동권으로 보관하고 한 번 더 던집니다. 도·개·걸·빽도는 먼저 사용하고, 저장한 윷·모는 원하는 순서로 계획해 한 번에 확정하세요. 잡으면 같은 조작자의 새 차례가 시작되고, 보관한 이동권을 유지한 채 먼저 윷을 던집니다.</p><p>모서리나 중앙에 정확히 멈춘 말은 다음 이동에서 지름길을 고를 수 있습니다. 출발점을 지나야 완주하며, 남는 걸음은 상관없습니다. <span data-role="backdo-discard-rule"></span></p><p>2:2 팀전은 1·3번과 2·4번 자리가 한 팀입니다. 팀끼리 번갈아 진행하고, 같은 팀의 조작자도 번갈아 맡습니다. 팀원은 제안하고 현재 조작자가 최종 이동을 확정합니다.</p></div></details><details><summary>진행 기록</summary><ol data-role="history" class="yut-history"></ol></details></footer>`;
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
  const hasImmediate = (): boolean => view.turn.pending.some((roll) => rollDisposition(roll) === "immediate");
  function preparePreview(): void {
    displayView = view;
    draftComplete = false;
    draftStopReason = "incomplete";
    if (!draftMoves.length) return;
    try {
      const result = simulateMovePlan(view, draftMoves, serverNow());
      displayView = { ...result.stage, legalMoves: getLegalMoves(result.stage), serverNow: serverNow() };
      draftComplete = result.complete;
      draftStopReason = result.stopReason;
    } catch {
      draftMoves = [];
      message = "말판이 바뀌어 이동 계획을 초기화했어요. 다시 골라주세요.";
    }
  }
  function selectNextDraftRoll(): void {
    preparePreview();
    rollId = displayView.turn.pending.find((roll) => rollDisposition(roll) === "immediate")?.rollId ?? displayView.turn.pending[0]?.rollId;
    pieceId = undefined;
    pathId = undefined;
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
      return `<section class="yut-team team-${id} ${displayView.turn.teamId === id && active() ? "is-current" : ""}"><div class="yut-team-top"><strong><span class="yut-team-dot">${id}</span>${teamName(id)}${myTeam() === id ? " <small>우리 팀</small>" : ""}</strong><span class="yut-score">${team?.finishedCount ?? 0}<small> / 4 완주</small></span></div><div class="yut-roster">${roster.length ? roster.map((player) => `<span class="${displayView.currentPlayerId === player.playerId && active() ? "is-controller" : ""}">${escape(player.displayName)}${player.playerId === snapshot.playerId ? " (나)" : ""}${snapshot.phase === "waiting" ? (player.ready ? " · 준비" : " · 대기") : displayView.currentPlayerId === player.playerId ? " · 조작 중" : ""}</span>`).join("<span class='yut-roster-divider'>→</span>") : "참가자를 기다리고 있어요"}</div><div class="yut-reserve"><span>대기</span><div>${pieces.filter((piece) => piece.nodeId === "reserve").map((piece) => pieceButton(piece.pieceId, id, piece.pieceId.replace(/^[AB][-_]?/, ""), canSelect() && !draftComplete && id === displayView.turn.teamId && displayView.legalMoves.some((move) => move.rollId === rollId && move.pieceId === piece.pieceId))).join("") || "<span class='yut-empty'>—</span>"}</div><span class="yut-finished" aria-label="완주한 말">${"●".repeat(team?.finishedCount ?? 0)}${"○".repeat(4 - (team?.finishedCount ?? 0))}</span></div></section>`;
    }).join("");
  }
  function renderBoard(): void {
    const selected = selectedLegalMove(displayView, rollId, pieceId, pathId);
    const candidates = displayView.legalMoves.filter((move) => move.rollId === rollId && move.pieceId === pieceId);
    const pathNodes = selected ? [displayView.pieces.find((piece) => piece.pieceId === pieceId)?.nodeId ?? "reserve", ...selected.path].map((id) => nodeMap.get(id === "reserve" || id === "finished" ? "o0" : id)).filter((node) => !!node) : [];
    const selectedNode = displayView.pieces.find((piece) => piece.pieceId === pieceId)?.nodeId;
    const arrow = (node: string, route: string, d: string): string => {
      const chosen = selectedNode === node && pathId === route;
      return `<path class="yut-route-arrow ${chosen ? "is-chosen" : ""}" data-fork="${node}" data-route="${route}" d="${d}" marker-end="url(#${chosen ? "yut-route-selected" : "yut-route-muted"})"/>`;
    };
    const directions = `<g class="yut-direction-guides"><path class="yut-route-arrow" data-direction="start" d="M96 89 L96 80" marker-end="url(#yut-route-muted)"/>${arrow("o5", "outer", "M86 13 L83 13 L79 13")}${arrow("o5", "diagonalA", "M86 13 L83 13 L80 16")}${arrow("o10", "outer", "M13 14 L13 17 L13 21")}${arrow("o10", "diagonalB", "M13 14 L13 17 L17 21")}${arrow("c", "diagonalA", "M50 55 L50 58 L46.5 61.5")}${arrow("c", "diagonalB", "M50 55 L50 58 L53.5 61.5")}</g>`;
    const markers = '<defs><marker id="yut-route-muted" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 .5 L3 2 L0 3.5" fill="none" stroke="#acb9ca" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"/></marker><marker id="yut-route-selected" markerWidth="4" markerHeight="4" refX="3" refY="2" orient="auto"><path d="M0 .5 L3 2 L0 3.5" fill="none" stroke="#3864e8" stroke-width=".8" stroke-linecap="round" stroke-linejoin="round"/></marker></defs>';
    const lines = BOARD_EDGES.map(([a, b]) => { const from = nodeMap.get(a)!; const to = nodeMap.get(b)!; return `<line x1="${from.x}" y1="${from.y}" x2="${to.x}" y2="${to.y}"/>`; }).join("");
    el("board").innerHTML = `<svg class="yut-board-lines" viewBox="0 0 100 100" aria-hidden="true">${markers}<g>${lines}</g>${directions}${pathNodes.length ? `<polyline class="yut-path-preview" points="${pathNodes.map((node) => `${node.x},${node.y}`).join(" ")}"/>` : ""}</svg>${BOARD_NODES.map((node) => {
      const pieces = displayView.pieces.filter((piece) => piece.nodeId === node.nodeId);
      const first = pieces[0];
      const target = candidates.find((move) => move.destination === node.nodeId);
      const inPath = selected?.path.includes(node.nodeId);
      const special = ["o0", "o5", "o10", "o15", "c"].includes(node.nodeId);
      const pieceEnabled = first && canSelect() && !draftComplete && first.teamId === displayView.turn.teamId && displayView.legalMoves.some((move) => move.rollId === rollId && move.pieceId === first.pieceId);
      const targetEnabled = !!target && canSelect();
      const label = `${locationName(node.nodeId)}${first ? `, ${teamName(first.teamId)} 말 ${pieces.length}개` : ""}${target ? ", 이동 후보" : ""}`;
      return `<div data-node="${node.nodeId}" class="yut-node ${special ? "is-special" : ""} ${inPath ? "is-path" : ""} ${target ? "is-target" : ""}" style="left:${node.x}%;top:${node.y}%"><button type="button" class="yut-node-button ${first ? `team-${first.teamId} has-piece` : ""} ${first && pieces.some((piece) => piece.pieceId === pieceId) ? "is-selected" : ""}" ${targetEnabled ? `data-path="${escape(target.pathId)}"` : first ? `data-piece="${escape(first.pieceId)}"` : ""} ${pieceEnabled || targetEnabled ? "" : "disabled"} aria-label="${escape(label)}">${first ? createPieceMarkup(first.teamId, pieces.map((piece) => piece.pieceId)) : target ? "◎" : special ? "◉" : ""}</button></div>`;
    }).join("")}`;
  }
  function moveDescription(move: LegalMove): string {
    const path = move.pathId === "diagonalA" || move.pathId === "diagonalB" ? "지름길" : move.pathId === "back" ? "뒤로" : "바깥길";
    return `${path} → ${locationName(move.destination)}${move.capturedPieceIds.length ? ` · ${move.capturedPieceIds.length}개 잡기 · 우리 팀 새 차례` : ""}${move.stackedPieceIds.length ? ` · ${move.stackedPieceIds.length}개 업기` : ""}${move.completedPieceIds.length ? ` · ${move.completedPieceIds.length}개 완주` : ""}`;
  }
  function renderActions(): void {
    const selected = selectedLegalMove(displayView, rollId, pieceId, pathId);
    const candidates = displayView.legalMoves.filter((move) => move.rollId === rollId && move.pieceId === pieceId);
    const selectedRoll = displayView.turn.pending.find((roll) => roll.rollId === rollId);
    const banked = !!selectedRoll && rollDisposition(selectedRoll) === "banked";
    const immediatePending = hasImmediate();
    const canUseSelected = canSelect() && (!banked || !immediatePending) && !draftComplete;
    const discardable = selectedRoll && !banked && !displayView.legalMoves.some((move) => move.rollId === selectedRoll.rollId);
    const planRows = draftMoves.map((choice, index) => {
      const roll = view.turn.pending.find((item) => item.rollId === choice.rollId);
      const result = simulateMovePlan(view, draftMoves.slice(0, index + 1), serverNow());
      const move = result.moves.at(-1)!;
      return `<li><span class="yut-plan-number">${index + 1}</span><div><strong>${roll ? OUTCOME_LABELS[roll.outcome] : "이동"} · ${escape(choice.pieceId)}</strong><span>${escape(moveDescription(move))}</span></div></li>`;
    }).join("");
    let hint = snapshot.phase === "waiting" ? "모두 준비하면 방장이 시작할 수 있어요."
      : animating() ? "함께 윷이 멈추기를 기다려요."
      : movementAnimating() ? "말이 정해진 길을 따라 이동하고 있어요."
      : mandatoryThrows(view) > 0 ? "새 차례예요. 먼저 윷을 던진 뒤 말을 움직이세요."
      : view.turn.throwsRemaining > 0 ? (view.turn.pending.some((roll) => rollDisposition(roll) === "banked") ? "윷·모 이동권은 보관했어요. 먼저 한 번 더 던지세요." : "먼저 윷을 던져 이번 차례를 시작하세요.")
      : !controller() && !teammate() ? "상대 팀이 수를 생각하고 있어요."
      : draftComplete ? (draftStopReason === "capture" ? "잡는 곳까지 계획했어요. 확정하면 우리 팀의 새 차례가 시작돼요." : draftStopReason === "victory" ? "네 말이 모두 완주하는 계획이에요!" : "저장한 결과의 이동 순서를 모두 골랐어요.")
      : banked && immediatePending ? "이번에 나온 결과를 먼저 사용한 뒤 저장한 윷·모를 계획하세요."
      : !rollId ? "윷을 던져 이동할 결과를 만드세요."
      : discardable ? "이 결과로 움직일 수 있는 말이 없어요."
      : !pieceId ? (banked ? "저장한 결과를 골랐어요. 계획에 넣을 말을 선택하세요." : "이번 결과로 움직일 말을 고르세요.")
      : !pathId ? "화살표와 목적지를 보고 이동 경로를 고르세요."
      : banked ? "이동 순서에 추가한 뒤 전체 계획을 한 번에 확정하세요." : "경로를 확인하고 이동을 확정하세요.";
    el("actions").innerHTML = `<div class="yut-section-heading"><span>${draftMoves.length ? "이동 계획" : "말 움직이기"}</span><span class="yut-step">${draftMoves.length ? "말판은 계획 미리보기예요" : "결과 → 말 → 경로"}</span></div><div class="yut-tokens" aria-label="보유한 윷 결과">${view.turn.pending.map((roll) => {
      const order = draftMoves.findIndex((choice) => choice.rollId === roll.rollId);
      const stored = rollDisposition(roll) === "banked";
      const enabled = canSelect() && order < 0 && !draftComplete && (!stored || !immediatePending);
      return `<button type="button" class="yut-token ${rollId === roll.rollId ? "is-selected" : ""} ${order >= 0 ? "is-planned" : ""}" data-roll="${escape(roll.rollId)}" ${enabled ? "" : "disabled"} aria-pressed="${rollId === roll.rollId}"><strong>${OUTCOME_LABELS[roll.outcome]}</strong><span>${order >= 0 ? `${order + 1}번째 이동` : stored ? "저장한 이동권" : "이번 이동"}</span></button>`;
    }).join("") || "<p class='yut-empty'>윷을 던지면 이동할 결과가 생겨요.</p>"}</div><p class="yut-hint">${hint}</p><div class="yut-paths">${candidates.map((move) => `<button type="button" data-path="${escape(move.pathId)}" class="yut-path-option ${pathId === move.pathId ? "is-selected" : ""}" ${canUseSelected ? "" : "disabled"}>${escape(moveDescription(move))}</button>`).join("")}</div>${selected && (!banked || !immediatePending) && !draftComplete ? `<div class="yut-preview"><strong>${selected.pieceIds.length}개 말 이동 미리보기</strong><span>${escape(moveDescription(selected))}</span></div><button type="button" class="yut-confirm" data-command="${controller() ? banked ? "plan-add" : "move" : "suggest"}" ${canUseSelected && (controller() || !!context.sendSignal) ? "" : "disabled"}>${controller() ? banked ? "이동 계획에 추가" : "이동 확정" : "팀원에게 이동 제안"} <span>${banked ? "+" : "→"}</span></button>` : discardable ? `<button type="button" class="yut-discard" data-command="discard" ${controller() && canSelect() ? "" : "disabled"}>${OUTCOME_LABELS[selectedRoll.outcome]} 소진하고 계속하기</button>` : ""}${draftMoves.length ? `<div class="yut-plan"><div class="yut-plan-heading"><strong>이 순서로 움직여요</strong><button type="button" data-command="plan-undo" ${canSelect() ? "" : "disabled"}>한 수 되돌리기</button></div><ol>${planRows}</ol><div class="yut-plan-tools"><button type="button" data-command="plan-reset" ${canSelect() ? "" : "disabled"}>처음부터 다시</button><span>${draftComplete ? "확정할 준비가 됐어요" : "남은 이동권도 골라주세요"}</span></div><button type="button" class="yut-confirm" data-command="plan-commit" ${controller() && canSelect() && draftComplete ? "" : "disabled"}>${draftMoves.length}번 이동 한 번에 확정 <span>→</span></button></div>` : !immediatePending && view.turn.pending.some((roll) => rollDisposition(roll) === "banked") ? '<p class="yut-bank-note">윷·모는 이동권으로 저장돼요. 사용할 순서대로 계획에 담아 한 번에 확정하세요.</p>' : ""}`;
    const suggestions = validSuggestions(snapshot.events ?? [], view, serverNow());
    const showSuggestions = active() && view.turn.teamId === myTeam();
    el("suggestions").hidden = !showSuggestions;
    el("suggestions").innerHTML = `<div class="yut-section-heading"><span>우리 팀 작전</span><span>팀에만 보여요</span></div>${suggestions.length ? suggestions.map((suggestion) => { const move = view.legalMoves.find((entry) => moveKey(entry) === moveKey(suggestion))!; return `<button type="button" class="yut-suggestion" data-suggestion="${escape(moveKey(move))}" ${canSelect() ? "" : "disabled"}><strong>${escape(name(suggestion.playerId))}의 제안</strong><span>${escape(moveDescription(move))}</span><small>${controller() ? "선택하여 미리보기 · 최종 확정 필요" : "제안한 경로 보기"}</small></button>`; }).join("") : `<p class="yut-empty">${teammate() ? "말과 경로를 고른 뒤 이동을 제안하세요." : "팀원의 이동 제안이 여기에 표시돼요."}</p>`}`;
  }
  function render(): void {
    if (!view.turn || !view.pieces || !view.teams) return;
    preparePreview();
    el("board").classList.toggle("is-plan-preview", draftMoves.length > 0);
    const focused = surface.contains(document.activeElement) ? document.activeElement as HTMLElement : undefined;
    const focusAttribute = ["data-roll", "data-piece", "data-path", "data-command", "data-suggestion"].find((attribute) => focused?.hasAttribute(attribute));
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
    el("overlay-result").innerHTML = !view.lastThrow || throwing ? '<strong class="is-throwing">어떤 수가 나올까요?</strong><span>윷이 멈추는 순간을 기다려요</span>' : `<strong>${OUTCOME_LABELS[view.lastThrow.outcome]}</strong><span>${view.lastThrow.steps === -1 ? "한 칸 뒤로" : `${view.lastThrow.steps}칸 앞으로`}${view.lastThrow.steps >= 4 ? " · 이동권 저장 · 한 번 더" : ""}</span>`;
    el("scene-summary").innerHTML = `<div class="yut-summary-sticks" aria-hidden="true">${Array.from({ length: 4 }, (_, index) => `<span class="yut-summary-stick ${view.lastThrow?.faces[index] ? "is-flat" : "is-round"}">${stickFaceMarkup(view.lastThrow?.faces[index] ?? false, index)}</span>`).join("")}</div>`;
    renderTeams();
    renderBoard();
    el("outcome").innerHTML = view.lastThrow ? `<strong>${OUTCOME_LABELS[view.lastThrow.outcome]}</strong><span>${view.lastThrow.steps === -1 ? "한 칸 뒤로" : `${view.lastThrow.steps}칸 앞으로`}${view.lastThrow.steps >= 4 ? " · 이동권 저장 · 한 번 더" : ""}</span>` : "<strong>준비</strong><span>윷을 던져 시작하세요</span>";
    el("throw-controls").innerHTML = `<button type="button" class="yut-throw-button" data-command="throw" ${controller() && view.turn.throwsRemaining > 0 && !hasImmediate() && !draftMoves.length && !pending && !animating() && !movementAnimating() ? "" : "disabled"}>${pending ? "확인 중…" : animating() ? "윷이 내려오고 있어요" : mandatoryThrows(view) > 0 ? "새 차례 · 윷 던지기" : "윷 던지기"}</button>`;
    renderActions();
    el("message").textContent = message;
    el("history").innerHTML = (snapshot.events ?? []).filter((event) => event.type.startsWith("yutnori.") && event.type !== "yutnori.suggestion" && event.payload.matchId === view.matchId).slice(-12).reverse().map((event) => {
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
    else if (validSuggestions(snapshot.events ?? [], view, serverNow()).length) refreshTimer = setTimeout(render, 1_000);
  }
  function onClick(event: Event): void {
    const target = (event.target as HTMLElement).closest<HTMLButtonElement>("button");
    if (!target || target.disabled) return;
    if (target.dataset.roll && canSelect()) { rollId = target.dataset.roll; pieceId = undefined; pathId = undefined; message = ""; render(); }
    if (target.dataset.piece && canSelect()) { pieceId = target.dataset.piece; pathId = undefined; message = ""; render(); }
    if (target.dataset.path && canSelect()) { pathId = target.dataset.path; render(); }
    if (target.dataset.suggestion && canSelect()) {
      const move = view.legalMoves.find((entry) => moveKey(entry) === target.dataset.suggestion);
      if (move) { draftMoves = []; preparePreview(); rollId = move.rollId; pieceId = move.pieceId; pathId = move.pathId; message = "제안을 미리 보고 있어요. 이동하려면 확정 버튼을 누르세요."; render(); }
    }
    const selected = selectedLegalMove(displayView, rollId, pieceId, pathId);
    if (target.dataset.command === "throw" && view.turn.throwsRemaining > 0) submit("throwYut");
    if (target.dataset.command === "plan-add" && selected && controller() && canSelect() && !hasImmediate() && !draftComplete) {
      draftMoves.push({ rollId: selected.rollId, pieceId: selected.pieceId, pathId: selected.pathId });
      selectNextDraftRoll();
      message = "계획을 미리 보고 있어요. 마지막에 한 번에 확정합니다.";
      render();
    }
    if (target.dataset.command === "plan-undo" && canSelect()) { draftMoves.pop(); selectNextDraftRoll(); render(); }
    if (target.dataset.command === "plan-reset" && canSelect()) { draftMoves = []; selectNextDraftRoll(); message = ""; render(); }
    if (target.dataset.command === "plan-commit" && controller() && canSelect() && draftComplete) submit("commitMoves", { matchId: view.matchId, turnId: view.turn.turnId, moves: draftMoves.map((choice) => ({ ...choice })) });
    if (target.dataset.command === "move" && selected) submit("movePiece", { rollId: selected.rollId, pieceId: selected.pieceId, pathId: selected.pathId });
    if (target.dataset.command === "discard" && rollId && !view.legalMoves.some((move) => move.rollId === rollId)) submit("discardRoll", { rollId });
    if (target.dataset.command === "suggest" && teammate() && selected && context.sendSignal) {
      context.sendSignal({ type: "suggestMove", payload: { matchId: view.matchId, turnId: view.turn.turnId, rollId: selected.rollId, pieceId: selected.pieceId, pathId: selected.pathId } });
      message = "우리 팀에 이동을 제안했어요. 조작자가 최종 확정합니다.";
      render();
    }
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
  el("sound").addEventListener("change", onSoundChange);
  el("vibration").addEventListener("change", onVibrationChange);
  function update(next: GameClientSnapshot): void {
    const previous = view;
    if (snapshot.version !== next.version || next.actionError?.revision !== snapshot.actionError?.revision || next.connected === false) { draftMoves = []; pending = false; message = next.actionError?.revision !== snapshot.actionError?.revision ? (next.actionError?.message ?? "") : ""; }
    if (next.serverTime !== snapshot.serverTime) clockOffset = next.serverTime - Date.now();
    snapshot = next;
    view = next.publicView as unknown as YutnoriPublicView;
    if (view.matchId !== previous.matchId || view.turn.turnId !== previous.turn.turnId) { rollId = undefined; pieceId = undefined; pathId = undefined; message = ""; }
    if (!view.turn.pending.some((roll) => roll.rollId === rollId)) { rollId = view.turn.pending.find((roll) => rollDisposition(roll) === "immediate")?.rollId ?? view.turn.pending[0]?.rollId; pieceId = undefined; pathId = undefined; }
    if (pieceId && !view.legalMoves.some((move) => move.rollId === rollId && move.pieceId === pieceId)) { pieceId = undefined; pathId = undefined; }
    if (pathId && !selectedLegalMove(view, rollId, pieceId, pathId)) pathId = undefined;
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
  return { update, destroy() { clearTimeout(refreshTimer); surface.removeEventListener("click", onClick); el("vibration").removeEventListener("change", onVibrationChange); document.removeEventListener("pointerdown", unlockAudio, { capture: true }); document.removeEventListener("keydown", unlockAudio, { capture: true }); el("sound").removeEventListener("change", onSoundChange); throwAudio.destroy(); scene.destroy(); boardMotion.destroy(); gameUi.destroy(); surface.remove(); } };
}
