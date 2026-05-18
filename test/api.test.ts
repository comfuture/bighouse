import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";

describe("HTTP API", () => {
  it("lists built-in games and creates a lobby room", async () => {
    const gamesResponse = await SELF.fetch("https://bighouse.test/games");
    expect(gamesResponse.status).toBe(200);
    const gamesBody = (await gamesResponse.json()) as { games: Array<{ gameId: string }> };
    expect(gamesBody.games.map((game) => game.gameId)).toEqual(["card-demo", "gomoku"]);

    const joinResponse = await SELF.fetch("https://bighouse.test/games/gomoku/lobbies/default/join", {
      method: "POST",
      body: JSON.stringify({ playerId: "p1" })
    });
    expect(joinResponse.status).toBe(200);
    const joinBody = (await joinResponse.json()) as { roomId: string; wsUrl: string };
    expect(joinBody.roomId).toMatch(/^room_/u);
    expect(joinBody.wsUrl).toContain(`/rooms/${joinBody.roomId}/ws`);
  });

  it("matches two players through matchmaking tickets", async () => {
    const first = await SELF.fetch("https://bighouse.test/games/gomoku/matchmaking/tickets", {
      method: "POST",
      body: JSON.stringify({ playerId: "m1", mode: "ranked", region: "apac", skill: "beginner" })
    });
    expect(first.status).toBe(202);
    const firstBody = (await first.json()) as { ticket: { ticketId: string } };

    const second = await SELF.fetch("https://bighouse.test/games/gomoku/matchmaking/tickets", {
      method: "POST",
      body: JSON.stringify({ playerId: "m2", mode: "ranked", region: "apac", skill: "beginner" })
    });
    expect(second.status).toBe(201);
    const body = (await second.json()) as { matchedRoomId: string };
    expect(body.matchedRoomId).toMatch(/^room_/u);

    const roomResponse = await SELF.fetch(`https://bighouse.test/rooms/${body.matchedRoomId}`);
    const roomBody = (await roomResponse.json()) as {
      room: { status: string; playerCount: number };
      summary: { phase: string; playerCount: number };
    };
    expect(roomBody.room).toMatchObject({ status: "active", playerCount: 2 });
    expect(roomBody.summary).toMatchObject({ phase: "active", playerCount: 2 });

    const ticketRow = await env.DB.prepare("SELECT status, region, skill FROM match_tickets WHERE ticket_id = ?")
      .bind(firstBody.ticket.ticketId)
      .first<{ status: string; region: string; skill: string }>();
    expect(ticketRow).toEqual({ status: "matched", region: "apac", skill: "beginner" });
  });

  it("upgrades room WebSockets through the room route", async () => {
    const joinResponse = await SELF.fetch("https://bighouse.test/games/card-demo/lobbies/default/join", {
      method: "POST",
      body: JSON.stringify({ playerId: "ws-p1" })
    });
    const joinBody = (await joinResponse.json()) as { wsUrl: string };
    const wsResponse = await SELF.fetch(joinBody.wsUrl.replace("wss://", "https://").replace("ws://", "http://"), {
      headers: { Upgrade: "websocket" }
    });
    expect(wsResponse.status).toBe(101);
    expect(wsResponse.webSocket).toBeDefined();
    wsResponse.webSocket?.accept();
    wsResponse.webSocket?.close();
  });

  it("synchronizes closed gomoku rooms and match results into D1", async () => {
    const firstJoin = await SELF.fetch("https://bighouse.test/games/gomoku/lobbies/win/join", {
      method: "POST",
      body: JSON.stringify({ playerId: "winner" })
    });
    const firstJoinBody = (await firstJoin.json()) as { roomId: string; doName: string };
    const secondJoin = await SELF.fetch("https://bighouse.test/games/gomoku/lobbies/win/join", {
      method: "POST",
      body: JSON.stringify({ playerId: "other" })
    });
    expect(secondJoin.status).toBe(200);

    const room = env.ROOM_DO.getByName(firstJoinBody.doName) as unknown as RoomDO;
    const moves = [
      ["winner", 0, 0],
      ["other", 0, 1],
      ["winner", 1, 0],
      ["other", 1, 1],
      ["winner", 2, 0],
      ["other", 2, 1],
      ["winner", 3, 0],
      ["other", 3, 1],
      ["winner", 4, 0]
    ] as const;
    let version = 2;
    for (const [playerId, x, y] of moves) {
      const result = await room.submitAction({
        playerId,
        clientActionId: `${playerId}-${x}-${y}`,
        expectedVersion: version,
        type: "placeStone",
        payload: { x, y }
      });
      version = result.version;
    }

    const roomResponse = await SELF.fetch(`https://bighouse.test/rooms/${firstJoinBody.roomId}`);
    const roomBody = (await roomResponse.json()) as {
      room: { status: string; closedAt: string | null };
      summary: { phase: string };
    };
    expect(roomBody.room.status).toBe("closed");
    expect(roomBody.room.closedAt).toBeTruthy();
    expect(roomBody.summary.phase).toBe("closed");

    const resultRow = await env.DB.prepare("SELECT status, winner_player_id FROM match_results WHERE room_id = ?")
      .bind(firstJoinBody.roomId)
      .first<{ status: string; winner_player_id: string }>();
    expect(resultRow).toEqual({ status: "closed", winner_player_id: "winner" });
  });
});
