import { Chess, type Color, type Move, type PieceSymbol, type Square } from "chess.js";
import type {
  ActionResult,
  ClientGameAction,
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

const turnMs = 60_000;
const promotionPieces = new Set(["q", "r", "b", "n"]);

export const gameMetadata = baseGameMetadata;

export const chessDefinition = defineGameDefinition(gameMetadata, {
  initialStageState(context): JsonObject {
    const chess = new Chess();
    const stage = buildStage(chess, {
      players: context.players,
      moveCount: 0
    });
    if (stage.currentPlayerId) {
      stage.turnDeadline = context.now + turnMs;
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
    const moveHistory = [...(stage.moveHistory ?? []), moveRecord(move)];
    const nextStage = buildStage(chess, {
      players: state.players,
      moveCount: stage.moveCount + 1,
      history: [...stage.history, move.san],
      moveHistory,
      lastMove: movePayload(action.playerId, move)
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
      nextStage.turnDeadline = context.now + turnMs;
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
    if (
      stage.result ||
      !stage.turnDeadline ||
      context.now < stage.turnDeadline ||
      !currentPlayerId ||
      timedOutPlayerId !== currentPlayerId
    ) {
      return { state, events: [] };
    }

    const winnerPlayerId = playerIdForTurn(state.players, oppositeColor(stage.turn));
    stage.result = "timeout";
    if (winnerPlayerId) {
      stage.winnerPlayerId = winnerPlayerId;
    }
    delete stage.turnDeadline;
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
        payload: { playerId: stage.currentPlayerId }
      }
    ];
  }
});

export const chessGamePlugin = {
  gameMetadata,
  gameDefinition: chessDefinition
} satisfies ServerGamePlugin;

function buildStage(
  chess: Chess,
  options: {
    players: PlayerSeat[];
    moveCount: number;
    history?: string[];
    moveHistory?: ChessMoveRecord[];
    lastMove?: ChessMovePayload;
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
