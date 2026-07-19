<template>
  <div class="portal-page">
    <nav class="portal-topbar" aria-label="Bighouse navigation">
      <RouterLink class="portal-brand" to="/" aria-label="Bighouse home">
        <span class="portal-brand-mark" aria-hidden="true">BH</span>
        <span>Bighouse</span>
      </RouterLink>
      <div class="portal-player-chip" aria-label="Current player">
        <UIcon name="i-lucide-user-round" aria-hidden="true" />
        <span>{{ identity.displayName || identity.playerId || "New player" }}</span>
      </div>
    </nav>

    <section class="game-home-hero" aria-labelledby="game-home-title">
      <img class="game-home-hero-image" :src="heroImageUrl" alt="" aria-hidden="true" />
      <div class="game-home-hero-overlay" />
      <div class="game-home-hero-content">
        <div class="portal-eyebrow">
          <span class="portal-live-dot" aria-hidden="true" />
          Multiplayer tables are open
        </div>
        <h1 id="game-home-title" class="game-home-hero-title">Your next table is waiting.</h1>
        <p class="game-home-hero-copy">
          Pick a game, meet at the table, and start playing in seconds.
        </p>
        <a class="portal-primary-action" href="#game-select">
          Choose a game
          <UIcon name="i-lucide-arrow-down" aria-hidden="true" />
        </a>
      </div>
      <div class="game-home-hero-status" aria-hidden="true">
        <strong>{{ displayGames.length }}</strong>
        <span>games ready</span>
      </div>
    </section>

    <section id="game-select" class="portal-game-section" aria-labelledby="game-select-title">
      <header class="portal-section-heading">
        <div>
          <div class="portal-kicker">Game room directory</div>
          <h2 id="game-select-title">Choose your table</h2>
        </div>
        <div class="portal-section-count">{{ displayGames.length }} available</div>
      </header>

      <div v-if="loading" class="portal-game-grid" aria-label="Loading games" aria-busy="true">
        <div v-for="index in 4" :key="index" class="portal-game-card portal-game-card-skeleton">
          <div class="portal-skeleton-image" />
          <div class="portal-skeleton-line" />
          <div class="portal-skeleton-line is-short" />
        </div>
      </div>

      <div v-else-if="displayGames.length > 0" class="portal-game-grid">
        <RouterLink
          v-for="game in displayGames"
          :key="game.gameId"
          class="portal-game-card"
          :aria-label="`Enter ${game.displayName} lobby`"
          :to="lobbyPath(game.gameId)"
        >
          <div class="portal-game-art">
            <img
              v-if="game.thumbnail"
              class="portal-game-thumbnail"
              :src="game.thumbnail.src"
              :alt="game.thumbnail.alt"
            />
            <div class="portal-game-player-count">
              <UIcon name="i-lucide-users" aria-hidden="true" />
              {{ playerRangeLabel(game) }}
            </div>
          </div>
          <div class="portal-game-card-body">
            <div>
              <h3>{{ game.displayName }}</h3>
              <p>{{ game.description }}</p>
            </div>
            <span class="portal-game-enter" aria-hidden="true">
              <UIcon name="i-lucide-arrow-up-right" />
            </span>
          </div>
        </RouterLink>
      </div>

      <div v-else class="portal-directory-empty">
        <UIcon name="i-lucide-gamepad-2" aria-hidden="true" />
        <div>
          <h3>No games are available yet</h3>
          <p>New tables will appear here as soon as they are registered.</p>
        </div>
      </div>
    </section>

    <div v-if="error" class="portal-alert is-error" role="alert">
      <UIcon name="i-lucide-circle-alert" aria-hidden="true" />
      <div>
        <strong>Games could not be loaded</strong>
        <span>{{ error }}</span>
      </div>
    </div>
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
const loading = ref(true);
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
  } finally {
    loading.value = false;
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
