import { getLegalMoves, piecePaths } from "./board";
import type { LegalMove, MoveChoice, YutMove, YutnoriStage, YutRoll } from "./types";
export const THROW_RESULT_HOLD_MS = 800;

export function rollDisposition(roll: YutRoll): "immediate" | "banked" {
  return roll.disposition ?? (roll.outcome === "yut" || roll.outcome === "mo" ? "banked" : "immediate");
}
export function mandatoryThrows(stage: YutnoriStage): number { return stage.turn.mandatoryThrows ?? 0; }
export function hasImmediateRoll(stage: YutnoriStage): boolean { return stage.turn.pending.some((roll) => rollDisposition(roll) === "immediate"); }
export function moveDuration(move: LegalMove): number {
  return Math.min(1250, Math.max(360, move.path.length * 180)) + (move.capturedPieceIds.length ? 650 : 100);
}

/** Shared deterministic mutation for authoritative moves and a cloned client preview. */
export function applyMove(stage: YutnoriStage, choice: MoveChoice, startedAt: number): YutMove {
  const move = getLegalMoves(stage).find((candidate) => candidate.rollId === choice.rollId && candidate.pieceId === choice.pieceId && candidate.pathId === choice.pathId);
  if (!move) throw new Error("이동할 수 없는 말 또는 경로입니다.");
  const roll = stage.turn.pending.find((entry) => entry.rollId === move.rollId)!;
  const lead = stage.pieces.find((piece) => piece.pieceId === move.pieceId)!;
  const route = piecePaths(lead, roll.steps).find((path) => path.pathId === move.pathId)!;
  const record: YutMove = { ...move, matchId: stage.matchId, turnId: stage.turn.turnId, playerId: stage.currentPlayerId, startedAt };
  for (const piece of stage.pieces) {
    if (move.capturedPieceIds.includes(piece.pieceId)) {
      piece.nodeId = "reserve"; piece.stackId = piece.pieceId; piece.routeId = "outer"; piece.history = [];
    }
    if (move.pieceIds.includes(piece.pieceId) || move.stackedPieceIds.includes(piece.pieceId)) {
      piece.nodeId = route.destination;
      piece.routeId = route.routeId;
      piece.history = route.history.map((step) => ({ ...step }));
      piece.stackId = route.destination === "reserve" || route.destination === "finished" ? piece.pieceId : lead.pieceId;
    }
  }
  stage.lastMove = record;
  stage.turn.pending = stage.turn.pending.filter((entry) => entry.rollId !== move.rollId);
  for (const team of stage.teams) team.finishedCount = stage.pieces.filter((piece) => piece.teamId === team.teamId && piece.nodeId === "finished").length;
  const team = stage.teams.find((entry) => entry.teamId === stage.turn.teamId)!;
  if (team.finishedCount === 4) {
    stage.winnerTeamId = team.teamId;
    stage.winnerPlayerIds = [...team.playerIds];
    if (team.playerIds.length === 1) stage.winnerPlayerId = team.playerIds[0]!;
  } else if (move.capturedPieceIds.length) {
    // A capture starts a new turn for this operator. Earned results and optional
    // extra throws carry over, but this capture's throw must happen first.
    stage.turn.normalTurnIndex ??= stage.turn.turnId - 1;
    stage.turn.turnId += 1;
    stage.turn.throwsRemaining += 1;
    stage.turn.mandatoryThrows = mandatoryThrows(stage) + 1;
  }
  return record;
}

export type MovePlanResult = {
  stage: YutnoriStage;
  moves: YutMove[];
  complete: boolean;
  stopReason: "all-spent" | "capture" | "victory" | "incomplete";
};

/** A valid prefix is previewable; only a complete plan is committable. */
export function simulateMovePlan(initial: YutnoriStage, choices: readonly MoveChoice[], startedAt: number): MovePlanResult {
  if (mandatoryThrows(initial) > 0) throw new Error("잡아서 얻은 추가 던지기를 먼저 하세요.");
  if (hasImmediateRoll(initial)) throw new Error("즉시 이동 결과를 먼저 사용하세요.");
  if (initial.turn.throwsRemaining > 0) throw new Error("남은 추가 던지기를 먼저 하세요.");
  const stage = structuredClone(initial);
  const moves: YutMove[] = [];
  let at = startedAt;
  let stopReason: MovePlanResult["stopReason"] = "incomplete";
  for (const choice of choices) {
    if (stopReason === "capture" || stopReason === "victory") throw new Error("잡기 또는 승리 뒤에는 계획을 이어갈 수 없습니다.");
    const roll = stage.turn.pending.find((entry) => entry.rollId === choice.rollId);
    if (!roll || rollDisposition(roll) !== "banked") throw new Error("사용할 수 없는 보관 이동권입니다.");
    const move = applyMove(stage, choice, at);
    moves.push(move);
    at += moveDuration(move);
    if (stage.winnerTeamId) stopReason = "victory";
    else if (move.capturedPieceIds.length) stopReason = "capture";
  }
  if (stopReason === "incomplete" && !stage.turn.pending.some((roll) => rollDisposition(roll) === "banked")) stopReason = "all-spent";
  return { stage, moves, complete: stopReason !== "incomplete", stopReason };
}
