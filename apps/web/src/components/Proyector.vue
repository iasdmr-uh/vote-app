<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { isTied as tiedAt, percentOf } from '../resultados'
import { useAssembly } from '../useAssembly'

const LOBBY_SLOTS = 21

const {
  error, state, code, qrImage, realtimeActive, realtimeConnected, projectorFullscreen, assemblyStatus, lobbyStatus, round, completionTime,
  projectorJoinUrl, go,
} = useAssembly()

const projectorJoinHost = computed(() => { try { return new URL(projectorJoinUrl.value).host } catch { return '' } })
const eligible = computed(() => state.value?.eligibleCount ?? state.value?.participantCount ?? 0)
const recorded = computed(() => state.value?.recordedCount ?? 0)
const progressPercent = computed(() => eligible.value > 0 ? Math.min(100, Math.round((recorded.value / eligible.value) * 100)) : 0)
const isCommittee = computed(() => round.value?.category === 'committee')

const view = computed(() => {
  if (round.value?.status === 'published') return 'results'
  if (assemblyStatus.value === 'completed') return 'completed'
  if (round.value?.status === 'annulled') return 'annulled'
  if (round.value?.status === 'open' || round.value?.status === 'closed') return 'voting'
  if (lobbyStatus.value === 'lobby_open') return 'lobby'
  return 'idle'
})

const statusLabel = computed(() => ({
  voting: round.value?.status === 'closed' ? 'Votación cerrada' : 'Votación abierta',
  results: assemblyStatus.value === 'completed' ? 'Asamblea finalizada' : 'Conteo publicado',
  annulled: 'Votación anulada',
  completed: 'Asamblea finalizada',
  lobby: '',
  idle: '',
}[view.value]))

const assemblyName = computed(() => state.value?.assembly?.name || 'Asamblea')

const participants = computed(() => state.value?.participants || [])
const lobbyTotal = computed(() => state.value?.participantCount ?? participants.value.length)
const lobbyNames = computed(() => participants.value.slice(0, lobbyTotal.value > LOBBY_SLOTS ? LOBBY_SLOTS - 1 : LOBBY_SLOTS))
const lobbyMore = computed(() => lobbyTotal.value > LOBBY_SLOTS ? lobbyTotal.value - lobbyNames.value.length : 0)

const results = computed(() => [...(state.value?.results || [])].sort((a, b) => b.count - a.count))
const electedLabels = computed(() => new Set((state.value?.officialResult?.elected || []).map((person) => person.label)))
const officeElected = computed(() => !isCommittee.value ? state.value?.officialResult?.elected || [] : [])

function isTied(index: number) {
  return tiedAt(results.value, index)
}

const columns = computed(() => results.value.length > 8 ? 2 : 1)
const rowsPerColumn = computed(() => Math.max(1, Math.ceil(results.value.length / columns.value)))
const resultsList = ref<HTMLElement | null>(null)
const density = ref(1)

async function fitResults() {
  const rows = rowsPerColumn.value + (officeElected.value.length ? 1.2 : 0)
  density.value = Math.max(0.45, Math.min(1, 4.2 / rows))
  await nextTick()
  const list = resultsList.value
  while (list && list.scrollHeight > list.clientHeight + 1 && density.value > 0.45) {
    density.value = Math.max(0.45, density.value - 0.05)
    await nextTick()
  }
}

watch([results, officeElected, () => round.value?.title, view], () => { void fitResults() }, { immediate: true })
onMounted(() => window.addEventListener('resize', fitResults))
onUnmounted(() => window.removeEventListener('resize', fitResults))

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
  <button v-if="code" class="pj-fullscreen secondary" @click="toggleProjectorFullscreen">{{ projectorFullscreen ? 'Salir de pantalla completa' : 'Pantalla completa' }}</button>
  <section v-if="!code" class="card join-card"><h1>Proyector</h1><form @submit.prevent="go(`/projector?code=${encodeURIComponent(code)}`)"><label>Código de sala<input v-model="code" required /></label><button class="primary">Mostrar sala</button></form></section>
  <section v-else class="pj">
    <p v-if="realtimeActive && !realtimeConnected" class="pj-offline" role="status" aria-live="polite">Reconectando…</p>

    <template v-if="view === 'lobby'">
      <h1 class="pj-title pj-title-lobby">{{ assemblyName }}</h1>
      <div class="pj-lobby" aria-label="Ingreso abierto">
        <div class="pj-card pj-join">
          <img v-if="qrImage" class="pj-qr projector-qr" :src="qrImage" alt="Código QR para unirse a la Asamblea" />
          <strong v-if="projectorJoinHost" class="pj-host">{{ projectorJoinHost }}</strong>
        </div>
        <div class="pj-card pj-room">
          <div class="pj-room-head"><h2>En la sala</h2><strong>{{ lobbyTotal }}</strong></div>
          <ul class="pj-names" aria-label="Personas en la sala">
            <li v-for="(person, index) in lobbyNames" :key="`${person.firstName}-${person.lastName}-${index}`">{{ person.firstName }} {{ person.lastName }}</li>
            <li v-if="lobbyMore" class="pj-more">+ {{ lobbyMore }} más</li>
          </ul>
        </div>
      </div>
    </template>

    <template v-else-if="view === 'voting'">
      <p class="pj-status" :class="{ 'pj-status-live': round?.status === 'open' }">{{ statusLabel }}</p>
      <h1 class="pj-title pj-title-xl">{{ round?.title }}</h1>
      <div class="pj-progress" aria-live="polite">
        <p><strong>{{ recorded }}</strong><span>de {{ eligible }} ya votaron</span></p>
        <div class="pj-track" role="progressbar" :aria-valuenow="recorded" :aria-valuemin="0" :aria-valuemax="eligible" aria-label="Personas que ya votaron"><span :style="{ width: `${progressPercent}%` }"></span></div>
      </div>
    </template>

    <template v-else-if="view === 'results'">
      <header class="pj-results-head">
        <div>
          <p class="pj-status">{{ statusLabel }}</p>
          <h1 class="pj-title">{{ round?.title }}</h1>
          <p v-if="isCommittee && (round?.electionSeats ?? round?.memberCount)" class="pj-subtitle">Se eligen {{ round?.electionSeats ?? round?.memberCount }} integrantes</p>
        </div>
        <p class="pj-card pj-turnout"><strong>{{ recorded }}</strong> <span>de {{ eligible }}</span><small>votaron</small></p>
      </header>
      <div v-if="officeElected.length" class="pj-elected"><p>{{ officeElected.length === 1 ? 'Electo/a' : 'Electos' }}</p><h2>{{ officeElected.map((person) => person.label).join(' · ') }}</h2></div>
      <ol ref="resultsList" class="pj-results" :style="{ '--k': density, '--cols': columns, '--rows': rowsPerColumn }">
        <li v-for="(result, index) in results" :key="result.label" class="pj-card" :class="{ 'pj-first': index === 0 && result.count > 0 }">
          <span class="pj-rank">{{ index + 1 }}</span>
          <span class="pj-name"><span class="pj-label">{{ result.label }}</span><em v-if="isTied(index)" class="pj-tie">Empate</em><em v-if="isCommittee && electedLabels.has(result.label)" class="pj-elected-tag">Electo/a</em></span>
          <strong class="pj-votes">{{ result.count }} {{ result.count === 1 ? 'voto' : 'votos' }}</strong>
          <span class="pj-percent">{{ percentOf(result.count, eligible) }} %</span>
          <span class="pj-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, percentOf(result.count, eligible))}%` }"></span></span>
        </li>
      </ol>
    </template>

    <template v-else-if="view === 'annulled'">
      <p class="pj-status pj-status-annulled">{{ statusLabel }}</p>
      <h1 class="pj-title pj-title-xl">{{ round?.title }}</h1>
    </template>

    <template v-else-if="view === 'completed'">
      <p class="pj-status">{{ statusLabel }}</p>
      <h1 class="pj-title pj-title-xl">{{ assemblyName }}</h1>
      <p v-if="completionTime" class="pj-subtitle">{{ completionTime }}</p>
    </template>

    <template v-else>
      <h1 class="pj-title pj-title-xl">{{ assemblyName }}</h1>
      <div class="pj-progress"><p><strong>{{ state?.participantCount ?? 0 }}</strong><span>en la sala</span></p></div>
    </template>
  </section>
</template>

<style scoped>
.pj {
  --u: min(100vw / 1920, 100vh / 1080);
  --ink: var(--blue-dark);
  --soft: #e6ecf8;
  display: flex;
  height: 100vh;
  flex-direction: column;
  overflow: hidden;
  padding: calc(var(--u) * 72) calc(var(--u) * 120);
  color: var(--ink);
  text-align: left;
}
.pj :where(h1, h2, p, ol, ul) { margin: 0; }
.pj-card { border-radius: calc(var(--u) * 22); background: #fff; }
.pj-title { color: var(--ink); font-size: calc(var(--u) * 96); text-wrap: balance; font-weight: 800; letter-spacing: -.02em; line-height: 1.08; }
.pj-title-lobby { font-size: calc(var(--u) * 96); }
.pj-title-xl { font-size: calc(var(--u) * 168); }
.pj-subtitle { margin-top: calc(var(--u) * 8); color: var(--muted); font-size: calc(var(--u) * 38); font-weight: 500; }
.pj-status { display: flex; align-items: center; gap: calc(var(--u) * 14); margin-bottom: calc(var(--u) * 12); color: var(--blue); font-size: calc(var(--u) * 26); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.pj-status-live { color: #1f7a4d; }
.pj-status-live::before { content: ''; width: calc(var(--u) * 20); height: calc(var(--u) * 20); border-radius: 50%; background: currentColor; }
.pj-status-annulled { color: #b42318; }
.pj-offline { position: fixed; z-index: 4; top: calc(var(--u) * 24); left: 50%; padding: calc(var(--u) * 10) calc(var(--u) * 24); transform: translateX(-50%); border-radius: 999px; background: #fff2f0; color: #b42318; font-size: calc(var(--u) * 26); font-weight: 700; }

.pj-lobby { display: grid; min-height: 0; flex: 1; grid-template-columns: calc(var(--u) * 510) minmax(0, 1fr); gap: calc(var(--u) * 48); margin-top: calc(var(--u) * 64); }
.pj-join { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 24); padding: calc(var(--u) * 40); }
.pj-qr { width: calc(var(--u) * 400); max-width: 100%; height: auto; }
.pj-host { color: var(--blue); font-size: calc(var(--u) * 56); font-weight: 800; overflow-wrap: anywhere; text-align: center; }
.pj-room { min-width: 0; padding: calc(var(--u) * 48) calc(var(--u) * 56); }
.pj-room-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--u) * 24); margin-bottom: calc(var(--u) * 28); }
.pj-room-head h2 { font-size: calc(var(--u) * 42); font-weight: 800; }
.pj-room-head strong { color: var(--blue); font-size: calc(var(--u) * 120); font-weight: 800; line-height: .9; }
.pj-names { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: calc(var(--u) * 56); gap: calc(var(--u) * 14) calc(var(--u) * 16); padding: 0; list-style: none; }
.pj-names li { overflow: hidden; padding: calc(var(--u) * 10) calc(var(--u) * 20); border-radius: calc(var(--u) * 8); background: #f4f6fa; color: #243451; font-size: calc(var(--u) * 30); line-height: calc(var(--u) * 36); text-overflow: ellipsis; white-space: nowrap; }
.pj-names .pj-more { color: var(--blue); font-weight: 800; }

.pj-progress { margin-top: auto; }
.pj-progress p { display: flex; align-items: baseline; gap: calc(var(--u) * 36); }
.pj-progress strong { color: var(--blue); font-size: calc(var(--u) * 300); font-weight: 900; letter-spacing: -.04em; line-height: .85; }
.pj-progress span { color: var(--muted); font-size: calc(var(--u) * 64); font-weight: 600; }
.pj-track { height: calc(var(--u) * 40); margin-top: calc(var(--u) * 64); overflow: hidden; border-radius: 999px; background: var(--soft); }
.pj-track span { display: block; height: 100%; border-radius: inherit; background: var(--blue); transition: width .3s ease; }

.pj-results-head { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(var(--u) * 40); }
.pj-results-head > div { min-width: 0; }
.pj-turnout { display: grid; flex: none; grid-template-columns: auto auto; align-items: baseline; column-gap: calc(var(--u) * 14); padding: calc(var(--u) * 22) calc(var(--u) * 40); }
.pj-turnout strong { font-size: calc(var(--u) * 76); font-weight: 800; line-height: 1; }
.pj-turnout span { color: var(--muted); font-size: calc(var(--u) * 40); font-weight: 600; }
.pj-turnout small { grid-column: 1 / -1; justify-self: end; color: var(--muted); font-size: calc(var(--u) * 28); }
.pj-elected { margin-top: calc(var(--u) * 28); padding: calc(var(--u) * 28) calc(var(--u) * 48); border-radius: calc(var(--u) * 22); background: var(--blue-dark); color: #fff; }
.pj-elected p { color: var(--cream); font-size: calc(var(--u) * 24); font-weight: 800; letter-spacing: .1em; text-transform: uppercase; }
.pj-elected h2 { color: #fff; font-size: calc(var(--u) * 76); font-weight: 800; line-height: 1.15; }
.pj-results {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), min-content);
  grid-auto-flow: column;
  align-content: start;
  overflow: hidden;
  gap: calc(var(--u) * 18 * var(--k)) calc(var(--u) * 32);
  margin-top: calc(var(--u) * 28);
  padding: 0;
  list-style: none;
}
.pj-results li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto calc(var(--u) * 130 * var(--k)); align-items: center; column-gap: calc(var(--u) * 30 * var(--k)); row-gap: calc(var(--u) * 16 * var(--k)); padding: calc(var(--u) * 26 * var(--k)) calc(var(--u) * 40); }
.pj-rank { display: grid; width: calc(var(--u) * 76 * var(--k)); height: calc(var(--u) * 76 * var(--k)); place-items: center; border-radius: 50%; background: var(--soft); color: var(--ink); font-size: calc(var(--u) * 32 * var(--k)); font-weight: 800; }
.pj-first .pj-rank { background: var(--blue); color: #fff; }
.pj-name { display: flex; min-width: 0; align-items: center; gap: calc(var(--u) * 20 * var(--k)); overflow: hidden; font-size: calc(var(--u) * 48 * var(--k)); font-weight: 600; white-space: nowrap; }
.pj-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pj-name em { flex: none; padding: calc(var(--u) * 6 * var(--k)) calc(var(--u) * 18 * var(--k)); border-radius: 999px; font-size: calc(var(--u) * 26 * var(--k)); font-style: normal; font-weight: 700; }
.pj-tie { background: #f3d9a4; color: #8a5a14; }
.pj-elected-tag { background: var(--blue-dark); color: var(--cream); letter-spacing: .06em; text-transform: uppercase; }
.pj-votes { color: var(--blue); font-size: calc(var(--u) * 48 * var(--k)); font-weight: 800; white-space: nowrap; }
.pj-percent { color: var(--muted); font-size: calc(var(--u) * 40 * var(--k)); font-weight: 600; text-align: right; white-space: nowrap; }
.pj-bar { grid-column: 1 / -1; height: calc(var(--u) * 16 * var(--k)); overflow: hidden; border-radius: 999px; background: var(--soft); }
.pj-bar span { display: block; height: 100%; border-radius: inherit; background: var(--blue); }

.pj-fullscreen { position: fixed; z-index: 5; right: .75rem; bottom: .75rem; min-height: 38px; padding: .45rem .7rem; font-size: .82rem; opacity: .35; transition: opacity .2s ease; }
.pj-fullscreen:hover, .pj-fullscreen:focus-visible { opacity: 1; }
:global(.projector-page:fullscreen) .pj-fullscreen { display: none; }
:global(.projector-page > .sync) { display: none; }
</style>
