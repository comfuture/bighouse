<template>
  <div class="space-y-6">
    <IdentityPanel />

    <div class="flex flex-wrap items-end justify-between gap-3">
      <UPageHeader :title="`${gameId} lobby`" :description="`Mode: ${mode}`" />
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
        :title="room.roomId"
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
import { computed, onBeforeUnmount, onMounted, ref } from "vue";
import { useRoute, useRouter } from "vue-router";
import IdentityPanel from "../components/IdentityPanel.vue";
import ChatPanel from "../components/ChatPanel.vue";
import { createLobbyRoom, joinRoom, listLobbyRooms, lobbyWebsocketUrl } from "../api";
import { identity, persistIdentity } from "../identity";
import type { ChatMessage, RoomIndex, ServerMessage } from "../types";

const route = useRoute();
const router = useRouter();
const gameId = computed(() => String(route.params.gameId));
const mode = computed(() => String(route.params.mode));
const rooms = ref<RoomIndex[]>([]);
const chat = ref<ChatMessage[]>([]);
const error = ref("");
let ws: WebSocket | undefined;
let pollId: number | undefined;

onMounted(() => {
  persistIdentity();
  void refreshRooms();
  connectLobby();
  pollId = window.setInterval(() => void refreshRooms(), 3000);
});

onBeforeUnmount(() => {
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
    await router.push(`/play/${encodeURIComponent(result.roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to create room";
  }
}

async function joinExisting(roomId: string): Promise<void> {
  try {
    await joinRoom(roomId);
    await router.push(`/play/${encodeURIComponent(roomId)}`);
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to join room";
  }
}

function connectLobby(): void {
  ws?.close();
  ws = new WebSocket(lobbyWebsocketUrl(gameId.value, mode.value));
  ws.addEventListener("message", (event) => {
    const message = JSON.parse(String(event.data)) as ServerMessage;
    if (message.type === "chat") {
      chat.value.push((message.payload as { message: ChatMessage }).message);
    }
  });
}

function sendChat(body: string, targetPlayerId?: string): void {
  if (!ws || ws.readyState !== WebSocket.OPEN) return;
  ws.send(JSON.stringify({ type: "chat", playerId: identity.playerId, targetPlayerId, body }));
}
</script>
