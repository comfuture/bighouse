import type { GameClientModule, GameMetadata } from "@bighouse/game-sdk/client";
import { gameMetadata as chessMetadata } from "@bighouse/chess/client-metadata";
import { gameMetadata as gomokuMetadata } from "@bighouse/gomoku/client-metadata";
import { gameMetadata as indianPokerMetadata } from "@bighouse/indian-poker/client-metadata";
import { gameMetadata as onecardMetadata } from "@bighouse/onecard/client-metadata";

type ClientGamePlugin = {
  metadata: GameMetadata;
  load(): Promise<GameClientModule>;
};

const clientGamePlugins = {
  [chessMetadata.gameId]: {
    metadata: chessMetadata,
    load: () => import("@bighouse/chess/client")
  },
  [gomokuMetadata.gameId]: {
    metadata: gomokuMetadata,
    load: () => import("@bighouse/gomoku/client")
  },
  [indianPokerMetadata.gameId]: {
    metadata: indianPokerMetadata,
    load: () => import("@bighouse/indian-poker/client")
  },
  [onecardMetadata.gameId]: {
    metadata: onecardMetadata,
    load: () => import("@bighouse/onecard/client")
  }
} satisfies Record<string, ClientGamePlugin>;

export function getClientGameMetadata(gameId: string): GameMetadata | undefined {
  return clientGamePlugins[gameId]?.metadata;
}

export async function loadGameClient(gameId: string): Promise<GameClientModule | undefined> {
  return clientGamePlugins[gameId]?.load();
}
