import { reactive, ref } from "vue";

export const identity = reactive({
  playerId: localStorage.getItem("bighouse.playerId") ?? "",
  displayName: localStorage.getItem("bighouse.displayName") ?? "",
  mode: localStorage.getItem("bighouse.mode") ?? "default"
});

export const identityReady = ref(identity.playerId.trim().length > 0);

export function persistIdentity(): void {
  identity.playerId = identity.playerId.trim();
  identity.displayName = identity.displayName.trim();
  identity.mode = identity.mode.trim() || "default";
  if (!identity.playerId) {
    identityReady.value = false;
    localStorage.removeItem("bighouse.playerId");
    return;
  }
  localStorage.setItem("bighouse.playerId", identity.playerId);
  localStorage.setItem("bighouse.displayName", identity.displayName);
  localStorage.setItem("bighouse.mode", identity.mode);
  identityReady.value = true;
}

export function requirePlayerId(): string {
  persistIdentity();
  if (!identityReady.value) {
    throw new Error("Player ID is required");
  }
  return identity.playerId;
}
