import { createGameEventId, defineGameDefinition } from "@bighouse/game-sdk/server";
import type { GameContext, GameEvent, JsonObject, ServerGamePlugin, ValidationResult } from "@bighouse/game-sdk/server";
import { getLegalMoves } from "./board";
import { baseGameMetadata } from "./metadata";
import { applyMove, hasImmediateRoll, mandatoryThrows, moveDuration, rollDisposition, simulateMovePlan, THROW_RESULT_HOLD_MS } from "./rules";
import type { LegalMove, MoveChoice, Outcome, TeamId, YutMove, YutnoriStage, YutRoll, YutThrow } from "./types";

export const THROW_DURATION_MS = 1800;
export const gameMetadata = baseGameMetadata;
export function outcomeFromFaces(faces: readonly boolean[], backDo: boolean): { outcome: Outcome; steps: number } {
  if (faces.length !== 4 || faces.some((face) => typeof face !== "boolean")) throw new Error("Four boolean faces required");
  const count = faces.filter(Boolean).length;
  if (count === 1 && faces[0] && backDo) return { outcome: "backDo", steps: -1 };
  return { outcome: (["mo", "do", "gae", "geol", "yut"] as const)[count]!, steps: count === 0 ? 5 : count };
}
function readStage(value: JsonObject): YutnoriStage { return value as unknown as YutnoriStage; }
function visibleStage(context: GameContext): YutnoriStage {
  const stage = readStage(context.state.stageState);
  if (context.state.phase !== "waiting") return stage;
  const players = [...context.state.players].sort((a, b) => a.seat - b.seat);
  return { ...stage, teams: stage.teams.map((team, index) => ({ ...team, playerIds: players.filter((_, seat) => seat % 2 === index).map((player) => player.playerId) })) };
}
function failure(code: string, message: string): ValidationResult { return { ok: false, code, message }; }
function animationActive(stage: YutnoriStage, now: number): boolean {
  return (!!stage.lastThrow && now < stage.lastThrow.startedAt + stage.lastThrow.durationMs + THROW_RESULT_HOLD_MS) ||
    (!!stage.lastMoveSequence && now < stage.lastMoveSequence.startedAt + stage.lastMoveSequence.durationMs);
}
function selectedMove(stage: YutnoriStage, payload: JsonObject): LegalMove | undefined {
  return getLegalMoves(stage).find((move) => move.rollId === payload.rollId && move.pieceId === payload.pieceId && move.pathId === payload.pathId);
}
function moveChoices(payload: JsonObject, stage: YutnoriStage): MoveChoice[] | undefined {
  if (payload.matchId !== stage.matchId || payload.turnId !== stage.turn.turnId || !Array.isArray(payload.moves) || payload.moves.length === 0 || payload.moves.length > stage.turn.pending.length) return;
  const choices: MoveChoice[] = [];
  for (const item of payload.moves) {
    if (!item || typeof item !== "object" || Array.isArray(item) || typeof item.rollId !== "string" || typeof item.pieceId !== "string" || typeof item.pathId !== "string") return;
    choices.push({ rollId: item.rollId, pieceId: item.pieceId, pathId: item.pathId });
  }
  return choices;
}
function event(context: GameContext, stage: YutnoriStage, type: string, payload: JsonObject = {}): GameEvent {
  return { id: createGameEventId(), type: `yutnori.${type}`, visibility: type === "finished" ? "system" : "public", payload: { matchId: stage.matchId, turnId: stage.turn.turnId, ...payload }, createdAt: context.now };
}
function nextTurn(context: GameContext, stage: YutnoriStage, events: GameEvent[], rollId: unknown): void {
  if (stage.winnerTeamId || stage.turn.throwsRemaining > 0 || stage.turn.pending.length > 0) return;
  const turnId = stage.turn.turnId + 1;
  const teamId: TeamId = stage.turn.teamId === "A" ? "B" : "A";
  const team = stage.teams.find((entry) => entry.teamId === teamId)!;
  const normalTurnIndex = (stage.turn.normalTurnIndex ?? stage.turn.turnId - 1) + 1;
  const controllerPlayerId = team.playerIds[Math.floor(normalTurnIndex / 2) % team.playerIds.length]!;
  stage.turn = { turnId, teamId, controllerPlayerId, throwsRemaining: 1, mandatoryThrows: 0, normalTurnIndex, pending: [] };
  stage.currentPlayerId = controllerPlayerId;
  events.push(event(context, stage, "turnChanged", { currentPlayerId: controllerPlayerId, teamId, rollId, previousTurnId: turnId - 1 }));
}
function recordMoves(context: GameContext, stage: YutnoriStage, moves: YutMove[], events: GameEvent[]): void {
  const durationMs = moves.reduce((total, move) => total + moveDuration(move), 0);
  stage.lastMoveSequence = { sequenceId: crypto.randomUUID(), startedAt: context.now, durationMs, moves };
  for (const move of moves) {
    events.push(event(context, stage, "moved", { ...move }));
    if (move.capturedPieceIds.length) {
      events.push(event(context, stage, "captured", { turnId: move.turnId, rollId: move.rollId, pieceIds: move.capturedPieceIds }));
      events.push(event(context, stage, "turnChanged", { currentPlayerId: stage.currentPlayerId, teamId: stage.turn.teamId, rollId: move.rollId, previousTurnId: move.turnId, reason: "capture" }));
    }
  }
  if (stage.winnerTeamId) {
    context.state.phase = "finished";
    events.push(event(context, stage, "finished", { rollId: moves.at(-1)!.rollId, winnerTeamId: stage.winnerTeamId, winnerPlayerIds: stage.winnerPlayerIds, ...(stage.winnerPlayerId ? { winnerPlayerId: stage.winnerPlayerId } : {}) }));
  }
}

export const yutnoriDefinition = defineGameDefinition(gameMetadata, {
  initialStageState({ room, players }): JsonObject {
    const ordered = [...players].sort((a, b) => a.seat - b.seat);
    const teams = (["A", "B"] as const).map((teamId, index) => ({ teamId, playerIds: ordered.filter((_, i) => i % 2 === index).map((player) => player.playerId), finishedCount: 0 }));
    const controllerPlayerId = teams[0]!.playerIds[0] ?? "";
    return {
      matchId: crypto.randomUUID(), rules: { backDo: room.config.backDo !== false, finish: "pass-exit" }, teams,
      pieces: teams.flatMap((team) => Array.from({ length: 4 }, (_, index) => ({ pieceId: `${team.teamId}${index + 1}`, teamId: team.teamId, nodeId: "reserve", stackId: `${team.teamId}${index + 1}`, routeId: "outer" as const, history: [] }))),
      currentPlayerId: controllerPlayerId,
      turn: { turnId: 1, teamId: "A", controllerPlayerId, throwsRemaining: 1, mandatoryThrows: 0, normalTurnIndex: 0, pending: [] }
    } satisfies YutnoriStage;
  },
  initialPlayerState(): JsonObject { return {}; },
  getTeams(context) {
    return visibleStage(context).teams.map((team) => ({ teamId: team.teamId, displayName: `${team.teamId}팀`, playerIds: [...team.playerIds] }));
  },
  validateAction(context, action): ValidationResult {
    const stage = readStage(context.state.stageState);
    if (context.state.phase !== "active" || stage.winnerTeamId) return failure("invalid_phase", "게임이 진행 중이 아닙니다.");
    if (context.state.activeInterruption) return failure("game_interrupted", "참가자 변경 후 다시 시작해야 합니다.");
    if (action.playerId !== stage.currentPlayerId || !context.state.players.some((player) => player.playerId === action.playerId)) return failure("invalid_turn", "현재 조작자만 확정할 수 있습니다.");
    if (animationActive(stage, context.now)) return failure("throw_in_progress", "공동 연출이 끝난 뒤 진행하세요.");
    if (action.type === "throwYut") {
      if (Object.keys(action.payload).length !== 0) return failure("invalid_action", "윷 결과는 서버에서 결정합니다.");
      if (hasImmediateRoll(stage) && mandatoryThrows(stage) === 0) return failure("immediate_move_required", "즉시 이동 결과를 먼저 사용하세요.");
      return stage.turn.throwsRemaining > 0 ? { ok: true } : failure("invalid_action", "남은 던지기가 없습니다.");
    }
    if (mandatoryThrows(stage) > 0) return failure("capture_throw_required", "잡아서 얻은 추가 던지기를 먼저 하세요.");
    if (action.type === "movePiece") {
      const roll = stage.turn.pending.find((entry) => entry.rollId === action.payload.rollId);
      if (!roll || rollDisposition(roll) !== "immediate") return failure("banked_plan_required", "보관한 이동권은 이동 계획을 한 번에 확정하세요.");
      return selectedMove(stage, action.payload) ? { ok: true } : failure("invalid_move", "이동할 수 없는 말 또는 경로입니다.");
    }
    if (action.type === "commitMoves") {
      const choices = moveChoices(action.payload, stage);
      if (!choices) return failure("invalid_move_plan", "현재 차례의 이동 계획이 아닙니다.");
      try {
        const plan = simulateMovePlan(stage, choices, context.now);
        return plan.complete ? { ok: true } : failure("incomplete_move_plan", "모든 보관 이동권의 이동 순서를 정하세요.");
      } catch (error) { return failure("invalid_move_plan", error instanceof Error ? error.message : "이동 계획을 확인하세요."); }
    }
    if (action.type === "discardRoll") {
      const roll = stage.turn.pending.find((entry) => entry.rollId === action.payload.rollId);
      if (!roll || getLegalMoves(stage).some((move) => move.rollId === roll.rollId)) return failure("invalid_action", "이동할 수 없는 결과만 버릴 수 있습니다.");
      return { ok: true };
    }
    return failure("invalid_action", "지원하지 않는 윷놀이 동작입니다.");
  },
  applyAction(context, action) {
    const state = context.state;
    const stage = readStage(state.stageState);
    const events: GameEvent[] = [];
    if (action.type === "throwYut") {
      const random = crypto.getRandomValues(new Uint32Array(2));
      const bits = random[0]!;
      const faces: YutThrow["faces"] = [!!(bits & 1), !!(bits & 2), !!(bits & 4), !!(bits & 8)];
      const result = outcomeFromFaces(faces, stage.rules.backDo);
      const roll: YutRoll = { rollId: crypto.randomUUID(), ...result, disposition: result.outcome === "yut" || result.outcome === "mo" ? "banked" : "immediate" };
      stage.turn.throwsRemaining -= 1;
      if (mandatoryThrows(stage) > 0) stage.turn.mandatoryThrows = mandatoryThrows(stage) - 1;
      if (result.outcome === "yut" || result.outcome === "mo") stage.turn.throwsRemaining += 1;
      stage.turn.pending.push(roll);
      stage.lastThrow = { ...roll, matchId: stage.matchId, turnId: stage.turn.turnId, playerId: action.playerId, faces, startedAt: context.now, durationMs: THROW_DURATION_MS, visualSeed: random[1]! };
      events.push(event(context, stage, "thrown", { ...stage.lastThrow }));
    } else if (action.type === "movePiece") {
      const move = selectedMove(stage, action.payload);
      if (!move) throw new Error("movePiece must be validated before applyAction");
      recordMoves(context, stage, [applyMove(stage, move, context.now)], events);
    } else if (action.type === "commitMoves") {
      const choices = moveChoices(action.payload, stage);
      if (!choices) throw new Error("commitMoves must be validated before applyAction");
      const plan = simulateMovePlan(stage, choices, context.now);
      if (!plan.complete) throw new Error("Cannot commit an incomplete move plan");
      Object.assign(stage, plan.stage);
      recordMoves(context, stage, plan.moves, events);
    } else if (action.type === "discardRoll") {
      stage.turn.pending = stage.turn.pending.filter((roll) => roll.rollId !== action.payload.rollId);
      events.push(event(context, stage, "rollDiscarded", { rollId: action.payload.rollId }));
    }
    nextTurn(context, stage, events, action.type === "commitMoves" ? stage.lastMoveSequence?.moves.at(-1)?.rollId : action.payload.rollId);
    return { state, events };
  },
  getPublicView(context): JsonObject {
    const stage = visibleStage(context);
    return { ...stage, legalMoves: getLegalMoves(stage), serverNow: context.now };
  },
  getPrivateView(): JsonObject { return {}; },
  nextTimers() { return []; },
  handleSignal(context, playerId, signal) {
    const stage = readStage(context.state.stageState);
    const payload = signal.payload;
    if (signal.type !== "suggestMove" || context.state.phase !== "active" || context.state.activeInterruption || stage.winnerTeamId || animationActive(stage, context.now) || mandatoryThrows(stage) > 0) return;
    if (payload.matchId !== stage.matchId || payload.turnId !== stage.turn.turnId || playerId === stage.currentPlayerId) return;
    const roll = stage.turn.pending.find((entry) => entry.rollId === payload.rollId);
    if (!roll || (rollDisposition(roll) === "banked" && (hasImmediateRoll(stage) || stage.turn.throwsRemaining > 0))) return;
    const team = stage.teams.find((entry) => entry.teamId === stage.turn.teamId);
    if (!team?.playerIds.includes(playerId) || !context.state.players.some((player) => player.playerId === playerId) || !selectedMove(stage, payload)) return;
    return { recipientPlayerIds: [...team.playerIds], type: "yutnori.suggestion", payload: { matchId: stage.matchId, turnId: stage.turn.turnId, rollId: payload.rollId, pieceId: payload.pieceId, pathId: payload.pathId, playerId } };
  }
});
export const yutnoriGamePlugin = { gameMetadata, gameDefinition: yutnoriDefinition } satisfies ServerGamePlugin;
