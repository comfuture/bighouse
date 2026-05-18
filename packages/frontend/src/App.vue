<template>
  <UApp>
    <div class="min-h-screen bg-muted">
      <UContainer class="py-6">
        <div class="mb-6 flex items-center justify-between gap-4">
          <div>
            <p class="text-sm font-medium text-muted">Bighouse</p>
            <h1 class="text-2xl font-semibold text-highlighted">Multiplayer game server</h1>
          </div>
          <UBadge color="neutral" variant="subtle">{{ routeLabel }}</UBadge>
        </div>
        <RouterView />
      </UContainer>
    </div>
  </UApp>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";

const route = useRoute();
const routeLabel = computed(() => {
  if (route.name === "lobby") return "Lobby";
  if (route.name === "room") return "Room";
  return "Games";
});
</script>
