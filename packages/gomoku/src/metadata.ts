import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "gomoku",
  adapterKey: "gomoku",
  displayName: "Gomoku",
  description: "Classic five-in-a-row strategy on a 15x15 board with authoritative multiplayer rules.",
  minPlayers: 2,
  maxPlayers: 2
} satisfies GameMetadata;
