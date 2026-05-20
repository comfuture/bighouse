export type JsonObject = Record<string, unknown>;

export type GameThumbnail = {
  src: string;
  alt: string;
};

export type GameMetadata = {
  gameId: string;
  adapterKey: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  config?: JsonObject;
  thumbnail?: GameThumbnail;
};

export type PlayerIdentity = {
  playerId: string;
  displayName?: string;
};

export type PlayerSeat = PlayerIdentity & {
  seat: number;
  connected: boolean;
  ready: boolean;
  joinedAt: number;
};

export type RoomConfig = {
  roomId: string;
  gameId: string;
  mode: string;
  minPlayers: number;
  maxPlayers: number;
  config: JsonObject;
  createdAt: number;
  hostPlayerId?: string;
};

export type RoomPhase = "waiting" | "active" | "finished" | "closed";

export type RoomInterruption = {
  reason: "player_left";
  playerId: string;
  displayName?: string;
  hostPlayerId: string;
  createdAt: number;
};

export type RoomState = {
  room: RoomConfig;
  phase: RoomPhase;
  version: number;
  players: PlayerSeat[];
  stageState: JsonObject;
  playerStates: Record<string, JsonObject>;
  updatedAt: number;
  rematchRequests?: Record<string, number>;
  activeInterruption?: RoomInterruption;
  emptySince?: number;
  closedAt?: number;
};

export type Visibility = "public" | "private" | "system";

export type GameEvent = {
  id: string;
  type: string;
  visibility: Visibility;
  payload: JsonObject;
  playerId?: string;
  createdAt: number;
};

export type GameAction = {
  type: string;
  payload: JsonObject;
};

export type ClientGameAction = GameAction & {
  playerId: string;
  clientActionId: string;
  expectedVersion: number;
};

export type TimerIntent = {
  id: string;
  kind: "turn_timeout" | "room_cleanup" | "disconnect_grace";
  runAt: number;
  payload?: JsonObject;
};

export type GameContext = {
  state: RoomState;
  now: number;
};

export type ActionResult = {
  state: RoomState;
  events: GameEvent[];
};

export type ValidationResult = { ok: true } | { ok: false; code: string; message: string };

export type GameDefinition = GameMetadata & {
  metadata: GameMetadata;
  initialStageState(context: { room: RoomConfig; players: PlayerSeat[]; now: number }): JsonObject;
  initialPlayerState(player: PlayerSeat, context: { room: RoomConfig; now: number }): JsonObject;
  validateAction(context: GameContext, action: ClientGameAction): ValidationResult;
  applyAction(context: GameContext, action: ClientGameAction): ActionResult;
  getPublicView(context: GameContext): JsonObject;
  getPrivateView(context: GameContext, playerId: string): JsonObject;
  nextTimers(context: GameContext): TimerIntent[];
};

export type GameDefinitionImplementation = Omit<GameDefinition, keyof GameMetadata | "metadata">;

export type ServerGamePlugin = {
  gameMetadata: GameMetadata;
  gameDefinition: GameDefinition;
};

export function defineGameDefinition(metadata: GameMetadata, implementation: GameDefinitionImplementation): GameDefinition {
  return {
    ...metadata,
    metadata,
    ...implementation
  };
}

export function publicEvents(events: GameEvent[]): GameEvent[] {
  return events.filter((event) => event.visibility === "public" || event.visibility === "system");
}

export function privateEventsFor(events: GameEvent[], playerId: string): GameEvent[] {
  return events.filter((event) => event.visibility === "private" && event.playerId === playerId);
}

export function cloneState(state: RoomState): RoomState {
  return structuredClone(state);
}

export function createGameEventId(): string {
  return `evt_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
