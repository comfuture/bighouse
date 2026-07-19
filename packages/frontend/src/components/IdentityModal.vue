<template>
  <UModal
    v-model:open="open"
    :title="editingNickname ? 'Change nickname' : 'Player information'"
    :description="editingNickname ? 'Choose the name other players will see.' : 'Set the identity used to join lobbies and rooms.'"
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
        <UFormField v-if="!editingNickname" label="Player ID" required>
          <UInput v-model="draft.playerId" placeholder="player-1234abcd" autofocus @keydown.enter.prevent="save" />
        </UFormField>
        <UFormField :label="editingNickname ? 'Nickname' : 'Display name'" :required="editingNickname">
          <UInput v-model="draft.displayName" placeholder="Alice" :autofocus="editingNickname" @keydown.enter.prevent="save" />
        </UFormField>
        <UFormField v-if="!editingNickname" label="Lobby mode">
          <UInput v-model="draft.mode" placeholder="default" @keydown.enter.prevent="save" />
        </UFormField>
      </div>
    </template>

    <template #footer>
      <div class="flex justify-end gap-2">
        <UButton v-if="editingNickname" color="neutral" variant="subtle" label="Cancel" @click="closeNicknameEditor" />
        <UButton v-else color="neutral" variant="subtle" label="Generate ID" icon="i-lucide-refresh-cw" @click="generatePlayerId" />
        <UButton :label="editingNickname ? 'Save nickname' : 'Continue'" :icon="editingNickname ? 'i-lucide-check' : 'i-lucide-arrow-right'" @click="save" />
      </div>
    </template>
  </UModal>
</template>

<script setup lang="ts">
import { computed, reactive, ref, watch } from "vue";
import { closeNicknameEditor, identity, identityReady, nicknameEditorOpen, persistIdentity } from "../identity";

const draft = reactive({
  playerId: identity.playerId || generatedPlayerId(),
  displayName: identity.displayName,
  mode: identity.mode
});
const error = ref("");
const editingNickname = computed(() => identityReady.value && nicknameEditorOpen.value);

const open = computed({
  get: () => !identityReady.value || nicknameEditorOpen.value,
  set: (value: boolean) => {
    if (!value && identityReady.value) closeNicknameEditor();
  }
});

watch(
  open,
  (isOpen) => {
    if (isOpen) {
      draft.playerId = identity.playerId || generatedPlayerId();
      draft.displayName = identity.displayName;
      draft.mode = identity.mode;
      error.value = "";
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
  if (editingNickname.value) {
    const displayName = draft.displayName.trim();
    if (!displayName) {
      error.value = "Nickname is required";
      return;
    }
    identity.displayName = displayName;
    persistIdentity();
    closeNicknameEditor();
    error.value = "";
    return;
  }
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
