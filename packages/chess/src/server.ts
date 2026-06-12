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
type GameResult = "checkmate" | "stalemate" | "draw" | "timeout";
type PromotionPiece = Extract<PieceSymbol, "q" | "r" | "b" | "n">;

export type ChessPieceView = {
  square: Square;
  type: PieceSymbol;
  color: Color;
};

export type ChessStageState = {
  fen: string;
  board: Array<Array<ChessPieceView | null>>;
  currentPlayerId?: string;
  turn: Color;
  clocks: ChessClockState;
  activeClockStartedAt?: number;
  turnDeadline?: number;
  moveCount: number;
  history: string[];
  moveHistory?: ChessMoveRecord[];
  lastMove?: ChessMovePayload;
  winnerPlayerId?: string;
  result?: GameResult;
  drawReason?: string;
  check: boolean;
  checkmate: boolean;
  stalemate: boolean;
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
    const chess = new Chess();
    const stage = buildStage(chess, {
      players: context.players,
      moveCount: 0,
      clocks: initialClocks()
    });
    if (stage.currentPlayerId) {
      startClock(stage, context.now);
    }
    return stage as unknown as JsonObject;
  },

  initialPlayerState(player: PlayerSeat): JsonObject {
    return { color: player.seat === 0 ? "white" : "black" } satisfies ChessPlayerState;
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    if (action.type !== "move") {
      return { ok: false, code: "invalid_action", message: "Unsupported chess action" };
    }
    const stage = chessStage(context.state.stageState);
    if (stage.winnerPlayerId || stage.result) {
      return { ok: false, code: "invalid_action", message: "Game is already finished" };
    }
    const currentPlayerId = stage.currentPlayerId ?? playerIdForTurn(context.state.players, stage.turn);
    if (action.playerId !== currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    if (remainingClockMs(stage, colorName(stage.turn), context.now) <= 0) {
      return { ok: false, code: "invalid_action", message: "Player clock has expired" };
    }
    const playerColor = colorForPlayer(context.state.playerStates[action.playerId]);
    if (playerColor !== colorName(stage.turn)) {
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
    if (piece.color !== stage.turn) {
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
    const chess = chessFromStage(stage);
    const move = chess.move(chessMoveInput(parsed), { strict: true });
    const nextClocks = stopClock(stage, context.now);
    const moveHistory = [...(stage.moveHistory ?? []), moveRecord(move)];
    const nextStage = buildStage(chess, {
      players: state.players,
      moveCount: stage.moveCount + 1,
      history: [...stage.history, move.san],
      moveHistory,
      lastMove: movePayload(action.playerId, move),
      clocks: nextClocks
    });
    const events: GameEvent[] = [
      {
        id: createGameEventId(),
        type: "chess.moveMade",
        visibility: "public",
        payload: nextStage.lastMove ?? {},
        createdAt: context.now
      }
    ];

    if (nextStage.result) {
      delete nextStage.turnDeadline;
      delete nextStage.activeClockStartedAt;
      state.phase = "finished";
      if (nextStage.winnerPlayerId) {
        events.push({
          id: createGameEventId(),
          type: "chess.gameWon",
          visibility: "system",
          payload: { winnerPlayerId: nextStage.winnerPlayerId, reason: nextStage.result },
          createdAt: context.now
        });
      } else {
        events.push({
          id: createGameEventId(),
          type: "chess.gameDrawn",
          visibility: "system",
          payload: { reason: nextStage.drawReason ?? nextStage.result },
          createdAt: context.now
        });
      }
    } else {
      startClock(nextStage, context.now);
    }

    state.stageState = nextStage as unknown as JsonObject;
    return { state, events };
  },

  applyTimer(context: GameContext, timer: TimerIntent): ActionResult {
    if (timer.kind !== "turn_timeout") {
      return { state: context.state, events: [] };
    }
    const state = context.state;
    const stage = chessStage(state.stageState);
    const currentPlayerId = stage.currentPlayerId ?? playerIdForTurn(state.players, stage.turn);
    const timedOutPlayerId = timerPayloadPlayerId(timer.payload) ?? currentPlayerId;
    const timedOutColor = timerPayloadColor(timer.payload) ?? colorName(stage.turn);
    if (
      stage.result ||
      !stage.turnDeadline ||
      context.now < stage.turnDeadline ||
      !currentPlayerId ||
      timedOutPlayerId !== currentPlayerId ||
      timedOutColor !== colorName(stage.turn)
    ) {
      return { state, events: [] };
    }

    const winnerPlayerId = playerIdForTurn(state.players, oppositeColor(stage.turn));
    stage.clocks = { ...normalizedClocks(stage.clocks), [colorName(stage.turn)]: 0 };
    stage.result = "timeout";
    if (winnerPlayerId) {
      stage.winnerPlayerId = winnerPlayerId;
    }
    delete stage.turnDeadline;
    delete stage.activeClockStartedAt;
    state.phase = "finished";
    state.stageState = stage as unknown as JsonObject;

    const events: GameEvent[] = [
      {
        id: createGameEventId(),
        type: "chess.turnTimedOut",
        visibility: "system",
        payload: { playerId: currentPlayerId, ...(winnerPlayerId ? { winnerPlayerId } : {}) },
        createdAt: context.now
      }
    ];
    if (winnerPlayerId) {
      events.push({
        id: createGameEventId(),
        type: "chess.gameWon",
        visibility: "system",
        payload: { winnerPlayerId, reason: "timeout" },
        createdAt: context.now
      });
    }
    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = chessStage(context.state.stageState);
    return {
      fen: stage.fen,
      board: stage.board,
      currentPlayerId: stage.currentPlayerId ?? playerIdForTurn(context.state.players, stage.turn),
      turn: stage.turn,
      clocks: stage.clocks,
      activeClockStartedAt: stage.activeClockStartedAt,
      turnDeadline: stage.turnDeadline,
      moveCount: stage.moveCount,
      history: stage.history,
      lastMove: stage.lastMove,
      winnerPlayerId: stage.winnerPlayerId,
      result: stage.result,
      drawReason: stage.drawReason,
      check: stage.check,
      checkmate: stage.checkmate,
      stalemate: stage.stalemate
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return context.state.playerStates[playerId] ?? {};
  },

  nextTimers(context: GameContext) {
    const stage = chessStage(context.state.stageState);
    if (context.state.phase !== "active" || !stage.turnDeadline || stage.result) {
      return [];
    }
    return [
      {
        id: "turn-timeout",
        kind: "turn_timeout",
        runAt: stage.turnDeadline,
        payload: { playerId: stage.currentPlayerId, color: colorName(stage.turn) }
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
  const currentPlayerId = stage.currentPlayerId ?? playerIdForTurn(context.state.players, stage.turn);
  if (context.state.phase !== "active" || stage.result || currentPlayerId !== context.player.playerId) {
    return null;
  }
  const botColorName = colorForPlayer(context.state.playerStates[context.player.playerId]);
  if (botColorName !== colorName(stage.turn)) {
    return null;
  }

  const chess = chessFromStage(stage);
  const legalMoves = chess.moves({ verbose: true });
  if (legalMoves.length === 0) {
    return null;
  }

  const seed = `${context.state.room.roomId}:${context.state.version}:${context.player.playerId}`;
  const botColor = stage.turn;
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

function buildStage(
  chess: Chess,
  options: {
    players: PlayerSeat[];
    moveCount: number;
    history?: string[];
    moveHistory?: ChessMoveRecord[];
    lastMove?: ChessMovePayload;
    clocks?: ChessClockState;
  }
): ChessStageState {
  const turn = chess.turn();
  const checkmate = chess.isCheckmate();
  const stalemate = chess.isStalemate();
  const draw = chess.isDraw();
  const result: GameResult | undefined = checkmate ? "checkmate" : stalemate ? "stalemate" : draw ? "draw" : undefined;
  const winningColor = checkmate ? oppositeColor(turn) : undefined;
  const currentPlayerId = playerIdForTurn(options.players, turn);
  const winnerPlayerId = winningColor ? playerIdForTurn(options.players, winningColor) : undefined;
  return {
    fen: chess.fen(),
    board: chess.board().map((row) => row.map((piece) => piece ? { square: piece.square, type: piece.type, color: piece.color } : null)),
    ...(currentPlayerId ? { currentPlayerId } : {}),
    turn,
    clocks: normalizedClocks(options.clocks),
    moveCount: options.moveCount,
    history: options.history ?? [],
    moveHistory: options.moveHistory ?? [],
    ...(options.lastMove ? { lastMove: options.lastMove } : {}),
    ...(winnerPlayerId ? { winnerPlayerId } : {}),
    ...(result ? { result } : {}),
    ...(draw && !stalemate ? { drawReason: drawReason(chess) } : {}),
    check: chess.isCheck(),
    checkmate,
    stalemate
  };
}

function chessStage(value: JsonObject): ChessStageState {
  return value as unknown as ChessStageState;
}

function chessFromStage(stage: ChessStageState): Chess {
  if (!stage.moveHistory?.length) {
    return new Chess(stage.fen);
  }
  const chess = new Chess();
  for (const move of stage.moveHistory) {
    chess.move(chessMoveInput(move), { strict: true });
  }
  return chess;
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

function timerPayloadPlayerId(payload: JsonObject | undefined): string | undefined {
  return typeof payload?.playerId === "string" ? payload.playerId : undefined;
}

function timerPayloadColor(payload: JsonObject | undefined): ChessColor | undefined {
  return payload?.color === "white" || payload?.color === "black" ? payload.color : undefined;
}

function initialClocks(): ChessClockState {
  return { white: playerClockMs, black: playerClockMs };
}

function normalizedClocks(clocks: ChessClockState | undefined): ChessClockState {
  const white = clocks?.white;
  const black = clocks?.black;
  return {
    white: Math.max(0, Number.isFinite(white) ? Number(white) : playerClockMs),
    black: Math.max(0, Number.isFinite(black) ? Number(black) : playerClockMs)
  };
}

function startClock(stage: ChessStageState, now: number): void {
  const color = colorName(stage.turn);
  stage.clocks = normalizedClocks(stage.clocks);
  stage.activeClockStartedAt = now;
  stage.turnDeadline = now + stage.clocks[color];
}

function stopClock(stage: ChessStageState, now: number): ChessClockState {
  const color = colorName(stage.turn);
  const clocks = normalizedClocks(stage.clocks);
  if (stage.activeClockStartedAt === undefined) {
    return clocks;
  }
  return {
    ...clocks,
    [color]: Math.max(0, clocks[color] - Math.max(0, now - stage.activeClockStartedAt))
  };
}

function remainingClockMs(stage: ChessStageState, color: ChessColor, now: number): number {
  const clocks = normalizedClocks(stage.clocks);
  if (color !== colorName(stage.turn) || stage.activeClockStartedAt === undefined) {
    return clocks[color];
  }
  return Math.max(0, clocks[color] - Math.max(0, now - stage.activeClockStartedAt));
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
