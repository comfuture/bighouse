import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "onecard",
  adapterKey: "onecard",
  displayName: "One Card",
  description: "Standard Korean One Card trump-shedding game with rich animations, action triggers, and stacking attacks.",
  minPlayers: 2,
  maxPlayers: 4
} satisfies GameMetadata;
