<template>
  <UModal
    v-model:open="open"
    title="Player information"
    description="Set the identity used to join lobbies and rooms."
    :ui="{ close: 'hidden' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
        <UFormField label="Player ID" required>
          <UInput v-model="draft.playerId" placeholder="player-1234abcd" autofocus @keydown.enter.prevent="save" />
        </UFormField>
        <UFormField label="Display name">
          <UInput v-model="draft.displayName" placeholder="Alice" @keydown.enter.prevent="save" />
        </UFormField>
        <UFormField label="Lobby mode">
          <UInput v-model="draft.mode" placeholder="default" @keydown.enter.prevent="save" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton color="neutral" variant="subtle" label="Generate ID" icon="i-lucide-refresh-cw" @click="generatePlayerId" />
        <UButton label="Continue" icon="i-lucide-arrow-right" @click="save" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { identity, identityReady, persistIdentity } from "../identity";

const draft = reactive({
  playerId: identity.playerId || generatedPlayerId(),
  displayName: identity.displayName,
  mode: identity.mode
});
const error = ref("");

const open = computed({
  get: () => !identityReady.value,
  set: () => {
    if (!identityReady.value) return;
  }
});

watch(
  () => identityReady.value,
  (ready) => {
    if (!ready) {
      draft.playerId = identity.playerId || generatedPlayerId();
      draft.displayName = identity.displayName;
      draft.mode = identity.mode;
    }
  }
);

function generatedPlayerId(): string {
  return `player-${crypto.randomUUID().slice(0, 8)}`;
}

function generatePlayerId(): void {
  draft.playerId = generatedPlayerId();
}

function save(): void {
  const playerId = draft.playerId.trim();
  if (!playerId) {
    error.value = "Player ID is required";
    return;
  }
  identity.playerId = playerId;
  identity.displayName = draft.displayName.trim();
  identity.mode = draft.mode.trim() || "default";
  persistIdentity();
  error.value = "";
}
</script>
