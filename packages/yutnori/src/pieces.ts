import type { TeamId } from "./types";

/** The same stacked silhouette is used on the board and by moving/captured sprites. */
export function createPieceMarkup(teamId: TeamId, pieceIds: string[]): string {
  const count = pieceIds.length;
  const layers = Array.from({ length: Math.max(0, Math.min(4, count) - 1) }, (_, index) => `<span class="yut-piece-layer" style="--layer:${Math.min(4, count) - 1 - index}" aria-hidden="true"></span>`).join("");
  const label = count > 1 ? "" : (pieceIds[0] ?? "").replace(/^[AB][-_]?/, "").replace(/[^0-9]/g, "");
  return `${layers}<span class="yut-piece-face">${teamId}<small>${label}</small></span>${count > 1 ? `<span class="yut-stack-count" aria-hidden="true">${count}</span>` : ""}`;
}
