<script setup lang="ts">
import { onMounted, onUnmounted, watch } from 'vue'
import Mesa from './components/Mesa.vue'
import Proyector from './components/Proyector.vue'
import Telefono from './components/Telefono.vue'
import { useAssembly } from './useAssembly'

const {
  route, loading, syncing, error, notice, code, sessionToken, moderatorToken, moderatorAuthState, realtimeActive, realtimeConnected,
  role, projectorJoinUrl, go, openProjectorWindow, refresh, refreshQr, syncRealtime, startAssembly, stopAssembly,
} = useAssembly()

onMounted(startAssembly)
watch([route, sessionToken, moderatorToken, code], () => syncRealtime())
watch(projectorJoinUrl, () => { void refreshQr() })
onUnmounted(stopAssembly)
</script>

<template>
  <header v-if="role !== 'projector'" class="topbar" :class="{ 'topbar-session': role === 'participant' && !!sessionToken }">
    <a class="brand" href="/" @click.prevent="go('/')"><span class="brand-mark">A</span><span>ASDMR <small>Unión Hondureña</small></span></a>
    <nav v-if="role === 'moderator'" aria-label="Vistas de mesa">
      <a href="/" @click.prevent="go('/')">Delegado</a>
      <a :href="`/projector${code ? `?code=${encodeURIComponent(code)}` : ''}`" @click.prevent="openProjectorWindow">Abrir proyector</a>
    </nav>
  </header>

  <main :class="['page', `${role}-page`, { 'projector-page': role === 'projector', 'participant-session-page': role === 'participant' && !!sessionToken }]">
    <p v-if="role !== 'projector' && realtimeActive && !realtimeConnected && !(role === 'moderator' && moderatorAuthState === 'validation_error')" class="connection-warning" role="status" aria-live="polite">Conexión interrumpida · Intentando reconectar. Los datos mostrados son los últimos confirmados.</p>
    <div v-if="error && !(role === 'moderator' && moderatorAuthState === 'validation_error')" class="notice error" role="alert"><strong v-if="!(role === 'participant' && !sessionToken && error.startsWith('El código no corresponde'))">Ocurrió un problema.</strong>{{ error }}</div>
    <div v-if="notice" class="notice success" role="status">{{ notice }}</div>
    <p v-if="loading || syncing" class="sync" aria-live="polite">Actualizando estado…</p>
    <Telefono v-if="role === 'participant'" />
    <Mesa v-else-if="role === 'moderator'" />
    <Proyector v-else />
  </main>
  <footer v-if="role !== 'projector'"><span>V1 · Herramienta operativa de la Asamblea</span><button class="link-button" @click="refresh()">Sincronizar estado</button></footer>
</template>
