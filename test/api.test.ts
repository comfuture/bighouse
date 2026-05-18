import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";

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

    const second = await SELF.fetch("https://bighouse.test/games/gomoku/matchmaking/tickets", {
      method: "POST",
      body: JSON.stringify({ playerId: "m2", mode: "ranked", region: "apac", skill: "beginner" })
    });
    expect(second.status).toBe(201);
    const body = (await second.json()) as { matchedRoomId: string };
    expect(body.matchedRoomId).toMatch(/^room_/u);
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
});
