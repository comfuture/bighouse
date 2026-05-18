<template>
  <div class="space-y-6">
    <UPageHeader title="Games" description="Choose a game." />

    <UPageGrid>
      <UPageCard
        v-for="game in games"
        :key="game.gameId"
        :title="game.displayName"
        :description="`${game.minPlayers}-${game.maxPlayers} players`"
        icon="i-lucide-gamepad-2"
      >
        <template #footer>
          <UButton label="Enter lobby" icon="i-lucide-door-open" :to="lobbyPath(game.gameId)" block />
        </template>
      </UPageCard>
    </UPageGrid>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />
  </div>
</template>

<script setup lang="ts">
import { onMounted, ref } from "vue";
import { listGames } from "../api";
import { identity } from "../identity";
import type { Game } from "../types";

const games = ref<Game[]>([]);
const error = ref("");

onMounted(async () => {
  try {
    games.value = await listGames();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Failed to load games";
  }
});

function lobbyPath(gameId: string): string {
  return `/game/${encodeURIComponent(gameId)}/${encodeURIComponent(identity.mode)}`;
}
</script>
