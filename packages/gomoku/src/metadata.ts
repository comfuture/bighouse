import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "gomoku",
  adapterKey: "gomoku",
  displayName: "Gomoku",
  description: "Classic five-in-a-row strategy for two players on a 15x15 board.",
  minPlayers: 2,
  maxPlayers: 2,
  category: "board"
} satisfies GameMetadata;
