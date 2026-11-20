<template>
  <div class="portal-page">
    <PortalTopbar>
      <RouterLink class="portal-back-link" to="/">
        <UIcon name="i-lucide-arrow-left" aria-hidden="true" />
        All games
      </RouterLink>
    </PortalTopbar>

    <section class="portal-panel lobby-header" aria-labelledby="lobby-title">
      <div class="lobby-header-art">
        <img v-if="gameMetadata?.thumbnail" :src="gameMetadata.thumbnail.src" :alt="gameMetadata.thumbnail.alt" />
      </div>
      <div class="lobby-header-copy">
        <h1 id="lobby-title">{{ displayGameName }}</h1>
        <p>{{ gameDescription }}</p>
        <div class="portal-game-meta">
          <span v-if="gameMetadata"><UIcon name="i-lucide-users" aria-hidden="true" />{{ playerRangeLabel(gameMetadata) }}</span>
          <span v-if="gameMetadata">{{ categoryLabel(gameMetadata) }}</span>
        </div>
      </div>
      <div class="lobby-header-action">
        <button class="portal-primary-action lobby-play-now" type="button" :disabled="busy || invalidMode" @click="quickPlay">
          <UIcon :name="quickJoining ? 'i-lucide-loader-circle' : 'i-lucide-play'" :class="{ 'portal-spin': quickJoining }" aria-hidden="true" />
          {{ quickJoining ? "Finding a seat…" : "Play now" }}
        </button>
        <p>Takes a free seat in an open room, or opens a new one</p>
      </div>
      <nav v-if="gameMetadata?.modes" class="lobby-mode-switch" aria-label="Game mode">
        <span class="lobby-mode-label">Mode</span>
        <RouterLink
          v-for="option in gameMetadata.modes"
          :key="option.id"
          data-game-elastic="off"
          :to="lobbyPath(gameId, option.id)"
          :aria-current="option.id === mode ? 'page' : undefined"
        >
          {{ option.displayName }}
        </RouterLink>
      </nav>
    </section>

    <div v-if="displayedError" class="portal-alert is-error" role="alert">
      <UIcon name="i-lucide-circle-alert" aria-hidden="true" />
      <div>
        <strong>{{ invalidMode ? "Unknown game mode" : "Something went wrong" }}</strong>
        <span>{{ displayedError }}</span>
      </div>
    </div>

    <div class="lobby-layout">
      <section class="portal-panel lobby-rooms" aria-labelledby="lobby-rooms-title">
        <header class="lobby-section-header">
          <div>
            <h2 id="lobby-rooms-title">Open rooms</h2>
            <p>Pick a room to sit down with the players already there</p>
          </div>
          <button class="portal-secondary-action" type="button" :disabled="refreshingRooms" @click="manualRefreshRooms">
            <UIcon name="i-lucide-refresh-cw" :class="{ 'portal-spin': refreshingRooms }" aria-hidden="true" />
            Refresh
          </button>
        </header>

        <div v-if="loadingRooms" class="lobby-room-list" aria-label="Loading rooms" aria-busy="true">
          <div v-for="index in 3" :key="index" class="lobby-room-row is-skeleton">
            <div class="portal-skeleton-line" />
            <div class="portal-skeleton-line is-short" />
          </div>
        </div>

        <ul v-else-if="rooms.length > 0" class="lobby-room-list">
          <li v-for="room in rooms" :key="room.roomId" class="lobby-room-row">
            <div class="lobby-room-summary">
              <h3>{{ roomLabel(room) }}</h3>
              <p>
                <span :class="['lobby-room-status', `is-${room.status}`]">{{ roomStatusLabel(room) }}</span>
                <span v-if="roomNote(room)">{{ roomNote(room) }}</span>
              </p>
            </div>
            <div class="lobby-room-seats" :aria-label="`${room.playerCount} of ${room.maxPlayers} seats taken`">
              <span class="lobby-room-seat-count">{{ room.playerCount }}/{{ room.maxPlayers }}</span>
              <span v-if="room.maxPlayers <= maxSeatPegs" class="seat-pegs" aria-hidden="true">
                <i v-for="seat in room.maxPlayers" :key="seat" :class="{ 'is-taken': seat <= room.playerCount }" />
              </span>
            </div>
            <button class="lobby-room-join" type="button" :disabled="busy" @click="joinExisting(room.roomId)">
              <UIcon v-if="joiningRoomId === room.roomId" name="i-lucide-loader-circle" class="portal-spin" aria-hidden="true" />
              {{ joiningRoomId === room.roomId ? "Joining…" : "Join" }}
            </button>
          </li>
        </ul>

        <div v-else class="portal-empty">
          <UIcon name="i-lucide-armchair" aria-hidden="true" />
          <div>
            <h3>No rooms are open yet</h3>
            <p>Create one and send the link to the people you want to play with.</p>
          </div>
        </div>
      </section>

      <aside class="lobby-side">
        <section class="portal-panel lobby-create" aria-labelledby="lobby-create-title">
          <h2 id="lobby-create-title">Create a room</h2>
          <p>Open your own room, then share its link or QR code so friends can join.</p>
          <dl class="lobby-create-summary">
            <div v-if="selectedMode">
              <dt>Mode</dt>
              <dd>{{ selectedMode.displayName }}</dd>
            </div>
            <div>
              <dt>Seats</dt>
              <dd>
                {{ seatLabel }}
                <span v-if="roomSeats <= maxSeatPegs" class="seat-pegs" aria-hidden="true">
                  <i v-for="seat in roomSeats" :key="seat" />
                </span>
              </dd>
            </div>
          </dl>
          <label v-if="gameId === 'yutnori'" class="lobby-rule-option">
            <input v-model="backDo" type="checkbox" />
            <span>
              Use back-do (빽도)
              <small>Pieces finish once they pass the exit</small>
            </span>
          </label>
          <button class="portal-secondary-action lobby-create-button" type="button" :disabled="busy || invalidMode" @click="createRoom">
            <UIcon :name="creatingRoom ? 'i-lucide-loader-circle' : 'i-lucide-plus'" :class="{ 'portal-spin': creatingRoom }" aria-hidden="true" />
            {{ creatingRoom ? "Opening room…" : "Create room" }}
          </button>
        </section>

        <ChatPanel title="Lobby chat" :messages="chat" @send="sendChat" />
      </aside>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatPanel from "../components/ChatPanel.vue";
import PortalTopbar from "../components/PortalTopbar.vue";
import { createLobbyRoom, joinRoom, listLobbyRooms, lobbyWebsocketUrl, quickJoinLobby } from "../api";
import { getClientGameMetadata } from "../game-plugins";
import { identity, identityReady } from "../identity";
import { categoryLabel, lobbyPath, playerRangeLabel, rememberRecentGame } from "../portal";
import { parseServerMessage } from "../socket";
import type { ChatMessage, RoomIndex } from "../types";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.gameId));
const mode = computed(() => String(route.params.mode));
const gameMetadata = computed(() => getClientGameMetadata(gameId.value));
const selectedMode = computed(() => gameMetadata.value?.modes?.find((entry) => entry.id === mode.value));
const invalidMode = computed(() => Boolean(gameMetadata.value?.modes && !selectedMode.value));
const backDo = ref(true);
const displayGameName = computed(() => gameMetadata.value?.displayName ?? gameId.value);
const gameDescription = computed(() => gameMetadata.value?.description ?? "Join an open room or create your own.");
/** Rooms with more seats than this show the count alone, without pegs. */
const maxSeatPegs = 8;
const roomSeats = computed(() => selectedMode.value?.maxPlayers ?? gameMetadata.value?.maxPlayers ?? 2);
const seatLabel = computed(() => {
  const min = selectedMode.value?.minPlayers ?? gameMetadata.value?.minPlayers ?? roomSeats.value;
  return min === roomSeats.value ? `${roomSeats.value} players` : `${min}–${roomSeats.value} players`;
});
const rooms = ref<RoomIndex[]>([]);
const chat = ref<ChatMessage[]>([]);
const error = ref("");
const roomListError = ref("");
const displayedError = computed(() => invalidMode.value ? "This game has no such mode. Pick one of the modes above." : error.value || roomListError.value);
const loadingRooms = ref(true);
const refreshingRooms = ref(false);
const creatingRoom = ref(false);
const quickJoining = ref(false);
const joiningRoomId = ref("");
const busy = computed(() => creatingRoom.value || quickJoining.value || joiningRoomId.value !== "");
let ws: WebSocket | undefined;
let pollId: number | undefined;
let reconnectTimer: number | undefined;
let reconnectAttempt = 0;
let closingLobby = false;

onMounted(() => {
  rememberRecentGame(gameId.value);
  void refreshRooms();
  if (identityReady.value) connectLobby();
  pollId = window.setInterval(() => void refreshRooms(), 3000);
});

watch([gameId, mode], () => {
  rememberRecentGame(gameId.value);
  rooms.value = [];
  chat.value = [];
  error.value = "";
  loadingRooms.value = true;
  void refreshRooms();
  if (identityReady.value) connectLobby();
});

watch(identityReady, (ready) => {
  if (ready) connectLobby();
});

watch(() => identity.displayName, () => {
  if (identityReady.value) connectLobby();
});

onBeforeUnmount(() => {
  closingLobby = true;
  clearReconnectTimer();
  ws?.close();
  if (pollId !== undefined) window.clearInterval(pollId);
});

async function refreshRooms(): Promise<void> {
  if (invalidMode.value) { loadingRooms.value = false; return; }
  const requestedGame = gameId.value;
  const requestedMode = mode.value;
  try {
    const nextRooms = await listLobbyRooms(requestedGame, requestedMode);
    if (requestedGame !== gameId.value || requestedMode !== mode.value) return;
    rooms.value = nextRooms;
    roomListError.value = "";
  } catch (cause) {
    roomListError.value = cause instanceof Error ? cause.message : "Failed to load rooms";
  } finally {
    loadingRooms.value = false;
  }
}

async function manualRefreshRooms(): Promise<void> {
  if (refreshingRooms.value) return;
  refreshingRooms.value = true;
  await refreshRooms();
  refreshingRooms.value = false;
}

function roomOptions(): { minPlayers?: number; maxPlayers?: number; config?: Record<string, unknown> } {
  return selectedMode.value ? {
    minPlayers: selectedMode.value.minPlayers,
    maxPlayers: selectedMode.value.maxPlayers,
    ...(gameId.value === "yutnori" ? { config: { backDo: backDo.value } } : {})
  } : {};
}

async function quickPlay(): Promise<void> {
  if (busy.value) return;
  quickJoining.value = true;
  try {
    const result = await quickJoinLobby(gameId.value, mode.value, roomOptions());
    await router.push(`/game/${encodeURIComponent(gameId.value)}/${encodeURIComponent(result.roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Could not find a room";
  } finally {
    quickJoining.value = false;
  }
}

async function createRoom(): Promise<void> {
  if (busy.value) return;
  creatingRoom.value = true;
  try {
    const result = await createLobbyRoom(gameId.value, mode.value, roomOptions());
    await router.push(`/game/${encodeURIComponent(gameId.value)}/${encodeURIComponent(result.roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to create room";
  } finally {
    creatingRoom.value = false;
  }
}

async function joinExisting(roomId: string): Promise<void> {
  if (busy.value) return;
  joiningRoomId.value = roomId;
  try {
    await joinRoom(roomId);
    await router.push(`/game/${encodeURIComponent(gameId.value)}/${encodeURIComponent(roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to join room";
  } finally {
    joiningRoomId.value = "";
  }
}

function roomLabel(room: RoomIndex): string {
  if (room.roomName) return room.roomName;
  const suffix = room.roomId.replace(/^room_/, "").slice(-6).toUpperCase();
  return suffix ? `Room ${suffix}` : "Room";
}

function roomStatusLabel(room: RoomIndex): string {
  if (room.isFixed) return "Always open";
  if (room.status === "active") return "In game";
  if (room.status === "matching") return "Ready to start";
  if (room.status === "closed") return "Closed";
  return "Waiting for players";
}

function roomNote(room: RoomIndex): string {
  const fixedSpec = gameMetadata.value?.fixedRooms?.find((spec) => spec.roomId === room.roomId);
  if (fixedSpec?.description) return fixedSpec.description;
  const missing = room.minPlayers - room.playerCount;
  if (room.status === "open" && missing > 0) return missing === 1 ? "Needs 1 more" : `Needs ${missing} more`;
  return "";
}

function connectLobby(): void {
  clearReconnectTimer();
  closingLobby = false;
  ws?.close();
  if (invalidMode.value) return;
  const socket = new WebSocket(lobbyWebsocketUrl(gameId.value, mode.value));
  ws = socket;
  socket.addEventListener("open", () => {
    if (ws !== socket) return;
    reconnectAttempt = 0;
    error.value = "";
  });
  socket.addEventListener("message", (event) => {
    if (ws !== socket) return;
    const message = parseServerMessage(event.data);
    if (!message) return;
    if (message.type === "chat") {
      chat.value.push((message.payload as { message: ChatMessage }).message);
    }
  });
  socket.addEventListener("error", () => {
    if (ws !== socket) return;
    error.value = "Lobby chat is not connected";
  });
  socket.addEventListener("close", () => {
    if (!closingLobby && ws === socket) {
      scheduleReconnect();
    }
  });
}

function sendChat(body: string, targetPlayerId?: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "chat", playerId: identity.playerId, targetPlayerId, body }));
}

function scheduleReconnect(): void {
  if (!identityReady.value || reconnectTimer) return;
  const delay = Math.min(500 * 2 ** reconnectAttempt, 5000);
  reconnectAttempt += 1;
  error.value = "Lobby connection lost, reconnecting";
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectLobby();
  }, delay);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}
</script>
