<template>
  <div class="space-y-6">
    <UPageHeader title="Games" description="Choose a game." />

    <UPageGrid>
      <UPageCard
        v-for="game in displayGames"
        :key="game.gameId"
        :title="game.displayName"
        :description="game.description"
      >
        <img
          v-if="game.thumbnail"
          class="mb-4 aspect-[16/10] w-full rounded-md object-cover"
          :src="game.thumbnail.src"
          :alt="game.thumbnail.alt"
        />
        <div class="mb-4 flex gap-2">
          <UBadge color="neutral" variant="subtle">{{ playerRangeLabel(game) }}</UBadge>
        </div>
        <template #footer>
          <UButton label="Enter lobby" icon="i-lucide-door-open" :to="lobbyPath(game.gameId)" block />
        </template>
      </UPageCard>
    </UPageGrid>

    <UAlert v-if="error" color="error" icon="i-lucide-circle-alert" :title="error" />
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import { listGames } from "../api";
import { getClientGameMetadata } from "../game-plugins";
import { identity } from "../identity";
import type { Game } from "../types";

const games = ref<Game[]>([]);
const error = ref("");
const displayGames = computed<Game[]>(() =>
  games.value.map((game) => {
    const clientMetadata = getClientGameMetadata(game.gameId);
    const thumbnail = clientMetadata?.thumbnail ?? game.thumbnail;
    return {
      ...game,
      description: clientMetadata?.description ?? game.description,
      ...(thumbnail ? { thumbnail } : {})
    };
  })
);

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

function playerRangeLabel(game: Game): string {
  return game.minPlayers === game.maxPlayers
    ? `${game.minPlayers} players`
    : `${game.minPlayers}-${game.maxPlayers} players`;
}
</script>
