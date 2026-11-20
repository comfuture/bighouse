export type JsonObject = Record<string, unknown>;

export type GameThumbnail = {
  src: string;
  alt: string;
};

/** Shelf a game is listed under in the portal directory. */
export type GameCategory = "board" | "card" | "action";

export type FixedRoomSpec = {
  roomId: string;
  name: string;
  description?: string;
  mode?: string;
};

export type GameMetadata = {
  gameId: string;
  adapterKey: string;
  displayName: string;
  description: string;
  minPlayers: number;
  maxPlayers: number;
  modes?: Array<{ id: string; displayName: string; minPlayers: number; maxPlayers: number }>;
  supportsBots?: boolean;
  /** When true, rooms run as drop-in/drop-out persistent worlds with concurrent actions and D1 profile persistence. */
  persistentWorld?: boolean;
  /** Optional permanent named rooms auto-provisioned for this game that remain open even with 0 players. */
  fixedRooms?: FixedRoomSpec[];
  config?: JsonObject;
  thumbnail?: GameThumbnail;
  /** Portal directory shelf. Games without one are listed under "Other". */
  category?: GameCategory;
};

export type PlayerIdentity = {
  playerId: string;
  displayName?: string;
};

export type GameTeam = {
  teamId: string;
  displayName: string;
  playerIds: string[];
};

export type BotDifficulty = "low" | "medium" | "high";

export type PlayerKind = "human" | "bot";

export type PlayerSeat = PlayerIdentity & {
  seat: number;
  connected: boolean;
  ready: boolean;
  joinedAt: number;
  kind?: PlayerKind;
  botDifficulty?: BotDifficulty;
};

export type RoomConfig = {
  roomId: string;
  roomName?: string;
  fixed?: boolean;
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
  kind: "turn_timeout" | "room_cleanup" | "disconnect_grace" | "bot_turn";
  runAt: number;
  payload?: JsonObject;
};

export type GameContext = {
  state: RoomState;
  now: number;
};

export type BotGameContext = GameContext & {
  player: PlayerSeat;
  difficulty: BotDifficulty;
};

export type ActionResult = {
  state: RoomState;
  events: GameEvent[];
};

export type ValidationResult = { ok: true } | { ok: false; code: string; message: string };

export type GameDefinition = GameMetadata & {
  metadata: GameMetadata;
  initialStageState(context: { room: RoomConfig; players: PlayerSeat[]; now: number }): JsonObject;
  /**
   * Private state for one seat. `stageState` is the stage built by `initialStageState`
   * for this game (or the live stage when a player joins later), so a game that deals
   * from shared randomness can hand each seat its share.
   */
  initialPlayerState(player: PlayerSeat, context: { room: RoomConfig; now: number; stageState?: JsonObject }): JsonObject;
  validateAction(context: GameContext, action: ClientGameAction): ValidationResult;
  applyAction(context: GameContext, action: ClientGameAction): ActionResult;
  /** Server-owned membership used by the room's team chat and signal routing. */
  getTeams?(context: GameContext): GameTeam[];
  /** Validate a transient signal without mutating game state or advancing its version. */
  handleSignal?(context: GameContext, playerId: string, signal: GameAction): {
    recipientPlayerIds: string[];
    type: string;
    payload: JsonObject;
    /** Optional lightweight player state fields persisted with the player (e.g. latest position for persistent worlds). */
    playerStatePatch?: JsonObject;
    /** Optional updated stage state for persistent worlds (e.g. nearest-player mob kinematics). */
    stageState?: JsonObject;
  } | undefined;
  /** Optional persistent-world hooks for drop-in join, drop-out leave, and D1 player profile persistence. */
  onPlayerJoin?(context: GameContext, player: PlayerSeat, persistedProfile?: JsonObject | null): ActionResult;
  onPlayerLeave?(context: GameContext, playerId: string): ActionResult;
  extractPlayerProfile?(context: GameContext, playerId: string): JsonObject | null;
  /** Optional stage/spatial interest filter returning recipient playerIds for a public event (undefined = broadcast all). */
  getBroadcastRecipients?(context: GameContext, event: GameEvent): string[] | undefined;
  applyTimer?(context: GameContext, timer: TimerIntent): ActionResult;
  selectBotAction?(context: BotGameContext): GameAction | null | undefined;
  /**
   * State every player may see. When the view has a string `currentPlayerId`
   * and that player is a bot, the host schedules `selectBotAction` for it;
   * leave the field out while nobody is to move.
   */
  getPublicView(context: GameContext, viewerPlayerId?: string): JsonObject;
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

/** Fisher-Yates shuffle from the platform CSPRNG. Returns a new array; unbiased and unpredictable to clients. */
export function secureShuffle<T>(items: readonly T[]): T[] {
  const shuffled = [...items];
  const random = new Uint32Array(1);
  for (let i = shuffled.length - 1; i > 0; i -= 1) {
    const range = i + 1;
    // Reject the top sliver of the 32-bit range so every index is equally likely.
    const limit = Math.floor(0x1_0000_0000 / range) * range;
    do {
      crypto.getRandomValues(random);
    } while (random[0]! >= limit);
    const j = random[0]! % range;
    [shuffled[i], shuffled[j]] = [shuffled[j]!, shuffled[i]!];
  }
  return shuffled;
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
