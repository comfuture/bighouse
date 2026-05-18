import { DurableObject } from "cloudflare:workers";
import { createId, roomDoName } from "../core/ids";
import { getGameDefinition } from "../games/registry";
import { D1Repository, type MatchTicketRecord, type RoomIndexRecord } from "../storage/d1";
import type { Env } from "../types";
import type { InitializeRoomInput } from "./room";

export type EnqueueTicketInput = {
  gameId: string;
  mode: string;
  playerId: string;
  displayName?: string;
  region?: string;
  skill?: string;
};

export type MatchmakerTicket = MatchTicketRecord & {
  region: string;
  skill: string;
};

export type MatchmakerResult = {
  ticket: MatchmakerTicket;
  matchedRoomId?: string;
};

type QueueRow = {
  ticket_id: string;
  game_id: string;
  mode: string;
  player_id: string;
  display_name: string | null;
  region: string;
  skill: string;
  status: "pending" | "matched" | "cancelled";
  created_at: number;
};

export class MatchmakerDO extends DurableObject<Env> {
  constructor(ctx: DurableObjectState, env: Env) {
    super(ctx, env);
    ctx.blockConcurrencyWhile(async () => this.migrate());
  }

  async enqueue(input: EnqueueTicketInput): Promise<MatchmakerResult> {
    const definition = getGameDefinition(input.gameId);
    const repo = new D1Repository(this.env.DB);
    const ticket: MatchmakerTicket = {
      ticketId: createId("ticket"),
      gameId: input.gameId,
      mode: input.mode,
      playerId: input.playerId,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      status: "pending",
      region: input.region ?? "global",
      skill: input.skill ?? "default"
    };
    this.ctx.storage.sql.exec(
      `INSERT INTO queue (
        ticket_id, game_id, mode, player_id, display_name, region, skill, status, created_at
      ) VALUES (?, ?, ?, ?, ?, ?, ?, 'pending', ?)`,
      ticket.ticketId,
      ticket.gameId,
      ticket.mode,
      ticket.playerId,
      ticket.displayName ?? null,
      ticket.region,
      ticket.skill,
      Date.now()
    );
    await repo.upsertTicket(ticket);

    const pending = this.pendingRows(input.gameId, input.mode, ticket.region, ticket.skill);
    if (pending.length < definition.minPlayers) {
      return { ticket };
    }

    const selected = pending.slice(0, definition.minPlayers);
    const roomId = createId("room");
    const doName = roomDoName(roomId);
    const room = this.env.ROOM_DO.getByName(doName);
    const initializeInput: InitializeRoomInput = {
      roomId,
      gameId: input.gameId,
      mode: input.mode,
      minPlayers: definition.minPlayers,
      maxPlayers: definition.maxPlayers
    };
    await room.initialize(initializeInput);
    for (const row of selected) {
      await room.join({
        playerId: row.player_id,
        ...(row.display_name ? { displayName: row.display_name } : {})
      });
      this.ctx.storage.sql.exec(
        "UPDATE queue SET status = 'matched', matched_room_id = ? WHERE ticket_id = ?",
        roomId,
        row.ticket_id
      );
      await repo.upsertTicket({
        ticketId: row.ticket_id,
        gameId: row.game_id,
        mode: row.mode,
        playerId: row.player_id,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        status: "matched",
        matchedRoomId: roomId,
        region: row.region,
        skill: row.skill
      });
    }
    for (const row of selected) {
      await room.setReady(row.player_id, true);
    }
    await room.startGame(selected[0]!.player_id);
    const latestSummary = await room.getSummary();

    const roomRecord: RoomIndexRecord = {
      roomId,
      gameId: input.gameId,
      mode: input.mode,
      status: latestSummary.phase === "active" ? "active" : "matching",
      playerCount: latestSummary.playerCount,
      minPlayers: definition.minPlayers,
      maxPlayers: definition.maxPlayers,
      doName
    };
    await repo.upsertRoom(roomRecord);

    const selectedCurrentTicket = selected.some((row) => row.ticket_id === ticket.ticketId);
    return {
      ticket: { ...ticket, status: selectedCurrentTicket ? "matched" : "pending" },
      ...(selectedCurrentTicket ? { matchedRoomId: roomId } : {})
    };
  }

  async cancel(ticketId: string): Promise<boolean> {
    const row = this.ctx.storage.sql
      .exec<QueueRow>("SELECT * FROM queue WHERE ticket_id = ? AND status = 'pending'", ticketId)
      .toArray()[0];
    if (!row) {
      return false;
    }
    this.ctx.storage.sql.exec("UPDATE queue SET status = 'cancelled' WHERE ticket_id = ?", ticketId);
    return new D1Repository(this.env.DB).cancelTicket(ticketId);
  }

  async pendingCount(gameId: string, mode: string, region = "global", skill = "default"): Promise<number> {
    return this.pendingRows(gameId, mode, region, skill).length;
  }

  private pendingRows(gameId: string, mode: string, region: string, skill: string): QueueRow[] {
    return this.ctx.storage.sql
      .exec<QueueRow>(
        `SELECT ticket_id, game_id, mode, player_id, display_name, region, skill, status, created_at
         FROM queue
         WHERE game_id = ? AND mode = ? AND region = ? AND skill = ? AND status = 'pending'
         ORDER BY created_at ASC`,
        gameId,
        mode,
        region,
        skill
      )
      .toArray();
  }

  private migrate(): void {
    this.ctx.storage.sql.exec(`
      CREATE TABLE IF NOT EXISTS queue (
        ticket_id TEXT PRIMARY KEY,
        game_id TEXT NOT NULL,
        mode TEXT NOT NULL,
        player_id TEXT NOT NULL,
        display_name TEXT,
        region TEXT NOT NULL,
        skill TEXT NOT NULL,
        status TEXT NOT NULL,
        matched_room_id TEXT,
        created_at INTEGER NOT NULL
      );
      CREATE INDEX IF NOT EXISTS idx_queue_match
        ON queue (game_id, mode, region, skill, status, created_at);
    `);
  }
}
