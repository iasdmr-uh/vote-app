<script setup lang="ts">
import { computed } from 'vue'
import { committeeVoters, rankOf, resultPercent } from '../resultados'
import { useAssembly } from '../useAssembly'

const {
  error, state, code, qrImage, realtimeActive, realtimeConnected, projectorFullscreen, assemblyStatus, lobbyStatus, round, completionTime,
  projectorJoinUrl, go, formatDateTime,
} = useAssembly()

const projectorJoinHost = computed(() => { try { return new URL(projectorJoinUrl.value).host } catch { return '' } })
const projectorProgressPercent = computed(() => {
  const eligible = state.value?.eligibleCount ?? 0
  const recorded = state.value?.recordedCount ?? 0
  return eligible > 0 ? Math.min(100, Math.round((recorded / eligible) * 100)) : 0
})

async function toggleProjectorFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.querySelector('.projector-page')?.requestFullscreen()
    projectorFullscreen.value = Boolean(document.fullscreenElement)
  } catch {
    error.value = 'No se pudo activar pantalla completa. Usa la opción de pantalla completa del navegador.'
  }
}
</script>

<template>
  <div v-if="code" class="projector-controls"><span>Esta ventana es solo para el público. La moderación sigue en la ventana original. Muévela al televisor antes de proyectar.</span><button class="secondary" @click="toggleProjectorFullscreen">{{ projectorFullscreen ? 'Salir de pantalla completa' : 'Iniciar proyección' }}</button></div>
  <section v-if="!code" class="card join-card"><p class="eyebrow">PANTALLA PÚBLICA</p><h1>Proyector</h1><p class="lead">Ingresa el código de la sala para mostrar el estado permitido de la Asamblea.</p><form @submit.prevent="go(`/projector?code=${encodeURIComponent(code)}`)"><label>Código de sala<input v-model="code" required /></label><button class="primary">Mostrar sala</button></form></section>
  <section v-else class="projector-content">
    <p class="eyebrow">ASDMR · UNIÓN HONDUREÑA</p>
    <h1>{{ assemblyStatus === 'completed' ? 'Asamblea finalizada' : round?.status === 'published' ? (round.category === 'committee' ? round.title : 'Resultados publicados') : round?.status === 'open' || round?.status === 'closed' || round?.status === 'annulled' ? round.title : 'Sala de Asamblea' }}</h1>
    <p class="projector-subtitle">{{ assemblyStatus === 'completed' ? `Sesión concluida${completionTime ? ` · ${completionTime}` : ''}` : round?.status === 'annulled' ? 'Votación anulada por la mesa · no se contará' : round?.status === 'open' ? 'Votación abierta' : round?.status === 'closed' ? 'Votación cerrada · resultados ocultos' : round?.status === 'published' ? (round.category === 'committee' ? `Conteo publicado por la mesa · se eligen ${round.memberCount} integrantes · ordenados de mayor a menor` : `${round.title} · resultados autorizados por la mesa`) : 'Estado: ' + assemblyStatus }}</p>
    <p v-if="realtimeActive && !realtimeConnected" class="connection-warning projector-connection-warning" role="status" aria-live="polite">Conexión interrumpida · Intentando reconectar. Los datos mostrados son los últimos confirmados.</p>
    <section v-if="round?.status === 'annulled'" class="projector-annulled" role="status"><h2>Ningún voto de esta papeleta se contará</h2><p>Espera la indicación de la mesa. Si se repite la votación, volverás a votar desde tu teléfono.</p></section>
    <section v-if="state?.officialResult" class="projector-official-result"><p class="eyebrow">RESULTADO DECLARADO POR LA MESA</p><h2>{{ state.officialResult.elected.map((person) => person.label).join(' · ') }}</h2><p v-if="state.officialResult.note">{{ state.officialResult.note }}</p><small>Declaración registrada {{ formatDateTime(state.officialResult.declaredAt) }}</small></section>
    <div v-if="round?.status === 'published'" class="results-list projector-results">
      <div v-for="(result, index) in state?.results || []" :key="result.label"><span>{{ rankOf(state?.results || [], index) }} {{ result.label }}</span><strong>{{ result.count }} {{ result.count === 1 ? 'voto' : 'votos' }} <small>{{ resultPercent(state?.results || [], result.count, committeeVoters(round, state?.recordedCount)) }} %</small></strong><span class="result-bar" aria-hidden="true"><span :style="{ width: `${resultPercent(state?.results || [], result.count, committeeVoters(round, state?.recordedCount))}%` }"></span></span></div>
      <p v-if="round.category === 'committee'" class="projector-results-note">{{ state?.recordedCount ?? 0 }} de {{ state?.participantCount ?? 0 }} participantes votaron · cada persona marcó hasta {{ round.electionSeats ?? round.memberCount }} {{ (round.electionSeats ?? round.memberCount) === 1 ? 'candidato' : 'candidatos' }} · % sobre quienes votaron · el voto es secreto</p>
      <template v-else>
        <p class="projector-result-total">Total: {{ (state?.results || []).reduce((total, result) => total + result.count, 0) }} {{ (state?.results || []).reduce((total, result) => total + result.count, 0) === 1 ? 'voto' : 'votos' }}</p>
        <p class="projector-results-note">Ordenado por votos · la mesa declara el resultado oficial</p>
      </template>
    </div>
    <div v-if="round?.status === 'open' || round?.status === 'closed'" class="projector-progress" aria-live="polite">
      <strong>{{ state?.recordedCount ?? 0 }}</strong>
      <span>de {{ state?.eligibleCount ?? state?.participantCount ?? 0 }} {{ (state?.eligibleCount ?? state?.participantCount ?? 0) === 1 ? 'voto recibido' : 'votos recibidos' }}</span>
      <div class="progress-track" role="progressbar" :aria-valuenow="state?.recordedCount ?? 0" :aria-valuemin="0" :aria-valuemax="state?.eligibleCount ?? state?.participantCount ?? 0" aria-label="Participación agregada en la votación"><span :style="{ width: `${projectorProgressPercent}%` }"></span></div>
      <p v-if="round?.status === 'closed'" class="projector-closed-note">La votación terminó. Los resultados se mostrarán cuando la mesa decida publicarlos.</p>
    </div>
    <div v-else-if="lobbyStatus !== 'lobby_open' && round?.status !== 'published'" class="projector-progress"><strong>{{ state?.participantCount ?? 0 }}</strong><span>personas en la sala</span></div>
    <section v-if="lobbyStatus === 'lobby_open'" class="projector-lobby" aria-label="Ingreso abierto">
      <div class="projector-lobby-summary">
        <img v-if="qrImage" class="projector-qr" :src="qrImage" alt="Código QR para unirse a la Asamblea" />
        <div><p class="eyebrow">INGRESO ABIERTO</p><strong class="projector-join-count">{{ state?.participantCount ?? 0 }}</strong><span>personas han ingresado</span><p>Código: <strong>{{ code }}</strong></p><p v-if="projectorJoinHost" class="projector-join-address">Sin QR: abre <strong>{{ projectorJoinHost }}</strong> en el navegador e ingresa el código.</p></div>
      </div>
      <div class="projector-participant-panel">
        <h2>Personas que ya ingresaron <span>{{ state?.participantCount ?? 0 }}</span></h2>
        <ul class="projector-participants" aria-label="Lista de participantes en la sala">
          <li v-for="(person, index) in state?.participants || []" :key="`${person.firstName}-${person.lastName}-${index}`">{{ person.firstName }} {{ person.lastName }}</li>
          <li v-if="!state?.participants?.length" class="empty">Todavía no ha ingresado nadie.</li>
        </ul>
        <p class="projector-list-note">Al iniciar la votación, esta lista se oculta y el proyector muestra solo el progreso agregado.</p>
      </div>
    </section>
  </section></template>
