/**
 * Gomoku placement rules, shared by the authoritative server and the browser
 * client so both always agree on which cells are playable.
 *
 * Ruleset: five or more in a row wins. A move that forms two open threes at
 * once is forbidden for both colours, unless that move also makes five. An
 * open three here is the straight shape only: exactly three stones in a row
 * with an empty cell on each side.
 */
export type Stone = "black" | "white";
export type Cell = Stone | null;
export type Board = Cell[][];
export type Point = { x: number; y: number };

export const BOARD_SIZE = 15;

const DIRECTIONS = [
  [1, 0],
  [0, 1],
  [1, 1],
  [1, -1]
] as const;

export function emptyBoard(): Board {
  return Array.from({ length: BOARD_SIZE }, () => Array<Cell>(BOARD_SIZE).fill(null));
}

export function otherStone(stone: Stone): Stone {
  return stone === "black" ? "white" : "black";
}

export function isOnBoard(x: number, y: number): boolean {
  return Number.isInteger(x) && Number.isInteger(y) && x >= 0 && y >= 0 && x < BOARD_SIZE && y < BOARD_SIZE;
}

/** A stone considered placed without copying the board. */
type Placement = Point & { stone: Stone };

/** The cell's content, or undefined outside the board. */
function cellAt(board: Board, x: number, y: number, placement?: Placement): Cell | undefined {
  if (placement && placement.x === x && placement.y === y) return placement.stone;
  return board[y]?.[x];
}

function runFrom(board: Board, placement: Placement, dx: number, dy: number): { length: number; end: Cell | undefined } {
  let length = 0;
  let x = placement.x + dx;
  let y = placement.y + dy;
  while (cellAt(board, x, y, placement) === placement.stone) {
    length += 1;
    x += dx;
    y += dy;
  }
  return { length, end: cellAt(board, x, y, placement) };
}

/** Each line through a stone placed at (x, y): its length and how many of its two ends are empty. */
export function linesThrough(board: Board, x: number, y: number, stone: Stone): Array<{ length: number; openEnds: number }> {
  const placement = { x, y, stone };
  return DIRECTIONS.map(([dx, dy]) => {
    const forward = runFrom(board, placement, dx, dy);
    const backward = runFrom(board, placement, -dx, -dy);
    return {
      length: 1 + forward.length + backward.length,
      openEnds: (forward.end === null ? 1 : 0) + (backward.end === null ? 1 : 0)
    };
  });
}

export function makesFive(board: Board, x: number, y: number, stone: Stone): boolean {
  return linesThrough(board, x, y, stone).some((line) => line.length >= 5);
}

export function createsDoubleThree(board: Board, x: number, y: number, stone: Stone): boolean {
  return linesThrough(board, x, y, stone).filter((line) => line.length === 3 && line.openEnds === 2).length >= 2;
}

export type PlacementProblem = "outside" | "occupied" | "double-three";

/** Why `stone` may not be placed at (x, y), or null when the move is legal. */
export function placementProblem(board: Board, x: number, y: number, stone: Stone): PlacementProblem | null {
  if (!isOnBoard(x, y)) return "outside";
  if (board[y]?.[x] !== null) return "occupied";
  if (!makesFive(board, x, y, stone) && createsDoubleThree(board, x, y, stone)) return "double-three";
  return null;
}

export function hasLegalPlacement(board: Board, stone: Stone): boolean {
  for (let y = 0; y < BOARD_SIZE; y += 1) {
    for (let x = 0; x < BOARD_SIZE; x += 1) {
      if (placementProblem(board, x, y, stone) === null) return true;
    }
  }
  return false;
}

/**
 * Where a game stands. Exactly one of these holds at any time, so "whose turn
 * is it", "is it over" and "who won" can never disagree.
 */
export type GomokuStatus =
  | { kind: "idle" }
  | { kind: "playing"; playerId: string; deadline: number | null }
  | { kind: "won"; winnerPlayerId: string }
  | { kind: "draw" };
