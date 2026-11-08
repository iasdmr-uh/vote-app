<script setup lang="ts">
import { es } from '../locale/es'
import { useAssembly } from '../useAssembly'

const { role, state, sessionToken, code, go, openProjectorWindow } = useAssembly()
</script>

<template>
  <header class="topbar" :class="{ 'topbar-session': role === 'participant' && !!sessionToken }">
    <a class="brand" href="/" @click.prevent="go('/')"><span class="brand-mark">A</span><span v-if="role === 'moderator' && state?.assembly?.name">{{ state.assembly.name }}</span><span v-else>{{ es.common.brandName }} <small>{{ es.common.unionName }}</small></span></a>
    <nav v-if="role === 'moderator'" :aria-label="es.common.mesaViews">
      <a href="/" @click.prevent="go('/')">{{ es.common.delegateView }}</a>
      <a :href="`/projector${code ? `?code=${encodeURIComponent(code)}` : ''}`" @click.prevent="openProjectorWindow">{{ es.common.openProjector }}</a>
    </nav>
  </header>
</template>
