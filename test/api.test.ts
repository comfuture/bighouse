import { env } from "cloudflare:workers";
import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";
import type { RoomDO } from "../src/do/room";
import { cleanupStaleRooms } from "../src/maintenance/stale-rooms";

describe("HTTP API", () => {
  it("lists built-in games and creates a lobby room", async () => {
    const gamesResponse = await SELF.fetch("https://bighouse.test/games");
    expect(gamesResponse.status).toBe(200);
    const gamesBody = (await gamesResponse.json()) as { games: Array<{ gameId: string; description: string; minPlayers: number; maxPlayers: number }> };
    expect(gamesBody.games.map((game) => game.gameId)).toEqual(["card-demo", "chess", "gomoku", "onecard"]);
    expect(gamesBody.games).toContainEqual(
      expect.objectContaining({
        gameId: "gomoku",
        description: expect.stringContaining("five-in-a-row"),
        minPlayers: 2,
        maxPlayers: 2
      })
    );

    await env.DB.prepare(
      `INSERT INTO games (game_id, adapter_key, display_name, enabled, min_players, max_players, config_json)
       VALUES ('stale-game', 'stale-game', 'Stale Game', 1, 1, 2, '{}')`
    ).run();
    await env.DB.prepare("UPDATE games SET enabled = 0 WHERE game_id = 'gomoku'").run();
    const filteredResponse = await SELF.fetch("https://bighouse.test/games");
    const filteredBody = (await filteredResponse.json()) as { games: Array<{ gameId: string }> };
    expect(filteredBody.games.map((game) => game.gameId)).toEqual(["card-demo", "chess", "gomoku", "onecard"]);
    const staleJoinResponse = await SELF.fetch("https://bighouse.test/games/stale-game/lobbies/default/join", {
      method: "POST",
      body: JSON.stringify({ playerId: "p1" })
    });
    expect(staleJoinResponse.status).toBe(404);

    const joinResponse = await SELF.fetch("https://bighouse.test/games/gomoku/lobbies/default/join", {
      method: "POST",
      body: JSON.stringify({ playerId: "p1" })
    });
    expect(joinResponse.status).toBe(200);
    const joinBody = (await joinResponse.json()) as { roomId: string; wsUrl: string };
    expect(joinBody.roomId).toMatch(/^room_/u);
    expect(joinBody.wsUrl).toContain(`/rooms/${joinBody.roomId}/ws`);
  });

  it("creates, lists, and explicitly joins waiting lobby rooms", async () => {
    const mode = `rooms-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "owner", displayName: "Owner" })
    });
    expect(createResponse.status).toBe(200);
    const createBody = (await createResponse.json()) as { roomId: string; summary: { phase: string; hostPlayerId: string } };
    expect(createBody.summary).toMatchObject({ phase: "waiting", hostPlayerId: "owner" });

    const listResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`);
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { rooms: Array<{ roomId: string; status: string; playerCount: number }> };
    expect(listBody.rooms).toContainEqual(expect.objectContaining({ roomId: createBody.roomId, status: "open", playerCount: 1 }));

    const joinResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "guest", displayName: "Guest" })
    });
    expect(joinResponse.status).toBe(200);
    const joinBody = (await joinResponse.json()) as { summary: { phase: string; readyCount: number; playerCount: number }; wsUrl: string };
    expect(joinBody.summary).toMatchObject({ phase: "waiting", readyCount: 0, playerCount: 2 });
    expect(joinBody.wsUrl).toContain(`/rooms/${createBody.roomId}/ws`);

    const fullListResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`);
    expect(fullListResponse.status).toBe(200);
    const fullListBody = (await fullListResponse.json()) as { rooms: Array<{ roomId: string }> };
    expect(fullListBody.rooms.some((room) => room.roomId === createBody.roomId)).toBe(false);
  });

  it("creates one card lobby rooms before players are seated", async () => {
    const mode = `onecard-rooms-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/onecard/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "onecard-owner", displayName: "Owner" })
    });
    expect(createResponse.status).toBe(200);
    const createBody = (await createResponse.json()) as { roomId: string; summary: { phase: string; hostPlayerId: string; playerCount: number } };
    expect(createBody.summary).toMatchObject({ phase: "waiting", hostPlayerId: "onecard-owner", playerCount: 1 });
  });

  it("actively hides empty rooms from lobby lists", async () => {
    const mode = `empty-room-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "empty-owner", displayName: "Owner" })
    });
    expect(createResponse.status).toBe(200);
    const createBody = (await createResponse.json()) as { roomId: string; doName: string };
    const room = env.ROOM_DO.getByName(createBody.doName) as unknown as RoomDO;
    await room.leave("empty-owner");

    await env.DB.prepare("UPDATE room_index SET status = 'open', player_count = 1, closed_at = NULL WHERE room_id = ?")
      .bind(createBody.roomId)
      .run();

    const listResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`);
    expect(listResponse.status).toBe(200);
    const listBody = (await listResponse.json()) as { rooms: Array<{ roomId: string }> };
    expect(listBody.rooms.some((candidate) => candidate.roomId === createBody.roomId)).toBe(false);

    const row = await env.DB.prepare("SELECT status FROM room_index WHERE room_id = ?")
      .bind(createBody.roomId)
      .first<{ status: string }>();
    expect(row?.status).toBe("closed");
  });

  it("rejects new room joins after the game leaves the waiting phase", async () => {
    const mode = `active-join-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/card-demo/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "active-host", displayName: "Host" })
    });
    expect(createResponse.status).toBe(200);
    const createBody = (await createResponse.json()) as { roomId: string; doName: string };
    const joinResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "active-guest", displayName: "Guest" })
    });
    expect(joinResponse.status).toBe(200);

    const room = env.ROOM_DO.getByName(createBody.doName) as unknown as RoomDO;
    await room.setReady("active-guest", true);
    await room.startGame("active-host");

    const lateJoin = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "late-player", displayName: "Late" })
    });
    expect(lateJoin.status).toBe(409);

    const reconnect = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "active-host", displayName: "Host" })
    });
    expect(reconnect.status).toBe(200);
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

    const ticketResponse = await SELF.fetch(`https://bighouse.test/matchmaking/tickets/${firstBody.ticket.ticketId}`);
    expect(ticketResponse.status).toBe(200);
    const ticketBody = (await ticketResponse.json()) as {
      ticket: { status: string; matchedRoomId: string };
      wsUrl: string;
    };
    expect(ticketBody.ticket).toMatchObject({ status: "matched", matchedRoomId: body.matchedRoomId });
    expect(ticketBody.wsUrl).toContain(`/rooms/${body.matchedRoomId}/ws`);

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

  it("rejects WebSocket room commands that spoof a different player", async () => {
    const mode = `spoof-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "spoof-host", displayName: "Host" })
    });
    const createBody = (await createResponse.json()) as { roomId: string };
    const joinResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "spoof-guest", displayName: "Guest" })
    });
    const joinBody = (await joinResponse.json()) as { wsUrl: string };
    const wsResponse = await SELF.fetch(joinBody.wsUrl.replace("wss://", "https://").replace("ws://", "http://"), {
      headers: { Upgrade: "websocket" }
    });
    expect(wsResponse.status).toBe(101);
    const ws = wsResponse.webSocket;
    expect(ws).toBeDefined();
    const messages: Array<{ type: string; payload?: { code?: string } }> = [];
    ws!.accept();
    ws!.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)) as { type: string; payload?: { code?: string } });
    });

    ws!.send(JSON.stringify({ type: "ready", playerId: "spoof-host", ready: true }));
    ws!.send(JSON.stringify({ type: "startGame", playerId: "spoof-host" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(messages.filter((message) => message.type === "error" && message.payload?.code === "forbidden")).toHaveLength(2);
    const roomResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}`);
    const roomBody = (await roomResponse.json()) as { summary: { phase: string; readyCount: number } };
    expect(roomBody.summary).toMatchObject({ phase: "waiting", readyCount: 0 });
    ws!.close();
  });

  it("does not broadcast presence for duplicate room joins", async () => {
    const mode = `presence-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "presence-host", displayName: "Host" })
    });
    const createBody = (await createResponse.json()) as { wsUrl: string };
    const wsResponse = await SELF.fetch(createBody.wsUrl.replace("wss://", "https://").replace("ws://", "http://"), {
      headers: { Upgrade: "websocket" }
    });
    expect(wsResponse.status).toBe(101);
    const ws = wsResponse.webSocket;
    expect(ws).toBeDefined();
    const messages: Array<{ type: string }> = [];
    ws!.accept();
    ws!.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)) as { type: string });
    });

    ws!.send(JSON.stringify({ type: "joinRoom", playerId: "presence-host", displayName: "Host" }));
    ws!.send(JSON.stringify({ type: "joinRoom", playerId: "presence-host", displayName: "Host" }));
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(messages.filter((message) => message.type === "presence")).toHaveLength(0);
    expect(messages.filter((message) => message.type === "snapshot").length).toBeGreaterThanOrEqual(1);
    ws!.close();
  });

  it("does not mark a player offline immediately after a transient room socket close", async () => {
    const mode = `disconnect-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "disconnect-host", displayName: "Host" })
    });
    const createBody = (await createResponse.json()) as { roomId: string; doName: string; wsUrl: string };
    const joinResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "disconnect-guest", displayName: "Guest" })
    });
    const joinBody = (await joinResponse.json()) as { wsUrl: string };
    const hostResponse = await SELF.fetch(createBody.wsUrl.replace("wss://", "https://").replace("ws://", "http://"), {
      headers: { Upgrade: "websocket" }
    });
    const guestResponse = await SELF.fetch(joinBody.wsUrl.replace("wss://", "https://").replace("ws://", "http://"), {
      headers: { Upgrade: "websocket" }
    });
    const host = hostResponse.webSocket;
    const guest = guestResponse.webSocket;
    expect(host).toBeDefined();
    expect(guest).toBeDefined();
    const messages: Array<{ type: string; payload?: { playerId?: string; connected?: boolean } }> = [];
    host!.accept();
    guest!.accept();
    host!.addEventListener("message", (event) => {
      messages.push(JSON.parse(String(event.data)) as { type: string; payload?: { playerId?: string; connected?: boolean } });
    });

    guest!.close();
    await new Promise((resolve) => setTimeout(resolve, 50));

    expect(
      messages.some(
        (message) =>
          message.type === "presence" &&
          message.payload?.playerId === "disconnect-guest" &&
          message.payload.connected === false
      )
    ).toBe(false);
    host!.close();
  });

  it("records finished gomoku results without closing reusable rooms", async () => {
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
    await room.setReady("other", true);
    await room.startGame("winner");
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
    let version = 4;
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
    expect(roomBody.room.status).toBe("active");
    expect(roomBody.room.closedAt).toBeNull();
    expect(roomBody.summary.phase).toBe("finished");

    const resultRow = await env.DB.prepare("SELECT status, winner_player_id FROM match_results WHERE room_id = ?")
      .bind(firstJoinBody.roomId)
      .first<{ status: string; winner_player_id: string }>();
    expect(resultRow).toEqual({ status: "finished", winner_player_id: "winner" });
  });

  it("removes stale rooms from lobby lists and direct join paths", async () => {
    const mode = `stale-${crypto.randomUUID()}`;
    const createResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`, {
      method: "POST",
      body: JSON.stringify({ playerId: "stale-host", displayName: "Stale Host" })
    });
    const createBody = (await createResponse.json()) as { roomId: string };
    const joinResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "stale-guest", displayName: "Stale Guest" })
    });
    expect(joinResponse.status).toBe(200);

    const cleanup = await cleanupStaleRooms(env, {
      now: Date.now() + 5 * 60_000 + 1,
      waitingIdleMs: 5 * 60_000,
      activeIdleMs: 30 * 60_000
    });
    expect(cleanup.cleaned).toBeGreaterThanOrEqual(1);

    const listResponse = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/rooms`);
    const listBody = (await listResponse.json()) as { rooms: Array<{ roomId: string }> };
    expect(listBody.rooms.some((room) => room.roomId === createBody.roomId)).toBe(false);

    const rejectedJoin = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/join`, {
      method: "POST",
      body: JSON.stringify({ playerId: "late-player" })
    });
    expect(rejectedJoin.status).toBe(410);

    const wsResponse = await SELF.fetch(`https://bighouse.test/rooms/${createBody.roomId}/ws`, {
      headers: { Upgrade: "websocket" }
    });
    expect(wsResponse.status).toBe(410);
  });
});
