import type { LegalMove, RouteId, RouteStep, YutnoriStage, YutPiece } from "./types";

export type BoardNode = { nodeId: string; x: number; y: number; label: string };
const corners = [[90, 90], [90, 10], [10, 10], [10, 90], [90, 90]] as const;
export const BOARD_NODES: BoardNode[] = Array.from({ length: 20 }, (_, i) => {
  const side = Math.floor(i / 5);
  const start = corners[side]!;
  const end = corners[side + 1]!;
  const t = (i % 5) / 5;
  return { nodeId: `o${i}`, x: start[0] + (end[0] - start[0]) * t, y: start[1] + (end[1] - start[1]) * t, label: i === 0 ? "출발" : String(i) };
});
for (const [prefix, from, to] of [["a", [90, 10], [10, 90]], ["b", [10, 10], [90, 90]]] as const) {
  for (let n = 1; n <= 4; n++) {
    const fraction = (n <= 2 ? n : n + 1) / 6;
    BOARD_NODES.push({ nodeId: `${prefix}${n}`, x: from[0] + (to[0] - from[0]) * fraction, y: from[1] + (to[1] - from[1]) * fraction, label: "" });
  }
}
BOARD_NODES.push({ nodeId: "c", x: 50, y: 50, label: "중앙" });
const DIAGONAL_A = ["o5", "a1", "a2", "c", "a3", "a4", "o15"];
const DIAGONAL_B = ["o10", "b1", "b2", "c", "b3", "b4", "o0"];
export const BOARD_EDGES: Array<[string, string]> = [
  ...Array.from({ length: 20 }, (_, i): [string, string] => [`o${i}`, `o${(i + 1) % 20}`]),
  ...[DIAGONAL_A, DIAGONAL_B].flatMap((route) => route.slice(1).map((node, i): [string, string] => [route[i]!, node]))
];

export type PiecePath = { pathId: string; path: string[]; destination: string; routeId: RouteId; history: RouteStep[] };

/** Branches are chosen only at the start of a move, never while passing a junction. */
export function piecePaths(piece: YutPiece, steps: number): PiecePath[] {
  if (piece.nodeId === "finished" || steps === 0) return [];
  if (steps === -1) {
    const previous = piece.history.at(-1);
    if (piece.nodeId === "reserve" || !previous) return [];
    return [{ pathId: "back", path: [previous.nodeId], destination: previous.nodeId, routeId: previous.routeId, history: piece.history.slice(0, -1) }];
  }
  const choices: RouteId[] = piece.nodeId === "o5" ? ["outer", "diagonalA"]
    : piece.nodeId === "o10" ? ["outer", "diagonalB"]
      : piece.nodeId === "c" ? ["diagonalA", "diagonalB"] : [piece.routeId];
  return choices.map((choice) => {
    let node = piece.nodeId;
    let route = choice;
    const path: string[] = [];
    const history = piece.history.map((step) => ({ ...step }));
    for (let i = 0; i < steps && node !== "finished"; i++) {
      history.push({ nodeId: node, routeId: i === 0 ? piece.routeId : route });
      if (node === "reserve") { node = "o1"; route = "outer"; }
      else if (node === "o0") { node = "finished"; }
      else if (route !== "outer") {
        const diagonal = route === "diagonalA" ? DIAGONAL_A : DIAGONAL_B;
        const index = diagonal.indexOf(node);
        node = diagonal[index + 1]!;
        if (node === diagonal.at(-1)) route = "outer";
      } else {
        node = `o${(Number(node.slice(1)) + 1) % 20}`;
      }
      path.push(node);
    }
    return { pathId: choice, path, destination: node, routeId: route, history };
  });
}

/** Canonical server-only legal-move computation; the browser consumes the published list. */
export function getLegalMoves(stage: YutnoriStage): LegalMove[] {
  if (stage.winnerTeamId) return [];
  const moves: LegalMove[] = [];
  for (const roll of stage.turn.pending) {
    for (const piece of stage.pieces.filter((entry) => entry.teamId === stage.turn.teamId)) {
      const moving = stage.pieces.filter((entry) => entry.stackId === piece.stackId);
      for (const route of piecePaths(piece, roll.steps)) {
        const onBoard = route.destination !== "reserve" && route.destination !== "finished";
        const destinationPieces = onBoard ? stage.pieces.filter((entry) => entry.nodeId === route.destination && !moving.includes(entry)) : [];
        moves.push({
          rollId: roll.rollId, pieceId: piece.pieceId, pieceIds: moving.map((entry) => entry.pieceId),
          pathId: route.pathId, path: route.path, destination: route.destination,
          capturedPieceIds: destinationPieces.filter((entry) => entry.teamId !== piece.teamId).map((entry) => entry.pieceId),
          stackedPieceIds: destinationPieces.filter((entry) => entry.teamId === piece.teamId).map((entry) => entry.pieceId),
          completedPieceIds: route.destination === "finished" ? moving.map((entry) => entry.pieceId) : []
        });
      }
    }
  }
  return moves;
}
