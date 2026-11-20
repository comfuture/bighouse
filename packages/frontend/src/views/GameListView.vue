<template>
  <div class="portal-page">
    <PortalTopbar />

    <h1 class="sr-only">Bighouse games</h1>

    <section v-if="featuredGame" class="portal-hero" aria-labelledby="portal-hero-title">
      <img
        v-if="featuredGame.thumbnail"
        :key="featuredGame.gameId"
        class="portal-hero-art"
        :src="featuredGame.thumbnail.src"
        alt=""
        aria-hidden="true"
      />
      <div class="portal-hero-body">
        <p class="portal-hero-label">Featured</p>
        <h2 id="portal-hero-title" class="portal-hero-title">{{ featuredGame.displayName }}</h2>
        <p class="portal-hero-copy">{{ featuredGame.description }}</p>
        <div class="portal-hero-actions">
          <RouterLink class="portal-primary-action" :to="lobbyPath(featuredGame.gameId)">
            <UIcon name="i-lucide-play" aria-hidden="true" />
            Play
          </RouterLink>
          <span class="portal-hero-meta">{{ playerRangeLabel(featuredGame) }} · {{ categoryLabel(featuredGame) }}</span>
        </div>
      </div>
      <div v-if="featuredGames.length > 1" class="portal-hero-picker" role="group" aria-label="Featured games">
        <button
          v-for="game in featuredGames"
          :key="game.gameId"
          type="button"
          class="portal-hero-pick"
          data-game-elastic="off"
          :aria-pressed="game.gameId === featuredGame.gameId"
          @click="featuredId = game.gameId"
        >
          <img v-if="game.thumbnail" :src="game.thumbnail.src" alt="" aria-hidden="true" />
          <span>{{ game.displayName }}</span>
        </button>
      </div>
    </section>

    <section v-else-if="!loading" class="portal-hero is-brand" aria-labelledby="portal-hero-title">
      <img class="portal-hero-art" :src="heroImageUrl" alt="" aria-hidden="true" />
      <div class="portal-hero-body">
        <h2 id="portal-hero-title" class="portal-hero-title">Board, card and action games with friends</h2>
        <p class="portal-hero-copy">Pick a game, open a room and share the link. Everyone plays in the browser.</p>
      </div>
    </section>

    <div v-else class="portal-hero is-loading" aria-hidden="true" />

    <section v-if="recentGames.length > 0" class="portal-recent" aria-labelledby="portal-recent-title">
      <h2 id="portal-recent-title">Recently played</h2>
      <div class="portal-recent-list">
        <RouterLink
          v-for="game in recentGames"
          :key="game.gameId"
          class="portal-recent-item"
          data-game-elastic="off"
          :to="lobbyPath(game.gameId)"
        >
          <img v-if="game.thumbnail" :src="game.thumbnail.src" alt="" aria-hidden="true" />
          <span>{{ game.displayName }}</span>
        </RouterLink>
      </div>
    </section>

    <section id="games" class="portal-panel portal-directory" aria-labelledby="portal-directory-title">
      <header class="portal-directory-header">
        <div class="portal-directory-title">
          <h2 id="portal-directory-title">All games</h2>
          <span v-if="!loading" class="portal-count">{{ resultCountLabel }}</span>
        </div>
        <label class="portal-search">
          <UIcon name="i-lucide-search" aria-hidden="true" />
          <span class="sr-only">Search games</span>
          <input v-model="query" type="search" placeholder="Search games" autocomplete="off" spellcheck="false" />
        </label>
      </header>

      <div v-if="categoryFilters.length > 2" class="portal-filter-row" role="group" aria-label="Filter by category">
        <button
          v-for="filter in categoryFilters"
          :key="filter.id"
          type="button"
          class="portal-filter"
          data-game-elastic="off"
          :aria-pressed="activeCategory === filter.id"
          @click="activeCategory = filter.id"
        >
          <UIcon v-if="filter.icon" :name="filter.icon" aria-hidden="true" />
          {{ filter.label }}
          <span class="portal-filter-count">{{ filter.count }}</span>
        </button>
      </div>

      <div v-if="loading" class="portal-game-grid" aria-label="Loading games" aria-busy="true">
        <div v-for="index in 8" :key="index" class="portal-game-card is-skeleton">
          <div class="portal-game-art" />
          <div class="portal-game-card-body">
            <div class="portal-skeleton-line" />
            <div class="portal-skeleton-line is-short" />
          </div>
        </div>
      </div>

      <div v-else-if="visibleGames.length > 0" class="portal-game-grid">
        <RouterLink
          v-for="game in visibleGames"
          :key="game.gameId"
          class="portal-game-card"
          data-game-elastic="off"
          :to="lobbyPath(game.gameId)"
        >
          <div class="portal-game-art">
            <img v-if="game.thumbnail" :src="game.thumbnail.src" :alt="game.thumbnail.alt" loading="lazy" />
          </div>
          <div class="portal-game-card-body">
            <h3>{{ game.displayName }}</h3>
            <p>{{ game.description }}</p>
            <div class="portal-game-meta">
              <span><UIcon name="i-lucide-users" aria-hidden="true" />{{ playerRangeLabel(game) }}</span>
              <span>{{ categoryLabel(game) }}</span>
            </div>
          </div>
        </RouterLink>
      </div>

      <div v-else-if="games.length > 0" class="portal-empty">
        <UIcon name="i-lucide-search-x" aria-hidden="true" />
        <div>
          <h3>No games match your search</h3>
          <p>Try another name, or browse every game.</p>
        </div>
        <button class="portal-secondary-action" type="button" @click="resetFilters">Show all games</button>
      </div>

      <div v-else-if="!error" class="portal-empty">
        <UIcon name="i-lucide-gamepad-2" aria-hidden="true" />
        <div>
          <h3>No games yet</h3>
          <p>Games appear here as soon as they are registered.</p>
        </div>
      </div>

      <div v-if="error" class="portal-alert is-error" role="alert">
        <UIcon name="i-lucide-circle-alert" aria-hidden="true" />
        <div>
          <strong>Games could not be loaded</strong>
          <span>{{ error }}</span>
        </div>
        <button class="portal-secondary-action" type="button" @click="loadGames">Try again</button>
      </div>
    </section>
  </div>
</template>

<script setup lang="ts">
import { computed, onMounted, ref } from "vue";
import PortalTopbar from "../components/PortalTopbar.vue";
import { listGames } from "../api";
import {
  categories,
  categoryLabel,
  categoryOf,
  featuredGameIds,
  lobbyPath,
  playerRangeLabel,
  recentGameIds,
  withClientMetadata,
  type CategoryId
} from "../portal";
import type { Game } from "../types";
import heroImageUrl from "../assets/generated/game-portal-hero.png";

const games = ref<Game[]>([]);
const error = ref("");
const loading = ref(true);
const query = ref("");
const activeCategory = ref<CategoryId | "all">("all");
const featuredId = ref("");

const displayGames = computed<Game[]>(() => games.value.map(withClientMetadata));
const gamesById = computed(() => new Map(displayGames.value.map((game) => [game.gameId, game])));

function pickGames(ids: string[]): Game[] {
  return ids.flatMap((id) => gamesById.value.get(id) ?? []);
}

const featuredGames = computed(() => pickGames(featuredGameIds));
const featuredGame = computed(
  () => featuredGames.value.find((game) => game.gameId === featuredId.value) ?? featuredGames.value[0]
);
const recentGames = computed(() => pickGames(recentGameIds()));

const categoryFilters = computed(() => {
  const counts = new Map<CategoryId, number>();
  for (const game of displayGames.value) counts.set(categoryOf(game), (counts.get(categoryOf(game)) ?? 0) + 1);
  return [
    { id: "all" as const, label: "All", icon: "", count: displayGames.value.length },
    ...categories
      .filter((entry) => counts.has(entry.id))
      .map((entry) => ({ ...entry, count: counts.get(entry.id) ?? 0 }))
  ];
});

const visibleGames = computed(() => {
  const needle = query.value.trim().toLowerCase();
  return displayGames.value.filter((game) => {
    if (activeCategory.value !== "all" && categoryOf(game) !== activeCategory.value) return false;
    if (!needle) return true;
    return [game.displayName, game.description, game.gameId, categoryLabel(game)]
      .some((field) => field.toLowerCase().includes(needle));
  });
});

const resultCountLabel = computed(() => {
  const shown = visibleGames.value.length;
  const total = displayGames.value.length;
  if (shown === total) return total === 1 ? "1 game" : `${total} games`;
  return `${shown} of ${total}`;
});

onMounted(loadGames);

async function loadGames(): Promise<void> {
  loading.value = true;
  error.value = "";
  try {
    games.value = await listGames();
  } catch (cause) {
    error.value = cause instanceof Error ? cause.message : "Check your connection and try again";
  } finally {
    loading.value = false;
  }
}

function resetFilters(): void {
  query.value = "";
  activeCategory.value = "all";
}
</script>
