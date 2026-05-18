import "./styles.css";
import type { GomokuGameInstance, GomokuPrivateView, GomokuPublicView } from "@bighouse/gomoku";

type Game = {
  gameId: string;
  displayName: string;
  minPlayers: number;
  maxPlayers: number;
};

type ChatMessage = {
  scope: "lobby" | "room";
  visibility: "public" | "private";
  playerId: string;
  displayName?: string;
  targetPlayerId?: string;
  body: string;
  createdAt: number;
};

type ServerMessage = {
  type: string;
  roomId: string;
  version: number;
  payload: Record<string, unknown>;
};

type RoomSnapshot = {
  roomId: string;
  gameId: string;
  mode: string;
  phase: "waiting" | "active" | "closed";
  version: number;
  players: Array<{ playerId: string; displayName?: string; seat: number; connected: boolean }>;
  publicView: Record<string, unknown>;
  privateView: Record<string, unknown>;
};

type RoomJoinResponse = {
  roomId: string;
  lobbyWsUrl: string;
  wsUrl: string;
  summary: { version: number };
};

type MatchTicket = {
  ticketId: string;
  playerId: string;
  status: "pending" | "matched" | "cancelled";
  matchedRoomId?: string | null;
};

type MatchTicketResponse = {
  ticket: MatchTicket;
  matchedRoomId?: string;
  wsUrl?: string;
};

type GameModule = typeof import("@bighouse/gomoku");

const gameLoaders = {
  gomoku: () => import("@bighouse/gomoku")
} satisfies Record<string, () => Promise<GameModule>>;

const state = {
  games: [] as Game[],
  selectedGameId: "gomoku",
  playerId: localStorage.getItem("bighouse.playerId") ?? `player-${crypto.randomUUID().slice(0, 8)}`,
  displayName: localStorage.getItem("bighouse.displayName") ?? "",
  mode: "default",
  roomId: "",
  lobbyWs: undefined as WebSocket | undefined,
  roomWs: undefined as WebSocket | undefined,
  room: undefined as RoomSnapshot | undefined,
  roomChat: [] as ChatMessage[],
  lobbyChat: [] as ChatMessage[],
  gameInstance: undefined as GomokuGameInstance | undefined,
  matchPollId: undefined as number | undefined,
  status: "Loading games..."
};

const app = document.querySelector<HTMLElement>("#app");
if (!app) {
  throw new Error("Missing #app");
}
const appRoot = app;

appRoot.innerHTML = `
  <section class="app-shell">
    <header class="topbar">
      <div>
        <p class="eyebrow">Bighouse</p>
        <h1>Multiplayer game lobby</h1>
      </div>
      <div class="connection" data-role="status"></div>
    </header>

    <section class="identity-bar" aria-label="Player identity">
      <label>Player ID <input data-role="player-id" autocomplete="off" /></label>
      <label>Display name <input data-role="display-name" autocomplete="off" placeholder="Alice" /></label>
      <label>Lobby mode <input data-role="mode" autocomplete="off" /></label>
    </section>

    <section class="layout">
      <aside class="panel games-panel">
        <div class="panel-header">
          <h2>Games</h2>
          <button data-role="refresh-games" type="button">Refresh</button>
        </div>
        <div class="game-list" data-role="games"></div>
      </aside>

      <section class="panel lobby-panel">
        <div class="panel-header">
          <h2>Lobby</h2>
          <div class="button-row">
            <button data-role="join-lobby" type="button">Create / Join room</button>
            <button data-role="matchmake" type="button">Matchmake</button>
          </div>
        </div>
        <div class="room-summary" data-role="room-summary"></div>
        <div class="chat-log" data-role="lobby-chat"></div>
        <form class="chat-form" data-role="lobby-chat-form">
          <input data-role="lobby-chat-target" placeholder="target playerId (optional)" />
          <input data-role="lobby-chat-body" placeholder="Lobby message" />
          <button type="submit">Send</button>
        </form>
      </section>

      <section class="panel room-panel">
        <div class="panel-header">
          <h2>Room</h2>
          <button data-role="leave-room" type="button">Leave</button>
        </div>
        <div class="players" data-role="players"></div>
        <div class="game-host" data-role="game-host"></div>
        <div class="chat-log" data-role="room-chat"></div>
        <form class="chat-form" data-role="room-chat-form">
          <input data-role="room-chat-target" placeholder="target playerId (optional)" />
          <input data-role="room-chat-body" placeholder="Room message" />
          <button type="submit">Send</button>
        </form>
      </section>
    </section>
  </section>
`;

const els = {
  status: must("[data-role='status']"),
  playerId: must<HTMLInputElement>("[data-role='player-id']"),
  displayName: must<HTMLInputElement>("[data-role='display-name']"),
  mode: must<HTMLInputElement>("[data-role='mode']"),
  games: must("[data-role='games']"),
  refreshGames: must<HTMLButtonElement>("[data-role='refresh-games']"),
  joinLobby: must<HTMLButtonElement>("[data-role='join-lobby']"),
  matchmake: must<HTMLButtonElement>("[data-role='matchmake']"),
  roomSummary: must("[data-role='room-summary']"),
  lobbyChat: must("[data-role='lobby-chat']"),
  lobbyChatForm: must<HTMLFormElement>("[data-role='lobby-chat-form']"),
  lobbyChatTarget: must<HTMLInputElement>("[data-role='lobby-chat-target']"),
  lobbyChatBody: must<HTMLInputElement>("[data-role='lobby-chat-body']"),
  players: must("[data-role='players']"),
  gameHost: must("[data-role='game-host']"),
  leaveRoom: must<HTMLButtonElement>("[data-role='leave-room']"),
  roomChat: must("[data-role='room-chat']"),
  roomChatForm: must<HTMLFormElement>("[data-role='room-chat-form']"),
  roomChatTarget: must<HTMLInputElement>("[data-role='room-chat-target']"),
  roomChatBody: must<HTMLInputElement>("[data-role='room-chat-body']")
};

els.playerId.value = state.playerId;
els.displayName.value = state.displayName;
els.mode.value = state.mode;

els.playerId.addEventListener("input", () => {
  state.playerId = els.playerId.value.trim();
  localStorage.setItem("bighouse.playerId", state.playerId);
});
els.displayName.addEventListener("input", () => {
  state.displayName = els.displayName.value.trim();
  localStorage.setItem("bighouse.displayName", state.displayName);
});
els.mode.addEventListener("input", () => {
  state.mode = els.mode.value.trim() || "default";
});
els.refreshGames.addEventListener("click", () => void loadGames());
els.joinLobby.addEventListener("click", () => void createOrJoinRoom());
els.matchmake.addEventListener("click", () => void matchmake());
els.leaveRoom.addEventListener("click", () => disconnectRoom());
els.lobbyChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat("lobby", els.lobbyChatBody.value, els.lobbyChatTarget.value);
  els.lobbyChatBody.value = "";
});
els.roomChatForm.addEventListener("submit", (event) => {
  event.preventDefault();
  sendChat("room", els.roomChatBody.value, els.roomChatTarget.value);
  els.roomChatBody.value = "";
});

void loadGames();

async function loadGames(): Promise<void> {
  setStatus("Loading games...");
  const res = await fetch("/games");
  const data = (await res.json()) as { games: Game[] };
  state.games = data.games;
  state.selectedGameId = state.games.some((game) => game.gameId === state.selectedGameId)
    ? state.selectedGameId
    : state.games[0]?.gameId ?? "gomoku";
  render();
  setStatus("Ready");
}

async function createOrJoinRoom(): Promise<void> {
  ensureIdentity();
  setStatus("Joining lobby room...");
  const res = await fetch(`/games/${state.selectedGameId}/lobbies/${state.mode}/join`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: state.playerId, displayName: state.displayName || undefined })
  });
  const data = (await res.json()) as RoomJoinResponse;
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  state.roomId = data.roomId;
  connectLobby(data.lobbyWsUrl);
  await connectRoom(data.wsUrl);
  setStatus(`Joined ${data.roomId}`);
}

async function matchmake(): Promise<void> {
  ensureIdentity();
  stopMatchPolling();
  setStatus("Waiting for match...");
  const res = await fetch(`/games/${state.selectedGameId}/matchmaking/tickets`, {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({ playerId: state.playerId, displayName: state.displayName || undefined, mode: state.mode })
  });
  const data = (await res.json()) as MatchTicketResponse;
  if (!res.ok) {
    throw new Error(JSON.stringify(data));
  }
  if (data.matchedRoomId || data.ticket.matchedRoomId) {
    await connectMatchedRoom(data.matchedRoomId ?? data.ticket.matchedRoomId ?? "", data.wsUrl);
    return;
  }
  startMatchPolling(data.ticket.ticketId);
  setStatus("Ticket queued. Waiting for another player...");
}

function connectLobby(url: string): void {
  if (state.lobbyWs?.readyState === WebSocket.OPEN) {
    state.lobbyWs.close();
  }
  const ws = new WebSocket(url);
  state.lobbyWs = ws;
  ws.addEventListener("message", (event) => handleLobbyMessage(JSON.parse(String(event.data)) as ServerMessage));
}

async function connectRoom(url: string): Promise<void> {
  disconnectRoom();
  const ws = new WebSocket(url);
  state.roomWs = ws;
  ws.addEventListener("message", (event) => void handleRoomMessage(JSON.parse(String(event.data)) as ServerMessage));
  await new Promise<void>((resolve, reject) => {
    ws.addEventListener("open", () => resolve(), { once: true });
    ws.addEventListener("error", () => reject(new Error("Room WebSocket failed")), { once: true });
  });
}

function disconnectRoom(): void {
  stopMatchPolling();
  state.roomWs?.close();
  state.roomWs = undefined;
  state.room = undefined;
  state.gameInstance?.destroy();
  state.gameInstance = undefined;
  render();
}

function startMatchPolling(ticketId: string): void {
  state.matchPollId = window.setInterval(() => {
    void pollMatchTicket(ticketId);
  }, 1500);
}

function stopMatchPolling(): void {
  if (state.matchPollId !== undefined) {
    window.clearInterval(state.matchPollId);
    state.matchPollId = undefined;
  }
}

async function pollMatchTicket(ticketId: string): Promise<void> {
  const res = await fetch(`/matchmaking/tickets/${encodeURIComponent(ticketId)}`);
  const data = (await res.json()) as MatchTicketResponse;
  if (!res.ok) {
    stopMatchPolling();
    setStatus("Match ticket expired or unavailable");
    return;
  }
  if (data.ticket.status === "cancelled") {
    stopMatchPolling();
    setStatus("Match ticket cancelled");
    return;
  }
  if (data.ticket.matchedRoomId) {
    await connectMatchedRoom(data.ticket.matchedRoomId, data.wsUrl);
  }
}

async function connectMatchedRoom(roomId: string, wsUrl?: string): Promise<void> {
  if (!roomId) {
    throw new Error("Matched room id is missing");
  }
  stopMatchPolling();
  state.roomId = roomId;
  await connectRoom(wsUrl ?? roomWebsocketUrl(roomId));
  setStatus(`Matched ${roomId}`);
}

function roomWebsocketUrl(roomId: string): string {
  const url = new URL(`/rooms/${roomId}/ws`, window.location.href);
  url.protocol = window.location.protocol === "https:" ? "wss:" : "ws:";
  url.searchParams.set("playerId", state.playerId);
  return url.toString();
}

function handleLobbyMessage(message: ServerMessage): void {
  if (message.type === "chat") {
    state.lobbyChat.push((message.payload as { message: ChatMessage }).message);
    renderChat();
  }
}

async function handleRoomMessage(message: ServerMessage): Promise<void> {
  if (message.type === "snapshot") {
    state.room = message.payload as unknown as RoomSnapshot;
    await mountOrUpdateGame();
    render();
    return;
  }
  if (message.type === "event" || message.type === "privateEvent") {
    await requestFreshSnapshot();
    return;
  }
  if (message.type === "chat") {
    state.roomChat.push((message.payload as { message: ChatMessage }).message);
    renderChat();
    return;
  }
  if (message.type === "error") {
    setStatus(`Error: ${(message.payload as { message?: string }).message ?? "unknown"}`);
  }
}

async function requestFreshSnapshot(): Promise<void> {
  if (!state.roomWs || state.roomWs.readyState !== WebSocket.OPEN) {
    return;
  }
  state.roomWs.send(JSON.stringify({ type: "joinRoom", playerId: state.playerId, displayName: state.displayName || undefined }));
}

async function mountOrUpdateGame(): Promise<void> {
  if (!state.room) {
    return;
  }
  const loader = gameLoaders[state.room.gameId as keyof typeof gameLoaders];
  if (!loader) {
    els.gameHost.innerHTML = `<div class="empty-state">No client module installed for ${state.room.gameId}.</div>`;
    return;
  }
  const module = await loader();
  if (!state.gameInstance) {
    state.gameInstance = module.createGomokuGame(els.gameHost, {
      playerId: state.playerId,
      version: state.room.version,
      publicView: state.room.publicView as GomokuPublicView,
      privateView: state.room.privateView as GomokuPrivateView,
      sendAction(action) {
        state.roomWs?.send(
          JSON.stringify({
            type: "action",
            playerId: state.playerId,
            clientActionId: crypto.randomUUID(),
            expectedVersion: state.room?.version ?? 0,
            action
          })
        );
      }
    });
  } else {
    state.gameInstance.update({
      playerId: state.playerId,
      version: state.room.version,
      publicView: state.room.publicView as GomokuPublicView,
      privateView: state.room.privateView as GomokuPrivateView
    });
  }
}

function sendChat(scope: "lobby" | "room", body: string, target: string): void {
  const ws = scope === "lobby" ? state.lobbyWs : state.roomWs;
  if (!ws || ws.readyState !== WebSocket.OPEN || !body.trim()) {
    return;
  }
  ws.send(
    JSON.stringify({
      type: "chat",
      playerId: state.playerId,
      targetPlayerId: target.trim() || undefined,
      body
    })
  );
}

function render(): void {
  els.status.textContent = state.status;
  els.games.innerHTML = state.games
    .map(
      (game) => `
        <button type="button" class="game-card ${game.gameId === state.selectedGameId ? "is-selected" : ""}" data-game-id="${game.gameId}">
          <strong>${escapeHtml(game.displayName)}</strong>
          <span>${game.minPlayers}-${game.maxPlayers} players</span>
          <small>${game.gameId === "gomoku" ? "Client module lazy-loaded after room entry" : "Server sample only"}</small>
        </button>
      `
    )
    .join("");
  for (const button of els.games.querySelectorAll<HTMLButtonElement>("[data-game-id]")) {
    button.addEventListener("click", () => {
      state.selectedGameId = button.dataset.gameId ?? "gomoku";
      render();
    });
  }
  els.roomSummary.textContent = state.room
    ? `${state.room.gameId} / ${state.room.roomId} / ${state.room.phase} / v${state.room.version}`
    : "No active room.";
  els.players.innerHTML =
    state.room?.players
      .map((player) => `<span class="player ${player.connected ? "is-online" : ""}">${escapeHtml(player.displayName || player.playerId)}</span>`)
      .join("") ?? "";
  renderChat();
}

function renderChat(): void {
  els.lobbyChat.innerHTML = renderMessages(state.lobbyChat);
  els.roomChat.innerHTML = renderMessages(state.roomChat);
}

function renderMessages(messages: ChatMessage[]): string {
  return messages
    .slice(-80)
    .map((message) => {
      const target = message.targetPlayerId ? ` -> ${message.targetPlayerId}` : "";
      return `<div class="chat-message is-${message.visibility}">
        <span>${escapeHtml(message.displayName || message.playerId)}${escapeHtml(target)}</span>
        <p>${escapeHtml(message.body)}</p>
      </div>`;
    })
    .join("");
}

function setStatus(status: string): void {
  state.status = status;
  els.status.textContent = status;
}

function ensureIdentity(): void {
  state.playerId = els.playerId.value.trim();
  state.displayName = els.displayName.value.trim();
  state.mode = els.mode.value.trim() || "default";
  if (!state.playerId) {
    throw new Error("Player ID is required");
  }
}

function must<T extends Element = HTMLElement>(selector: string): T {
  const element = appRoot.querySelector<T>(selector);
  if (!element) {
    throw new Error(`Missing ${selector}`);
  }
  return element;
}

function escapeHtml(value: string): string {
  return value.replace(/[&<>"']/g, (char) => {
    const replacements: Record<string, string> = {
      "&": "&amp;",
      "<": "&lt;",
      ">": "&gt;",
      '"': "&quot;",
      "'": "&#39;"
    };
    return replacements[char] ?? char;
  });
}
