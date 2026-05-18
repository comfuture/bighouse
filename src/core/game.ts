export type JsonObject = Record<string, unknown>;

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

export type RoomState = {
  room: RoomConfig;
  phase: RoomPhase;
  version: number;
  players: PlayerSeat[];
  stageState: JsonObject;
  playerStates: Record<string, JsonObject>;
  updatedAt: number;
  rematchRequests?: Record<string, number>;
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
  kind: "turn_timeout" | "room_cleanup";
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

export type GameDefinition = {
  gameId: string;
  adapterKey: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
  initialStageState(context: { room: RoomConfig; players: PlayerSeat[]; now: number }): JsonObject;
  initialPlayerState(player: PlayerSeat, context: { room: RoomConfig; now: number }): JsonObject;
  validateAction(context: GameContext, action: ClientGameAction): ValidationResult;
  applyAction(context: GameContext, action: ClientGameAction): ActionResult;
  getPublicView(context: GameContext): JsonObject;
  getPrivateView(context: GameContext, playerId: string): JsonObject;
  nextTimers(context: GameContext): TimerIntent[];
};

export function publicEvents(events: GameEvent[]): GameEvent[] {
  return events.filter((event) => event.visibility === "public" || event.visibility === "system");
}

export function privateEventsFor(events: GameEvent[], playerId: string): GameEvent[] {
  return events.filter((event) => event.visibility === "private" && event.playerId === playerId);
}

export function cloneState(state: RoomState): RoomState {
  return JSON.parse(JSON.stringify(state)) as RoomState;
}
