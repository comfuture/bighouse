<template>
  <UApp>
    <div :class="isImmersiveRoom ? 'game-room-app-shell' : 'game-portal-shell'">
      <div v-if="!isImmersiveRoom" class="game-portal-container">
        <RouterView />
      </div>
      <RouterView v-else />
      <IdentityModal />
    </div>
  </UApp>
</template>

<script setup lang="ts">
import { computed } from "vue";
import { useRoute } from "vue-router";
import IdentityModal from "./components/IdentityModal.vue";

const route = useRoute();
const isImmersiveRoom = computed(() => route.meta.immersive === true);
</script>
