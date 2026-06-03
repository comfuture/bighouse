import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "chess",
  adapterKey: "chess",
  displayName: "Chess",
  description: "Classic two-player chess with authoritative legal moves, checkmate, stalemate, and draw detection.",
  minPlayers: 2,
  maxPlayers: 2
} satisfies GameMetadata;
