<template>
  <section class="portal-chat" :aria-label="title">
    <header class="portal-chat-header">
      <div>
        <span class="portal-kicker">Live channel</span>
        <h2>{{ title }}</h2>
      </div>
      <span class="portal-chat-count">{{ messages.length }}</span>
    </header>

    <div ref="logElement" class="portal-chat-log" role="log" aria-live="polite" aria-relevant="additions">
      <div v-if="messages.length === 0" class="portal-chat-empty">
        <UIcon name="i-lucide-message-circle-more" aria-hidden="true" />
        <span>No messages yet. Say hello.</span>
      </div>
      <div v-for="message in messages.slice(-80)" :key="`${message.createdAt}-${message.playerId}-${message.body}`" class="portal-chat-message">
        <div class="portal-chat-message-meta">
          <strong>{{ message.displayName || message.playerId }}</strong>
          <span v-if="message.visibility === 'private'" class="portal-chat-private">private</span>
          <span v-if="message.targetPlayerId">to {{ message.targetPlayerId }}</span>
        </div>
        <p>{{ message.body }}</p>
      </div>
    </div>

    <div class="portal-chat-composer">
      <UInput
        v-model="body"
        class="min-w-0 flex-1"
        :placeholder="`Message ${title.toLowerCase()}`"
        aria-label="Chat message"
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
  </section>
</template>

<script setup lang="ts">
import { nextTick, ref, watch } from "vue";
import {
  createChatImeState,
  markCompositionEnd,
  markCompositionStart,
  shouldSubmitChatEnter
} from "../chat-ime";
import type { ChatMessage } from "../types";

const props = defineProps<{
  title: string;
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  send: [body: string, targetPlayerId?: string];
}>();

const body = ref("");
const logElement = ref<HTMLElement>();
const imeState = createChatImeState();

watch(
  () => props.messages.length,
  async () => {
    await nextTick();
    if (logElement.value) logElement.value.scrollTop = logElement.value.scrollHeight;
  }
);

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
