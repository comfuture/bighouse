export type GameRow = {
  gameId: string;
  adapterKey: string;
  displayName: string;
  enabled: boolean;
  minPlayers: number;
  maxPlayers: number;
  config: Record<string, unknown>;
};

export type RoomStatus = "open" | "matching" | "active" | "closed";

export type RoomIndexRecord = {
  roomId: string;
  gameId: string;
  mode: string;
  status: RoomStatus;
  playerCount: number;
  minPlayers: number;
  maxPlayers: number;
  doName: string;
  createdAt?: string;
  updatedAt?: string;
  closedAt?: string | null;
};

export type MatchTicketStatus = "pending" | "matched" | "cancelled";

export type MatchTicketRecord = {
  ticketId: string;
  gameId: string;
  mode: string;
  playerId: string;
  displayName?: string;
  status: MatchTicketStatus;
  matchedRoomId?: string | null;
  region?: string;
  skill?: string;
};

export type MatchResultRecord = {
  roomId: string;
  gameId: string;
  mode: string;
  status: string;
  winnerPlayerId?: string | null;
  result: Record<string, unknown>;
  replayPointer?: string | null;
};

type GameDbRow = {
  game_id: string;
  adapter_key: string;
  display_name: string;
  enabled: number;
  min_players: number;
  max_players: number;
  config_json: string;
};

type RoomDbRow = {
  room_id: string;
  game_id: string;
  mode: string;
  status: RoomStatus;
  player_count: number;
  min_players: number;
  max_players: number;
  do_name: string;
  created_at: string;
  updated_at: string;
  closed_at: string | null;
};

type MatchTicketDbRow = {
  ticket_id: string;
  game_id: string;
  mode: string;
  player_id: string;
  display_name: string | null;
  status: MatchTicketStatus;
  matched_room_id: string | null;
  region: string;
  skill: string;
};

function parseJsonObject(value: string): Record<string, unknown> {
  const parsed = JSON.parse(value) as unknown;
  return parsed && typeof parsed === "object" && !Array.isArray(parsed)
    ? (parsed as Record<string, unknown>)
    : {};
}

function mapGame(row: GameDbRow): GameRow {
  return {
    gameId: row.game_id,
    adapterKey: row.adapter_key,
    displayName: row.display_name,
    enabled: row.enabled === 1,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    config: parseJsonObject(row.config_json)
  };
}

function mapRoom(row: RoomDbRow): RoomIndexRecord {
  return {
    roomId: row.room_id,
    gameId: row.game_id,
    mode: row.mode,
    status: row.status,
    playerCount: row.player_count,
    minPlayers: row.min_players,
    maxPlayers: row.max_players,
    doName: row.do_name,
    createdAt: row.created_at,
    updatedAt: row.updated_at,
    closedAt: row.closed_at
  };
}

export class D1Repository {
  constructor(private readonly db: D1Database) {}

  async upsertGame(game: GameRow): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO games (
          game_id, adapter_key, display_name, enabled, min_players, max_players, config_json, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(game_id) DO UPDATE SET
          adapter_key = excluded.adapter_key,
          display_name = excluded.display_name,
          enabled = excluded.enabled,
          min_players = excluded.min_players,
          max_players = excluded.max_players,
          config_json = excluded.config_json,
          updated_at = CURRENT_TIMESTAMP`
      )
      .bind(
        game.gameId,
        game.adapterKey,
        game.displayName,
        game.enabled ? 1 : 0,
        game.minPlayers,
        game.maxPlayers,
        JSON.stringify(game.config)
      )
      .run();
  }

  async listEnabledGames(): Promise<GameRow[]> {
    const result = await this.db
      .prepare(
        `SELECT game_id, adapter_key, display_name, enabled, min_players, max_players, config_json
         FROM games
         WHERE enabled = 1
         ORDER BY game_id`
      )
      .all<GameDbRow>();
    return (result.results ?? []).map(mapGame);
  }

  async getGame(gameId: string): Promise<GameRow | null> {
    const row = await this.db
      .prepare(
        `SELECT game_id, adapter_key, display_name, enabled, min_players, max_players, config_json
         FROM games
         WHERE game_id = ?`
      )
      .bind(gameId)
      .first<GameDbRow>();
    return row ? mapGame(row) : null;
  }

  async upsertRoom(room: RoomIndexRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO room_index (
          room_id, game_id, mode, status, player_count, min_players, max_players, do_name, closed_at, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(room_id) DO UPDATE SET
          status = excluded.status,
          player_count = excluded.player_count,
          min_players = excluded.min_players,
          max_players = excluded.max_players,
          closed_at = excluded.closed_at,
          updated_at = CURRENT_TIMESTAMP`
      )
      .bind(
        room.roomId,
        room.gameId,
        room.mode,
        room.status,
        room.playerCount,
        room.minPlayers,
        room.maxPlayers,
        room.doName,
        room.closedAt ?? null
      )
      .run();
  }

  async findJoinableRoom(gameId: string, mode: string): Promise<RoomIndexRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT room_id, game_id, mode, status, player_count, min_players, max_players, do_name, created_at, updated_at, closed_at
         FROM room_index
         WHERE game_id = ? AND mode = ? AND status IN ('open', 'matching') AND player_count < max_players
         ORDER BY created_at ASC
         LIMIT 1`
      )
      .bind(gameId, mode)
      .first<RoomDbRow>();
    return row ? mapRoom(row) : null;
  }

  async listLobbyRooms(gameId: string, mode: string): Promise<RoomIndexRecord[]> {
    const result = await this.db
      .prepare(
        `SELECT room_id, game_id, mode, status, player_count, min_players, max_players, do_name, created_at, updated_at, closed_at
         FROM room_index
         WHERE game_id = ? AND mode = ? AND status IN ('open', 'matching')
         ORDER BY created_at ASC`
      )
      .bind(gameId, mode)
      .all<RoomDbRow>();
    return (result.results ?? []).map(mapRoom);
  }

  async getRoom(roomId: string): Promise<RoomIndexRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT room_id, game_id, mode, status, player_count, min_players, max_players, do_name, created_at, updated_at, closed_at
         FROM room_index
         WHERE room_id = ?`
      )
      .bind(roomId)
      .first<RoomDbRow>();
    return row ? mapRoom(row) : null;
  }

  async upsertTicket(ticket: MatchTicketRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO match_tickets (
          ticket_id, game_id, mode, player_id, display_name, status, matched_room_id, region, skill, updated_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, CURRENT_TIMESTAMP)
        ON CONFLICT(ticket_id) DO UPDATE SET
          status = excluded.status,
          matched_room_id = excluded.matched_room_id,
          region = excluded.region,
          skill = excluded.skill,
          updated_at = CURRENT_TIMESTAMP`
      )
      .bind(
        ticket.ticketId,
        ticket.gameId,
        ticket.mode,
        ticket.playerId,
        ticket.displayName ?? null,
        ticket.status,
        ticket.matchedRoomId ?? null,
        ticket.region ?? "global",
        ticket.skill ?? "default"
      )
      .run();
  }

  async getTicket(ticketId: string): Promise<MatchTicketRecord | null> {
    const row = await this.db
      .prepare(
        `SELECT ticket_id, game_id, mode, player_id, display_name, status, matched_room_id, region, skill
         FROM match_tickets
         WHERE ticket_id = ?`
      )
      .bind(ticketId)
      .first<MatchTicketDbRow>();
    return row
      ? {
          ticketId: row.ticket_id,
          gameId: row.game_id,
          mode: row.mode,
          playerId: row.player_id,
          ...(row.display_name ? { displayName: row.display_name } : {}),
          status: row.status,
          matchedRoomId: row.matched_room_id,
          region: row.region,
          skill: row.skill
        }
      : null;
  }

  async cancelTicket(ticketId: string): Promise<boolean> {
    const result = await this.db
      .prepare(
        `UPDATE match_tickets
         SET status = 'cancelled', updated_at = CURRENT_TIMESTAMP
         WHERE ticket_id = ? AND status = 'pending'`
      )
      .bind(ticketId)
      .run();
    return result.meta.changes > 0;
  }

  async insertMatchResult(result: MatchResultRecord): Promise<void> {
    await this.db
      .prepare(
        `INSERT INTO match_results (
          room_id, game_id, mode, status, winner_player_id, result_json, replay_pointer
        ) VALUES (?, ?, ?, ?, ?, ?, ?)
        ON CONFLICT(room_id) DO UPDATE SET
          status = excluded.status,
          winner_player_id = excluded.winner_player_id,
          result_json = excluded.result_json,
          replay_pointer = excluded.replay_pointer`
      )
      .bind(
        result.roomId,
        result.gameId,
        result.mode,
        result.status,
        result.winnerPlayerId ?? null,
        JSON.stringify(result.result),
        result.replayPointer ?? null
      )
      .run();
  }
}
