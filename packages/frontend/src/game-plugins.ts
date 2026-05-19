import type { GameClientModule, GameMetadata } from "@bighouse/game-sdk/client";
import { gameMetadata as gomokuMetadata } from "@bighouse/gomoku/client-metadata";

type ClientGamePlugin = {
  metadata: GameMetadata;
  load(): Promise<GameClientModule>;
};

const clientGamePlugins = {
  [gomokuMetadata.gameId]: {
    metadata: gomokuMetadata,
    load: () => import("@bighouse/gomoku/client")
  }
} satisfies Record<string, ClientGamePlugin>;

export function getClientGameMetadata(gameId: string): GameMetadata | undefined {
  return clientGamePlugins[gameId]?.metadata;
}

export async function loadGameClient(gameId: string): Promise<GameClientModule | undefined> {
  return clientGamePlugins[gameId]?.load();
}
