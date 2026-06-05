import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";

type ServerMessage = {
  type: string;
  payload: {
    message?: {
      scope: "lobby" | "room";
      visibility: "public" | "private";
      playerId: string;
      displayName?: string;
      targetPlayerId?: string;
      body: string;
    };
  };
};

describe("chat", () => {
  it("broadcasts public lobby chat and targets private lobby chat", async () => {
    const suffix = crypto.randomUUID();
    const lobbyBase = `https://bighouse.test/games/gomoku/lobbies/chat-${suffix}/ws`;
    const alice = await connect(`${lobbyBase}?playerId=alice-${suffix}&displayName=Alice`);
    const bob = await connect(`${lobbyBase}?playerId=bob-${suffix}&displayName=Bob`);
    const carol = await connect(`${lobbyBase}?playerId=carol-${suffix}&displayName=Carol`);

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `alice-${suffix}`,
        body: "hello lobby"
      })
    );
    await expectChat(alice.messages, "public", "hello lobby");
    await expectChat(bob.messages, "public", "hello lobby");
    await expectChat(carol.messages, "public", "hello lobby");

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `alice-${suffix}`,
        targetPlayerId: `bob-${suffix}`,
        body: "secret lobby"
      })
    );
    await expectChat(alice.messages, "private", "secret lobby");
    await expectChat(bob.messages, "private", "secret lobby");
    await expectNoChat(carol.messages, "secret lobby");

    closeAll(alice.ws, bob.ws, carol.ws);
  });

  it("broadcasts public room chat and targets private room chat", async () => {
    const suffix = crypto.randomUUID();
    const mode = `chat-${suffix}`;
    const joins: Array<{ wsUrl: string }> = [];
    for (const name of ["alice", "bob"]) {
      const response = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/join`, {
        method: "POST",
        body: JSON.stringify({ playerId: `${name}-${suffix}`, displayName: name })
      });
      joins.push((await response.json()) as { wsUrl: string });
    }
    const alice = await connect(joins[0]!.wsUrl);
    const bob = await connect(joins[1]!.wsUrl);
    await expectMessage(alice.messages, (message) => message.type === "snapshot", "room snapshot");

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `alice-${suffix}`,
        body: "hello room"
      })
    );
    await expectChat(alice.messages, "public", "hello room");
    await expectChat(bob.messages, "public", "hello room");

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `alice-${suffix}`,
        targetPlayerId: `bob-${suffix}`,
        body: "secret room"
      })
    );
    await expectChat(alice.messages, "private", "secret room");
    await expectChat(bob.messages, "private", "secret room");

    closeAll(alice.ws, bob.ws);
  });
});

async function connect(url: string): Promise<{ ws: WebSocket; messages: ServerMessage[] }> {
  const response = await SELF.fetch(url.replace("wss://", "https://").replace("ws://", "http://"), {
    headers: { Upgrade: "websocket" }
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  expect(ws).toBeDefined();
  const messages: ServerMessage[] = [];
  ws!.accept();
  ws!.addEventListener("message", (event) => {
    messages.push(JSON.parse(String(event.data)) as ServerMessage);
  });
  return { ws: ws!, messages };
}

async function expectChat(messages: ServerMessage[], visibility: "public" | "private", body: string): Promise<void> {
  const message = await expectMessage(
    messages,
    (candidate) =>
      candidate.type === "chat" &&
      candidate.payload.message?.visibility === visibility &&
      candidate.payload.message.body === body,
    `${visibility} chat ${body}`
  );
  expect(message.payload.message).toMatchObject({ visibility, body });
}

async function expectNoChat(messages: ServerMessage[], body: string): Promise<void> {
  await new Promise((resolve) => setTimeout(resolve, 50));
  expect(
    messages.some((message) => message.type === "chat" && message.payload.message?.body === body)
  ).toBe(false);
}

async function expectMessage(
  messages: ServerMessage[],
  predicate: (message: ServerMessage) => boolean,
  label: string
): Promise<ServerMessage> {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    const found = messages.find(predicate);
    if (found) {
      return found;
    }
    await new Promise((resolve) => setTimeout(resolve, 10));
  }
  throw new Error(`Timed out waiting for ${label}; saw ${JSON.stringify(messages)}`);
}

function closeAll(...sockets: WebSocket[]): void {
  for (const socket of sockets) {
    socket.close();
  }
}
