<script setup lang="ts">
import { useAssembly } from '../useAssembly'

const { role, state, sessionToken, code, go, openProjectorWindow } = useAssembly()
</script>

<template>
  <header class="topbar" :class="{ 'topbar-session': role === 'participant' && !!sessionToken }">
    <a class="brand" href="/" @click.prevent="go('/')"><span class="brand-mark">A</span><span v-if="role === 'moderator' && state?.assembly?.name">{{ state.assembly.name }}</span><span v-else>ASDMR <small>Unión Hondureña</small></span></a>
    <nav v-if="role === 'moderator'" aria-label="Vistas de mesa">
      <a href="/" @click.prevent="go('/')">Delegado</a>
      <a :href="`/projector${code ? `?code=${encodeURIComponent(code)}` : ''}`" @click.prevent="openProjectorWindow">Abrir proyector</a>
    </nav>
  </header>
</template>
