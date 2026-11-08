<script setup lang="ts">
import { es } from '../locale/es'
import { computed, ref, watch } from 'vue'
import { connectedText, electedSoFar, voteLabel } from '../resultados'
import { resultSlide } from '../diapositivas'
import { useAssembly } from '../useAssembly'
import Diapositiva from './Diapositiva.vue'
import ProjectorLobby from './ProjectorLobby.vue'
import ProjectorResults from './ProjectorResults.vue'
import ResultSummary from './ResultSummary.vue'

const {
  error, state, code, realtimeActive, realtimeConnected, projectorFullscreen, assemblyStatus, lobbyStatus, round, connectionCount, completionTime, go,
} = useAssembly()

const eligible = computed(() => state.value?.eligibleCount ?? state.value?.participantCount ?? 0)
const recorded = computed(() => state.value?.recordedCount ?? 0)
const progressPercent = computed(() => eligible.value > 0 ? Math.min(100, Math.round((recorded.value / eligible.value) * 100)) : 0)

// «Presentar oficiales» (P1, P4, P5): the mesa drives it and it covers every other screen while on.
const presentationSlide = computed(() => state.value?.presentation?.active ? state.value.presentation.slide : null)
// A settled published result is shown as its slide (P2, P3, P6); the detailed count stays one click away.
const publishedSlide = computed(() => resultSlide(state.value))
const soFar = computed(() => electedSoFar(round.value, state.value?.officialResult?.elected, state.value?.final))
const showCount = ref(false)
watch(() => round.value?.id, () => { showCount.value = false })

const view = computed(() => {
  if (presentationSlide.value !== null) return 'presentation'
  if (lobbyStatus.value === 'lobby_open') return 'lobby'
  if (round.value?.status === 'published') return publishedSlide.value && !showCount.value ? 'slide' : 'results'
  if (assemblyStatus.value === 'completed') return 'completed'
  if (round.value?.status === 'annulled') return 'annulled'
  if (round.value?.status === 'open' || round.value?.status === 'closed') return 'voting'
  if (lobbyStatus.value === 'lobby_open') return 'lobby'
  return 'idle'
})

const roundLabel = computed(() => [voteLabel(round.value), round.value?.regionalSecretaryVotes ? es.results.regionalSecretaryNote : ''].filter(Boolean).join(' · '))
const statusLabel = computed(() => ({
  voting: round.value?.status === 'closed' ? es.results.preparing : [es.projector.voteOpenStatus, roundLabel.value].filter(Boolean).join(' · '),
  results: [assemblyStatus.value === 'completed' ? es.common.assemblyEnded : es.projector.countPublished, roundLabel.value].filter(Boolean).join(' · '),
  annulled: es.common.voteAnnulled,
  completed: es.common.assemblyEnded,
  lobby: '',
  idle: '',
  slide: '',
  presentation: '',
}[view.value]))

const assemblyName = computed(() => state.value?.assembly?.name || es.projector.defaultAssemblyName)

async function toggleProjectorFullscreen() {
  try {
    if (document.fullscreenElement) await document.exitFullscreen()
    else await document.querySelector('.projector-page')?.requestFullscreen()
    projectorFullscreen.value = Boolean(document.fullscreenElement)
  } catch {
    error.value = es.projector.fullscreenFailed
  }
}
</script>

<template>
  <button v-if="code" class="pj-fullscreen secondary" @click="toggleProjectorFullscreen">{{ projectorFullscreen ? es.projector.exitFullscreen : es.projector.fullscreen }}</button>
  <button v-if="code && publishedSlide && (view === 'slide' || view === 'results')" class="pj-count-toggle secondary" @click="showCount = !showCount">{{ showCount ? es.projector.showResult : es.projector.showCount }}</button>
  <section v-if="!code" class="card join-card"><h1>{{ es.projector.title }}</h1><form @submit.prevent="go(`/projector?code=${encodeURIComponent(code)}`)"><label>{{ es.common.roomCode }}<input v-model="code" required /></label><button class="primary">{{ es.projector.showRoom }}</button></form></section>
  <section v-else-if="view === 'slide' || view === 'presentation'" class="pj-stage">
    <p v-if="realtimeActive && !realtimeConnected" class="pj-offline" role="status" aria-live="polite">{{ es.projector.reconnecting }}</p>
    <ResultSummary v-if="view === 'slide'" class="pj-result-summary" :final="state?.final" :continuing="state?.continuing" :so-far="soFar" show-option />
    <Diapositiva v-if="view === 'slide'" :result="publishedSlide" />
    <Diapositiva v-else :presentation="presentationSlide ?? 0" />
  </section>
  <section v-else class="pj">
    <p v-if="realtimeActive && !realtimeConnected" class="pj-offline" role="status" aria-live="polite">{{ es.projector.reconnecting }}</p>

    <ProjectorLobby v-if="view === 'lobby'" :assembly-name="assemblyName" />

    <template v-else-if="view === 'voting'">
      <p class="pj-status" :class="{ 'pj-status-live': round?.status === 'open' }">{{ statusLabel }}</p>
      <h1 class="pj-title pj-title-xl">{{ round?.title }}</h1>
      <div class="pj-progress" aria-live="polite">
        <p><strong>{{ recorded }}</strong><span>{{ es.projector.alreadyVoted(eligible) }}</span></p>
        <div class="pj-track" role="progressbar" :aria-valuenow="recorded" :aria-valuemin="0" :aria-valuemax="eligible" :aria-label="es.projector.alreadyVotedLabel"><span :style="{ width: `${progressPercent}%` }"></span></div>
        <p v-if="connectionCount" class="pj-connected">{{ connectedText(connectionCount.connected, connectionCount.base) }}</p>
      </div>
    </template>

    <template v-else-if="view === 'results'">
      <ResultSummary class="pj-result-summary" :final="state?.final" :continuing="state?.continuing" :so-far="soFar" show-option />
      <ProjectorResults :status-label="statusLabel" :eligible="eligible" :recorded="recorded" />
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
      <div class="pj-progress"><p><strong>{{ state?.participantCount ?? 0 }}</strong><span>{{ es.projector.inRoom }}</span></p></div>
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
.pj-stage { --u: min(100vw / 1920, 100vh / 1080); display: grid; height: 100vh; place-items: center; overflow: hidden; background: #fff; }
.pj-card { border-radius: calc(var(--u) * 22); background: #fff; }
.pj-title { color: var(--ink); font-size: calc(var(--u) * 96); text-wrap: balance; font-weight: 800; letter-spacing: -.02em; line-height: 1.08; }
.pj-title-xl { font-size: calc(var(--u) * 168); }
.pj-subtitle { margin-top: calc(var(--u) * 8); color: var(--muted); font-size: calc(var(--u) * 38); font-weight: 500; }
.pj-status { display: flex; align-items: center; gap: calc(var(--u) * 14); margin-bottom: calc(var(--u) * 12); color: var(--blue); font-size: calc(var(--u) * 26); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.pj-status-live { color: #1f7a4d; }
.pj-status-live::before { content: ''; width: calc(var(--u) * 20); height: calc(var(--u) * 20); border-radius: 50%; background: currentColor; }
.pj-status-annulled { color: #b42318; }
.pj-offline { position: fixed; z-index: 4; top: calc(var(--u) * 24); left: 50%; padding: calc(var(--u) * 10) calc(var(--u) * 24); transform: translateX(-50%); border-radius: 999px; background: #fff2f0; color: #b42318; font-size: calc(var(--u) * 26); font-weight: 700; }

.pj-progress { margin-top: auto; }
.pj-progress p { display: flex; align-items: baseline; gap: calc(var(--u) * 36); }
.pj-progress strong { color: var(--blue); font-size: calc(var(--u) * 300); font-weight: 900; letter-spacing: -.04em; line-height: .85; }
.pj-progress span { color: var(--muted); font-size: calc(var(--u) * 64); font-weight: 600; }
.pj-progress .pj-connected { display: block; margin-top: calc(var(--u) * 28); color: var(--muted); font-size: calc(var(--u) * 52); font-weight: 600; }
.pj-track { height: calc(var(--u) * 40); margin-top: calc(var(--u) * 64); overflow: hidden; border-radius: 999px; background: var(--soft); }
.pj-track span { display: block; height: 100%; border-radius: inherit; background: var(--blue); transition: width .3s ease; }

.pj-fullscreen { position: fixed; z-index: 5; right: .75rem; bottom: .75rem; min-height: 38px; padding: .45rem .7rem; font-size: .82rem; opacity: .35; transition: opacity .2s ease; }
.pj-fullscreen:hover, .pj-fullscreen:focus-visible { opacity: 1; }
.pj-count-toggle { position: fixed; z-index: 5; right: calc(.75rem + 12.5rem); bottom: .75rem; min-height: 38px; padding: .45rem .7rem; font-size: .82rem; opacity: .35; transition: opacity .2s ease; }
.pj-count-toggle:hover, .pj-count-toggle:focus-visible { opacity: 1; }
:global(.projector-page:fullscreen) .pj-fullscreen { display: none; }
:global(.projector-page:fullscreen) .pj-count-toggle { right: .75rem; opacity: 0; }
:global(.projector-page:fullscreen) .pj-count-toggle:hover, :global(.projector-page:fullscreen) .pj-count-toggle:focus-visible { opacity: 1; }
:global(.projector-page > .sync) { display: none; }
</style>
