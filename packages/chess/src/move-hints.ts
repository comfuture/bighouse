import { Chess, type Color, type Square } from "chess.js";

export type ChessSquare = `${"a" | "b" | "c" | "d" | "e" | "f" | "g" | "h"}${"1" | "2" | "3" | "4" | "5" | "6" | "7" | "8"}`;

export type MoveDestinationHints = {
  legal: Set<ChessSquare>;
  unsafe: Set<ChessSquare>;
};

const files = ["a", "b", "c", "d", "e", "f", "g", "h"] as const;
const knightOffsets = [
  [1, 2],
  [2, 1],
  [2, -1],
  [1, -2],
  [-1, -2],
  [-2, -1],
  [-2, 1],
  [-1, 2]
] as const;
const bishopOffsets = [
  [1, 1],
  [1, -1],
  [-1, 1],
  [-1, -1]
] as const;
const rookOffsets = [
  [1, 0],
  [-1, 0],
  [0, 1],
  [0, -1]
] as const;
const kingOffsets = [...bishopOffsets, ...rookOffsets] as const;

export function moveDestinationHints(fen: string, square: ChessSquare): MoveDestinationHints {
  try {
    const chess = new Chess(fen);
    const legal = new Set(chess.moves({ square: square as Square, verbose: true }).map((move) => move.to as ChessSquare));
    const pseudoLegal = pseudoLegalDestinations(chess, fen, square);
    return {
      legal,
      unsafe: new Set([...pseudoLegal].filter((destination) => !legal.has(destination)))
    };
  } catch {
    return { legal: new Set(), unsafe: new Set() };
  }
}

function pseudoLegalDestinations(chess: Chess, fen: string, square: ChessSquare): Set<ChessSquare> {
  const piece = chess.get(square as Square);
  if (!piece || piece.color !== chess.turn()) {
    return new Set();
  }
  if (piece.type === "p") {
    return pawnDestinations(chess, fen, square, piece.color);
  }
  if (piece.type === "n") {
    return stepDestinations(chess, square, piece.color, knightOffsets);
  }
  if (piece.type === "b") {
    return slideDestinations(chess, square, piece.color, bishopOffsets);
  }
  if (piece.type === "r") {
    return slideDestinations(chess, square, piece.color, rookOffsets);
  }
  if (piece.type === "q") {
    return slideDestinations(chess, square, piece.color, kingOffsets);
  }
  return stepDestinations(chess, square, piece.color, kingOffsets);
}

function pawnDestinations(chess: Chess, fen: string, square: ChessSquare, color: Color): Set<ChessSquare> {
  const destinations = new Set<ChessSquare>();
  const direction = color === "w" ? 1 : -1;
  const startRank = color === "w" ? "2" : "7";
  const oneForward = offsetSquare(square, 0, direction);
  if (oneForward && !chess.get(oneForward as Square)) {
    destinations.add(oneForward);
    const twoForward = offsetSquare(square, 0, direction * 2);
    if (square[1] === startRank && twoForward && !chess.get(twoForward as Square)) {
      destinations.add(twoForward);
    }
  }

  const enPassant = enPassantSquare(fen);
  for (const fileOffset of [-1, 1]) {
    const capture = offsetSquare(square, fileOffset, direction);
    if (!capture) continue;
    const target = chess.get(capture as Square);
    if ((target && target.color !== color) || capture === enPassant) {
      destinations.add(capture);
    }
  }
  return destinations;
}

function stepDestinations(
  chess: Chess,
  square: ChessSquare,
  color: Color,
  offsets: ReadonlyArray<readonly [number, number]>
): Set<ChessSquare> {
  const destinations = new Set<ChessSquare>();
  for (const [fileOffset, rankOffset] of offsets) {
    const target = offsetSquare(square, fileOffset, rankOffset);
    if (!target) continue;
    const piece = chess.get(target as Square);
    if (!piece || piece.color !== color) {
      destinations.add(target);
    }
  }
  return destinations;
}

function slideDestinations(
  chess: Chess,
  square: ChessSquare,
  color: Color,
  offsets: ReadonlyArray<readonly [number, number]>
): Set<ChessSquare> {
  const destinations = new Set<ChessSquare>();
  for (const [fileOffset, rankOffset] of offsets) {
    let current: ChessSquare | undefined = square;
    while (true) {
      current = offsetSquare(current, fileOffset, rankOffset);
      if (!current) break;
      const piece = chess.get(current as Square);
      if (!piece) {
        destinations.add(current);
        continue;
      }
      if (piece.color !== color) {
        destinations.add(current);
      }
      break;
    }
  }
  return destinations;
}

function offsetSquare(square: ChessSquare, fileOffset: number, rankOffset: number): ChessSquare | undefined {
  const fileIndex = files.indexOf(square[0] as (typeof files)[number]);
  const rankIndex = Number(square[1]) - 1;
  const nextFile = fileIndex + fileOffset;
  const nextRank = rankIndex + rankOffset;
  if (nextFile < 0 || nextFile >= files.length || nextRank < 0 || nextRank >= 8) {
    return undefined;
  }
  return `${files[nextFile]}${nextRank + 1}` as ChessSquare;
}

function enPassantSquare(fen: string): ChessSquare | undefined {
  const square = fen.split(" ")[3];
  return isChessSquare(square) ? square : undefined;
}

function isChessSquare(value: unknown): value is ChessSquare {
  return typeof value === "string" && /^[a-h][1-8]$/u.test(value);
}
