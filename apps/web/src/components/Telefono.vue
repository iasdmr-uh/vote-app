<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { rankOf, resultPercent } from '../resultados'
import { ApiRequestError, useAssembly } from '../useAssembly'

const {
  loading, error, notice, state, code, firstName, lastName, sessionToken, sessionAssemblyId, pendingJoinCode, selectedOptions,
  reviewingVote, voteSubmitting, assemblyStatus, round, ballotMaxChoices, request, handleParticipantUnauthorized,
  clearParticipantSession, normalizeState, refresh,
} = useAssembly()

const reviewHeading = ref<HTMLElement | null>(null)
const leaving = ref(false)
const reviewedOptions = computed(() => round.value?.options?.filter((option) => selectedOptions.value.includes(option.id)) || [])
const voteRecorded = computed(() => state.value?.participationStatus === 'recorded')
const ballotShown = computed(() => assemblyStatus.value !== 'completed' && round.value?.status === 'open' && Boolean(round.value.options?.length) && !voteRecorded.value)
const resultBase = computed(() => state.value?.eligibleCount ?? 0)
const resultVoters = computed(() => state.value?.recordedCount ?? round.value?.participationCount ?? 0)
const resultRows = computed(() => {
  const results = state.value?.results || []
  return results.map((result, index) => ({
    label: result.label,
    count: result.count,
    rank: Number.parseInt(rankOf(results, index), 10) || index + 1,
    tied: results.some((other, otherIndex) => otherIndex !== index && other.count === result.count),
    percent: resultPercent(results, result.count, resultBase.value || null),
  }))
})

watch(reviewingVote, (reviewing) => {
  if (reviewing) void nextTick(() => reviewHeading.value?.focus())
})

async function join() {
  error.value = ''
  loading.value = true
  try {
    const joined = await request<Record<string, any>>(`/assemblies/${encodeURIComponent(code.value)}/join`, {
      method: 'POST', body: JSON.stringify({ firstName: firstName.value.trim(), lastName: lastName.value.trim() }),
    })
    sessionToken.value = joined.participantSessionToken
    sessionAssemblyId.value = String(joined.assembly?.id || '')
    localStorage.setItem('participantSessionToken', joined.participantSessionToken)
    if (sessionAssemblyId.value) localStorage.setItem('participantAssemblyId', sessionAssemblyId.value)
    pendingJoinCode.value = ''
    state.value = normalizeState(joined)
    notice.value = ''
    await refresh()
  } catch (e) {
    if (!handleParticipantUnauthorized(e, sessionToken.value)) {
      error.value = e instanceof ApiRequestError && e.status === 404
        ? 'El código no corresponde a una sala abierta.'
        : (e as Error).message
    }
  }
  finally { loading.value = false }
}

async function leaveRoom() {
  const token = sessionToken.value
  leaving.value = true
  try {
    if (token) await request('/participant/leave', { method: 'POST' }, token)
  } catch {
  } finally { leaving.value = false }
  clearParticipantSession()
  pendingJoinCode.value = ''
  error.value = ''
  notice.value = ''
}

async function leaveParticipantSession() {
  if (leaving.value) return
  await leaveRoom()
}

async function switchToIncomingAssembly() {
  const incoming = pendingJoinCode.value
  if (!incoming || leaving.value) return
  await leaveRoom()
  code.value = incoming
}

function reviewVote() {
  if (!round.value || !selectedOptions.value.length || !reviewedOptions.value.length || loading.value || voteSubmitting.value) return
  error.value = ''
  notice.value = ''
  reviewingVote.value = true
}

async function submitVote() {
  if (!round.value || !selectedOptions.value.length || !reviewedOptions.value.length || !reviewingVote.value || loading.value || voteSubmitting.value) return
  error.value = ''
  notice.value = ''
  voteSubmitting.value = true
  loading.value = true
  let accepted = false
  try {
    await request(`/participant/rounds/${encodeURIComponent(round.value.id)}/vote`, {
      method: 'POST', body: JSON.stringify(round.value.format === 'multiple_choice'
        ? { optionIds: selectedOptions.value, confirmation: true }
        : { optionId: selectedOptions.value[0], confirmation: true }),
    }, sessionToken.value)
    selectedOptions.value = []
    reviewingVote.value = false
    accepted = true
  } catch (e) {
    if (!handleParticipantUnauthorized(e, sessionToken.value)) error.value = (e as Error).message
  }
  finally { loading.value = false; voteSubmitting.value = false }
  if (accepted) await refresh()
}

function toggleBallotOption(optionId: string, input: HTMLInputElement) {
  const checked = input.checked
  if (round.value?.format !== 'multiple_choice') {
    selectedOptions.value = checked ? [optionId] : []
    return
  }
  if (checked) {
    const maxChoices = ballotMaxChoices.value
    if (maxChoices && selectedOptions.value.length >= maxChoices) {
      error.value = `Máximo ${maxChoices} ${maxChoices === 1 ? 'candidato' : 'candidatos'}.`
      input.checked = false
      return
    }
    selectedOptions.value = [...selectedOptions.value, optionId]
  } else selectedOptions.value = selectedOptions.value.filter((id) => id !== optionId)
  error.value = ''
}
</script>

<template>
  <section v-if="!sessionToken" class="card join-card phone-screen">
    <h1>Bienvenido</h1>
    <form class="phone-form" @submit.prevent="join">
      <label>Código de sala<input v-model="code" autocomplete="off" required /></label>
      <label>Nombre<input v-model="firstName" autocomplete="given-name" required maxlength="80" placeholder="Tu nombre" /></label>
      <label>Apellido<input v-model="lastName" autocomplete="family-name" required maxlength="100" placeholder="Tu apellido" /></label>
      <button class="primary phone-action" :disabled="loading">{{ loading ? 'Entrando…' : 'Entrar a la sala' }}</button>
    </form>
  </section>
  <section v-else class="card participant-card phone-screen">
    <button class="link-button participant-leave" :disabled="leaving" @click="leaveParticipantSession">Salir</button>
    <div v-if="pendingJoinCode" class="notice error" role="alert">
      Este QR corresponde a otra Asamblea.
      <button class="secondary" :disabled="leaving" @click="switchToIncomingAssembly">Cerrar sesión y cambiar a la Asamblea del QR</button>
    </div>
    <template v-if="ballotShown && round && reviewingVote">
      <section class="vote-review" aria-labelledby="vote-review-title">
        <h2 id="vote-review-title" ref="reviewHeading" tabindex="-1">Confirma tu voto</h2>
        <dl class="review-details">
          <div><dt>{{ round.title }}</dt><dd>{{ reviewedOptions.map((option) => option.label).join(', ') }}</dd></div>
        </dl>
      </section>
      <div class="review-actions phone-action">
        <button class="secondary" :disabled="loading" @click="reviewingVote = false">Volver</button>
        <button class="primary" :disabled="loading || !reviewedOptions.length" @click="submitVote">{{ voteSubmitting ? 'Enviando…' : 'Confirmar voto' }}</button>
      </div>
    </template>
    <template v-else-if="ballotShown && round">
      <p class="phone-status phone-status-open"><span class="status-dot" aria-hidden="true"></span>VOTACIÓN ABIERTA</p>
      <h1>{{ round.title }}</h1>
      <fieldset class="options">
        <legend v-if="round.format === 'multiple_choice' && ballotMaxChoices">{{ selectedOptions.length }} de {{ ballotMaxChoices }}</legend>
        <label v-for="option in round.options" :key="option.id" class="option"><input :type="round.format === 'multiple_choice' ? 'checkbox' : 'radio'" name="option" :value="option.id" :checked="selectedOptions.includes(option.id)" @change="toggleBallotOption(option.id, $event.target as HTMLInputElement)" /><span>{{ option.label }}</span></label>
      </fieldset>
      <button class="primary phone-action" :disabled="loading || voteSubmitting || !selectedOptions.length" @click="reviewVote">Revisar mi voto</button>
    </template>
    <template v-else>
      <p v-if="voteRecorded && assemblyStatus !== 'completed'" class="phone-recorded" role="status"><span aria-hidden="true">✓</span>Tu voto quedó registrado</p>
      <h1 v-if="assemblyStatus === 'completed'">Asamblea finalizada</h1>
      <section v-if="resultRows.length || state?.officialResult" class="phone-results" aria-labelledby="phone-results-title">
        <div class="phone-results-heading">
          <div><p class="eyebrow">RESULTADOS</p><h2 id="phone-results-title">{{ round?.title }}</h2></div>
          <p v-if="resultBase" class="voters-total"><strong>{{ resultVoters }} de {{ resultBase }}</strong><span>votaron</span></p>
        </div>
        <div v-if="state?.officialResult" class="official-card"><p class="eyebrow">RESULTADO OFICIAL</p><strong>{{ state.officialResult.elected.map((person) => person.label).join(' · ') }}</strong><p v-if="state.officialResult.note">{{ state.officialResult.note }}</p></div>
        <ol v-if="resultRows.length" class="ranked-rows">
          <li v-for="row in resultRows" :key="row.label" :class="{ first: row.rank === 1 }">
            <span class="rank-number">{{ row.rank }}</span>
            <span class="ranked-label">{{ row.label }}<span v-if="row.tied" class="badge badge-warning">Empate</span></span>
            <strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong>
            <span class="ranked-percent">{{ row.percent }} %</span>
            <span class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span>
          </li>
        </ol>
      </section>
      <h1 v-else-if="round?.status === 'annulled' && assemblyStatus !== 'completed'">Votación anulada</h1>
      <h1 v-else-if="assemblyStatus !== 'completed' && !voteRecorded">Sala de espera</h1>
      <p v-if="assemblyStatus !== 'completed'" class="phone-waiting phone-action" role="status"><span class="status-dot" aria-hidden="true"></span>{{ round?.status === 'open' ? 'Votación en curso' : 'Espera la siguiente papeleta' }}</p>
    </template>
  </section>
</template>
