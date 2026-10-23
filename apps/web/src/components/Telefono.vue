<script setup lang="ts">
import { computed, nextTick, ref, watch } from 'vue'
import { rankOf } from '../resultados'
import { ApiRequestError, useAssembly } from '../useAssembly'

const {
  loading, error, notice, state, code, firstName, lastName, sessionToken, sessionAssemblyId, pendingJoinCode, selectedOptions,
  reviewingVote, voteSubmitting, assemblyStatus, round, completionTime, ballotMaxChoices, request, handleParticipantUnauthorized,
  clearParticipantSession, normalizeState, refresh,
} = useAssembly()

const reviewHeading = ref<HTMLElement | null>(null)
/** A delegate who voted already sees the published counts in the «Tu participación está registrada» block. */
const participantResultsShown = computed(() => state.value?.participationStatus === 'recorded' && round.value?.status === 'published' && Boolean(state.value?.results?.length))
const reviewedOptions = computed(() => round.value?.options?.filter((option) => selectedOptions.value.includes(option.id)) || [])

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
    notice.value = 'Te uniste a la sala. Tu teléfono queda en espera.'
    await refresh()
  } catch (e) {
    if (!handleParticipantUnauthorized(e, sessionToken.value)) {
      error.value = e instanceof ApiRequestError && e.status === 404
        ? 'El código no corresponde a una sala abierta. Revísalo con la mesa e inténtalo de nuevo.'
        : (e as Error).message
    }
  }
  finally { loading.value = false }
}

function leaveParticipantSession() {
  clearParticipantSession()
  pendingJoinCode.value = ''
  error.value = ''
  notice.value = 'Saliste de la sesión. Puedes ingresar otro delegado en este dispositivo.'
}

function switchToIncomingAssembly() {
  if (!pendingJoinCode.value) return
  code.value = pendingJoinCode.value
  clearParticipantSession()
  pendingJoinCode.value = ''
  error.value = ''
  notice.value = 'La sesión anterior se cerró en este dispositivo. Ingresa tus datos para unirte a la Asamblea del QR.'
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
    notice.value = 'Tu participación fue registrada. Gracias.'
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
      error.value = `Puedes marcar como máximo ${maxChoices} ${maxChoices === 1 ? 'candidato' : 'candidatos'}. Desmarca uno para cambiarlo.`
      // The selection did not change, so Vue will not re-render the box the browser already ticked.
      input.checked = false
      return
    }
    selectedOptions.value = [...selectedOptions.value, optionId]
  } else selectedOptions.value = selectedOptions.value.filter((id) => id !== optionId)
  error.value = ''
}
</script>

<template>
  <section v-if="!sessionToken" class="card join-card">
    <p class="eyebrow">ASAMBLEA DE DELEGADOS</p>
    <h1>Bienvenido</h1>
    <p class="lead">Ingresa con el código mostrado por la mesa y escribe tu nombre para unirte a la sala.</p>
    <form @submit.prevent="join">
      <label>Código de sala<input v-model="code" autocomplete="off" required placeholder="Código de la Asamblea" /></label>
      <div class="field-row">
        <label>Nombre<input v-model="firstName" autocomplete="given-name" required maxlength="80" /></label>
        <label>Apellido<input v-model="lastName" autocomplete="family-name" required maxlength="100" /></label>
      </div>
      <button class="primary" :disabled="loading">{{ loading ? 'Uniéndote…' : 'Unirme a la sala' }}</button>
    </form>
    <p class="privacy-note">El ingreso por nombre facilita el control en sala, pero no acredita identidad ni condición de delegado.</p>
  </section>
  <section v-else class="card participant-card">
    <div class="participant-session-actions"><button class="link-button" @click="leaveParticipantSession">Salir / cambiar de participante</button></div>
    <div v-if="pendingJoinCode" class="notice error" role="alert">
      Este QR corresponde a otra Asamblea. La sesión actual sigue abierta en este dispositivo.
      <button class="secondary" @click="switchToIncomingAssembly">Cerrar sesión y cambiar a la Asamblea del QR</button>
    </div>
    <p class="eyebrow">{{ state?.assembly?.name || 'ASAMBLEA' }}</p>
    <h1>{{ assemblyStatus === 'completed' ? 'Asamblea finalizada' : round?.status === 'open' ? round.title : 'Sala de espera' }}</h1>
    <div v-if="assemblyStatus === 'completed'" class="status-panel assembly-completed" role="status"><span class="status-dot"></span><div><strong>La sesión concluyó</strong><p>Esta Asamblea está en modo de consulta.<template v-if="completionTime"> Se finalizó {{ completionTime }}.</template></p></div></div>
    <template v-if="state?.participationStatus === 'recorded'">
      <div class="status-panel"><span class="status-dot"></span><div><strong>Tu participación está registrada</strong><p>La papeleta fue confirmada y no puede cambiarse. No se muestra aquí la opción seleccionada.</p></div></div>
      <section v-if="round?.status === 'published' && state?.results?.length" class="participant-results" aria-labelledby="participant-results-title">
        <p class="eyebrow">RESULTADOS PUBLICADOS</p><h2 id="participant-results-title">{{ round.title }}</h2>
        <ul class="participant-results-list"><li v-for="(result, index) in state.results" :key="result.label"><span>{{ rankOf(state.results, index) }} {{ result.label }}</span><strong>{{ result.count }} {{ result.count === 1 ? 'voto' : 'votos' }}</strong></li></ul>
        <p class="participant-results-total">Total: {{ state.results.reduce((total, result) => total + result.count, 0) }} {{ state.results.reduce((total, result) => total + result.count, 0) === 1 ? 'voto' : 'votos' }}</p>
      </section>
    </template>
    <section v-if="(state?.results?.length && !participantResultsShown) || state?.officialResult" class="participant-published-results"><template v-if="state.results?.length && !participantResultsShown"><p class="eyebrow">RESULTADOS PUBLICADOS</p><div class="results-list"><div v-for="(result, index) in state.results" :key="result.label"><span>{{ rankOf(state.results, index) }} {{ result.label }}</span><strong>{{ result.count }}</strong></div></div></template><div v-if="state.officialResult" class="projector-official-result"><p class="eyebrow">RESULTADO OFICIAL DE LA MESA</p><h2>{{ state.officialResult.elected.map((person) => person.label).join(' · ') }}</h2><p v-if="state.officialResult.note">{{ state.officialResult.note }}</p></div></section>
    <template v-else-if="round?.status === 'open' && round.options?.length && reviewingVote">
      <section class="vote-review" aria-labelledby="vote-review-title">
        <p class="eyebrow">REVISIÓN DEL VOTO</p>
        <h2 id="vote-review-title" ref="reviewHeading" tabindex="-1">Confirma tu selección</h2>
        <dl class="review-details">
          <div><dt>Papeleta</dt><dd>{{ round.title }}</dd></div>
          <div><dt>Selección</dt><dd>{{ reviewedOptions.map((option) => option.label).join(', ') || 'La selección ya no está disponible.' }}</dd></div>
        </dl>
        <p class="privacy-note">Después de confirmar, tu voto será definitivo y no podrás cambiarlo.</p>
        <div class="review-actions">
          <button class="secondary" :disabled="loading" @click="reviewingVote = false">Volver a la papeleta</button>
          <button class="primary" :disabled="loading || !reviewedOptions.length" @click="submitVote">{{ voteSubmitting ? 'Enviando voto…' : 'Confirmar voto' }}</button>
        </div>
      </section>
    </template>
    <template v-else-if="round?.status === 'open' && round.options?.length">
      <p class="lead">{{ round.format === 'multiple_choice' && ballotMaxChoices ? `Marca hasta ${ballotMaxChoices} ${ballotMaxChoices === 1 ? 'candidato' : 'candidatos'}. Puedes marcar menos, pero no más de ${ballotMaxChoices}.` : 'Selecciona una opción, revísala y confirma cuando estés listo.' }}</p>
      <fieldset class="options"><legend>{{ round.format === 'multiple_choice' && ballotMaxChoices ? `Candidatos · ${selectedOptions.length} de ${ballotMaxChoices} ${ballotMaxChoices === 1 ? 'marcado' : 'marcados'}` : 'Opciones de la papeleta' }}</legend>
        <label v-for="option in round.options" :key="option.id" class="option"><input :type="round.format === 'multiple_choice' ? 'checkbox' : 'radio'" name="option" :value="option.id" :checked="selectedOptions.includes(option.id)" @change="toggleBallotOption(option.id, $event.target as HTMLInputElement)" /><span>{{ option.label }}</span></label>
      </fieldset>
      <p v-if="round.format === 'multiple_choice' && ballotMaxChoices && ballotMaxChoices > 1" class="hint">Si ya marcaste {{ ballotMaxChoices }}, desmarca uno para cambiarlo.</p>
      <button class="primary ballot-submit" :disabled="loading || voteSubmitting || !selectedOptions.length" @click="reviewVote">Revisar y confirmar voto</button>
      <p class="ballot-warning">Tu voto es secreto. Una vez confirmado, no podrás cambiarlo.</p>
    </template>
    <div v-else-if="round?.status === 'annulled'" class="status-panel annulled-panel" role="status"><span class="status-dot"></span><div><strong>La mesa anuló esta votación</strong><p>Nada de lo registrado en esta papeleta se contará. Espera la siguiente indicación de la mesa.</p></div></div>
    <div v-else class="status-panel"><span class="status-dot"></span><div><strong>{{ round?.status === 'closed' ? 'La papeleta está cerrada' : 'Esperando la siguiente papeleta' }}</strong><p>La mesa anunciará cuando comience la votación.</p></div></div>
  </section></template>
