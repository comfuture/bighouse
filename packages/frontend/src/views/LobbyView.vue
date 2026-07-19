<template>
  <div class="portal-page">
    <nav class="portal-topbar" aria-label="Lobby navigation">
      <UButton label="All games" icon="i-lucide-arrow-left" color="neutral" variant="ghost" @click="goToGames" />
      <div class="portal-player-chip" aria-label="Current player">
        <UIcon name="i-lucide-user-round" aria-hidden="true" />
        <span>{{ identity.displayName || identity.playerId }}</span>
      </div>
    </nav>

    <section class="game-lobby-hero" :style="lobbyHeroStyle" aria-labelledby="lobby-title">
      <div class="game-lobby-hero-overlay" />
      <div class="game-lobby-hero-content">
        <div class="game-lobby-copy">
          <div class="portal-eyebrow">
            <span class="portal-live-dot" aria-hidden="true" />
            {{ rooms.length }} live {{ rooms.length === 1 ? "room" : "rooms" }}
          </div>
          <h1 id="lobby-title" class="game-lobby-hero-title">{{ displayGameName }}</h1>
          <p class="game-lobby-hero-copy">{{ gameDescription }}</p>
          <div class="game-lobby-badges">
            <span>{{ mode }}</span>
            <span>public lobby</span>
          </div>
        </div>
        <button class="portal-primary-action game-lobby-create" type="button" :disabled="creatingRoom" @click="createRoom">
          <UIcon :name="creatingRoom ? 'i-lucide-loader-circle' : 'i-lucide-plus'" :class="{ 'portal-spin': creatingRoom }" aria-hidden="true" />
          {{ creatingRoom ? "Opening room…" : "Create a room" }}
        </button>
      </div>
    </section>

    <div v-if="displayedError" class="portal-alert is-error" role="alert">
      <UIcon name="i-lucide-circle-alert" aria-hidden="true" />
      <div>
        <strong>Lobby update</strong>
        <span>{{ displayedError }}</span>
      </div>
    </div>

    <div class="game-lobby-layout">
      <section class="lobby-room-directory" aria-labelledby="room-directory-title">
        <header class="portal-section-heading">
          <div>
            <div class="portal-kicker">Open tables</div>
            <h2 id="room-directory-title">Join a live room</h2>
          </div>
          <button class="portal-refresh-button" type="button" :disabled="refreshingRooms" @click="manualRefreshRooms">
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

        <div v-else-if="rooms.length > 0" class="lobby-room-list">
          <article v-for="(room, index) in rooms" :key="room.roomId" class="lobby-room-row">
            <div class="lobby-room-rank" aria-hidden="true">{{ String(index + 1).padStart(2, "0") }}</div>
            <div class="lobby-room-summary">
              <div class="lobby-room-title-line">
                <h3>{{ roomLabel(room.roomId) }}</h3>
                <span :class="['lobby-room-status', `is-${room.status}`]">{{ room.status }}</span>
              </div>
              <div class="lobby-room-meta">
                <span><UIcon name="i-lucide-users" aria-hidden="true" /> {{ room.playerCount }}/{{ room.maxPlayers }}</span>
                <span>Starts at {{ room.minPlayers }}</span>
              </div>
            </div>
            <div class="lobby-room-capacity" :aria-label="`${room.playerCount} of ${room.maxPlayers} seats filled`">
              <span v-for="seat in room.maxPlayers" :key="seat" :class="{ 'is-filled': seat <= room.playerCount }" />
            </div>
            <button
              class="lobby-room-join"
              type="button"
              :disabled="joiningRoomId !== ''"
              @click="joinExisting(room.roomId)"
            >
              <UIcon :name="joiningRoomId === room.roomId ? 'i-lucide-loader-circle' : 'i-lucide-log-in'" :class="{ 'portal-spin': joiningRoomId === room.roomId }" aria-hidden="true" />
              {{ joiningRoomId === room.roomId ? "Joining…" : "Join" }}
            </button>
          </article>
        </div>

        <div v-else class="lobby-empty-state">
          <span class="lobby-empty-icon" aria-hidden="true"><UIcon name="i-lucide-armchair" /></span>
          <div>
            <h3>Be the first at the table</h3>
            <p>No rooms are waiting right now. Open one and invite your crew.</p>
          </div>
          <button class="portal-secondary-action" type="button" :disabled="creatingRoom" @click="createRoom">
            <UIcon name="i-lucide-plus" aria-hidden="true" />
            Create room
          </button>
        </div>
      </section>

      <ChatPanel class="lobby-chat-panel" title="Lobby chat" :messages="chat" @send="sendChat" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatPanel from "../components/ChatPanel.vue";
import { createLobbyRoom, joinRoom, listLobbyRooms, lobbyWebsocketUrl } from "../api";
import { getClientGameMetadata } from "../game-plugins";
import { identity, identityReady } from "../identity";
import { parseServerMessage } from "../socket";
import type { ChatMessage, RoomIndex } from "../types";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.gameId));
const mode = computed(() => String(route.params.mode));
const gameMetadata = computed(() => getClientGameMetadata(gameId.value));
const displayGameName = computed(() => gameMetadata.value?.displayName ?? gameId.value);
const gameDescription = computed(() => gameMetadata.value?.description ?? "Create a room or join an open table.");
const lobbyHeroStyle = computed(() => {
  const thumbnail = gameMetadata.value?.thumbnail;
  if (!thumbnail) return {};
  return {
    "--game-lobby-image": `url(${thumbnail.src})`
  };
});
const rooms = ref<RoomIndex[]>([]);
const chat = ref<ChatMessage[]>([]);
const error = ref("");
const roomListError = ref("");
const displayedError = computed(() => error.value || roomListError.value);
const loadingRooms = ref(true);
const refreshingRooms = ref(false);
const creatingRoom = ref(false);
const joiningRoomId = ref("");
let ws: WebSocket | undefined;
let pollId: number | undefined;
let reconnectTimer: number | undefined;
let reconnectAttempt = 0;
let closingLobby = false;

onMounted(() => {
  void refreshRooms();
  if (identityReady.value) connectLobby();
  pollId = window.setInterval(() => void refreshRooms(), 3000);
});

watch(identityReady, (ready) => {
  if (ready) connectLobby();
});

onBeforeUnmount(() => {
  closingLobby = true;
  clearReconnectTimer();
  ws?.close();
  if (pollId !== undefined) window.clearInterval(pollId);
});

async function refreshRooms(): Promise<void> {
  try {
    rooms.value = await listLobbyRooms(gameId.value, mode.value);
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

async function createRoom(): Promise<void> {
  if (creatingRoom.value) return;
  creatingRoom.value = true;
  try {
    const result = await createLobbyRoom(gameId.value, mode.value);
    await router.push(`/game/${encodeURIComponent(gameId.value)}/${encodeURIComponent(result.roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to create room";
  } finally {
    creatingRoom.value = false;
  }
}

async function goToGames(): Promise<void> {
  await router.replace("/");
}

async function joinExisting(roomId: string): Promise<void> {
  if (joiningRoomId.value) return;
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

function roomLabel(roomId: string): string {
  const suffix = roomId.replace(/^room_/, "").slice(-6).toUpperCase();
  return suffix ? `Table ${suffix}` : "Waiting table";
}

function connectLobby(): void {
  clearReconnectTimer();
  closingLobby = false;
  ws?.close();
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
    error.value = "Lobby WebSocket failed";
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
  error.value = "Lobby connection lost. Reconnecting...";
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
