<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">{{ title }}</h2>
        <UBadge color="neutral" variant="subtle">{{ messages.length }}</UBadge>
      </div>
    </template>

    <div class="space-y-3">
      <div class="game-stage h-56 overflow-auto rounded-3xl p-3">
        <div v-if="messages.length === 0" class="text-sm text-muted">No messages.</div>
        <div v-for="message in messages.slice(-80)" :key="`${message.createdAt}-${message.playerId}-${message.body}`" class="mb-3">
          <div class="flex items-center gap-2 text-xs text-muted">
            <span>{{ message.displayName || message.playerId }}</span>
            <UBadge v-if="message.visibility === 'private'" size="xs" color="warning" variant="subtle">private</UBadge>
            <span v-if="message.targetPlayerId">to {{ message.targetPlayerId }}</span>
          </div>
          <p class="text-sm text-highlighted">{{ message.body }}</p>
        </div>
      </div>

      <div class="flex items-center gap-2">
        <UInput
          v-model="body"
          class="min-w-0 flex-1"
          :placeholder="`${title} message`"
          @compositionstart="handleCompositionStart"
          @compositionend="handleCompositionEnd"
          @keydown.enter="handleEnter"
        />
        <UButton
          type="button"
          icon="i-lucide-send"
          color="primary"
          variant="solid"
          class="shrink-0"
          aria-label="Send message"
          :disabled="body.trim().length === 0"
          @click="submit"
        />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { ref } from "vue";
import {
  createChatImeState,
  markCompositionEnd,
  markCompositionStart,
  shouldSubmitChatEnter
} from "../chat-ime";
import type { ChatMessage } from "../types";

defineProps<{
  title: string;
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  send: [body: string, targetPlayerId?: string];
}>();

const body = ref("");
const imeState = createChatImeState();

function handleCompositionStart(): void {
  markCompositionStart(imeState);
}

function handleCompositionEnd(): void {
  markCompositionEnd(imeState);
}

function handleEnter(event: KeyboardEvent): void {
  if (!shouldSubmitChatEnter(event, imeState)) return;
  event.preventDefault();
  submit();
}

function submit(): void {
  const trimmed = body.value.trim();
  if (!trimmed) return;
  emit("send", trimmed);
  body.value = "";
}
</script>
