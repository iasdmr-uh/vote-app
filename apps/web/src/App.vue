<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import AppHeader from './components/AppHeader.vue'
import AppNotices from './components/AppNotices.vue'
import Mesa from './components/Mesa.vue'
import Proyector from './components/Proyector.vue'
import Telefono from './components/Telefono.vue'
import { useAssembly } from './useAssembly'

const {
  route, code, sessionToken, moderatorToken,
  role, projectorJoinUrl, refreshQr, syncRealtime, startAssembly, stopAssembly,
} = useAssembly()

onMounted(startAssembly)
watch([route, sessionToken, moderatorToken, code], () => syncRealtime())
watch(projectorJoinUrl, () => { void refreshQr() })
onUnmounted(stopAssembly)
</script>

<template>
  <AppHeader v-if="role !== 'projector'" />

  <main :class="['page', `${role}-page`, { 'projector-page': role === 'projector', 'participant-session-page': role === 'participant' && !!sessionToken }]">
    <AppNotices />
    <Telefono v-if="role === 'participant'" />
    <Mesa v-else-if="role === 'moderator'" />
    <Proyector v-else />
  </main>
</template>
