<script setup lang="ts">
import { useAssembly } from '../useAssembly'

const { role, realtimeActive, realtimeConnected, phoneOnline, moderatorAuthState, error, notice, loading, syncing, sessionToken } = useAssembly()
</script>

<template>
    <p v-if="role !== 'projector' && realtimeActive && !(role === 'participant' ? phoneOnline : realtimeConnected) && !(role === 'moderator' && moderatorAuthState === 'validation_error')" class="connection-warning" role="status" aria-live="polite">Conexión interrumpida · Intentando reconectar. Los datos mostrados son los últimos confirmados.</p>
    <div v-if="error && !(role === 'moderator' && moderatorAuthState === 'validation_error')" class="notice error" role="alert"><strong v-if="!(role === 'participant' && !sessionToken && error.startsWith('El código no corresponde'))">Ocurrió un problema.</strong>{{ error }}</div>
    <div v-if="notice" class="notice success" role="status">{{ notice }}</div>
    <p v-if="loading || syncing" class="sync" aria-live="polite">Actualizando estado…</p>
</template>
