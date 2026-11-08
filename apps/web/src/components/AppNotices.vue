<script setup lang="ts">
import { es } from '../locale/es'
import { useAssembly } from '../useAssembly'

const { role, realtimeActive, realtimeConnected, phoneOnline, moderatorAuthState, error, notice, loading, syncing, sessionToken } = useAssembly()
</script>

<template>
    <p v-if="role !== 'projector' && realtimeActive && !(role === 'participant' ? phoneOnline : realtimeConnected) && !(role === 'moderator' && moderatorAuthState === 'validation_error')" class="connection-warning" role="status" aria-live="polite">{{ es.common.connectionLost }}</p>
    <div v-if="error && !(role === 'moderator' && moderatorAuthState === 'validation_error')" class="notice error" role="alert"><strong v-if="!(role === 'participant' && !sessionToken && error.startsWith(es.common.codeMismatchPrefix))">{{ es.common.problemPrefix }}</strong>{{ error }}</div>
    <div v-if="notice" class="notice success" role="status">{{ notice }}</div>
    <p v-if="loading || syncing" class="sync" aria-live="polite">{{ es.common.updating }}</p>
</template>
