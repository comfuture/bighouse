import { DurableObject } from "cloudflare:workers";
import { normalizeChatBody, type ChatInput, type ChatMessage } from "../core/chat";
import { GameServerError } from "../core/errors";
import type { JsonObject } from "../core/game";
import { createId, roomDoName } from "../core/ids";
import {
  decodeClientMessage,
  encodeServerMessage,
  type ClientMessage,
  type ServerMessage
} from "../core/protocol";
import { getGameDefinition } from "../games/registry";
import { D1Repository, type RoomIndexRecord } from "../storage/d1";
import type { Env } from "../types";
import type { InitializeRoomInput, JoinRoomInput, RoomSummary } from "./room";

export type LobbyJoinInput = JoinRoomInput & {
  gameId: string;
  mode: string;
  minPlayers?: number;
  maxPlayers?: number;
  config?: JsonObject;
};

export type LobbyJoinResult = {
  roomId: string;
  doName: string;
  summary: RoomSummary;
};

export type LobbyCreateRoomInput = LobbyJoinInput;

type LobbyRoomRow = {
  room_id: string;
  game_id: string;
  mode: string;
  status: RoomIndexRecord["status"];
  player_count: number;
  min_players: number;
  max_players: number;
  do_name: string;
  updated_at: number;
};

type LobbySocketAttachment = {
  playerId?: string;
  displayName?: string;
};

type LobbyIdentityRow = {
  display_name: string | null;
};

type LobbyMetaRow = {
  value: string;
};

export class LobbyDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async join(input: LobbyJoinInput): Promise<LobbyJoinResult> {
    const repo = new D1Repository(this.env.DB);
    const definition = getGameDefinition(input.gameId);
    const minPlayers = input.minPlayers ?? definition.minPlayers;
    const maxPlayers = input.maxPlayers ?? definition.maxPlayers;
    if (minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > definition.maxPlayers) {
      throw new GameServerError("bad_request", "Invalid room player limits", 400);
    }

    const existing = await repo.findJoinableRoom(input.gameId, input.mode);
    const roomRecord =
      existing ??
      (await this.createIndexedRoom(repo, {
        roomId: createId("room"),
        gameId: input.gameId,
        mode: input.mode,
        minPlayers,
        maxPlayers,
        config: input.config ?? {}
      }));

    const room = this.env.ROOM_DO.getByName(roomRecord.doName);
    const summary = await room.join({
      playerId: input.playerId,
      ...(input.displayName ? { displayName: input.displayName } : {})
    });
    const status = summary.activeInterruption
      ? summary.playerCount >= summary.minPlayers
        ? "matching"
        : "open"
      : summary.phase === "active"
        ? "active"
        : summary.playerCount >= summary.minPlayers
          ? "matching"
          : "open";
    await this.recordRoom({
      ...roomRecord,
      status,
      playerCount: summary.playerCount
    });
    await repo.upsertRoom({
      ...roomRecord,
      status,
      playerCount: summary.playerCount
    });

    return { roomId: roomRecord.roomId, doName: roomRecord.doName, summary };
  }

  async createRoom(input: LobbyCreateRoomInput): Promise<LobbyJoinResult> {
    const repo = new D1Repository(this.env.DB);
    const definition = getGameDefinition(input.gameId);
    const minPlayers = input.minPlayers ?? definition.minPlayers;
    const maxPlayers = input.maxPlayers ?? definition.maxPlayers;
    if (minPlayers < 1 || maxPlayers < minPlayers || maxPlayers > definition.maxPlayers) {
      throw new GameServerError("bad_request", "Invalid room player limits", 400);
    }
    const roomRecord = await this.createIndexedRoom(repo, {
      roomId: createId("room"),
      gameId: input.gameId,
      mode: input.mode,
      minPlayers,
      maxPlayers,
      config: input.config ?? {}
    });
    const room = this.env.ROOM_DO.getByName(roomRecord.doName);
    const summary = await room.join({
      playerId: input.playerId,
      ...(input.displayName ? { displayName: input.displayName } : {})
    });
    const record = {
      ...roomRecord,
      status: summary.playerCount >= summary.minPlayers ? "matching" : "open",
      playerCount: summary.playerCount
    } satisfies RoomIndexRecord;
    await this.recordRoom(record);
    await repo.upsertRoom(record);
    return { roomId: roomRecord.roomId, doName: roomRecord.doName, summary };
  }

  async recordRoom(record: RoomIndexRecord): Promise<void> {
    this.ctx.storage.sql.exec(
      `INSERT INTO rooms (
        room_id, game_id, mode, status, player_count, min_players, max_players, do_name, updated_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)
      ON CONFLICT(room_id) DO UPDATE SET
        status = excluded.status,
        player_count = excluded.player_count,
        min_players = excluded.min_players,
        max_players = excluded.max_players,
        updated_at = excluded.updated_at`,
      record.roomId,
      record.gameId,
      record.mode,
      record.status,
      record.playerCount,
      record.minPlayers,
      record.maxPlayers,
      record.doName,
      Date.now()
    );
  }

  async listRooms(): Promise<RoomIndexRecord[]> {
    return this.ctx.storage.sql
      .exec<LobbyRoomRow>(
        `SELECT room_id, game_id, mode, status, player_count, min_players, max_players, do_name, updated_at
         FROM rooms
         WHERE status IN ('open', 'matching', 'active')
         ORDER BY updated_at DESC`
      )
      .toArray()
      .map((row) => ({
        roomId: row.room_id,
        gameId: row.game_id,
        mode: row.mode,
        status: row.status,
        playerCount: row.player_count,
        minPlayers: row.min_players,
        maxPlayers: row.max_players,
        doName: row.do_name
      }));
  }

  async sendChat(input: ChatInput): Promise<ChatMessage> {
    if (!this.hasOnlinePlayer(input.playerId)) {
      throw new GameServerError("player_not_found", "Sender is not connected to this lobby", 404);
    }
    if (input.targetPlayerId && !this.hasOnlinePlayer(input.targetPlayerId)) {
      throw new GameServerError("player_not_found", "Target player is not connected to this lobby", 404);
    }

    const now = Date.now();
    const displayName = this.getDisplayName(input.playerId);
    const scopeId = this.lobbyScopeId();
    const message: ChatMessage = {
      id: createId("chat"),
      scope: "lobby",
      scopeId,
      visibility: input.targetPlayerId ? "private" : "public",
      playerId: input.playerId,
      ...(displayName ? { displayName } : {}),
      ...(input.targetPlayerId ? { targetPlayerId: input.targetPlayerId } : {}),
      body: normalizeChatBody(input.body),
      createdAt: now
    };
    this.insertChat(message);
    this.deliverChat(message);
    return message;
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
    this.recordScopeId(this.scopeIdFromUrl(url));
    server.serializeAttachment((playerId ? { playerId, ...(displayName ? { displayName } : {}) } : {}) satisfies LobbySocketAttachment);
    if (playerId) {
      this.recordIdentity(playerId, displayName);
    }
    this.ctx.acceptWebSocket(server, playerId ? [`player:${playerId}`] : undefined);
    this.sendToSocket(server, this.message("ack", { command: "lobby.connect" }));
    return new Response(null, { status: 101, webSocket: client });
  }

  async webSocketMessage(ws: WebSocket, raw: string | ArrayBuffer): Promise<void> {
    try {
      const message = decodeClientMessage(raw);
      await this.handleClientMessage(ws, message);
    } catch (error) {
      this.sendToSocket(ws, {
        type: "error",
        roomId: this.lobbyScopeId(),
        version: 0,
        serverTime: Date.now(),
        payload: { code: "bad_request", message: error instanceof Error ? error.message : "Bad request" }
      });
    }
  }

  async webSocketClose(ws: WebSocket, code: number, reason: string, wasClean: boolean): Promise<void> {
    const attachment = ws.deserializeAttachment() as LobbySocketAttachment | undefined;
    if (attachment?.playerId) {
      const activeSibling = this.ctx
        .getWebSockets(`player:${attachment.playerId}`)
        .some((candidate) => candidate !== ws && candidate.readyState === WebSocket.OPEN);
      if (!activeSibling) {
        this.ctx.storage.sql.exec("UPDATE lobby_players SET connected = 0, updated_at = ? WHERE player_id = ?", Date.now(), attachment.playerId);
      }
    }
  }

  async webSocketError(ws: WebSocket, error: unknown): Promise<void> {
    const attachment = ws.deserializeAttachment() as LobbySocketAttachment | undefined;
    if (attachment?.playerId) {
      const activeSibling = this.ctx
        .getWebSockets(`player:${attachment.playerId}`)
        .some((candidate) => candidate !== ws && candidate.readyState === WebSocket.OPEN);
      if (!activeSibling) {
        this.ctx.storage.sql.exec("UPDATE lobby_players SET connected = 0, updated_at = ? WHERE player_id = ?", Date.now(), attachment.playerId);
      }
    }
  }

  private async createIndexedRoom(
    repo: D1Repository,
    input: InitializeRoomInput
  ): Promise<RoomIndexRecord> {
    const doName = roomDoName(input.roomId);
    const room = this.env.ROOM_DO.getByName(doName);
    const summary = await room.initialize(input);
    const record: RoomIndexRecord = {
      roomId: input.roomId,
      gameId: input.gameId,
      mode: input.mode,
      status: "open",
      playerCount: summary.playerCount,
      minPlayers: input.minPlayers,
      maxPlayers: input.maxPlayers,
      doName
    };
    await this.recordRoom(record);
    await repo.upsertRoom(record);
    return record;
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS rooms (
        room_id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        status TEXT NOT NULL,
        player_count INTEGER NOT NULL,
        min_players INTEGER NOT NULL,
        max_players INTEGER NOT NULL,
        do_name TEXT NOT NULL,
        updated_at INTEGER NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lobby_meta (
        key TEXT PRIMARY KEY,
        value TEXT NOT NULL
      );
      CREATE TABLE IF NOT EXISTS lobby_players (
        player_id TEXT PRIMARY KEY,
        display_name TEXT,
        connected INTEGER NOT NULL,
        updated_at INTEGER NOT NULL
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
      CREATE INDEX IF NOT EXISTS idx_rooms_lobby ON rooms (game_id, mode, status);
      CREATE INDEX IF NOT EXISTS idx_chat_log_created_at ON chat_log (created_at);
    `);
  }

  private async handleClientMessage(ws: WebSocket, message: ClientMessage): Promise<void> {
    if (message.type === "ping") {
      this.sendToSocket(ws, this.message("pong", message.nonce ? { nonce: message.nonce } : {}));
      return;
    }
    if (message.type === "hello") {
      ws.serializeAttachment({
        playerId: message.playerId,
        ...(message.displayName ? { displayName: message.displayName } : {})
      } satisfies LobbySocketAttachment);
      this.recordIdentity(message.playerId, message.displayName);
      this.sendToSocket(ws, this.message("ack", { command: "hello" }));
      return;
    }
    if (message.type === "chat") {
      const chat = await this.sendChat({
        playerId: message.playerId,
        body: message.body,
        ...(message.targetPlayerId ? { targetPlayerId: message.targetPlayerId } : {})
      });
      this.sendToSocket(ws, this.message("ack", { command: "chat", result: { chatId: chat.id } }));
      return;
    }
    this.sendToSocket(ws, this.message("error", { code: "bad_request", message: `Unsupported lobby message '${message.type}'` }));
  }

  private recordIdentity(playerId: string, displayName: string | undefined): void {
    this.ctx.storage.sql.exec(
      `INSERT INTO lobby_players (player_id, display_name, connected, updated_at)
       VALUES (?, ?, 1, ?)
       ON CONFLICT(player_id) DO UPDATE SET
         display_name = COALESCE(excluded.display_name, lobby_players.display_name),
         connected = 1,
         updated_at = excluded.updated_at`,
      playerId,
      displayName ?? null,
      Date.now()
    );
  }

  private recordScopeId(scopeId: string): void {
    this.ctx.storage.sql.exec(
      "INSERT INTO lobby_meta (key, value) VALUES ('scope_id', ?) ON CONFLICT(key) DO UPDATE SET value = excluded.value",
      scopeId
    );
  }

  private getDisplayName(playerId: string): string | undefined {
    const row = this.ctx.storage.sql
      .exec<LobbyIdentityRow>("SELECT display_name FROM lobby_players WHERE player_id = ?", playerId)
      .toArray()[0];
    return row?.display_name ?? undefined;
  }

  private hasOnlinePlayer(playerId: string): boolean {
    return this.ctx.getWebSockets(`player:${playerId}`).some((socket) => socket.readyState === WebSocket.OPEN);
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

  private deliverChat(chat: ChatMessage): void {
    const message = this.message("chat", { message: chat });
    if (chat.visibility === "public") {
      this.broadcast(message);
      return;
    }
    this.broadcastToPlayer(chat.playerId, message);
    if (chat.targetPlayerId && chat.targetPlayerId !== chat.playerId) {
      this.broadcastToPlayer(chat.targetPlayerId, message);
    }
  }

  private message<TType extends ServerMessage["type"]>(
    type: TType,
    payload: Extract<ServerMessage, { type: TType }>["payload"]
  ): Extract<ServerMessage, { type: TType }> {
    return {
      type,
      roomId: this.lobbyScopeId(),
      version: 0,
      serverTime: Date.now(),
      payload
    } as Extract<ServerMessage, { type: TType }>;
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

  private sendToSocket(ws: WebSocket, message: ServerMessage): void {
    if (ws.readyState === WebSocket.OPEN) {
      ws.send(encodeServerMessage(message));
    }
  }

  private lobbyScopeId(): string {
    return (
      this.ctx.storage.sql.exec<LobbyMetaRow>("SELECT value FROM lobby_meta WHERE key = 'scope_id'").toArray()[0]
        ?.value ?? this.ctx.id.toString()
    );
  }

  private scopeIdFromUrl(url: URL): string {
    const match = url.pathname.match(/^\/games\/([^/]+)\/lobbies\/([^/]+)\/ws$/u);
    if (!match?.[1] || !match[2]) {
      return this.ctx.id.toString();
    }
    return `lobby:${decodeURIComponent(match[1])}:${decodeURIComponent(match[2])}`;
  }
}
