import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "onecard",
  adapterKey: "onecard",
  displayName: "One Card",
  description: "Korean One Card for 2 to 4 players. Shed your hand first with action cards and stacking attacks.",
  minPlayers: 2,
  maxPlayers: 4,
  category: "card"
} satisfies GameMetadata;
