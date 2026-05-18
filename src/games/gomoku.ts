import type {
  ActionResult,
  ClientGameAction,
  GameContext,
  GameDefinition,
  GameEvent,
  JsonObject,
  PlayerSeat,
  ValidationResult
} from "../core/game";
import { createId } from "../core/ids";

type Stone = "black" | "white";
type Cell = Stone | null;

type GomokuStageState = {
  boardSize: number;
  board: Cell[][];
  currentPlayerId?: string;
  turnDeadline?: number;
  moveCount: number;
  winnerPlayerId?: string;
};

const boardSize = 15;
const turnMs = 30_000;

export const gomokuDefinition: GameDefinition = {
  gameId: "gomoku",
  adapterKey: "gomoku",
  displayName: "Gomoku",
  minPlayers: 2,
  maxPlayers: 2,

  initialStageState(): JsonObject {
    return {
      boardSize,
      board: Array.from({ length: boardSize }, () => Array<Cell>(boardSize).fill(null)),
      moveCount: 0
    } satisfies GomokuStageState;
  },

  initialPlayerState(player: PlayerSeat): JsonObject {
    return { stone: player.seat === 0 ? "black" : "white" };
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    if (action.type !== "placeStone") {
      return { ok: false, code: "invalid_action", message: "Unsupported gomoku action" };
    }
    const stage = gomokuStage(context.state.stageState);
    if (stage.winnerPlayerId) {
      return { ok: false, code: "invalid_action", message: "Game already has a winner" };
    }
    const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
    if (action.playerId !== currentPlayerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    const { x, y } = positionPayload(action.payload);
    if (!Number.isInteger(x) || !Number.isInteger(y) || x < 0 || y < 0 || x >= stage.boardSize || y >= stage.boardSize) {
      return { ok: false, code: "invalid_action", message: "Move is outside the board" };
    }
    if (stage.board[y]?.[x] !== null) {
      return { ok: false, code: "invalid_action", message: "Cell is already occupied" };
    }
    return { ok: true };
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = gomokuStage(state.stageState);
    const { x, y } = positionPayload(action.payload);
    const stone = stoneForPlayer(state.playerStates[action.playerId]);
    stage.board[y]![x] = stone;
    stage.moveCount += 1;
    const winnerPlayerId = hasFive(stage.board, x, y, stone) ? action.playerId : undefined;
    if (winnerPlayerId) {
      stage.winnerPlayerId = winnerPlayerId;
      state.phase = "closed";
      state.closedAt = context.now;
    } else {
      const next = nextPlayer(state.players, action.playerId);
      if (next) {
        stage.currentPlayerId = next.playerId;
      }
      stage.turnDeadline = context.now + turnMs;
    }
    state.stageState = stage as unknown as JsonObject;

    const events: GameEvent[] = [
      {
        id: createId("evt"),
        type: "gomoku.stonePlaced",
        visibility: "public",
        payload: { playerId: action.playerId, x, y, stone },
        createdAt: context.now
      }
    ];
    if (winnerPlayerId) {
      events.push({
        id: createId("evt"),
        type: "gomoku.gameWon",
        visibility: "system",
        payload: { winnerPlayerId },
        createdAt: context.now
      });
    }
    return { state, events };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = gomokuStage(context.state.stageState);
    return {
      boardSize: stage.boardSize,
      board: stage.board,
      currentPlayerId: stage.currentPlayerId ?? context.state.players[0]?.playerId,
      turnDeadline: stage.turnDeadline,
      moveCount: stage.moveCount,
      winnerPlayerId: stage.winnerPlayerId
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return context.state.playerStates[playerId] ?? {};
  },

  nextTimers(context: GameContext) {
    const stage = gomokuStage(context.state.stageState);
    if (context.state.phase !== "active" || !stage.turnDeadline || stage.winnerPlayerId) {
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
};

function gomokuStage(value: JsonObject): GomokuStageState {
  return value as unknown as GomokuStageState;
}

function positionPayload(payload: JsonObject): { x: number; y: number } {
  return { x: Number(payload.x), y: Number(payload.y) };
}

function stoneForPlayer(state: JsonObject | undefined): Stone {
  return state?.stone === "white" ? "white" : "black";
}

function nextPlayer(players: PlayerSeat[], currentPlayerId: string): PlayerSeat | undefined {
  const currentIndex = players.findIndex((player) => player.playerId === currentPlayerId);
  if (currentIndex < 0 || players.length === 0) {
    return players[0];
  }
  return players[(currentIndex + 1) % players.length];
}

function hasFive(board: Cell[][], x: number, y: number, stone: Stone): boolean {
  return (
    countLine(board, x, y, stone, 1, 0) >= 5 ||
    countLine(board, x, y, stone, 0, 1) >= 5 ||
    countLine(board, x, y, stone, 1, 1) >= 5 ||
    countLine(board, x, y, stone, 1, -1) >= 5
  );
}

function countLine(board: Cell[][], x: number, y: number, stone: Stone, dx: number, dy: number): number {
  return 1 + countDirection(board, x, y, stone, dx, dy) + countDirection(board, x, y, stone, -dx, -dy);
}

function countDirection(board: Cell[][], x: number, y: number, stone: Stone, dx: number, dy: number): number {
  let count = 0;
  let cx = x + dx;
  let cy = y + dy;
  while (board[cy]?.[cx] === stone) {
    count += 1;
    cx += dx;
    cy += dy;
  }
  return count;
}
