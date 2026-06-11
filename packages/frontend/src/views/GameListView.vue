<template>
  <div class="space-y-6">
    <section class="game-home-hero" aria-labelledby="game-home-title">
      <img class="game-home-hero-image" :src="heroImageUrl" alt="" aria-hidden="true" />
      <div class="game-home-hero-overlay" />
      <div class="game-home-hero-content">
        <h1 id="game-home-title" class="game-home-hero-title">Bighouse</h1>
        <p class="game-home-hero-copy">Pick a table, jump into a lobby, and keep the room moving.</p>
      </div>
    </section>

    <UPageGrid>
      <RouterLink
        v-for="game in displayGames"
        :key="game.gameId"
        class="group block h-full rounded-3xl focus:outline-none focus-visible:ring-4 focus-visible:ring-primary/40"
        :aria-label="`Enter ${game.displayName} lobby`"
        :to="lobbyPath(game.gameId)"
      >
        <UCard class="game-plastic-card h-full" :ui="{ body: '!p-0 sm:!p-0' }">
          <img
            v-if="game.thumbnail"
            class="aspect-[16/10] w-full rounded-t-3xl object-cover"
            :src="game.thumbnail.src"
            :alt="game.thumbnail.alt"
          />
          <div class="space-y-4 p-4 sm:p-5">
            <div class="space-y-2">
              <div class="flex items-start justify-between gap-3">
                <h2 class="text-lg font-black text-highlighted">{{ game.displayName }}</h2>
                <UBadge
                  color="secondary"
                  variant="subtle"
                  icon="i-lucide-users"
                  :label="playerRangeLabel(game)"
                  class="shrink-0"
                />
              </div>
              <p class="text-sm font-medium text-toned">{{ game.description }}</p>
            </div>
          </div>
        </UCard>
      </RouterLink>
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
import heroImageUrl from "../assets/generated/game-portal-hero.png";

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
    ? String(game.minPlayers)
    : `${game.minPlayers}-${game.maxPlayers}`;
}
</script>
