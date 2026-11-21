import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type {
  ActionResult,
  BotGameContext,
  ClientGameAction,
  GameAction,
  GameContext,
  GameEvent,
  JsonObject,
  PlayerSeat,
  ServerGamePlugin,
  TimerIntent,
  ValidationResult
} from "@bighouse/game-sdk/server";
import { createGameEventId, defineGameDefinition } from "@bighouse/game-sdk/server";
import { baseGameMetadata } from "./metadata";

type ChessColor = "white" | "black";
type PromotionPiece = Extract<PieceSymbol, "q" | "r" | "b" | "n">;

export type ChessPieceView = {
  square: Square;
  type: PieceSymbol;
  color: Color;
};

/** How a finished game ended. A game in progress has no outcome. */
export type ChessOutcome =
  | { kind: "checkmate"; winnerPlayerId: string | undefined }
  | { kind: "timeout"; winnerPlayerId: string | undefined }
  | { kind: "stalemate" }
  | { kind: "draw"; reason: string };

/**
 * Only what cannot be derived is stored. The board, side to move, check,
 * current player, move count and turn deadline all follow from these fields.
 */
export type ChessStageState = {
  /** Current position. */
  fen: string;
  /** Moves from the replay base, replayed so repetition draws are detected. */
  moveHistory: ChessMoveRecord[];
  /** A verified position for histories that cannot be replayed from the standard start. */
  replayBaseFen?: string;
  /** Legacy moves whose notation and coordinates were not stored. */
  unrecordedMoveCount?: number;
  /** The same moves in SAN, for display. */
  history: string[];
  lastMove?: ChessMovePayload;
  /** Time each side has left, not counting the turn in progress. */
  clocks: ChessClockState;
  /** When the side to move started thinking, or null while no clock runs. */
  clockStartedAt: number | null;
  outcome: ChessOutcome | null;
};

export type ChessPlayerState = {
  color: ChessColor;
};

export type ChessClockState = Record<ChessColor, number>;

export type ChessMovePayload = {
  playerId: string;
  from: Square;
  to: Square;
  color: Color;
  piece: PieceSymbol;
  captured?: PieceSymbol;
  promotion?: PieceSymbol;
  san: string;
  lan: string;
  before: string;
  after: string;
};

type ChessMoveRecord = {
  from: Square;
  to: Square;
  promotion?: PromotionPiece;
};

const playerClockMs = 15 * 60 * 1000;
const promotionPieces = new Set(["q", "r", "b", "n"]);

export const gameMetadata = baseGameMetadata;

export const chessDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context): JsonObject {
    return {
      fen: new Chess().fen(),
      moveHistory: [],
      history: [],
      clocks: { white: playerClockMs, black: playerClockMs },
      // White's clock starts once there is a white player to run it against.
      clockStartedAt: context.players[0] ? context.now : null,
      outcome: null
    } satisfies ChessStageState as unknown as JsonObject;
  },

  initialPlayerState(player: PlayerSeat): JsonObject {
    return { color: player.seat === 0 ? "white" : "black" } satisfies ChessPlayerState;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    if (action.type !== "move") {
      return { ok: false, code: "invalid_action", message: "Unsupported chess action" };
    }
    const stage = chessStage(context.state.stageState);
    if (stage.outcome) {
      return { ok: false, code: "invalid_action", message: "Game is already finished" };
    }
    const turn = turnOf(stage);
    if (action.playerId !== playerIdForTurn(context.state.players, turn)) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    if (remainingClockMs(stage, colorName(turn), context.now) <= 0) {
      return { ok: false, code: "invalid_action", message: "Player clock has expired" };
    }
    const playerColor = colorForPlayer(context.state.playerStates[action.playerId]);
    if (playerColor !== colorName(turn)) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's color to move" };
    }
    const parsed = parseMovePayload(action.payload);
    if (!parsed.ok) {
      return parsed;
    }
    const chess = chessFromStage(stage);
    const piece = chess.get(parsed.from);
    if (!piece) {
      return { ok: false, code: "invalid_action", message: "No piece on source square" };
    }
    if (piece.color !== turn) {
      return { ok: false, code: "invalid_action", message: "Source square has the wrong color" };
    }
    if (isPromotionMove(chess, parsed.from, parsed.to) && !parsed.promotion) {
      return { ok: false, code: "invalid_action", message: "promotion is required" };
    }
    try {
      chess.move(chessMoveInput(parsed), { strict: true });
    } catch {
      return { ok: false, code: "invalid_action", message: "Illegal chess move" };
    }
    return { ok: true };
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = chessStage(state.stageState);
    const parsed = parseMovePayload(action.payload);
    if (!parsed.ok) {
      throw new Error("Chess move payload must be validated before applying");
    }
    const mover = colorName(turnOf(stage));
    const replay = replayMoves(stage.moveHistory, stage.fen, stage.replayBaseFen);
    const chess = replay ?? new Chess(stage.fen);
    const replayBaseFen = replay ? stage.replayBaseFen : stage.fen;
    const move = chess.move(chessMoveInput(parsed), { strict: true });
    const lastMove = movePayload(action.playerId, move);
    const outcome = outcomeOfPosition(chess, state.players);

    const nextStage: ChessStageState = {
      fen: chess.fen(),
      moveHistory: [...(replay ? stage.moveHistory : []), moveRecord(move)],
      ...(replayBaseFen ? { replayBaseFen } : {}),
      ...(stage.unrecordedMoveCount ? { unrecordedMoveCount: stage.unrecordedMoveCount } : {}),
      history: [...stage.history, move.san],
      lastMove,
      // The mover pays for the time they used; the opponent's clock starts now unless the game is over.
      clocks: { ...stage.clocks, [mover]: remainingClockMs(stage, mover, context.now) },
      clockStartedAt: outcome ? null : context.now,
      outcome
    };
    state.stageState = nextStage as unknown as JsonObject;

    const events: GameEvent[] = [gameEvent("chess.moveMade", "public", lastMove, context.now)];
    if (outcome) {
      state.phase = "finished";
      events.push(outcomeEvent(outcome, context.now));
    }
    return { state, events };
  },

  applyTimer(context: GameContext, timer: TimerIntent): ActionResult {
    const state = context.state;
    const stage = chessStage(state.stageState);
    const turn = turnOf(stage);
    const deadline = turnDeadlineOf(stage);
    // Ignore anything but the flag falling for the side that is actually to move.
    if (
      timer.kind !== "turn_timeout" ||
      stage.outcome ||
      deadline === null ||
      context.now < deadline ||
      (timer.payload?.color !== undefined && timer.payload.color !== colorName(turn))
    ) {
      return { state, events: [] };
    }

    const timedOutPlayerId = playerIdForTurn(state.players, turn);
    const outcome: ChessOutcome = { kind: "timeout", winnerPlayerId: playerIdForTurn(state.players, oppositeColor(turn)) };
    stage.clocks = { ...stage.clocks, [colorName(turn)]: 0 };
    stage.clockStartedAt = null;
    stage.outcome = outcome;
    state.stageState = stage as unknown as JsonObject;
    state.phase = "finished";

    const events: GameEvent[] = [
      gameEvent(
        "chess.turnTimedOut",
        "system",
        {
          ...(timedOutPlayerId ? { playerId: timedOutPlayerId } : {}),
          ...(outcome.winnerPlayerId ? { winnerPlayerId: outcome.winnerPlayerId } : {})
        },
        context.now
      )
    ];
    if (outcome.winnerPlayerId) {
      events.push(outcomeEvent(outcome, context.now));
    }
    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = chessStage(context.state.stageState);
    const chess = new Chess(stage.fen);
    const turn = chess.turn();
    const deadline = turnDeadlineOf(stage);
    const currentPlayerId = stage.outcome ? undefined : playerIdForTurn(context.state.players, turn);
    return {
      fen: stage.fen,
      board: chess.board().map((row) => row.map((piece) => (piece ? { square: piece.square, type: piece.type, color: piece.color } : null))),
      turn,
      // The host reads `currentPlayerId` to schedule bot turns.
      ...(currentPlayerId ? { currentPlayerId } : {}),
      clocks: stage.clocks,
      ...(stage.clockStartedAt === null ? {} : { activeClockStartedAt: stage.clockStartedAt }),
      ...(deadline === null ? {} : { turnDeadline: deadline }),
      moveCount: Math.max(stage.history.length, stage.moveHistory.length) + (stage.unrecordedMoveCount ?? 0),
      history: stage.history,
      ...(stage.lastMove ? { lastMove: stage.lastMove } : {}),
      check: chess.isCheck(),
      ...publicOutcome(stage.outcome)
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return context.state.playerStates[playerId] ?? {};
  },

  nextTimers(context: GameContext): TimerIntent[] {
    const stage = chessStage(context.state.stageState);
    const deadline = turnDeadlineOf(stage);
    if (context.state.phase !== "active" || stage.outcome || deadline === null) {
      return [];
    }
    const turn = turnOf(stage);
    const playerId = playerIdForTurn(context.state.players, turn);
    return [
      {
        id: "turn-timeout",
        kind: "turn_timeout",
        runAt: deadline,
        payload: { ...(playerId ? { playerId } : {}), color: colorName(turn) }
      }
    ];
  },

  selectBotAction(context: BotGameContext): GameAction | null {
    return selectChessBotAction(context);
  }
});

export const chessGamePlugin = {
  gameMetadata,
  gameDefinition: chessDefinition
} satisfies ServerGamePlugin;

const pieceValues: Record<PieceSymbol, number> = {
  p: 100,
  n: 320,
  b: 330,
  r: 500,
  q: 900,
  k: 0
};

function selectChessBotAction(context: BotGameContext): GameAction | null {
  const stage = chessStage(context.state.stageState);
  const turn = turnOf(stage);
  if (
    context.state.phase !== "active" ||
    stage.outcome ||
    playerIdForTurn(context.state.players, turn) !== context.player.playerId
  ) {
    return null;
  }
  const botColorName = colorForPlayer(context.state.playerStates[context.player.playerId]);
  if (botColorName !== colorName(turn)) {
    return null;
  }

  const chess = chessFromStage(stage);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) {
    return null;
  }

  const seed = `${context.state.room.roomId}:${context.state.version}:${context.player.playerId}`;
  const botColor = turn;
  const selected =
    context.difficulty === "low"
      ? pickLowChessMove(legalMoves, seed)
      : pickScoredChessMove(chess, legalMoves, botColor, context.difficulty === "high" ? 2 : 1, seed);
  if (!selected) {
    return null;
  }
  return {
    type: "move",
    payload: {
      from: selected.from,
      to: selected.to,
      ...(isPromotionPiece(selected.promotion) ? { promotion: selected.promotion } : {})
    }
  };
}

function pickLowChessMove(moves: Move[], seed: string): Move {
  const index = Math.floor(stableChessNoise(seed, "low") * moves.length) % moves.length;
  return moves[index]!;
}

function pickScoredChessMove(chess: Chess, moves: Move[], botColor: Color, depth: number, seed: string): Move | null {
  let bestMove: Move | null = null;
  let bestScore = Number.NEGATIVE_INFINITY;
  for (const move of moves) {
    chess.move(chessMoveInput(verboseMoveRecord(move)), { strict: true });
    const score =
      immediateMoveScore(move) +
      alphaBeta(chess, depth - 1, Number.NEGATIVE_INFINITY, Number.POSITIVE_INFINITY, botColor) +
      stableChessNoise(seed, `${move.from}-${move.to}-${move.promotion ?? ""}`);
    chess.undo();
    if (score > bestScore) {
      bestScore = score;
      bestMove = move;
    }
  }
  return bestMove;
}

function alphaBeta(chess: Chess, depth: number, alphaInput: number, betaInput: number, botColor: Color): number {
  if (depth <= 0 || chess.isGameOver()) {
    return evaluateChess(chess, botColor);
  }
  const moves = chess.moves({ verbose: true });
  if (moves.length === 0) {
    return evaluateChess(chess, botColor);
  }

  let alpha = alphaInput;
  let beta = betaInput;
  if (chess.turn() === botColor) {
    let value = Number.NEGATIVE_INFINITY;
    for (const move of moves) {
      chess.move(chessMoveInput(verboseMoveRecord(move)), { strict: true });
      value = Math.max(value, alphaBeta(chess, depth - 1, alpha, beta, botColor));
      chess.undo();
      alpha = Math.max(alpha, value);
      if (alpha >= beta) break;
    }
    return value;
  }

  let value = Number.POSITIVE_INFINITY;
  for (const move of moves) {
    chess.move(chessMoveInput(verboseMoveRecord(move)), { strict: true });
    value = Math.min(value, alphaBeta(chess, depth - 1, alpha, beta, botColor));
    chess.undo();
    beta = Math.min(beta, value);
    if (alpha >= beta) break;
  }
  return value;
}

function evaluateChess(chess: Chess, botColor: Color): number {
  if (chess.isCheckmate()) {
    return chess.turn() === botColor ? -1_000_000 : 1_000_000;
  }
  if (chess.isDraw()) {
    return 0;
  }

  let score = 0;
  for (const row of chess.board()) {
    for (const piece of row) {
      if (!piece) continue;
      const value = pieceValues[piece.type];
      score += piece.color === botColor ? value : -value;
    }
  }
  const mobility = chess.moves().length;
  score += chess.turn() === botColor ? mobility * 2 : -mobility * 2;
  if (chess.isCheck()) {
    score += chess.turn() === botColor ? -40 : 40;
  }
  return score;
}

function immediateMoveScore(move: Move): number {
  let score = 0;
  if (move.captured) {
    score += 20;
  }
  if (move.san.includes("#")) {
    score += 1_000_000;
  } else if (move.san.includes("+")) {
    score += 80;
  }
  return score;
}

function verboseMoveRecord(move: Move): ChessMoveRecord {
  return {
    from: move.from,
    to: move.to,
    ...(isPromotionPiece(move.promotion) ? { promotion: move.promotion } : {})
  };
}

function stableChessNoise(seed: string, key: string): number {
  let hash = 2166136261;
  const input = `${seed}:${key}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

/** Deserializes pre-#31 flat stages without resetting the position or the running clock. */
export function normalizeLegacyChessStage(stageState: JsonObject): JsonObject {
  if (
    (stageState.clockStartedAt === null || typeof stageState.clockStartedAt === "number") &&
    (stageState.outcome === null || isJsonRecord(stageState.outcome)) &&
    Array.isArray(stageState.moveHistory)
  ) return stageState;

  // Some waiting rooms have no stage yet; this is not an older Chess position.
  if (typeof stageState.fen !== "string") return stageState;
  const position = new Chess(stageState.fen);
  const fen = position.fen();
  const rawClocks = isJsonRecord(stageState.clocks) ? stageState.clocks : undefined;
  const white = finiteNumber(rawClocks?.white) ?? playerClockMs;
  const black = finiteNumber(rawClocks?.black) ?? playerClockMs;
  const clocks = { white: Math.max(0, white), black: Math.max(0, black) };
  const outcome = legacyOutcome(stageState);
  const deadline = finiteNumber(stageState.turnDeadline);
  const clockStartedAt = outcome
    ? null
    : (deadline === undefined
      ? finiteNumber(stageState.activeClockStartedAt) ?? null
      : deadline - clocks[colorName(position.turn())]);

  const history = Array.isArray(stageState.history)
    ? stageState.history.filter((move): move is string => typeof move === "string")
    : [];
  const coordinateMoves = Array.isArray(stageState.moveHistory) ? stageState.moveHistory : [];
  const recovered = replayMoves(coordinateMoves, fen) ?? replayMoves(history, fen);
  const moveHistory = recovered?.history({ verbose: true }).map(moveRecord) ?? [];
  const missingMoves = Math.max(0, (finiteNumber(stageState.moveCount) ?? 0) - Math.max(history.length, moveHistory.length));
  return {
    fen,
    moveHistory,
    ...(!recovered ? { replayBaseFen: fen } : {}),
    ...(missingMoves ? { unrecordedMoveCount: missingMoves } : {}),
    history,
    ...(isJsonRecord(stageState.lastMove) ? { lastMove: stageState.lastMove } : {}),
    clocks,
    clockStartedAt,
    outcome
  } as unknown as JsonObject;
}

function finiteNumber(value: unknown): number | undefined {
  return typeof value === "number" && Number.isFinite(value) ? value : undefined;
}

function legacyOutcome(stage: JsonObject): ChessOutcome | null {
  switch (stage.result) {
    case "checkmate":
    case "timeout":
      return {
        kind: stage.result,
        winnerPlayerId: typeof stage.winnerPlayerId === "string" ? stage.winnerPlayerId : undefined
      };
    case "stalemate":
      return { kind: "stalemate" };
    case "draw":
      return { kind: "draw", reason: typeof stage.drawReason === "string" ? stage.drawReason : "draw" };
    default:
      return null;
  }
}

function chessStage(value: JsonObject): ChessStageState {
  return normalizeLegacyChessStage(value) as unknown as ChessStageState;
}

/** Accept history only if replay reaches the persisted position, not merely if moves are legal. */
function replayMoves(moves: unknown[], fen: string, baseFen?: string): Chess | null {
  try {
    const chess = new Chess(baseFen);
    for (const move of moves) {
      if (typeof move === "string") {
        chess.move(move, { strict: true });
      } else {
        const parsed = parseMovePayload(move);
        if (!parsed.ok) return null;
        chess.move(chessMoveInput(parsed), { strict: true });
      }
    }
    return chess.fen() === fen ? chess : null;
  } catch {
    return null;
  }
}

function chessFromStage(stage: ChessStageState): Chess {
  return replayMoves(stage.moveHistory, stage.fen, stage.replayBaseFen) ?? new Chess(stage.fen);
}

function turnOf(stage: ChessStageState): Color {
  return stage.fen.split(" ")[1] === "b" ? "b" : "w";
}

/** When the side to move runs out of time, or null while no clock is running. */
function turnDeadlineOf(stage: ChessStageState): number | null {
  return stage.clockStartedAt === null ? null : stage.clockStartedAt + stage.clocks[colorName(turnOf(stage))];
}

function remainingClockMs(stage: ChessStageState, color: ChessColor, now: number): number {
  const running = stage.clockStartedAt !== null && color === colorName(turnOf(stage));
  const elapsed = running ? Math.max(0, now - stage.clockStartedAt!) : 0;
  return Math.max(0, stage.clocks[color] - elapsed);
}

function outcomeOfPosition(chess: Chess, players: PlayerSeat[]): ChessOutcome | null {
  if (chess.isCheckmate()) {
    return { kind: "checkmate", winnerPlayerId: playerIdForTurn(players, oppositeColor(chess.turn())) };
  }
  if (chess.isStalemate()) return { kind: "stalemate" };
  if (chess.isDraw()) return { kind: "draw", reason: drawReason(chess) };
  return null;
}

/** The outcome as the flat fields clients read. */
function publicOutcome(outcome: ChessOutcome | null): JsonObject {
  if (!outcome) return {};
  switch (outcome.kind) {
    case "checkmate":
    case "timeout":
      return { result: outcome.kind, ...(outcome.winnerPlayerId ? { winnerPlayerId: outcome.winnerPlayerId } : {}) };
    case "stalemate":
      return { result: "stalemate" };
    case "draw":
      return { result: "draw", drawReason: outcome.reason };
  }
}

function outcomeEvent(outcome: ChessOutcome, now: number): GameEvent {
  if ((outcome.kind === "checkmate" || outcome.kind === "timeout") && outcome.winnerPlayerId) {
    return gameEvent("chess.gameWon", "system", { winnerPlayerId: outcome.winnerPlayerId, reason: outcome.kind }, now);
  }
  return gameEvent("chess.gameDrawn", "system", { reason: outcome.kind === "draw" ? outcome.reason : outcome.kind }, now);
}

function gameEvent(type: string, visibility: GameEvent["visibility"], payload: JsonObject, now: number): GameEvent {
  return { id: createGameEventId(), type, visibility, payload, createdAt: now };
}

function parseMovePayload(payload: unknown):
  | ({ ok: true; from: Square; to: Square; promotion?: PromotionPiece })
  | ({ ok: false; code: string; message: string }) {
  if (!isJsonRecord(payload)) {
    return { ok: false, code: "invalid_action", message: "Payload must be an object" };
  }
  const from = payload.from;
  const to = payload.to;
  const promotion = payload.promotion;
  if (!isSquare(from) || !isSquare(to)) {
    return { ok: false, code: "invalid_action", message: "from and to must be algebraic squares" };
  }
  if (promotion !== undefined && !isPromotionPiece(promotion)) {
    return { ok: false, code: "invalid_action", message: "promotion must be q, r, b, or n" };
  }
  return { ok: true, from, to, ...(promotion ? { promotion } : {}) };
}

function isJsonRecord(value: unknown): value is JsonObject {
  return value !== null && typeof value === "object" && !Array.isArray(value);
}

function isSquare(value: unknown): value is Square {
  return typeof value === "string" && /^[a-h][1-8]$/u.test(value);
}

function isPromotionPiece(value: unknown): value is PromotionPiece {
  return typeof value === "string" && promotionPieces.has(value);
}

function chessMoveInput(move: { from: Square; to: Square; promotion?: PromotionPiece }): { from: string; to: string; promotion?: string } {
  return { from: move.from, to: move.to, ...(move.promotion ? { promotion: move.promotion } : {}) };
}

function isPromotionMove(chess: Chess, from: Square, to: Square): boolean {
  const piece = chess.get(from);
  if (piece?.type !== "p") {
    return false;
  }
  return (piece.color === "w" && to.endsWith("8")) || (piece.color === "b" && to.endsWith("1"));
}

function movePayload(playerId: string, move: Move): ChessMovePayload {
  return {
    playerId,
    from: move.from,
    to: move.to,
    color: move.color,
    piece: move.piece,
    ...(move.captured ? { captured: move.captured } : {}),
    ...(move.promotion ? { promotion: move.promotion } : {}),
    san: move.san,
    lan: move.lan,
    before: move.before,
    after: move.after
  };
}

function moveRecord(move: Move): ChessMoveRecord {
  return {
    from: move.from,
    to: move.to,
    ...(isPromotionPiece(move.promotion) ? { promotion: move.promotion } : {})
  };
}

function colorForPlayer(state: JsonObject | undefined): ChessColor {
  return state?.color === "black" ? "black" : "white";
}

function colorName(color: Color): ChessColor {
  return color === "w" ? "white" : "black";
}

function oppositeColor(color: Color): Color {
  return color === "w" ? "b" : "w";
}

function playerIdForTurn(players: PlayerSeat[], turn: Color): string | undefined {
  return players[turn === "w" ? 0 : 1]?.playerId;
}

function drawReason(chess: Chess): string {
  if (chess.isInsufficientMaterial()) return "insufficient_material";
  if (chess.isThreefoldRepetition()) return "threefold_repetition";
  if (chess.isDrawByFiftyMoves()) return "fifty_moves";
  return "draw";
}
