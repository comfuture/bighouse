import type { GameMetadata, JsonObject, RoomPhase } from "./server";

export type { GameMetadata, GameThumbnail, JsonObject } from "./server";

export type GameClientAction = {
  type: string;
  payload: JsonObject;
};

export type GameClientContext = {
  playerId: string;
  version: number;
  phase: RoomPhase;
  publicView: JsonObject;
  privateView: JsonObject;
  rematchRequests: string[];
  sendAction(action: GameClientAction): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

export type MountedGameClient = {
  update(context: Omit<GameClientContext, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">): void;
  destroy(): void;
};

export type GameClientModule = {
  gameMetadata: GameMetadata;
  mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient;
};
