<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">{{ title }}</h2>
        <UBadge color="neutral" variant="subtle">{{ messages.length }}</UBadge>
      </div>
    </template>

    <div class="space-y-3">
      <div class="h-56 overflow-auto rounded-md border border-default p-3">
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

      <div class="grid gap-2 md:grid-cols-[220px_1fr_auto]">
        <UInput v-model="target" placeholder="target playerId" />
        <UInput v-model="body" :placeholder="`${title} message`" @keydown.enter.prevent="submit" />
        <UButton label="Send" icon="i-lucide-send" @click="submit" />
      </div>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { ref } from "vue";
import type { ChatMessage } from "../types";

defineProps<{
  title: string;
  messages: ChatMessage[];
}>();

const emit = defineEmits<{
  send: [body: string, targetPlayerId?: string];
}>();

const body = ref("");
const target = ref("");

function submit(): void {
  const trimmed = body.value.trim();
  if (!trimmed) return;
  emit("send", trimmed, target.value.trim() || undefined);
  body.value = "";
}
</script>
