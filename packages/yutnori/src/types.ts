export type TeamId = "A" | "B";
export type Outcome = "backDo" | "do" | "gae" | "geol" | "yut" | "mo";
export type RouteId = "outer" | "diagonalA" | "diagonalB";
export type RouteStep = { nodeId: string; routeId: RouteId };
export type YutPiece = {
  pieceId: string;
  teamId: TeamId;
  nodeId: string;
  stackId: string;
  routeId: RouteId;
  history: RouteStep[];
};
export type YutRoll = { rollId: string; outcome: Outcome; steps: number; disposition?: "immediate" | "banked" };
export type YutThrow = YutRoll & {
  matchId: string;
  turnId: number;
  playerId: string;
  faces: [boolean, boolean, boolean, boolean];
  startedAt: number;
  durationMs: number;
  visualSeed: number;
};
export type LegalMove = {
  rollId: string;
  pieceId: string;
  pieceIds: string[];
  pathId: string;
  path: string[];
  destination: string;
  capturedPieceIds: string[];
  completedPieceIds: string[];
  stackedPieceIds: string[];
};
export type MoveChoice = Pick<LegalMove, "rollId" | "pieceId" | "pathId">;
export type YutMove = LegalMove & { matchId: string; turnId: number; playerId: string; startedAt?: number };
export type MoveSequence = { sequenceId: string; startedAt: number; durationMs: number; moves: YutMove[] };
export type YutnoriStage = {
  matchId: string;
  rules: { backDo: boolean; finish: "pass-exit" };
  teams: Array<{ teamId: TeamId; playerIds: string[]; finishedCount: number }>;
  pieces: YutPiece[];
  currentPlayerId: string;
  turn: {
    turnId: number;
    teamId: TeamId;
    controllerPlayerId: string;
    throwsRemaining: number;
    /** Required capture throws are a subset of throwsRemaining. */
    mandatoryThrows?: number;
    /** Opponent handoffs only; capture-created turns do not rotate controllers. */
    normalTurnIndex?: number;
    pending: YutRoll[];
  };
  lastThrow?: YutThrow;
  lastMove?: YutMove;
  lastMoveSequence?: MoveSequence;
  winnerTeamId?: TeamId;
  winnerPlayerIds?: string[];
  winnerPlayerId?: string;
};
export type YutnoriPublicView = YutnoriStage & { legalMoves: LegalMove[]; serverNow: number };
export type YutSuggestion = {
  matchId: string;
  turnId: number;
  rollId: string;
  pieceId: string;
  pathId: string;
  playerId: string;
};
export const OUTCOME_LABELS: Record<Outcome, string> = {
  backDo: "빽도", do: "도", gae: "개", geol: "걸", yut: "윷", mo: "모"
};
