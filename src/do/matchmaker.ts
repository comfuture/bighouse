import { resolvePlayerLimits } from "../core/game-settings";
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
    // Matching spans RPC awaits. Serialize it so concurrent retries cannot select
    // the same pending players into two rooms.
    return this.ctx.blockConcurrencyWhile(() => this.enqueueTicket(input));
  }

  private async enqueueTicket(input: EnqueueTicketInput): Promise<MatchmakerResult> {
    const definition = getGameDefinition(input.gameId);
    const { minPlayers, maxPlayers } = resolvePlayerLimits(definition, input);
    const repo = new D1Repository(this.env.DB);
    await repo.upsertGame(definition.metadata);
    const region = input.region ?? "global";
    const skill = input.skill ?? "default";
    const existing = this.pendingRows(input.gameId, input.mode, region, skill).find((row) => row.player_id === input.playerId);
    const ticket: MatchmakerTicket = {
      ticketId: existing?.ticket_id ?? createId("ticket"),
      gameId: input.gameId,
      mode: input.mode,
      playerId: input.playerId,
      ...(input.displayName ? { displayName: input.displayName } : {}),
      status: "pending",
      region,
      skill
    };
    if (!existing) this.ctx.storage.sql.exec(
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

    const allPending = this.pendingRows(input.gameId, input.mode, ticket.region, ticket.skill);
    const seenPlayers = new Set<string>();
    const pending = allPending.filter((row) => {
      if (seenPlayers.has(row.player_id)) return false;
      seenPlayers.add(row.player_id);
      return true;
    });
    if (pending.length < minPlayers) {
      return { ticket };
    }

    const selected = pending.slice(0, minPlayers);
    const roomId = createId("room");
    const doName = roomDoName(roomId);
    const room = this.env.ROOM_DO.getByName(doName);
    const initializeInput: InitializeRoomInput = {
      roomId,
      gameId: input.gameId,
      mode: input.mode,
      minPlayers,
      maxPlayers
    };
    await room.initialize(initializeInput);
    for (const row of selected) {
      await room.join({
        playerId: row.player_id,
        ...(row.display_name ? { displayName: row.display_name } : {})
      });
    }
    const hostPlayerId = selected[0]!.player_id;
    for (const row of selected.filter((candidate) => candidate.player_id !== hostPlayerId)) {
      await room.setReady(row.player_id, true);
    }
    const latestSummary = await room.startGame(hostPlayerId);
    // Only a successfully started room can consume tickets. Also settle any old
    // duplicate tickets for these players, so they cannot form another match.
    const selectedPlayers = new Set(selected.map((row) => row.player_id));
    const matchedTickets = allPending.filter((row) => selectedPlayers.has(row.player_id));
    for (const row of matchedTickets) {
      this.ctx.storage.sql.exec("UPDATE queue SET status = 'matched', matched_room_id = ? WHERE ticket_id = ?", roomId, row.ticket_id);
    }
    for (const row of matchedTickets) {
      await repo.upsertTicket({
        ticketId: row.ticket_id, gameId: row.game_id, mode: row.mode, playerId: row.player_id,
        ...(row.display_name ? { displayName: row.display_name } : {}),
        status: "matched", matchedRoomId: roomId, region: row.region, skill: row.skill
      });
    }

    const roomRecord: RoomIndexRecord = {
      roomId,
      gameId: input.gameId,
      mode: input.mode,
      status: latestSummary.phase === "active" ? "active" : "matching",
      playerCount: latestSummary.playerCount,
      minPlayers,
      maxPlayers,
      doName
    };
    await repo.upsertRoom(roomRecord);

    const selectedCurrentTicket = selectedPlayers.has(ticket.playerId);
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
    return new Set(this.pendingRows(gameId, mode, region, skill).map((row) => row.player_id)).size;
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
