<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-semibold text-highlighted">{{ displayGameId }}</h1>
        <UBadge v-if="room?.mode" color="neutral" variant="subtle">{{ room.mode }}</UBadge>
        <UBadge v-if="room" :color="room.phase === 'active' ? 'success' : 'warning'" variant="subtle">{{ room.phase }}</UBadge>
        <UBadge v-else color="neutral" variant="subtle">Connecting</UBadge>
      </div>
      <div>
        <UButton label="Lobby" icon="i-lucide-arrow-left" color="neutral" variant="subtle" :to="lobbyPath" />
      </div>
    </div>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />

    <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div class="space-y-6">
        <UCard>
          <template #header>
            <div class="flex items-center justify-between">
              <h2 class="font-semibold">Players</h2>
              <UBadge color="neutral" variant="subtle">{{ room?.players.length ?? 0 }}</UBadge>
            </div>
          </template>

          <div class="space-y-3">
            <div v-for="player in room?.players ?? []" :key="player.playerId" class="flex items-center justify-between gap-3">
              <div>
                <div class="font-medium text-highlighted">{{ player.displayName || player.playerId }}</div>
                <div class="text-xs text-muted">
                  Seat {{ player.seat + 1 }}
                  <span v-if="player.playerId === room?.hostPlayerId">/ host</span>
                </div>
              </div>
              <div class="flex gap-2">
                <UBadge :color="player.connected ? 'success' : 'neutral'" variant="subtle">
                  {{ player.connected ? "online" : "offline" }}
                </UBadge>
                <UBadge v-if="player.playerId === room?.hostPlayerId" color="neutral" variant="subtle">
                  host
                </UBadge>
                <UBadge v-else :color="player.ready ? 'success' : 'warning'" variant="subtle">
                  {{ player.ready ? "ready" : "not ready" }}
                </UBadge>
              </div>
            </div>
          </div>
        </UCard>

        <UCard>
          <template #header>
            <h2 class="font-semibold">Room controls</h2>
          </template>

          <div class="space-y-3">
            <UButton
              v-if="!isHost"
              :label="me?.ready ? 'Cancel ready' : 'Ready'"
              :icon="me?.ready ? 'i-lucide-circle-x' : 'i-lucide-circle-check'"
              :color="me?.ready ? 'neutral' : 'primary'"
              :disabled="!room || room.phase !== 'waiting'"
              block
              @click="sendReady(!me?.ready)"
            />
            <UButton
              v-if="isHost"
              label="Start"
              icon="i-lucide-play"
              :disabled="!canStart"
              block
              @click="startGame"
            />
          </div>

          <template #footer>
            <div class="space-y-2">
              <div class="text-xs text-muted">Delegate host</div>
              <div class="flex flex-wrap gap-2">
                <UButton
                  v-for="player in delegatablePlayers"
                  :key="player.playerId"
                  size="xs"
                  color="neutral"
                  variant="subtle"
                  :label="player.displayName || player.playerId"
                  @click="transferHost(player.playerId)"
                />
              </div>
            </div>
          </template>
        </UCard>

        <ChatPanel title="Room chat" :messages="chat" @send="sendChat" />
      </div>

      <UCard>
        <template #header>
          <div class="flex items-center justify-between">
            <h2 class="font-semibold">Game</h2>
            <UBadge v-if="room" color="neutral" variant="subtle">v{{ room.version }}</UBadge>
          </div>
        </template>
        <div ref="gameHost">
          <UAlert v-if="!room" color="neutral" variant="subtle" title="Waiting for snapshot" />
        </div>
      </UCard>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute } from "vue-router";
import type { GomokuGameInstance, GomokuPrivateView, GomokuPublicView } from "@bighouse/gomoku";
import ChatPanel from "../components/ChatPanel.vue";
import { identity, identityReady } from "../identity";
import { roomWebsocketUrl } from "../api";
import type { ChatMessage, Player, RoomSnapshot, ServerMessage } from "../types";

type GameModule = typeof import("@bighouse/gomoku");

const gameLoaders = {
  gomoku: () => import("@bighouse/gomoku")
} satisfies Record<string, () => Promise<GameModule>>;

const route = useRoute();
const roomId = computed(() => String(route.params.roomId));
const displayGameId = computed(() => room.value?.gameId ?? String(route.params.gameId));
const room = ref<RoomSnapshot>();
const chat = ref<ChatMessage[]>([]);
const error = ref("");
const gameHost = ref<HTMLElement>();
let ws: WebSocket | undefined;
let gameInstance: GomokuGameInstance | undefined;

const me = computed(() => room.value?.players.find((player) => player.playerId === identity.playerId));
const isHost = computed(() => room.value?.hostPlayerId === identity.playerId);
const canStart = computed(() => {
  const snapshot = room.value;
  if (!snapshot || !isHost.value || snapshot.phase !== "waiting") return false;
  const requiredReadyPlayers = snapshot.players.filter((player) => player.playerId !== snapshot.hostPlayerId);
  return snapshot.players.length >= snapshot.minPlayers && requiredReadyPlayers.every((player) => player.ready);
});
const delegatablePlayers = computed<Player[]>(() => {
  if (!room.value || !isHost.value) return [];
  return room.value.players.filter((player) => player.playerId !== identity.playerId);
});
const lobbyPath = computed(() => {
  const gameId = room.value?.gameId ?? String(route.params.gameId);
  const mode = room.value?.mode ?? "default";
  return `/game/${encodeURIComponent(gameId)}/${encodeURIComponent(mode)}`;
});

onMounted(() => {
  if (identityReady.value) connectRoom();
});

watch(identityReady, (ready) => {
  if (ready && !ws) connectRoom();
});

onBeforeUnmount(() => {
  ws?.close();
  gameInstance?.destroy();
});

function connectRoom(): void {
  ws?.close();
  ws = new WebSocket(roomWebsocketUrl(roomId.value));
  ws.addEventListener("open", () => {
    ws?.send(JSON.stringify({ type: "joinRoom", playerId: identity.playerId, displayName: identity.displayName || undefined }));
  });
  ws.addEventListener("message", (event) => void handleRoomMessage(JSON.parse(String(event.data)) as ServerMessage));
  ws.addEventListener("error", () => {
    error.value = "Room WebSocket failed";
  });
}

async function handleRoomMessage(message: ServerMessage): Promise<void> {
  if (message.type === "snapshot") {
    room.value = message.payload as unknown as RoomSnapshot;
    await mountOrUpdateGame();
    return;
  }
  if (message.type === "event" || message.type === "privateEvent" || message.type === "presence") {
    requestSnapshot();
    return;
  }
  if (message.type === "chat") {
    chat.value.push((message.payload as { message: ChatMessage }).message);
    return;
  }
  if (message.type === "error") {
    error.value = (message.payload as { message?: string }).message ?? "Room error";
  }
}

function requestSnapshot(): void {
  ws?.send(JSON.stringify({ type: "joinRoom", playerId: identity.playerId, displayName: identity.displayName || undefined }));
}

async function mountOrUpdateGame(): Promise<void> {
  const snapshot = room.value;
  if (!snapshot || !gameHost.value) return;
  const loader = gameLoaders[snapshot.gameId as keyof typeof gameLoaders];
  if (!loader) {
    gameHost.value.textContent = `No client module installed for ${snapshot.gameId}.`;
    return;
  }
  await nextTick();
  const module = await loader();
  const publicView = { ...snapshot.publicView, roomPhase: snapshot.phase } as GomokuPublicView;
  const client = {
    playerId: identity.playerId,
    version: snapshot.version,
    publicView,
    privateView: snapshot.privateView as GomokuPrivateView
  };
  if (!gameInstance) {
    gameInstance = module.createGomokuGame(gameHost.value, {
      ...client,
      sendAction(action) {
        ws?.send(
          JSON.stringify({
            type: "action",
            playerId: identity.playerId,
            clientActionId: crypto.randomUUID(),
            expectedVersion: room.value?.version ?? 0,
            action
          })
        );
      }
    });
    return;
  }
  gameInstance.update(client);
}

function sendReady(ready: boolean): void {
  ws?.send(JSON.stringify({ type: "ready", playerId: identity.playerId, ready }));
}

function startGame(): void {
  ws?.send(JSON.stringify({ type: "startGame", playerId: identity.playerId }));
}

function transferHost(targetPlayerId: string): void {
  ws?.send(JSON.stringify({ type: "transferHost", playerId: identity.playerId, targetPlayerId }));
}

function sendChat(body: string, targetPlayerId?: string): void {
  ws?.send(JSON.stringify({ type: "chat", playerId: identity.playerId, targetPlayerId, body }));
}
</script>
