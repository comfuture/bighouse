import { SELF } from "cloudflare:test";
import { describe, expect, it } from "vitest";
import "../src";

type ServerMessage = {
  type: string;
  payload: {
    code?: string;
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
  it("auto-responds to raw ping without JSON handlers", async () => {
    const suffix = crypto.randomUUID();
    const lobby = await connectRaw(`https://bighouse.test/games/gomoku/lobbies/ping-${suffix}/ws?playerId=ping-lobby-${suffix}`);
    const room = await connectRaw(`https://bighouse.test/rooms/ping-room-${suffix}/ws?playerId=ping-room-${suffix}`);

    lobby.ws.send("ping");
    room.ws.send("ping");

    await expectRawMessage(lobby.messages, "pong", "lobby raw pong");
    await expectRawMessage(room.messages, "pong", "room raw pong");

    closeAll(lobby.ws, room.ws);
  });

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

  it("keeps lobby chat targetable after identity is attached by hello", async () => {
    const suffix = crypto.randomUUID();
    const lobbyBase = `https://bighouse.test/games/gomoku/lobbies/late-lobby-${suffix}/ws`;
    const alice = await connect(lobbyBase);
    const bob = await connect(lobbyBase);

    alice.ws.send(JSON.stringify({ type: "hello", playerId: `late-alice-${suffix}`, displayName: "Alice" }));
    bob.ws.send(JSON.stringify({ type: "hello", playerId: `late-bob-${suffix}`, displayName: "Bob" }));
    await expectMessage(alice.messages, (message) => message.type === "ack", "alice hello ack");
    await expectMessage(bob.messages, (message) => message.type === "ack", "bob hello ack");

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `late-alice-${suffix}`,
        targetPlayerId: `late-bob-${suffix}`,
        body: "late-bound lobby secret"
      })
    );

    await expectChat(alice.messages, "private", "late-bound lobby secret");
    await expectChat(bob.messages, "private", "late-bound lobby secret");

    closeAll(alice.ws, bob.ws);
  });

  it("rejects lobby chat when the message player does not match the socket attachment", async () => {
    const suffix = crypto.randomUUID();
    const lobbyBase = `https://bighouse.test/games/gomoku/lobbies/spoof-lobby-${suffix}/ws`;
    const alice = await connect(`${lobbyBase}?playerId=spoof-alice-${suffix}&displayName=Alice`);
    const bob = await connect(`${lobbyBase}?playerId=spoof-bob-${suffix}&displayName=Bob`);

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `spoof-bob-${suffix}`,
        body: "spoofed lobby message"
      })
    );

    await expectMessage(
      alice.messages,
      (message) => message.type === "error" && message.payload.code === "forbidden",
      "lobby spoof forbidden error"
    );
    await expectNoChat(bob.messages, "spoofed lobby message");

    closeAll(alice.ws, bob.ws);
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

  it("keeps room private chat targetable after identity is attached by joinRoom", async () => {
    const suffix = crypto.randomUUID();
    const mode = `late-room-${suffix}`;
    const joins: Array<{ roomId: string; wsUrl: string }> = [];
    for (const name of ["alice", "bob"]) {
      const response = await SELF.fetch(`https://bighouse.test/games/gomoku/lobbies/${mode}/join`, {
        method: "POST",
        body: JSON.stringify({ playerId: `late-${name}-${suffix}`, displayName: name })
      });
      joins.push((await response.json()) as { roomId: string; wsUrl: string });
    }
    const bareRoomUrl = `https://bighouse.test/rooms/${joins[0]!.roomId}/ws`;
    const alice = await connect(bareRoomUrl);
    const bob = await connect(bareRoomUrl);

    alice.ws.send(JSON.stringify({ type: "joinRoom", playerId: `late-alice-${suffix}`, displayName: "Alice" }));
    bob.ws.send(JSON.stringify({ type: "joinRoom", playerId: `late-bob-${suffix}`, displayName: "Bob" }));
    await expectMessage(alice.messages, (message) => message.type === "snapshot", "alice room snapshot");
    await expectMessage(bob.messages, (message) => message.type === "snapshot", "bob room snapshot");

    alice.ws.send(
      JSON.stringify({
        type: "chat",
        playerId: `late-alice-${suffix}`,
        targetPlayerId: `late-bob-${suffix}`,
        body: "late-bound room secret"
      })
    );

    await expectChat(alice.messages, "private", "late-bound room secret");
    await expectChat(bob.messages, "private", "late-bound room secret");

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

async function connectRaw(url: string): Promise<{ ws: WebSocket; messages: string[] }> {
  const response = await SELF.fetch(url.replace("wss://", "https://").replace("ws://", "http://"), {
    headers: { Upgrade: "websocket" }
  });
  expect(response.status).toBe(101);
  const ws = response.webSocket;
  expect(ws).toBeDefined();
  const messages: string[] = [];
  ws!.accept();
  ws!.addEventListener("message", (event) => {
    messages.push(String(event.data));
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

async function expectRawMessage(messages: string[], expected: string, label: string): Promise<void> {
  const started = Date.now();
  while (Date.now() - started < 1000) {
    if (messages.includes(expected)) {
      return;
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
