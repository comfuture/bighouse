<template>
  <UCard>
    <template #header>
      <div class="flex items-center justify-between">
        <h2 class="font-semibold">Player</h2>
        <UBadge color="neutral" variant="subtle">{{ identity.mode }}</UBadge>
      </div>
    </template>

    <div class="grid gap-4 md:grid-cols-3">
      <UFormField label="Player ID" required>
        <UInput v-model="identity.playerId" @change="persistIdentity" />
      </UFormField>
      <UFormField label="Display name">
        <UInput v-model="identity.displayName" placeholder="Alice" @change="persistIdentity" />
      </UFormField>
      <UFormField label="Lobby mode">
        <UInput v-model="identity.mode" @change="persistIdentity" />
      </UFormField>
    </div>
  </UCard>
</template>

<script setup lang="ts">
import { identity, persistIdentity } from "../identity";
</script>
