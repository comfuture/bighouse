<template>
  <UApp>
    <div class="min-h-screen bg-muted">
      <UContainer class="py-6">
        <RouterView />
      </UContainer>
      <IdentityModal />
    </div>
  </UApp>
</template>

<script setup lang="ts">
import IdentityModal from "./components/IdentityModal.vue";
</script>
