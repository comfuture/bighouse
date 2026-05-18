import { DurableObject } from "cloudflare:workers";
import { normalizeChatBody, type ChatInput, type ChatMessage } from "../core/chat";
import { GameServerError } from "../core/errors";
import type { ClientGameAction, GameEvent, JsonObject, PlayerSeat, RoomState, TimerIntent } from "../core/game";
import { cloneState, privateEventsFor, publicEvents } from "../core/game";
import { createId, roomDoName } from "../core/ids";
import {
  decodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage,
  type SnapshotPayload
} from "../core/protocol";
import { getGameDefinition } from "../games/registry";
import { D1Repository } from "../storage/d1";
import type { Env } from "../types";

export type InitializeRoomInput = {
  roomId: string;
  gameId: string;
  mode: string;
  minPlayers: number;
  maxPlayers: number;
  config?: JsonObject;
};

export type JoinRoomInput = {
  playerId: string;
  displayName?: string;
};

export type RoomSummary = {
  roomId: string;
  gameId: string;
  mode: string;
  phase: RoomState["phase"];
  version: number;
  playerCount: number;
  readyCount: number;
  minPlayers: number;
  maxPlayers: number;
  hostPlayerId?: string;
};

export type ActionAck = {
  version: number;
  events: GameEvent[];
};

export type ActionResultEnvelope =
  | { ok: true; ack: ActionAck }
  | { ok: false; error: { code: string; message: string; status: number; details?: unknown } };

export type RoomCommandResultEnvelope =
  | { ok: true; summary: RoomSummary }
  | { ok: false; error: { code: string; message: string; status: number; details?: unknown } };

export type CleanupStaleRoomInput = {
  now?: number;
  waitingIdleMs?: number;
  activeIdleMs?: number;
};

export type CleanupStaleRoomResult = {
  cleaned: boolean;
  reason: "missing_state" | "already_closed" | "connected_clients" | "not_idle" | "stale_no_connections";
  summary?: RoomSummary;
};

type RoomStateRow = {
  id: number;
  state_json: string;
};

type ProcessedActionRow = {
  ack_json: string;
};

type TimerRow = {
  id: string;
  kind: TimerIntent["kind"];
  run_at: number;
  payload_json: string | null;
};

type SocketAttachment = {
  playerId?: string;
  displayName?: string;
};

export class RoomDO extends DurableObject<Env> {
  private readonly disconnectTimers = new Map<string, ReturnType<typeof setTimeout>>();

  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => {
      this.migrate();
      this.ctx.setWebSocketAutoResponse(new WebSocketRequestResponsePair("ping", "pong"));
    });
  }

  async initialize(input: InitializeRoomInput): Promise<RoomSummary> {
    const existing = this.loadState();
    if (existing) {
      return this.toSummary(existing);
    }

    const now = Date.now();
    const room = {
      roomId: input.roomId,
      gameId: input.gameId,
      mode: input.mode,
      minPlayers: input.minPlayers,
      maxPlayers: input.maxPlayers,
      config: input.config ?? {},
      createdAt: now
    };
    const definition = getGameDefinition(input.gameId);
    const state: RoomState = {
      room,
      phase: "waiting",
      version: 0,
      players: [],
      stageState: definition.initialStageState({ room, players: [], now }),
      playerStates: {},
      updatedAt: now
    };

    this.saveState(state);
    await this.rescheduleTimers(definition.nextTimers({ state, now }));
    return this.toSummary(state);
  }

  async join(input: JoinRoomInput): Promise<RoomSummary> {
    const state = this.requireState();
    this.clearDisconnectTimer(input.playerId);
    const existing = state.players.find((player) => player.playerId === input.playerId);
    if (existing) {
      const wasConnected = existing.connected;
      existing.connected = true;
      existing.ready = existing.ready ?? false;
      if (input.displayName) {
        existing.displayName = input.displayName;
      }
      delete state.emptySince;
      state.updatedAt = Date.now();
      this.saveState(state);
      if (!wasConnected) {
        this.broadcastPresence(state, input.playerId, true);
        this.broadcastSnapshots(state);
      }
      return this.toSummary(state);
    }

    if (state.phase === "closed") {
      throw new GameServerError("room_closed", "Room is closed", 409);
    }
    if (state.players.length >= state.room.maxPlayers) {
      throw new GameServerError("room_full", "Room is full", 409);
    }

    const now = Date.now();
    const player: PlayerSeat = {
      playerId: input.playerId,
      seat: state.players.length,
      connected: true,
      ready: false,
      joinedAt: now,
      ...(input.displayName ? { displayName: input.displayName } : {})
    };
    const definition = getGameDefinition(state.room.gameId);
    if (state.players.length === 0) {
      state.room.hostPlayerId = input.playerId;
    }
    state.players.push(player);
    state.playerStates[player.playerId] = definition.initialPlayerState(player, { room: state.room, now });
    delete state.emptySince;
    state.updatedAt = now;
    state.version += 1;
    this.saveState(state);
    await this.persistRoomIndex(state);
    await this.rescheduleTimers(definition.nextTimers({ state, now }));
    this.broadcastPresence(state, input.playerId, true);
    this.broadcastSnapshots(state);
    return this.toSummary(state);
  }

  async leave(playerId: string): Promise<RoomSummary> {
    this.clearDisconnectTimer(playerId);
    const state = this.requireState();
    const player = state.players.find((candidate) => candidate.playerId === playerId);
    if (!player) {
      throw new GameServerError("player_not_found", "Player is not in this room", 404);
    }

    player.connected = false;
    if (state.phase === "waiting") {
      player.ready = false;
    }
    const now = Date.now();
    state.updatedAt = now;
    if (state.players.every((candidate) => !candidate.connected)) {
      state.emptySince = now;
    } else {
      delete state.emptySince;
    }
    state.version += 1;
    this.saveState(state);
    await this.persistRoomIndex(state);
    this.broadcastPresence(state, playerId, false);
    this.broadcastSnapshots(state);
    return this.toSummary(state);
  }

  async setReady(playerId: string, ready: boolean): Promise<RoomSummary> {
    const state = this.requireState();
    if (state.phase !== "waiting") {
      throw new GameServerError("invalid_room_phase", "Ready state can only change while waiting", 409);
    }
    const player = state.players.find((candidate) => candidate.playerId === playerId);
    if (!player) {
      throw new GameServerError("player_not_found", "Player is not in this room", 404);
    }
    player.ready = ready;
    state.updatedAt = Date.now();
    state.version += 1;
    this.saveState(state);
    await this.persistRoomIndex(state);
    this.broadcastSnapshots(state);
    return this.toSummary(state);
  }

  async transferHost(playerId: string, targetPlayerId: string): Promise<RoomSummary> {
    const state = this.requireState();
    if (state.room.hostPlayerId !== playerId) {
      throw new GameServerError("forbidden", "Only the host can transfer host authority", 403);
    }
    if (!state.players.some((candidate) => candidate.playerId === targetPlayerId)) {
      throw new GameServerError("player_not_found", "Target player is not in this room", 404);
    }
    state.room.hostPlayerId = targetPlayerId;
    state.updatedAt = Date.now();
    state.version += 1;
    this.saveState(state);
    this.broadcastSnapshots(state);
    return this.toSummary(state);
  }

  async startGame(playerId: string): Promise<RoomSummary> {
    const state = this.requireState();
    if (state.room.hostPlayerId !== playerId) {
      throw new GameServerError("forbidden", "Only the host can start the game", 403);
    }
    if (state.phase !== "waiting") {
      throw new GameServerError("invalid_room_phase", "Room is not waiting", 409);
    }
    if (state.players.length < state.room.minPlayers) {
      throw new GameServerError("not_enough_players", "Not enough players to start", 409);
    }
    const requiredReadyPlayers = state.players.filter((candidate) => candidate.playerId !== state.room.hostPlayerId);
    if (!requiredReadyPlayers.every((candidate) => candidate.ready)) {
      throw new GameServerError("players_not_ready", "All non-host players must be ready before starting", 409);
    }

    const now = Date.now();
    state.phase = "active";
    state.updatedAt = now;
    state.version += 1;
    this.saveState(state);
    await this.persistRoomIndex(state);
    const definition = getGameDefinition(state.room.gameId);
    await this.rescheduleTimers(definition.nextTimers({ state, now }));
    this.broadcastSnapshots(state);
    return this.toSummary(state);
  }

  async getSummary(): Promise<RoomSummary> {
    return this.toSummary(this.requireState());
  }

  async getSnapshot(playerId: string): Promise<SnapshotPayload> {
    const state = this.requireState();
    return this.createSnapshot(state, playerId);
  }

  async cleanupIfStale(input: CleanupStaleRoomInput = {}): Promise<CleanupStaleRoomResult> {
    const state = this.loadState();
    if (!state) {
      return { cleaned: true, reason: "missing_state" };
    }
    if (state.phase === "closed") {
      return { cleaned: false, reason: "already_closed", summary: this.toSummary(state) };
    }

    const now = input.now ?? Date.now();
    const waitingIdleMs = input.waitingIdleMs ?? 5 * 60 * 1000;
    const activeIdleMs = input.activeIdleMs ?? 30 * 60 * 1000;
    const requiredIdleMs = state.phase === "active" ? activeIdleMs : waitingIdleMs;
    const hasLiveSockets = this.ctx.getWebSockets().some((ws) => ws.readyState === WebSocket.OPEN);
    if (hasLiveSockets) {
      return { cleaned: false, reason: "connected_clients", summary: this.toSummary(state) };
    }
    const staleSince = state.emptySince ?? state.updatedAt;
    if (now - staleSince < requiredIdleMs) {
      return { cleaned: false, reason: "not_idle", summary: this.toSummary(state) };
    }

    state.phase = "closed";
    state.closedAt = now;
    state.updatedAt = now;
    state.version += 1;
    for (const player of state.players) {
      player.connected = false;
      player.ready = false;
    }
    this.saveState(state);
    await this.rescheduleTimers([]);
    await this.persistAbandonedRoom(state, "stale_no_connections");
    return { cleaned: true, reason: "stale_no_connections", summary: this.toSummary(state) };
  }

  async submitAction(action: ClientGameAction): Promise<ActionAck> {
    const state = this.requireState();
    const processed = this.ctx.storage.sql
      .exec<ProcessedActionRow>(
        "SELECT ack_json FROM processed_actions WHERE player_id = ? AND client_action_id = ?",
        action.playerId,
        action.clientActionId
      )
      .toArray()[0];
    if (processed) {
      return JSON.parse(processed.ack_json) as ActionAck;
    }

    if (action.expectedVersion !== state.version) {
      throw new GameServerError("stale_action", "Action expectedVersion does not match room version", 409, {
        expectedVersion: action.expectedVersion,
        currentVersion: state.version
      });
    }

    const player = state.players.find((candidate) => candidate.playerId === action.playerId);
    if (!player) {
      throw new GameServerError("player_not_found", "Player is not in this room", 404);
    }
    if (state.phase !== "active") {
      throw new GameServerError("invalid_action", "Room is not active", 409);
    }

    const now = Date.now();
    const definition = getGameDefinition(state.room.gameId);
    const validation = definition.validateAction({ state: cloneState(state), now }, action);
    if (!validation.ok) {
      throw new GameServerError(
        validation.code === "invalid_turn" ? "invalid_turn" : "invalid_action",
        validation.message,
        409
      );
    }

    const applied = definition.applyAction({ state: cloneState(state), now }, action);
    applied.state.version = state.version + 1;
    applied.state.updatedAt = now;
    this.saveState(applied.state);
    for (const event of applied.events) {
      this.insertEvent(applied.state.version, event);
    }
    const timers = definition.nextTimers({ state: applied.state, now });
    await this.rescheduleTimers(timers);
    if (applied.state.phase === "closed") {
      await this.persistClosedRoom(applied.state, applied.events);
    }

    const ack: ActionAck = { version: applied.state.version, events: applied.events };
    this.ctx.storage.sql.exec(
      "INSERT INTO processed_actions (player_id, client_action_id, ack_json, created_at) VALUES (?, ?, ?, ?)",
      action.playerId,
      action.clientActionId,
      JSON.stringify(ack),
      now
    );
    this.deliverEvents(applied.state, applied.events);
    this.broadcastSnapshots(applied.state);
    return ack;
  }

  async sendChat(input: ChatInput): Promise<ChatMessage> {
    const state = this.requireState();
    const player = state.players.find((candidate) => candidate.playerId === input.playerId);
    if (!player) {
      throw new GameServerError("player_not_found", "Player is not in this room", 404);
    }
    if (input.targetPlayerId && !state.players.some((candidate) => candidate.playerId === input.targetPlayerId)) {
      throw new GameServerError("player_not_found", "Target player is not in this room", 404);
    }

    const now = Date.now();
    const message: ChatMessage = {
      id: createId("chat"),
      scope: "room",
      scopeId: state.room.roomId,
      visibility: input.targetPlayerId ? "private" : "public",
      playerId: input.playerId,
      ...(player.displayName ? { displayName: player.displayName } : {}),
      ...(input.targetPlayerId ? { targetPlayerId: input.targetPlayerId } : {}),
      body: normalizeChatBody(input.body),
      createdAt: now
    };
    this.insertChat(message);
    this.deliverChat(state, message);
    return message;
  }

  async trySubmitAction(action: ClientGameAction): Promise<ActionResultEnvelope> {
    try {
      return { ok: true, ack: await this.submitAction(action) };
    } catch (error) {
      if (error instanceof GameServerError) {
        return {
          ok: false,
          error: {
            code: error.code,
            message: error.message,
            status: error.status,
            ...(error.details === undefined ? {} : { details: error.details })
          }
        };
      }
      throw error;
    }
  }

  async tryStartGame(playerId: string): Promise<RoomCommandResultEnvelope> {
    try {
      return { ok: true, summary: await this.startGame(playerId) };
    } catch (error) {
      return this.toCommandError(error);
    }
  }

  async tryTransferHost(playerId: string, targetPlayerId: string): Promise<RoomCommandResultEnvelope> {
    try {
      return { ok: true, summary: await this.transferHost(playerId, targetPlayerId) };
    } catch (error) {
      return this.toCommandError(error);
    }
  }

  async fetch(request: Request): Promise<Response> {
    if (request.headers.get("Upgrade") !== "websocket") {
      return Response.json({ error: "Expected WebSocket upgrade" }, { status: 426 });
    }

    const pair = new WebSocketPair();
    const client = pair[0];
    const server = pair[1];
    const url = new URL(request.url);
    const playerId = url.searchParams.get("playerId") ?? undefined;
    const displayName = url.searchParams.get("displayName") ?? undefined;
    server.serializeAttachment((playerId ? { playerId, ...(displayName ? { displayName } : {}) } : {}) satisfies SocketAttachment);
    this.ctx.acceptWebSocket(server, playerId ? [`player:${playerId}`] : undefined);
    if (playerId) {
      const state = this.loadState();
      if (state) {
        this.sendToSocket(server, this.message(state, "snapshot", this.createSnapshot(state, playerId)));
      }
    }
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      const message = decodeClientMessage(raw);
      await this.handleClientMessage(ws, message);
    } catch (error) {
      const state = this.loadState();
      const roomId = state?.room.roomId ?? "unknown";
      const version = state?.version ?? 0;
      this.sendToSocket(ws, {
        type: "error",
        roomId,
        version,
        serverTime: Date.now(),
        payload: { code: "bad_request", message: error instanceof Error ? error.message : "Bad request" }
      });
    }
  }

  async webSocketClose(ws: WebSocket): Promise<void> {
    const attachment = ws.deserializeAttachment() as SocketAttachment | undefined;
    if (attachment?.playerId) {
      const activeSibling = this.ctx
        .getWebSockets(`player:${attachment.playerId}`)
        .some((candidate) => candidate !== ws && candidate.readyState === WebSocket.OPEN);
      if (activeSibling) {
        return;
      }
      this.scheduleDisconnect(attachment.playerId);
    }
  }

  async alarm(): Promise<void> {
    const state = this.loadState();
    if (!state) {
      await this.ctx.storage.deleteAlarm();
      return;
    }

    const now = Date.now();
    const due = this.ctx.storage.sql
      .exec<TimerRow>("SELECT id, kind, run_at, payload_json FROM timers WHERE run_at <= ? ORDER BY run_at ASC", now)
      .toArray();
    for (const timer of due) {
      if (timer.kind === "room_cleanup" && state.phase === "closed") {
        this.ctx.storage.sql.exec("DELETE FROM timers WHERE id = ?", timer.id);
      }
      if (timer.kind === "turn_timeout" && state.phase === "active") {
        const event: GameEvent = {
          id: createId("evt"),
          type: "turn.timeout",
          visibility: "system",
          payload: timer.payload_json ? JSON.parse(timer.payload_json) : {},
          createdAt: now
        };
        this.insertEvent(state.version, event);
        this.deliverEvents(state, [event]);
        this.ctx.storage.sql.exec("DELETE FROM timers WHERE id = ?", timer.id);
      }
    }
    await this.scheduleNextAlarm();
  }

  private async handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    const state = this.requireState();
    if (message.type === "ping") {
      this.sendToSocket(ws, this.message(state, "pong", message.nonce ? { nonce: message.nonce } : {}));
      return;
    }
    if (message.type === "hello" || message.type === "joinRoom") {
      ws.serializeAttachment({
        playerId: message.playerId,
        ...(message.displayName ? { displayName: message.displayName } : {})
      } satisfies SocketAttachment);
      await this.join({
        playerId: message.playerId,
        ...(message.displayName ? { displayName: message.displayName } : {})
      });
      const latest = this.requireState();
      this.sendToSocket(ws, this.message(latest, "snapshot", this.createSnapshot(latest, message.playerId)));
      this.sendToSocket(ws, this.message(latest, "ack", { command: message.type }));
      return;
    }
    if (message.type === "chat") {
      const chat = await this.sendChat({
        playerId: message.playerId,
        body: message.body,
        ...(message.targetPlayerId ? { targetPlayerId: message.targetPlayerId } : {})
      });
      this.sendToSocket(ws, this.message(this.requireState(), "ack", { command: "chat", result: { chatId: chat.id } }));
      return;
    }
    if (message.type === "ready") {
      const summary = await this.setReady(message.playerId, message.ready);
      this.sendToSocket(ws, this.message(this.requireState(), "ack", { command: "ready", result: { summary } }));
      return;
    }
    if (message.type === "transferHost") {
      const summary = await this.transferHost(message.playerId, message.targetPlayerId);
      this.sendToSocket(ws, this.message(this.requireState(), "ack", { command: "transferHost", result: { summary } }));
      return;
    }
    if (message.type === "startGame") {
      const summary = await this.startGame(message.playerId);
      this.sendToSocket(ws, this.message(this.requireState(), "ack", { command: "startGame", result: { summary } }));
      return;
    }
    if (message.type === "leaveRoom") {
      await this.leave(message.playerId);
      this.sendToSocket(ws, this.message(this.requireState(), "ack", { command: "leaveRoom" }));
      return;
    }
    if (message.type === "action") {
      const ack = await this.submitAction({
        playerId: message.playerId,
        clientActionId: message.clientActionId,
        expectedVersion: message.expectedVersion,
        type: message.action.type,
        payload: message.action.payload
      });
      this.sendToSocket(
        ws,
        this.message(this.requireState(), "ack", {
          command: "action",
          clientActionId: message.clientActionId,
          result: { version: ack.version }
        })
      );
    }
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS room_state (
        id INTEGER PRIMARY KEY CHECK (id = 1),
        state_json TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS processed_actions (
        player_id TEXT NOT NULL,
        client_action_id TEXT NOT NULL,
        ack_json TEXT NOT NULL,
        created_at INTEGER NOT NULL,
        PRIMARY KEY (player_id, client_action_id)
      );
      CREATE TABLE IF NOT EXISTS event_log (
        id TEXT PRIMARY KEY,
        version INTEGER NOT NULL,
        event_json TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS timers (
        id TEXT PRIMARY KEY,
        kind TEXT NOT NULL,
        run_at INTEGER NOT NULL,
        payload_json TEXT
      );
      CREATE TABLE IF NOT EXISTS chat_log (
        id TEXT PRIMARY KEY,
        scope TEXT NOT NULL,
        scope_id TEXT NOT NULL,
        visibility TEXT NOT NULL,
        player_id TEXT NOT NULL,
        display_name TEXT,
        target_player_id TEXT,
        body TEXT NOT NULL,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_timers_run_at ON timers (run_at);
      CREATE INDEX IF NOT EXISTS idx_chat_log_created_at ON chat_log (created_at);
    `);
  }

  private loadState(): RoomState | null {
    const row = this.ctx.storage.sql.exec<RoomStateRow>("SELECT id, state_json FROM room_state WHERE id = 1").toArray()[0];
    return row ? (JSON.parse(row.state_json) as RoomState) : null;
  }

  private requireState(): RoomState {
    const state = this.loadState();
    if (!state) {
      throw new GameServerError("room_not_found", "Room is not initialized", 404);
    }
    return state;
  }

  private saveState(state: RoomState): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO room_state (id, state_json) VALUES (1, ?) ON CONFLICT(id) DO UPDATE SET state_json = excluded.state_json",
      JSON.stringify(state)
    );
  }

  private insertEvent(version: number, event: GameEvent): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO event_log (id, version, event_json, created_at) VALUES (?, ?, ?, ?)",
      event.id,
      version,
      JSON.stringify(event),
      event.createdAt
    );
  }

  private insertChat(message: ChatMessage): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO chat_log (
        id, scope, scope_id, visibility, player_id, display_name, target_player_id, body, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      message.id,
      message.scope,
      message.scopeId,
      message.visibility,
      message.playerId,
      message.displayName ?? null,
      message.targetPlayerId ?? null,
      message.body,
      message.createdAt
    );
  }

  private async rescheduleTimers(timers: TimerIntent[]): Promise<void> {
    this.ctx.storage.sql.exec("DELETE FROM timers");
    for (const timer of timers) {
      this.ctx.storage.sql.exec(
        "INSERT INTO timers (id, kind, run_at, payload_json) VALUES (?, ?, ?, ?)",
        timer.id,
        timer.kind,
        timer.runAt,
        timer.payload ? JSON.stringify(timer.payload) : null
      );
    }
    await this.scheduleNextAlarm();
  }

  private async scheduleNextAlarm(): Promise<void> {
    const next = this.ctx.storage.sql
      .exec<{ run_at: number | null }>("SELECT MIN(run_at) AS run_at FROM timers")
      .one();
    if (next.run_at) {
      await this.ctx.storage.setAlarm(next.run_at);
    } else {
      await this.ctx.storage.deleteAlarm();
    }
  }

  private createSnapshot(state: RoomState, playerId: string): SnapshotPayload {
    const definition = getGameDefinition(state.room.gameId);
    const context = { state, now: Date.now() };
    return {
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      phase: state.phase,
      version: state.version,
      minPlayers: state.room.minPlayers,
      maxPlayers: state.room.maxPlayers,
      ...(state.room.hostPlayerId ? { hostPlayerId: state.room.hostPlayerId } : {}),
      players: state.players,
      publicView: definition.getPublicView(context),
      privateView: definition.getPrivateView(context, playerId)
    };
  }

  private toSummary(state: RoomState): RoomSummary {
    return {
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      phase: state.phase,
      version: state.version,
      playerCount: state.players.length,
      readyCount: state.players.filter((player) => player.playerId !== state.room.hostPlayerId && player.ready).length,
      minPlayers: state.room.minPlayers,
      maxPlayers: state.room.maxPlayers,
      ...(state.room.hostPlayerId ? { hostPlayerId: state.room.hostPlayerId } : {})
    };
  }

  private message<TType extends ServerMessage["type"]>(
    state: RoomState,
    type: TType,
    payload: Extract<ServerMessage, { type: TType }>["payload"]
  ): Extract<ServerMessage, { type: TType }> {
    return {
      type,
      roomId: state.room.roomId,
      version: state.version,
      serverTime: Date.now(),
      payload
    } as Extract<ServerMessage, { type: TType }>;
  }

  private deliverEvents(state: RoomState, events: GameEvent[]): void {
    for (const event of publicEvents(events)) {
      this.broadcast(this.message(state, "event", { event }));
    }
    for (const player of state.players) {
      for (const event of privateEventsFor(events, player.playerId)) {
        this.broadcastToPlayer(player.playerId, this.message(state, "privateEvent", { event }));
      }
    }
  }

  private deliverChat(state: RoomState, chat: ChatMessage): void {
    const message = this.message(state, "chat", { message: chat });
    if (chat.visibility === "public") {
      this.broadcast(message);
      return;
    }
    this.broadcastToPlayer(chat.playerId, message);
    if (chat.targetPlayerId && chat.targetPlayerId !== chat.playerId) {
      this.broadcastToPlayer(chat.targetPlayerId, message);
    }
  }

  private broadcastPresence(state: RoomState, playerId: string, connected: boolean): void {
    this.broadcast(this.message(state, "presence", { playerId, connected }));
  }

  private broadcastSnapshots(state: RoomState): void {
    for (const player of state.players) {
      for (const ws of this.ctx.getWebSockets(`player:${player.playerId}`)) {
        this.sendToSocket(ws, this.message(state, "snapshot", this.createSnapshot(state, player.playerId)));
      }
    }
  }

  private async persistRoomIndex(state: RoomState): Promise<void> {
    const definition = getGameDefinition(state.room.gameId);
    const repo = new D1Repository(this.env.DB);
    await repo.upsertGame({
      gameId: definition.gameId,
      adapterKey: definition.adapterKey,
      displayName: definition.displayName,
      enabled: true,
      minPlayers: definition.minPlayers,
      maxPlayers: definition.maxPlayers,
      config: {}
    });
    const status =
      state.phase === "closed"
        ? "closed"
        : state.phase === "active"
          ? "active"
          : state.players.length >= state.room.minPlayers
            ? "matching"
            : "open";
    await repo.upsertRoom({
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      status,
      playerCount: state.players.length,
      minPlayers: state.room.minPlayers,
      maxPlayers: state.room.maxPlayers,
      doName: roomDoName(state.room.roomId),
      ...(state.closedAt ? { closedAt: new Date(state.closedAt).toISOString() } : {})
    });
  }

  private broadcast(message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets()) {
      this.sendToSocket(ws, message);
    }
  }

  private broadcastToPlayer(playerId: string, message: ServerMessage): void {
    for (const ws of this.ctx.getWebSockets(`player:${playerId}`)) {
      this.sendToSocket(ws, message);
    }
  }

  private scheduleDisconnect(playerId: string): void {
    this.clearDisconnectTimer(playerId);
    const timer = setTimeout(() => {
      this.disconnectTimers.delete(playerId);
      void this.confirmDisconnect(playerId);
    }, this.disconnectGraceMs());
    this.disconnectTimers.set(playerId, timer);
  }

  private async confirmDisconnect(playerId: string): Promise<void> {
    const activeSibling = this.ctx
      .getWebSockets(`player:${playerId}`)
      .some((candidate) => candidate.readyState === WebSocket.OPEN);
    if (activeSibling) {
      return;
    }
    const state = this.loadState();
    if (!state || !state.players.some((player) => player.playerId === playerId && player.connected)) {
      return;
    }
    await this.leave(playerId);
  }

  private clearDisconnectTimer(playerId: string): void {
    const timer = this.disconnectTimers.get(playerId);
    if (timer) {
      clearTimeout(timer);
      this.disconnectTimers.delete(playerId);
    }
  }

  private disconnectGraceMs(): number {
    return this.env.ENVIRONMENT === "test" ? 100 : 10_000;
  }

  private toCommandError(error: unknown): RoomCommandResultEnvelope {
    if (error instanceof GameServerError) {
      return {
        ok: false,
        error: {
          code: error.code,
          message: error.message,
          status: error.status,
          ...(error.details === undefined ? {} : { details: error.details })
        }
      };
    }
    throw error;
  }

  private sendToSocket(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeServerMessage(message));
    }
  }

  private async persistClosedRoom(state: RoomState, events: GameEvent[]): Promise<void> {
    const repo = new D1Repository(this.env.DB);
    const closedAt = new Date(state.closedAt ?? Date.now()).toISOString();
    await repo.upsertRoom({
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      status: "closed",
      playerCount: state.players.length,
      minPlayers: state.room.minPlayers,
      maxPlayers: state.room.maxPlayers,
      doName: roomDoName(state.room.roomId),
      closedAt
    });
    const winnerPlayerId = findWinnerPlayerId(events);
    await repo.insertMatchResult({
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      status: "closed",
      winnerPlayerId,
      result: {
        version: state.version,
        winnerPlayerId,
        closedAt
      }
    });
  }

  private async persistAbandonedRoom(state: RoomState, reason: string): Promise<void> {
    const repo = new D1Repository(this.env.DB);
    const closedAt = new Date(state.closedAt ?? Date.now()).toISOString();
    await repo.upsertRoom({
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      status: "closed",
      playerCount: state.players.length,
      minPlayers: state.room.minPlayers,
      maxPlayers: state.room.maxPlayers,
      doName: roomDoName(state.room.roomId),
      closedAt
    });
    await repo.insertMatchResult({
      roomId: state.room.roomId,
      gameId: state.room.gameId,
      mode: state.room.mode,
      status: "abandoned",
      winnerPlayerId: null,
      result: {
        version: state.version,
        reason,
        closedAt
      }
    });
  }
}

function findWinnerPlayerId(events: GameEvent[]): string | null {
  for (const event of events) {
    const winnerPlayerId = event.payload.winnerPlayerId;
    if (typeof winnerPlayerId === "string") {
      return winnerPlayerId;
    }
  }
  return null;
}
