import type {
  ActionResult,
  BotGameContext,
  ClientGameAction,
  GameAction,
  GameContext,
  GameEvent,
  JsonObject,
  PlayerSeat,
  RoomState,
  ServerGamePlugin,
  TimerIntent,
  ValidationResult
} from "@bighouse/game-sdk/server";
import { createGameEventId, defineGameDefinition } from "@bighouse/game-sdk/server";
import { baseGameMetadata } from "./metadata";
import {
  BOARD_SIZE,
  emptyBoard,
  hasLegalPlacement,
  isOnBoard,
  linesThrough,
  makesFive,
  otherStone,
  placementProblem,
  type Board,
  type GomokuStatus,
  type Point,
  type Stone
} from "./rules";

type GomokuStageState = {
  board: Board;
  moveCount: number;
  lastMove?: Point & { playerId: string; stone: Stone };
  status: GomokuStatus;
};

/** Time a player has to place a stone before the turn passes to the opponent. */
const TURN_MS = 30_000;
const TURN_TIMER_ID = "turn-timeout";

export const gameMetadata = baseGameMetadata;

/** Convert the flat stage stored before the turn/status refactor. */
export function normalizeLegacyGomokuStage(stageState: JsonObject, room: RoomState): JsonObject {
  if (stageState.status || !Array.isArray(stageState.board)) return stageState;

  const { boardSize: _boardSize, currentPlayerId, turnDeadline, winnerPlayerId, ...rest } = stageState;
  const playerId = typeof currentPlayerId === "string" ? currentPlayerId : room.players[0]?.playerId;
  const savedDeadline = typeof turnDeadline === "number" && Number.isFinite(turnDeadline) ? turnDeadline : null;
  let status: GomokuStatus = { kind: "idle" };
  if (typeof winnerPlayerId === "string" && winnerPlayerId) {
    status = { kind: "won", winnerPlayerId };
  } else if (playerId && (savedDeadline !== null || room.phase === "active")) {
    // A legacy opening had neither a deadline nor an alarm until the first move.
    status = { kind: "playing", playerId, deadline: savedDeadline };
  }
  return { ...rest, status };
}

export const gomokuDefinition = defineGameDefinition(gameMetadata, {
  initialStageState({ players, now }): JsonObject {
    const first = players[0];
    return {
      board: emptyBoard(),
      moveCount: 0,
      status: first ? { kind: "playing", playerId: first.playerId, deadline: now + TURN_MS } : { kind: "idle" }
    } satisfies GomokuStageState as unknown as JsonObject;
  },

  initialPlayerState(player: PlayerSeat): JsonObject {
    return { stone: player.seat === 0 ? "black" : "white" };
  },

  validateAction(context: GameContext, action: ClientGameAction): ValidationResult {
    if (action.type !== "placeStone") {
      return { ok: false, code: "invalid_action", message: "Unsupported gomoku action" };
    }
    const stage = gomokuStage(context.state);
    if (stage.status.kind !== "playing") {
      return { ok: false, code: "invalid_action", message: "Game is not in progress" };
    }
    if (action.playerId !== stage.status.playerId) {
      return { ok: false, code: "invalid_turn", message: "It is not this player's turn" };
    }
    const point = parsePoint(action.payload);
    if (!point) {
      return { ok: false, code: "invalid_action", message: "Move is outside the board" };
    }
    switch (placementProblem(stage.board, point.x, point.y, stoneOf(context.state, action.playerId))) {
      case "outside":
        return { ok: false, code: "invalid_action", message: "Move is outside the board" };
      case "occupied":
        return { ok: false, code: "invalid_action", message: "Cell is already occupied" };
      case "double-three":
        return { ok: false, code: "invalid_action", message: "Move violates double-three rule" };
      case null:
        return { ok: true };
    }
  },

  applyAction(context: GameContext, action: ClientGameAction): ActionResult {
    const state = context.state;
    const stage = gomokuStage(state);
    const point = parsePoint(action.payload);
    if (!point) {
      return { state, events: [] };
    }
    const { x, y } = point;
    const stone = stoneOf(state, action.playerId);
    const won = makesFive(stage.board, x, y, stone);
    stage.board[y]![x] = stone;
    stage.moveCount += 1;
    stage.lastMove = { playerId: action.playerId, x, y, stone };

    const events: GameEvent[] = [
      gameEvent("gomoku.stonePlaced", "public", { playerId: action.playerId, x, y, stone }, context.now)
    ];
    const next = playerAfter(state.players, action.playerId);
    if (won) {
      stage.status = { kind: "won", winnerPlayerId: action.playerId };
      state.phase = "finished";
      events.push(gameEvent("gomoku.gameWon", "system", { winnerPlayerId: action.playerId }, context.now));
    } else if (!next || !hasLegalPlacement(stage.board, stoneOf(state, next.playerId))) {
      // Full board, or the player to move has nowhere legal to play.
      stage.status = { kind: "draw" };
      state.phase = "finished";
      events.push(gameEvent("gomoku.gameDrawn", "system", {}, context.now));
    } else {
      stage.status = { kind: "playing", playerId: next.playerId, deadline: context.now + TURN_MS };
    }
    return { state, events };
  },

  applyTimer(context: GameContext, timer: TimerIntent): ActionResult {
    const state = context.state;
    const stage = gomokuStage(state);
    // Ignore a timer left over from a turn that has already moved on.
    if (timer.id !== TURN_TIMER_ID || stage.status.kind !== "playing" || timer.runAt !== stage.status.deadline) {
      return { state, events: [] };
    }
    const skippedPlayerId = stage.status.playerId;
    const next = playerAfter(state.players, skippedPlayerId);
    stage.status = { kind: "playing", playerId: next?.playerId ?? skippedPlayerId, deadline: context.now + TURN_MS };
    return {
      state,
      events: [gameEvent("gomoku.turnSkipped", "public", { playerId: skippedPlayerId }, context.now)]
    };
  },

  getPublicView(context: GameContext): JsonObject {
    const stage = gomokuStage(context.state);
    return {
      boardSize: BOARD_SIZE,
      board: stage.board,
      moveCount: stage.moveCount,
      status: stage.status,
      // The host reads `currentPlayerId` to schedule bot turns.
      ...(stage.status.kind === "playing" ? { currentPlayerId: stage.status.playerId } : {}),
      ...(stage.lastMove ? { lastMove: stage.lastMove } : {})
    };
  },

  getPrivateView(context: GameContext, playerId: string): JsonObject {
    return context.state.playerStates[playerId] ?? {};
  },

  nextTimers(context: GameContext): TimerIntent[] {
    const { status } = gomokuStage(context.state);
    if (context.state.phase !== "active" || status.kind !== "playing" || status.deadline === null) {
      return [];
    }
    return [{ id: TURN_TIMER_ID, kind: "turn_timeout", runAt: status.deadline, payload: { playerId: status.playerId } }];
  },

  selectBotAction(context: BotGameContext): GameAction | null {
    return selectGomokuBotAction(context);
  }
});

export const gomokuGamePlugin = {
  gameMetadata,
  gameDefinition: gomokuDefinition
} satisfies ServerGamePlugin;

function gomokuStage(state: RoomState): GomokuStageState {
  return state.stageState as unknown as GomokuStageState;
}

function gameEvent(type: string, visibility: GameEvent["visibility"], payload: JsonObject, now: number): GameEvent {
  return { id: createGameEventId(), type, visibility, payload, createdAt: now };
}

/** Accepts only `{ x, y }` with integer board coordinates; anything else is rejected. */
function parsePoint(payload: unknown): Point | null {
  if (typeof payload !== "object" || payload === null) return null;
  const { x, y } = payload as { x?: unknown; y?: unknown };
  if (typeof x !== "number" || typeof y !== "number" || !isOnBoard(x, y)) return null;
  return { x, y };
}

function stoneOf(state: RoomState, playerId: string): Stone {
  return state.playerStates[playerId]?.stone === "white" ? "white" : "black";
}

/** The seat that plays after `playerId`, in seat order. */
function playerAfter(players: PlayerSeat[], playerId: string): PlayerSeat | undefined {
  const index = players.findIndex((player) => player.playerId === playerId);
  return players[(index + 1) % players.length];
}

const WIN_SCORE = 100_000;
const FOUR_SCORE = 10_000;

function selectGomokuBotAction(context: BotGameContext): GameAction | null {
  const stage = gomokuStage(context.state);
  if (
    context.state.phase !== "active" ||
    stage.status.kind !== "playing" ||
    stage.status.playerId !== context.player.playerId
  ) {
    return null;
  }

  const stone = stoneOf(context.state, context.player.playerId);
  const opponentStone = otherStone(stone);
  const difficulty = context.difficulty;
  const candidates = legalCandidates(stage.board, stone, difficulty);
  if (candidates.length === 0) {
    return null;
  }
  const seed = `${context.state.room.roomId}:${context.state.version}:${context.player.playerId}`;
  const place = (point: Point): GameAction => ({ type: "placeStone", payload: { x: point.x, y: point.y } });

  if (difficulty === "low") {
    const center = (BOARD_SIZE - 1) / 2;
    return place(
      best(candidates, (c) => -Math.abs(c.x - center) - Math.abs(c.y - center) + stableNoise(seed, c.x, c.y))
    );
  }

  // Take a win before blocking one: a five ends the game on the spot.
  const winningMove = bestThreatMove(stage.board, candidates, stone, WIN_SCORE, seed);
  if (winningMove) return place(winningMove);

  const winBlock = bestThreatMove(stage.board, candidates, opponentStone, WIN_SCORE, seed);
  if (winBlock) return place(winBlock);

  if (difficulty === "high") {
    const fourBlock = bestThreatMove(stage.board, candidates, opponentStone, FOUR_SCORE, seed);
    if (fourBlock) return place(fourBlock);
  }

  const defenseWeight = difficulty === "high" ? 0.9 : 0.6;
  return place(
    best(
      candidates,
      (c) =>
        movePotential(stage.board, c.x, c.y, stone) +
        movePotential(stage.board, c.x, c.y, opponentStone) * defenseWeight +
        centerScore(c.x, c.y) +
        stableNoise(seed, c.x, c.y)
    )
  );
}

function best(candidates: Point[], score: (candidate: Point) => number): Point {
  let top = candidates[0]!;
  let topScore = score(top);
  for (const candidate of candidates.slice(1)) {
    const candidateScore = score(candidate);
    if (candidateScore > topScore) {
      top = candidate;
      topScore = candidateScore;
    }
  }
  return top;
}

/** Legal cells worth considering: near existing stones, or the whole board for the weakest bot. */
function legalCandidates(board: Board, stone: Stone, difficulty: "low" | "medium" | "high"): Point[] {
  const radius = difficulty === "high" ? 2 : 1;
  const considered = new Set<number>();
  let hasStones = false;
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (board[y]?.[x] === null) continue;
      hasStones = true;
      for (let dy = -radius; dy <= radius; dy += 1) {
        for (let dx = -radius; dx <= radius; dx += 1) {
          if (isOnBoard(x + dx, y + dy)) considered.add((y + dy) * BOARD_SIZE + x + dx);
        }
      }
    }
  }
  if (!hasStones) {
    const center = Math.floor(BOARD_SIZE / 2);
    considered.add(center * BOARD_SIZE + center);
  } else if (difficulty === "low") {
    for (let index = 0; index < BOARD_SIZE * BOARD_SIZE; index += 1) considered.add(index);
  }

  const candidates: Point[] = [];
  for (const index of considered) {
    const point = { x: index % BOARD_SIZE, y: Math.floor(index / BOARD_SIZE) };
    if (placementProblem(board, point.x, point.y, stone) === null) candidates.push(point);
  }
  return candidates;
}

function bestThreatMove(board: Board, candidates: Point[], stone: Stone, threshold: number, seed: string): Point | null {
  const threats = candidates.filter((c) => movePotential(board, c.x, c.y, stone) >= threshold);
  if (threats.length === 0) return null;
  return best(threats, (c) => movePotential(board, c.x, c.y, stone) + stableNoise(seed, c.x, c.y));
}

/** Heuristic value of `stone` occupying (x, y): longer and more open lines score higher. */
function movePotential(board: Board, x: number, y: number, stone: Stone): number {
  let score = 0;
  for (const { length, openEnds } of linesThrough(board, x, y, stone)) {
    if (length >= 5) score += WIN_SCORE;
    else if (length === 4 && openEnds > 0) score += FOUR_SCORE + openEnds * 1_000;
    else if (length === 3 && openEnds === 2) score += 1_200;
    else if (length === 3) score += 350;
    else if (length === 2 && openEnds === 2) score += 100;
    else if (length === 2) score += 30;
    else score += openEnds * 3;
  }
  return score;
}

function centerScore(x: number, y: number): number {
  const center = (BOARD_SIZE - 1) / 2;
  return Math.max(0, BOARD_SIZE - Math.abs(x - center) - Math.abs(y - center));
}

/** Deterministic tie-breaker in [0, 1] so a bot's choice is reproducible for a given room version. */
function stableNoise(seed: string, x: number, y: number): number {
  let hash = 2166136261;
  const input = `${seed}:${x}:${y}`;
  for (let index = 0; index < input.length; index += 1) {
    hash ^= input.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return (hash >>> 0) / 0xffffffff;
}
