import type { GameMetadata } from "@bighouse/game-sdk/server";

export const baseGameMetadata = {
  gameId: "tank-battle",
  adapterKey: "tank-battle",
  displayName: "Tank Battle",
  description: "Turn-based artillery combat with destructible terrain, wind, gravity, power charging, and tactical items.",
  minPlayers: 2,
  maxPlayers: 2
} satisfies GameMetadata;
