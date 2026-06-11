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
  ValidationResult
} from "@bighouse/game-sdk/server";
import { createGameEventId, defineGameDefinition } from "@bighouse/game-sdk/server";
import { baseGameMetadata } from "./metadata";

type Stone = "black" | "white";
type Cell = Stone | null;

type GomokuStageState = {
  boardSize: number;
  board: Cell[][];
  currentPlayerId?: string;
  turnDeadline?: number;
  moveCount: number;
  lastMove?: {
    playerId: string;
    x: number;
    y: number;
    stone: Stone;
  };
  winnerPlayerId?: string;
};

const boardSize = 15;
const turnMs = 30_000;

export const gameMetadata = baseGameMetadata;

export const gomokuDefinition = defineGameDefinition(gameMetadata, {
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
    const stone = stoneForPlayer(context.state.playerStates[action.playerId]);
    if (createsDoubleThree(stage.board, x, y, stone)) {
      return { ok: false, code: "invalid_action", message: "Move violates double-three rule" };
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
    stage.lastMove = { playerId: action.playerId, x, y, stone };
    const winnerPlayerId = hasFive(stage.board, x, y, stone) ? action.playerId : undefined;
    if (winnerPlayerId) {
      stage.winnerPlayerId = winnerPlayerId;
      delete stage.turnDeadline;
      state.phase = "finished";
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
        id: createGameEventId(),
        type: "gomoku.stonePlaced",
        visibility: "public",
        payload: { playerId: action.playerId, x, y, stone },
        createdAt: context.now
      }
    ];
    if (winnerPlayerId) {
      events.push({
        id: createGameEventId(),
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
      winnerPlayerId: stage.winnerPlayerId,
      lastMove: stage.lastMove
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
  },

  selectBotAction(context: BotGameContext): GameAction | null {
    return selectGomokuBotAction(context);
  }
});

export const gomokuGamePlugin = {
  gameMetadata,
  gameDefinition: gomokuDefinition
} satisfies ServerGamePlugin;

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

function selectGomokuBotAction(context: BotGameContext): GameAction | null {
  const stage = gomokuStage(context.state.stageState);
  const currentPlayerId = stage.currentPlayerId ?? context.state.players[0]?.playerId;
  if (context.state.phase !== "active" || stage.winnerPlayerId || currentPlayerId !== context.player.playerId) {
    return null;
  }

  const stone = stoneForPlayer(context.state.playerStates[context.player.playerId]);
  const opponentStone = stone === "black" ? "white" : "black";
  const candidates = legalCandidates(stage, stone, context.difficulty);
  if (candidates.length === 0) {
    return null;
  }

  const seed = `${context.state.room.roomId}:${context.state.version}:${context.player.playerId}`;
  const difficulty = context.difficulty;
  if (difficulty === "low") {
    const center = (stage.boardSize - 1) / 2;
    const ranked = candidates
      .map((candidate) => ({
        ...candidate,
        score: -Math.abs(candidate.x - center) - Math.abs(candidate.y - center) + stableNoise(seed, candidate.x, candidate.y)
      }))
      .sort((a, b) => b.score - a.score);
    const selected = ranked[0]!;
    return { type: "placeStone", payload: { x: selected.x, y: selected.y } };
  }

  const defensiveWinBlock = bestThreatMove(stage, candidates, opponentStone, 100_000, seed);
  if (defensiveWinBlock) {
    return { type: "placeStone", payload: defensiveWinBlock };
  }

  const winningMove = bestThreatMove(stage, candidates, stone, 100_000, seed);
  if (winningMove) {
    return { type: "placeStone", payload: winningMove };
  }

  if (difficulty === "high") {
    const defensiveFourBlock = bestThreatMove(stage, candidates, opponentStone, 10_000, seed);
    if (defensiveFourBlock) {
      return { type: "placeStone", payload: defensiveFourBlock };
    }
  }

  const selected = candidates
    .map((candidate) => {
      const ownScore = movePotential(stage.board, candidate.x, candidate.y, stone);
      const defenseScore = movePotential(stage.board, candidate.x, candidate.y, opponentStone);
      const centerBias = centerScore(stage.boardSize, candidate.x, candidate.y);
      const difficultyWeight = difficulty === "high" ? 0.9 : 0.6;
      return {
        ...candidate,
        score: ownScore + defenseScore * difficultyWeight + centerBias + stableNoise(seed, candidate.x, candidate.y)
      };
    })
    .sort((a, b) => b.score - a.score)[0]!;

  return { type: "placeStone", payload: { x: selected.x, y: selected.y } };
}

function legalCandidates(stage: GomokuStageState, stone: Stone, difficulty: "low" | "medium" | "high"): Array<{ x: number; y: number }> {
  const occupied: Array<{ x: number; y: number }> = [];
  for (let y = 0; y < stage.boardSize; y += 1) {
    for (let x = 0; x < stage.boardSize; x += 1) {
      if (stage.board[y]?.[x] !== null) {
        occupied.push({ x, y });
      }
    }
  }

  const candidateKeys = new Set<string>();
  const radius = difficulty === "high" ? 2 : 1;
  if (occupied.length === 0) {
    const center = Math.floor(stage.boardSize / 2);
    candidateKeys.add(`${center},${center}`);
  } else if (difficulty === "low") {
    for (let y = 0; y < stage.boardSize; y += 1) {
      for (let x = 0; x < stage.boardSize; x += 1) {
        candidateKeys.add(`${x},${y}`);
      }
    }
  } else {
    for (const stoneCell of occupied) {
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          const x = stoneCell.x + dx;
          const y = stoneCell.y + dy;
          if (x >= 0 && y >= 0 && x < stage.boardSize && y < stage.boardSize) {
            candidateKeys.add(`${x},${y}`);
          }
        }
      }
    }
  }

  const candidates: Array<{ x: number; y: number }> = [];
  for (const key of candidateKeys) {
    const [x, y] = key.split(",").map(Number);
    if (
      Number.isInteger(x) &&
      Number.isInteger(y) &&
      stage.board[y!]?.[x!] === null &&
      !createsDoubleThree(stage.board, x!, y!, stone)
    ) {
      candidates.push({ x: x!, y: y! });
    }
  }
  return candidates;
}

function bestThreatMove(
  stage: GomokuStageState,
  candidates: Array<{ x: number; y: number }>,
  stone: Stone,
  threshold: number,
  seed: string
): { x: number; y: number } | null {
  const ranked = candidates
    .map((candidate) => ({
      ...candidate,
      score: movePotential(stage.board, candidate.x, candidate.y, stone) + stableNoise(seed, candidate.x, candidate.y)
    }))
    .filter((candidate) => candidate.score >= threshold)
    .sort((a, b) => b.score - a.score);
  return ranked[0] ? { x: ranked[0].x, y: ranked[0].y } : null;
}

function movePotential(board: Cell[][], x: number, y: number, stone: Stone): number {
  const nextBoard = board.map((row) => [...row]);
  nextBoard[y]![x] = stone;
  let score = 0;
  for (const [dx, dy] of [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ] as const) {
    const contiguous = countLine(nextBoard, x, y, stone, dx, dy);
    const openEnds = openEndCount(nextBoard, x, y, stone, dx, dy);
    if (contiguous >= 5) score += 100_000;
    else if (contiguous === 4 && openEnds > 0) score += 10_000 + openEnds * 1_000;
    else if (contiguous === 3 && openEnds === 2) score += 1_200;
    else if (contiguous === 3) score += 350;
    else if (contiguous === 2 && openEnds === 2) score += 100;
    else if (contiguous === 2) score += 30;
    else score += openEnds * 3;
  }
  return score;
}

function openEndCount(board: Cell[][], x: number, y: number, stone: Stone, dx: number, dy: number): number {
  return openEnd(board, x, y, stone, dx, dy) + openEnd(board, x, y, stone, -dx, -dy);
}

function openEnd(board: Cell[][], x: number, y: number, stone: Stone, dx: number, dy: number): number {
  let cx = x + dx;
  let cy = y + dy;
  while (board[cy]?.[cx] === stone) {
    cx += dx;
    cy += dy;
  }
  return board[cy]?.[cx] === null ? 1 : 0;
}

function centerScore(boardSize: number, x: number, y: number): number {
  const center = (boardSize - 1) / 2;
  return Math.max(0, boardSize - Math.abs(x - center) - Math.abs(y - center));
}

function stableNoise(seed: string, x: number, y: number): number {
  let hash = 2166136261;
  const input = `${seed}:${x}:${y}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}

function hasFive(board: Cell[][], x: number, y: number, stone: Stone): boolean {
  return (
    countLine(board, x, y, stone, 1, 0) >= 5 ||
    countLine(board, x, y, stone, 0, 1) >= 5 ||
    countLine(board, x, y, stone, 1, 1) >= 5 ||
    countLine(board, x, y, stone, 1, -1) >= 5
  );
}

function createsDoubleThree(board: Cell[][], x: number, y: number, stone: Stone): boolean {
  const nextBoard = board.map((row) => [...row]);
  nextBoard[y]![x] = stone;
  const openThreeCount = [
    [1, 0],
    [0, 1],
    [1, 1],
    [1, -1]
  ].filter(([dx, dy]) => isOpenThree(nextBoard, x, y, stone, dx!, dy!)).length;
  return openThreeCount >= 2;
}

function isOpenThree(board: Cell[][], x: number, y: number, stone: Stone, dx: number, dy: number): boolean {
  const line = collectLine(board, x, y, dx, dy);
  const center = line.findIndex((cell) => cell.x === x && cell.y === y);
  if (center < 0) {
    return false;
  }

  for (let start = 0; start <= line.length - 5; start += 1) {
    const end = start + 4;
    if (center < start || center > end) {
      continue;
    }
    const window = line.slice(start, start + 5);
    const values = window.map((cell) => cell.value);
    const stones = values.filter((value) => value === stone).length;
    const empties = values.filter((value) => value === null).length;
    if (stones === 3 && empties === 2 && values[0] === null && values[4] === null) {
      const extendedStones = countLine(board, x, y, stone, dx, dy);
      if (extendedStones === 3) {
        return true;
      }
    }
  }
  return false;
}

function collectLine(board: Cell[][], x: number, y: number, dx: number, dy: number): Array<{ x: number; y: number; value: Cell }> {
  const cells: Array<{ x: number; y: number; value: Cell }> = [];
  let sx = x;
  let sy = y;
  while (board[sy - dy]?.[sx - dx] !== undefined) {
    sx -= dx;
    sy -= dy;
  }
  let cx = sx;
  let cy = sy;
  while (board[cy]?.[cx] !== undefined) {
    cells.push({ x: cx, y: cy, value: board[cy]![cx]! });
    cx += dx;
    cy += dy;
  }
  return cells;
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
