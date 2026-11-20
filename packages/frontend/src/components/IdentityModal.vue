<template>
  <UModal
    v-model:open="open"
    :title="editingNickname ? 'Change nickname' : 'Pick a nickname'"
    :description="editingNickname ? 'This is the name other players see.' : 'Other players see this name in rooms and chat. You can change it any time.'"
    :dismissible="editingNickname"
    :ui="{ close: 'hidden' }"
  >
    <template #body>
      <div class="space-y-4">
        <UAlert
          v-if="error"
          id="identity-error"
          role="alert"
          color="error"
          variant="subtle"
          icon="i-lucide-circle-alert"
          :title="error"
        />
        <UFormField label="Nickname" required>
          <UInput
            v-model="draft.displayName"
            class="w-full"
            placeholder="Alice"
            autofocus
            maxlength="24"
            :aria-invalid="Boolean(error)"
            :aria-describedby="error ? 'identity-error' : undefined"
            @keydown.enter.prevent="save"
          />
        </UFormField>
        <details v-if="!editingNickname" class="identity-advanced">
          <summary>Advanced</summary>
          <div class="space-y-4">
            <UFormField label="Player ID" help="Identifies you on this device. Generated for you.">
              <div class="flex gap-2">
                <UInput v-model="draft.playerId" class="min-w-0 flex-1" placeholder="player-1234abcd" @keydown.enter.prevent="save" />
                <UButton color="neutral" variant="subtle" icon="i-lucide-refresh-cw" aria-label="Generate a new player ID" @click="generatePlayerId" />
              </div>
            </UFormField>
            <UFormField label="Default lobby mode">
              <UInput v-model="draft.mode" class="w-full" placeholder="default" @keydown.enter.prevent="save" />
            </UFormField>
          </div>
        </details>
      </div>
    </template>

    <template #footer>
      <div class="flex w-full justify-end gap-2">
        <UButton v-if="editingNickname" color="neutral" variant="subtle" label="Cancel" @click="closeNicknameEditor" />
        <UButton :label="editingNickname ? 'Save' : 'Start playing'" :icon="editingNickname ? 'i-lucide-check' : 'i-lucide-arrow-right'" @click="save" />
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
    const displayName = (draft.displayName || "").trim();
    if (!displayName) {
      error.value = "Enter a nickname to continue";
      return;
    }
    identity.displayName = displayName;
    persistIdentity();
    closeNicknameEditor();
    error.value = "";
    return;
  }
  const displayName = (draft.displayName || "").trim();
  if (!displayName) {
    error.value = "Enter a nickname to continue";
    return;
  }
  identity.playerId = draft.playerId.trim() || generatedPlayerId();
  identity.displayName = displayName;
  identity.mode = draft.mode.trim() || "default";
  persistIdentity();
  error.value = "";
}
</script>
