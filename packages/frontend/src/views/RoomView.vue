<template>
  <div class="space-y-6">
    <div class="flex flex-wrap items-center justify-between gap-3">
      <div class="flex items-center gap-2">
        <h1 class="text-lg font-semibold text-highlighted">{{ displayGameId }}</h1>
        <UBadge v-if="room?.mode" color="neutral" variant="subtle">{{ room.mode }}</UBadge>
        <UBadge v-if="room" :color="room.phase === 'active' ? 'success' : room.phase === 'finished' ? 'neutral' : 'warning'" variant="subtle">{{ room.phase }}</UBadge>
        <UBadge v-else color="neutral" variant="subtle">Connecting</UBadge>
      </div>
      <div>
        <UButton label="Lobby" icon="i-lucide-arrow-left" color="neutral" variant="subtle" @click="goToLobby" />
      </div>
    </div>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />
    <UAlert
      v-if="activeInterruption && !isHost"
      color="warning"
      icon="i-lucide-triangle-alert"
      :title="`${interruptedPlayerName} left the game`"
      :description="`${hostName} is deciding whether to reset and start a new game.`"
    />

    <UModal
      v-model:open="restartDialogOpen"
      title="Player left the game"
      :description="`${interruptedPlayerName} left. Reset the game and start over with the remaining players?`"
      :ui="{ close: 'hidden' }"
    >
      <template #body>
        <div class="space-y-3">
          <UAlert
            v-if="!canRestartInterruptedGame"
            color="warning"
            variant="subtle"
            icon="i-lucide-users"
            :title="`Need at least ${room?.minPlayers ?? 0} players to restart`"
            description="Wait for another player to join from the lobby or leave this room."
          />
          <p class="text-sm text-muted">
            The current game state will be discarded and the stage will be dealt from a fresh state.
          </p>
        </div>
      </template>

      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Leave room" color="neutral" variant="subtle" icon="i-lucide-log-out" @click="leaveRoom" />
          <UButton
            label="Start new game"
            icon="i-lucide-refresh-cw"
            :disabled="!canRestartInterruptedGame"
            @click="restartGame"
          />
        </div>
      </template>
    </UModal>

    <div class="grid gap-6 lg:grid-cols-[360px_1fr]">
      <div class="order-1 space-y-6 lg:order-1">
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
                <UBadge v-else-if="room?.phase === 'waiting'" :color="player.ready ? 'success' : 'warning'" variant="subtle">
                  {{ player.ready ? "ready" : "not ready" }}
                </UBadge>
              </div>
            </div>

            <div v-if="room?.phase === 'waiting'" class="border-t border-default pt-3">
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

            <div v-if="room?.phase === 'active'" class="border-t border-default pt-3">
              <UButton
                label="Leave game"
                icon="i-lucide-log-out"
                color="error"
                variant="subtle"
                block
                @click="leaveRoom"
              />
            </div>

            <div v-if="room?.phase === 'waiting' && delegatablePlayers.length > 0" class="space-y-2 border-t border-default pt-3">
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
          </div>
        </UCard>
      </div>

      <UCard class="order-2 min-w-0 -mx-4 sm:mx-0 lg:order-2" :ui="{ header: 'p-3 sm:px-6 sm:py-4', body: 'p-0 sm:p-6' }">
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

      <ChatPanel class="order-3 lg:order-3 lg:col-span-2" title="Room chat" :messages="chat" @send="sendChat" />
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { useRoute, useRouter } from "vue-router";
import type { GameClientContext, MountedGameClient } from "@bighouse/game-sdk/client";
import ChatPanel from "../components/ChatPanel.vue";
import { identity, identityReady } from "../identity";
import { roomWebsocketUrl } from "../api";
import { loadGameClient } from "../game-plugins";
import { parseServerMessage } from "../socket";
import type { ChatMessage, Player, RoomSnapshot, ServerMessage } from "../types";

const route = useRoute();
const router = useRouter();
const roomId = computed(() => String(route.params.roomId));
const displayGameId = computed(() => room.value?.gameId ?? String(route.params.gameId));
const room = ref<RoomSnapshot>();
const chat = ref<ChatMessage[]>([]);
const error = ref("");
const gameHost = ref<HTMLElement>();
let ws: WebSocket | undefined;
let gameInstance: MountedGameClient | undefined;
let mountedGameId: string | undefined;
let reconnectTimer: ReturnType<typeof window.setTimeout> | undefined;
let leaveFallbackTimer: ReturnType<typeof window.setTimeout> | undefined;
let reconnectAttempt = 0;
let closingRoom = false;
let leavingRoom = false;

const me = computed(() => room.value?.players.find((player) => player.playerId === identity.playerId));
const isHost = computed(() => room.value?.hostPlayerId === identity.playerId);
const activeInterruption = computed(() => room.value?.activeInterruption);
const restartDialogOpen = computed({
  get: () => Boolean(activeInterruption.value && isHost.value),
  set: () => {
    // The server owns this dialog state; it closes when a fresh snapshot clears activeInterruption.
  }
});
const canRestartInterruptedGame = computed(() => {
  const snapshot = room.value;
  return Boolean(activeInterruption.value && isHost.value && snapshot && snapshot.players.length >= snapshot.minPlayers);
});
const interruptedPlayerName = computed(() => {
  const interruption = activeInterruption.value;
  if (!interruption) return "A player";
  return interruption.displayName || interruption.playerId;
});
const hostName = computed(() => playerName(room.value?.hostPlayerId));
const canStart = computed(() => {
  const snapshot = room.value;
  if (!snapshot || !isHost.value || snapshot.phase !== "waiting") return false;
  const requiredReadyPlayers = snapshot.players.filter((player) => player.playerId !== snapshot.hostPlayerId);
  return snapshot.players.length >= snapshot.minPlayers && requiredReadyPlayers.every((player) => player.connected && player.ready);
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
  closingRoom = true;
  clearReconnectTimer();
  clearLeaveFallbackTimer();
  ws?.close();
  gameInstance?.destroy();
});

function connectRoom(): void {
  clearReconnectTimer();
  closingRoom = false;
  ws?.close();
  const socket = new WebSocket(roomWebsocketUrl(roomId.value));
  ws = socket;
  socket.addEventListener("open", () => {
    if (ws !== socket) return;
    reconnectAttempt = 0;
    error.value = "";
    socket.send(JSON.stringify({ type: "joinRoom", playerId: identity.playerId, displayName: identity.displayName || undefined }));
  });
  socket.addEventListener("message", (event) => {
    if (ws === socket) {
      const message = parseServerMessage(event.data);
      if (message) void handleRoomMessage(message);
    }
  });
  socket.addEventListener("error", () => {
    if (ws !== socket) return;
    error.value = "Room WebSocket failed";
  });
  socket.addEventListener("close", () => {
    if (!closingRoom && ws === socket) {
      scheduleReconnect();
    }
  });
}

async function handleRoomMessage(message: ServerMessage): Promise<void> {
  if (message.type === "snapshot") {
    room.value = message.payload as unknown as RoomSnapshot;
    await mountOrUpdateGame();
    return;
  }
  if (message.type === "presence") {
    applyPresence(message.payload as { playerId: string; connected: boolean });
    return;
  }
  if (message.type === "event" || message.type === "privateEvent") return;
  if (message.type === "ack") {
    const payload = message.payload as { command?: string };
    if (payload.command === "leaveRoom" && leavingRoom) {
      clearLeaveFallbackTimer();
      void router.push(lobbyPath.value);
    }
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

function applyPresence(payload: { playerId: string; connected: boolean }): void {
  const player = room.value?.players.find((candidate) => candidate.playerId === payload.playerId);
  if (player) {
    player.connected = payload.connected;
  }
}

async function mountOrUpdateGame(): Promise<void> {
  const snapshot = room.value;
  if (!snapshot || !gameHost.value) return;
  const module = await loadGameClient(snapshot.gameId);
  if (!module) {
    gameHost.value.textContent = `No client module installed for ${snapshot.gameId}.`;
    return;
  }
  await nextTick();
  const client = {
    playerId: identity.playerId,
    version: snapshot.version,
    phase: snapshot.phase,
    publicView: snapshot.publicView,
    privateView: snapshot.privateView,
    rematchRequests: snapshot.rematchRequests ?? []
  } satisfies Omit<GameClientContext, "sendAction" | "requestPlayAgain" | "leaveFinishedGame">;
  if (!gameInstance || mountedGameId !== snapshot.gameId) {
    gameInstance?.destroy();
    mountedGameId = snapshot.gameId;
    gameInstance = module.mountGame(gameHost.value, {
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
      },
      requestPlayAgain() {
        ws?.send(JSON.stringify({ type: "playAgain", playerId: identity.playerId }));
      },
      leaveFinishedGame() {
        ws?.send(JSON.stringify({ type: "leaveFinishedGame", playerId: identity.playerId }));
        void router.push(lobbyPath.value);
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

function restartGame(): void {
  ws?.send(JSON.stringify({ type: "restartGame", playerId: identity.playerId }));
}

function transferHost(targetPlayerId: string): void {
  ws?.send(JSON.stringify({ type: "transferHost", playerId: identity.playerId, targetPlayerId }));
}

function sendChat(body: string, targetPlayerId?: string): void {
  ws?.send(JSON.stringify({ type: "chat", playerId: identity.playerId, targetPlayerId, body }));
}

function goToLobby(): void {
  if (room.value?.phase === "waiting" || room.value?.phase === "active") {
    leaveRoom();
    return;
  }
  void router.push(lobbyPath.value);
}

function leaveRoom(): void {
  if (leavingRoom) return;
  leavingRoom = true;
  closingRoom = true;
  ws?.send(JSON.stringify({ type: "leaveRoom", playerId: identity.playerId }));
  leaveFallbackTimer = window.setTimeout(() => {
    void router.push(lobbyPath.value);
  }, 500);
}

function playerName(playerId?: string): string {
  if (!playerId) return "the host";
  const player = room.value?.players.find((candidate) => candidate.playerId === playerId);
  return player?.displayName || player?.playerId || playerId;
}

function scheduleReconnect(): void {
  if (!identityReady.value || reconnectTimer) return;
  const delay = Math.min(500 * 2 ** reconnectAttempt, 5000);
  reconnectAttempt += 1;
  error.value = "Room connection lost. Reconnecting...";
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectRoom();
  }, delay);
}

function clearReconnectTimer(): void {
  if (reconnectTimer) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function clearLeaveFallbackTimer(): void {
  if (leaveFallbackTimer) {
    window.clearTimeout(leaveFallbackTimer);
    leaveFallbackTimer = undefined;
  }
}
</script>
