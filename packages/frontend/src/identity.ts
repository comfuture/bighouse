import { reactive } from "vue";

export const identity = reactive({
  playerId: localStorage.getItem("bighouse.playerId") ?? `player-${crypto.randomUUID().slice(0, 8)}`,
  displayName: localStorage.getItem("bighouse.displayName") ?? "",
  mode: localStorage.getItem("bighouse.mode") ?? "default"
});

export function persistIdentity(): void {
  identity.playerId = identity.playerId.trim();
  identity.displayName = identity.displayName.trim();
  identity.mode = identity.mode.trim() || "default";
  localStorage.setItem("bighouse.playerId", identity.playerId);
  localStorage.setItem("bighouse.displayName", identity.displayName);
  localStorage.setItem("bighouse.mode", identity.mode);
}

export function requirePlayerId(): string {
  persistIdentity();
  if (!identity.playerId) {
    throw new Error("Player ID is required");
  }
  return identity.playerId;
}
