import type {
  BotDifficulty,
  GameMetadata,
  GameEvent,
  GameTeam,
  JsonObject,
  PlayerSeat,
  RoomInterruption,
  RoomPhase
} from "./server";

export type {
  BotDifficulty,
  GameMetadata,
  GameEvent,
  GameTeam,
  GameThumbnail,
  JsonObject,
  PlayerSeat,
  RoomInterruption,
  RoomPhase
} from "./server";

export type GameClientAction = {
  type: string;
  payload: JsonObject;
};

export type GameClientRoom = {
  roomId: string;
  gameId: string;
  mode: string;
  minPlayers: number;
  maxPlayers: number;
  supportsBots?: boolean;
  teams?: GameTeam[];
  hostPlayerId?: string;
  players: PlayerSeat[];
  activeInterruption?: RoomInterruption;
  inviteUrl?: string;
};

export type GameClientChatMessage = {
  id?: string;
  scope: "lobby" | "room";
  scopeId?: string;
  visibility: "public" | "private" | "team";
  teamId?: string;
  playerId: string;
  displayName?: string;
  targetPlayerId?: string;
  body: string;
  createdAt: number;
};

/**
 * The complete render state delivered to a package-owned browser game.
 *
 * `uiRevision` changes for UI-only updates such as chat and presence even when
 * the authoritative room `version` does not. Games should use `version` to
 * gate board animations and `uiRevision` to refresh shared UI.
 */
export type GameClientSnapshot = {
  playerId: string;
  version: number;
  uiRevision: number;
  serverTime: number;
  phase: RoomPhase;
  room: GameClientRoom;
  publicView: JsonObject;
  privateView: JsonObject;
  rematchRequests: string[];
  chatMessages: GameClientChatMessage[];
  /** Bounded recent events; consumers deduplicate by event.id. */
  events?: GameEvent[];
  actionError?: { revision: number; message: string };
  connected?: boolean;
};

/** Stable command callbacks retained for the lifetime of a mounted client. */
export type GameClientActions = {
  sendAction(action: GameClientAction): void;
  sendSignal?(signal: GameClientAction): void;
  setReady(ready: boolean): void;
  startGame(): void;
  restartGame(): void;
  addBot(difficulty: BotDifficulty, displayName?: string): void;
  addBots?(difficulty: BotDifficulty, count: number, displayName?: string): void;
  removeBot(botPlayerId: string): void;
  transferHost(targetPlayerId: string): void;
  sendChat(body: string, targetPlayerId?: string): void;
  sendTeamChat?(body: string): void;
  shareRoom(): void;
  leaveRoom(): void;
  requestPlayAgain(): void;
  leaveFinishedGame(): void;
};

export type GameClientContext = GameClientSnapshot & GameClientActions;

export type MountedGameClient = {
  update(context: GameClientSnapshot): void;
  destroy(): void;
};

export type GameClientModule = {
  gameMetadata: GameMetadata;
  mountGame(container: HTMLElement, context: GameClientContext): MountedGameClient;
};
