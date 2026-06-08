<template>
  <UApp>
    <div class="game-portal-shell">
      <div class="game-portal-container">
        <RouterView />
      </div>
      <IdentityModal />
    </div>
  </UApp>
</template>

<script setup lang="ts">
import IdentityModal from "./components/IdentityModal.vue";
</script>
