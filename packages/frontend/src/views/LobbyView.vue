<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-semibold text-highlighted">{{ gameId }}</h1>
        <UBadge color="neutral" variant="subtle">{{ mode }}</UBadge>
        <UBadge color="neutral" variant="outline">Lobby</UBadge>
      </div>
      <div class="flex gap-2">
        <UButton label="Games" icon="i-lucide-arrow-left" color="neutral" variant="subtle" to="/" />
        <UButton label="Create room" icon="i-lucide-plus" @click="createRoom" />
      </div>
    </div>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />

    <UPageGrid>
      <UPageCard
        v-for="room in rooms"
        :key="room.roomId"
        title="Waiting room"
        :description="`${room.playerCount}/${room.maxPlayers} players`"
        icon="i-lucide-users"
      >
        <div class="mb-4 flex gap-2">
          <UBadge :color="room.status === 'matching' ? 'warning' : 'neutral'" variant="subtle">{{ room.status }}</UBadge>
          <UBadge color="neutral" variant="outline">min {{ room.minPlayers }}</UBadge>
        </div>
        <template #footer>
          <UButton label="Join room" icon="i-lucide-log-in" block @click="joinExisting(room.roomId)" />
        </template>
      </UPageCard>
    </UPageGrid>

    <UCard v-if="rooms.length === 0">
      <p class="text-sm text-muted">No waiting rooms. Create one to wait for opponents.</p>
    </UCard>

    <ChatPanel title="Lobby chat" :messages="chat" @send="sendChat" />
  </div>
</template>

<script setup lang="ts">
import { computed, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import ChatPanel from "../components/ChatPanel.vue";
import { createLobbyRoom, joinRoom, listLobbyRooms, lobbyWebsocketUrl } from "../api";
import { identity, identityReady } from "../identity";
import { parseServerMessage } from "../socket";
import type { ChatMessage, RoomIndex } from "../types";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.gameId));
const mode = computed(() => String(route.params.mode));
const rooms = ref<RoomIndex[]>([]);
const chat = ref<ChatMessage[]>([]);
const error = ref("");
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
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load rooms";
  }
}

async function createRoom(): Promise<void> {
  try {
    const result = await createLobbyRoom(gameId.value, mode.value);
    await router.push(`/game/${encodeURIComponent(gameId.value)}/${encodeURIComponent(result.roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to create room";
  }
}

async function joinExisting(roomId: string): Promise<void> {
  try {
    await joinRoom(roomId);
    await router.push(`/game/${encodeURIComponent(gameId.value)}/${encodeURIComponent(roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to join room";
  }
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
