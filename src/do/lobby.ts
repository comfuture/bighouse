import { DurableObject } from "cloudflare:workers";
import { GameServerError } from "../core/errors";
import type { JsonObject } from "../core/game";
import { createId, roomDoName } from "../core/ids";
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
    await this.recordRoom({
      ...roomRecord,
      status: summary.phase === "active" ? "active" : "open",
      playerCount: summary.playerCount
    });
    await repo.upsertRoom({
      ...roomRecord,
      status: summary.phase === "active" ? "active" : "open",
      playerCount: summary.playerCount
    });

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
      CREATE INDEX IF NOT EXISTS idx_rooms_lobby ON rooms (game_id, mode, status);
    `);
  }
}
