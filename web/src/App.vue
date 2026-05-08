<script setup lang="ts">
import { computed } from 'vue';
import { useRoute } from 'vue-router';
import AppHeader from '@/components/AppHeader.vue';

const route = useRoute();
const isBlank = computed(() => route.meta.layout === 'blank');
</script>

<template>
  <div v-if="isBlank">
    <router-view />
  </div>
  <div v-else style="min-height: 100%; display: flex; flex-direction: column;">
    <AppHeader />
    <main style="flex: 1;">
      <router-view v-slot="{ Component }">
        <component :is="Component" />
      </router-view>
    </main>
  </div>
</template>
