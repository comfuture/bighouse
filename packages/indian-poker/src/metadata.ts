import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "indian-poker",
  adapterKey: "indian-poker",
  displayName: "Indian Poker",
  description:
    "Heads-up Indian Poker. One card goes on your forehead, so you read your opponent's card instead of your own before betting chips.",
  minPlayers: 2,
  maxPlayers: 2
} satisfies GameMetadata;
