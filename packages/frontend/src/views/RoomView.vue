<template>
  <div class="game-room-shell">
    <div
      ref="gameHost"
      class="game-room-host"
      aria-label="Game surface"
      @bighouse-toggle-fullscreen="toggleFullscreen"
    />

    <div v-if="!gameReady" class="game-room-loading" role="status" aria-live="polite">
      <div class="game-room-loading-card">
        <span class="game-room-loading-icon" aria-hidden="true">
          <UIcon name="i-lucide-gamepad-2" />
        </span>
        <h1>{{ room ? `Preparing ${displayGameId}` : "Joining the table" }}</h1>
        <p>{{ error || (identityReady ? "Syncing the latest room state…" : "Finish player setup to enter this room.") }}</p>
        <UButton
          v-if="error"
          label="Back to lobby"
          icon="i-lucide-arrow-left"
          color="primary"
          size="xl"
          @click="goToLobby"
        />
      </div>
    </div>

    <div v-if="error && gameReady" class="room-connection-banner" role="alert">{{ error }}</div>

    <span v-if="fullscreenMessage" class="room-fullscreen-status" role="status" aria-live="polite">
      {{ fullscreenMessage }}
    </span>

    <UModal
      v-model:open="leaveConfirmOpen"
      title="Leave room?"
      description="Other players are still in this room. Leave anyway?"
      :dismissible="false"
      :ui="{ close: 'hidden' }"
    >
      <template #footer>
        <div class="flex w-full justify-end gap-2">
          <UButton label="Stay" color="neutral" variant="subtle" @click="cancelGuardedLeave" />
          <UButton label="Leave" color="error" icon="i-lucide-log-out" @click="confirmGuardedLeave" />
        </div>
      </template>
    </UModal>

    <UModal
      v-model:open="qrModalOpen"
      title="Share room"
      description="Scan this code to join the room."
      dismissible
    >
      <template #body>
        <div class="flex flex-col items-center gap-4">
          <img v-if="qrCodeDataUrl" class="room-qr-image" :src="qrCodeDataUrl" alt="Room QR code" />
          <div v-else class="portal-alert" role="status">Preparing QR code…</div>
          <p class="max-w-full break-all text-center text-xs text-muted">{{ publicRoomUrl }}</p>
        </div>
      </template>
    </UModal>
  </div>
</template>

<script setup lang="ts">
import { toDataURL } from "qrcode";
import { computed, nextTick, onBeforeUnmount, onMounted, ref, watch } from "vue";
import { onBeforeRouteLeave, useRoute, useRouter } from "vue-router";
import type {
  BotDifficulty,
  GameClientActions,
  GameClientChatMessage,
  GameClientSnapshot,
  MountedGameClient
} from "@bighouse/game-sdk/client";
import { identity, identityReady } from "../identity";
import { roomWebsocketUrl } from "../api";
import { loadGameClient } from "../game-plugins";
import { parseServerMessage } from "../socket";
import type { RoomSnapshot, ServerMessage } from "../types";

const route = useRoute();
const router = useRouter();
const roomId = computed(() => String(route.params.roomId));
const displayGameId = computed(() => room.value?.gameId ?? String(route.params.gameId));
const room = ref<RoomSnapshot>();
const chatMessages = ref<GameClientChatMessage[]>([]);
const uiRevision = ref(0);
const error = ref("");
const leaveConfirmOpen = ref(false);
const qrModalOpen = ref(false);
const qrCodeDataUrl = ref("");
const gameHost = ref<HTMLElement>();
const gameReady = ref(false);
const fullscreenAvailable = ref(false);
const fullscreenBusy = ref(false);
const fullscreenMessage = ref("");
const lastSnapshotServerTime = ref(Date.now());
let ws: WebSocket | undefined;
let gameInstance: MountedGameClient | undefined;
let mountedGameId: string | undefined;
let loadingGameId: string | undefined;
let reconnectTimer: number | undefined;
let leaveFallbackTimer: number | undefined;
let reconnectAttempt = 0;
let closingRoom = false;
let leavingRoom = false;
let leaveDestination: string | undefined;
let pendingGuardDestination: string | undefined;
let guardNavigationAllowed = false;
let roomViewMounted = false;
let fullscreenRequestVersion = 0;

const hasOtherPlayers = computed(() => room.value?.players.some((player) => player.playerId !== identity.playerId) ?? false);
const roomIsFull = computed(() => {
  const snapshot = room.value;
  return Boolean(snapshot && snapshot.players.length >= snapshot.maxPlayers);
});
const roomCanShareQr = computed(() => {
  const snapshot = room.value;
  return Boolean(snapshot && !roomIsFull.value && (snapshot.phase === "waiting" || snapshot.activeInterruption));
});
const lobbyPath = computed(() => {
  const gameId = room.value?.gameId ?? String(route.params.gameId);
  const mode = room.value?.mode ?? "default";
  return `/game/${encodeURIComponent(gameId)}/${encodeURIComponent(mode)}`;
});
const publicRoomUrl = computed(() => {
  if (typeof window === "undefined") return "";
  const href = router.resolve({
    name: "room",
    params: { gameId: displayGameId.value, roomId: roomId.value }
  }).href;
  return new URL(href, window.location.origin).toString();
});

const gameActions: GameClientActions = {
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
  setReady(ready) {
    ws?.send(JSON.stringify({ type: "ready", playerId: identity.playerId, ready }));
  },
  startGame() {
    ws?.send(JSON.stringify({ type: "startGame", playerId: identity.playerId }));
  },
  restartGame() {
    ws?.send(JSON.stringify({ type: "restartGame", playerId: identity.playerId }));
  },
  addBot(difficulty: BotDifficulty, displayName?: string) {
    sendAddBotRequest(difficulty, 1, displayName);
  },
  addBots(difficulty: BotDifficulty, count: number, displayName?: string) {
    sendAddBotRequest(difficulty, count, displayName);
  },
  removeBot(botPlayerId) {
    ws?.send(JSON.stringify({ type: "removeBot", playerId: identity.playerId, botPlayerId }));
  },
  transferHost(targetPlayerId) {
    ws?.send(JSON.stringify({ type: "transferHost", playerId: identity.playerId, targetPlayerId }));
  },
  sendChat(body, targetPlayerId) {
    ws?.send(JSON.stringify({ type: "chat", playerId: identity.playerId, targetPlayerId, body }));
  },
  shareRoom() {
    openQrModal();
  },
  leaveRoom() {
    goToLobby();
  },
  requestPlayAgain() {
    ws?.send(JSON.stringify({ type: "playAgain", playerId: identity.playerId }));
  },
  leaveFinishedGame() {
    ws?.send(JSON.stringify({ type: "leaveFinishedGame", playerId: identity.playerId }));
    void replaceRoomRoute(lobbyPath.value);
  }
};

function sendAddBotRequest(difficulty: BotDifficulty, count: number, displayName?: string): void {
  ws?.send(
    JSON.stringify({
      type: "addBot",
      playerId: identity.playerId,
      difficulty,
      count,
      ...(displayName ? { displayName } : {})
    })
  );
}

onMounted(() => {
  roomViewMounted = true;
  fullscreenAvailable.value =
    document.fullscreenEnabled && typeof document.documentElement.requestFullscreen === "function";
  document.addEventListener("fullscreenchange", handleFullscreenChange);
  document.addEventListener("fullscreenerror", handleFullscreenError, true);
  handleFullscreenChange();
  if (identityReady.value) connectRoom();
});

watch(identityReady, (ready) => {
  if (ready && !ws) connectRoom();
});

watch(roomCanShareQr, (canShare) => {
  if (!canShare) qrModalOpen.value = false;
});

watch(qrModalOpen, async (open) => {
  if (!open || qrCodeDataUrl.value) return;
  try {
    qrCodeDataUrl.value = await toDataURL(publicRoomUrl.value, {
      errorCorrectionLevel: "M",
      margin: 1,
      width: 320
    });
  } catch (cause) {
    console.error("Failed to generate room QR code", cause);
    error.value = "Failed to generate room QR code";
    qrModalOpen.value = false;
  }
});

onBeforeRouteLeave((to) => {
  if (guardNavigationAllowed || leavingRoom || closingRoom) return true;

  pendingGuardDestination = to.fullPath;
  if (hasOtherPlayers.value) {
    leaveConfirmOpen.value = true;
    return false;
  }

  leaveRoom(to.fullPath);
  return false;
});

onBeforeUnmount(() => {
  closingRoom = true;
  roomViewMounted = false;
  fullscreenRequestVersion += 1;
  fullscreenBusy.value = false;
  document.removeEventListener("fullscreenchange", handleFullscreenChange);
  document.removeEventListener("fullscreenerror", handleFullscreenError, true);
  void releaseOwnedFullscreen();
  clearReconnectTimer();
  clearLeaveFallbackTimer();
  ws?.close();
  gameInstance?.destroy();
});

function handleFullscreenChange(): void {
  if (document.fullscreenElement !== null) {
    fullscreenMessage.value = "";
    return;
  }
  unlockScreenOrientation();
}

function handleFullscreenError(): void {
  fullscreenMessage.value = "Fullscreen could not be opened. Try again.";
}

async function toggleFullscreen(): Promise<void> {
  fullscreenMessage.value = "";
  if (!fullscreenAvailable.value) {
    fullscreenMessage.value = "Fullscreen is not supported in this browser.";
    return;
  }
  if (fullscreenBusy.value) return;

  const requestVersion = ++fullscreenRequestVersion;
  fullscreenBusy.value = true;
  try {
    if (document.fullscreenElement) {
      await document.exitFullscreen();
      return;
    }

    await document.documentElement.requestFullscreen();
    if (!roomViewMounted || requestVersion !== fullscreenRequestVersion) {
      await releaseOwnedFullscreen();
      return;
    }
    if (isMobileDevice()) await lockLandscapeBestEffort();
    if (!roomViewMounted || requestVersion !== fullscreenRequestVersion) {
      await releaseOwnedFullscreen();
    }
  } catch (cause) {
    if (roomViewMounted && requestVersion === fullscreenRequestVersion) {
      console.warn("Failed to toggle fullscreen", cause);
      handleFullscreenError();
    }
  } finally {
    if (roomViewMounted && requestVersion === fullscreenRequestVersion) fullscreenBusy.value = false;
  }
}

function isMobileDevice(): boolean {
  return navigator.maxTouchPoints > 0 || window.matchMedia("(pointer: coarse)").matches;
}

type LockableScreenOrientation = ScreenOrientation & {
  lock?: (orientation: "landscape") => Promise<void>;
};

async function lockLandscapeBestEffort(): Promise<void> {
  const orientation = screen.orientation as LockableScreenOrientation | undefined;
  if (typeof orientation?.lock !== "function") return;
  try {
    await orientation.lock("landscape");
  } catch {
    // Orientation locking is optional and commonly rejected by mobile browsers.
  }
}

function unlockScreenOrientation(): void {
  try {
    screen.orientation?.unlock();
  } catch {
    // Orientation unlocking is best effort for browsers with partial support.
  }
}

async function releaseOwnedFullscreen(): Promise<void> {
  unlockScreenOrientation();
  if (document.fullscreenElement !== document.documentElement || typeof document.exitFullscreen !== "function") return;
  await document.exitFullscreen().catch(() => undefined);
}

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
    if (ws !== socket) return;
    const message = parseServerMessage(event.data);
    if (message) void handleRoomMessage(message);
  });
  socket.addEventListener("error", () => {
    if (ws !== socket) return;
    error.value = "Room connection failed";
  });
  socket.addEventListener("close", () => {
    if (!closingRoom && ws === socket) scheduleReconnect();
  });
}

async function handleRoomMessage(message: ServerMessage): Promise<void> {
  if (message.type === "snapshot") {
    lastSnapshotServerTime.value = message.serverTime;
    room.value = message.payload as unknown as RoomSnapshot;
    uiRevision.value += 1;
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
      replaceAfterLeave();
    }
    return;
  }
  if (message.type === "chat") {
    chatMessages.value.push((message.payload as { message: GameClientChatMessage }).message);
    if (chatMessages.value.length > 200) chatMessages.value.splice(0, chatMessages.value.length - 200);
    uiRevision.value += 1;
    updateMountedGame();
    return;
  }
  if (message.type === "roomClosed") {
    error.value = "This room has closed";
    return;
  }
  if (message.type === "error") {
    error.value = (message.payload as { message?: string }).message ?? "Room error";
  }
}

function applyPresence(payload: { playerId: string; connected: boolean }): void {
  const player = room.value?.players.find((candidate) => candidate.playerId === payload.playerId);
  if (!player || player.connected === payload.connected) return;
  player.connected = payload.connected;
  uiRevision.value += 1;
  updateMountedGame();
}

function createGameSnapshot(): GameClientSnapshot | undefined {
  const snapshot = room.value;
  if (!snapshot) return undefined;
  return {
    playerId: identity.playerId,
    version: snapshot.version,
    uiRevision: uiRevision.value,
    serverTime: lastSnapshotServerTime.value,
    phase: snapshot.phase,
    room: {
      roomId: snapshot.roomId,
      gameId: snapshot.gameId,
      mode: snapshot.mode,
      minPlayers: snapshot.minPlayers,
      maxPlayers: snapshot.maxPlayers,
      ...(snapshot.hostPlayerId ? { hostPlayerId: snapshot.hostPlayerId } : {}),
      players: snapshot.players,
      ...(snapshot.activeInterruption ? { activeInterruption: snapshot.activeInterruption } : {}),
      inviteUrl: publicRoomUrl.value
    },
    publicView: snapshot.publicView,
    privateView: snapshot.privateView,
    rematchRequests: snapshot.rematchRequests ?? [],
    chatMessages: [...chatMessages.value]
  };
}

async function mountOrUpdateGame(): Promise<void> {
  const snapshot = createGameSnapshot();
  const host = gameHost.value;
  if (!snapshot || !host) return;

  if (gameInstance && mountedGameId === snapshot.room.gameId) {
    gameInstance.update(snapshot);
    gameReady.value = true;
    return;
  }

  if (loadingGameId === snapshot.room.gameId) return;
  loadingGameId = snapshot.room.gameId;
  try {
    const module = await loadGameClient(snapshot.room.gameId);
    if (!module) {
      error.value = `No client module installed for ${snapshot.room.gameId}.`;
      return;
    }
    const latest = createGameSnapshot();
    if (!latest || latest.room.gameId !== snapshot.room.gameId || !gameHost.value) return;
    await nextTick();
    gameInstance?.destroy();
    mountedGameId = latest.room.gameId;
    gameInstance = module.mountGame(gameHost.value, { ...latest, ...gameActions });
    gameReady.value = true;
    const afterMount = createGameSnapshot();
    if (afterMount && afterMount.uiRevision !== latest.uiRevision) gameInstance.update(afterMount);
  } catch (cause) {
    console.error("Failed to mount game client", cause);
    error.value = cause instanceof Error ? cause.message : "Failed to open game";
  } finally {
    loadingGameId = undefined;
  }
}

function updateMountedGame(): void {
  const snapshot = createGameSnapshot();
  if (snapshot && gameInstance) gameInstance.update(snapshot);
}

function goToLobby(): void {
  void router.replace(lobbyPath.value);
}

function leaveRoom(destination = lobbyPath.value): void {
  if (leavingRoom) return;
  leavingRoom = true;
  closingRoom = true;
  leaveDestination = destination;
  leaveConfirmOpen.value = false;
  leaveFallbackTimer = window.setTimeout(replaceAfterLeave, 500);
  if (ws?.readyState === WebSocket.OPEN) {
    ws.send(JSON.stringify({ type: "leaveRoom", playerId: identity.playerId }));
  }
}

function cancelGuardedLeave(): void {
  leaveConfirmOpen.value = false;
  pendingGuardDestination = undefined;
}

function confirmGuardedLeave(): void {
  leaveRoom(pendingGuardDestination ?? lobbyPath.value);
  pendingGuardDestination = undefined;
}

function replaceAfterLeave(): void {
  const destination = leaveDestination ?? lobbyPath.value;
  clearLeaveFallbackTimer();
  void replaceRoomRoute(destination);
}

async function replaceRoomRoute(destination: string): Promise<void> {
  guardNavigationAllowed = true;
  await router.replace(destination).finally(() => {
    guardNavigationAllowed = false;
  });
}

function openQrModal(): void {
  if (!roomCanShareQr.value) return;
  qrModalOpen.value = true;
}

function scheduleReconnect(): void {
  if (!identityReady.value || reconnectTimer) return;
  const delay = Math.min(500 * 2 ** reconnectAttempt, 5000);
  reconnectAttempt += 1;
  error.value = "Room connection lost. Reconnecting…";
  reconnectTimer = window.setTimeout(() => {
    reconnectTimer = undefined;
    connectRoom();
  }, delay);
}

function clearReconnectTimer(): void {
  if (reconnectTimer !== undefined) {
    window.clearTimeout(reconnectTimer);
    reconnectTimer = undefined;
  }
}

function clearLeaveFallbackTimer(): void {
  if (leaveFallbackTimer !== undefined) {
    window.clearTimeout(leaveFallbackTimer);
    leaveFallbackTimer = undefined;
  }
}
</script>
