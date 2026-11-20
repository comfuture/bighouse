<template>
  <nav class="portal-topbar" aria-label="Bighouse">
    <RouterLink class="portal-brand" to="/" aria-label="Bighouse home">
      <span class="portal-brand-mark" aria-hidden="true">BH</span>
      <span class="portal-brand-name">Bighouse</span>
    </RouterLink>
    <div class="portal-topbar-slot">
      <slot />
    </div>
    <button class="portal-player-chip" type="button" title="Change nickname" @click="openNicknameEditor">
      <UIcon name="i-lucide-user-round" aria-hidden="true" />
      <span>{{ identity.displayName || identity.playerId || "Guest" }}</span>
      <UIcon class="portal-player-edit-icon" name="i-lucide-pencil" aria-hidden="true" />
      <span class="sr-only">Change nickname</span>
    </button>
  </nav>
</template>

<script setup lang="ts">
import { identity, openNicknameEditor } from "../identity";
</script>
