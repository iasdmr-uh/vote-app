<script setup lang="ts">
import { computed } from 'vue'
import { useAssembly } from '../useAssembly'
import PhoneBallot from './PhoneBallot.vue'
import PhoneJoinForm from './PhoneJoinForm.vue'
import PhoneVoteReview from './PhoneVoteReview.vue'

const {
  loading, error, notice, state, code, sessionToken, pendingJoinCode, selectedOptions,
  reviewingVote, voteSubmitting, assemblyStatus, round, ballotMaxChoices, request, handleParticipantUnauthorized,
  clearParticipantSession, refresh,
} = useAssembly()

const reviewedOptions = computed(() => round.value?.options?.filter((option) => selectedOptions.value.includes(option.id)) || [])
// Committees and runoffs take exactly the open seats; any other ballot takes one choice.
const seatsToFill = computed(() => round.value?.format === 'multiple_choice' ? ballotMaxChoices.value : null)
const selectionComplete = computed(() => seatsToFill.value ? selectedOptions.value.length === seatsToFill.value : selectedOptions.value.length > 0)
const voteRecorded = computed(() => state.value?.participationStatus === 'recorded')
const ballotShown = computed(() => assemblyStatus.value !== 'completed' && round.value?.status === 'open' && Boolean(round.value.options?.length) && !voteRecorded.value)
// The mesa inhabilitó this delegate: during an open vote they see the state, never the ballot.
const votingDisabled = computed(() => Boolean(state.value?.votingDisabled) && assemblyStatus.value !== 'completed' && round.value?.status === 'open' && !voteRecorded.value)

function switchToIncomingAssembly() {
  const incoming = pendingJoinCode.value
  if (!incoming) return
  clearParticipantSession()
  pendingJoinCode.value = ''
  error.value = ''
  notice.value = ''
  code.value = incoming
}

function reviewVote() {
  if (!round.value || !selectionComplete.value || !reviewedOptions.value.length || loading.value || voteSubmitting.value) return
  error.value = ''
  notice.value = ''
  reviewingVote.value = true
}

async function submitVote() {
  if (!round.value || !selectionComplete.value || !reviewedOptions.value.length || !reviewingVote.value || loading.value || voteSubmitting.value) return
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
</script>

<template>
  <PhoneJoinForm v-if="!sessionToken" />
  <section v-else class="card participant-card phone-screen" :data-round-status="round?.status">
    <div v-if="pendingJoinCode" class="notice error" role="alert">
      Este QR corresponde a otra Asamblea.
      <button class="secondary" @click="switchToIncomingAssembly">Cerrar sesión y cambiar a la Asamblea del QR</button>
    </div>
    <PhoneVoteReview v-if="ballotShown && round && reviewingVote" :round="round" :reviewed-options="reviewedOptions" @confirm="submitVote" />
    <template v-else-if="votingDisabled && round">
      <p class="phone-status phone-status-disabled"><span class="status-dot" aria-hidden="true"></span>{{ round.title }} · VOTACIÓN ABIERTA</p>
      <h1>Voto inhabilitado</h1>
    </template>
    <PhoneBallot v-else-if="ballotShown && round" :round="round" :seats-to-fill="seatsToFill" :selection-complete="selectionComplete" @review="reviewVote" />
    <template v-else>
      <p v-if="voteRecorded && assemblyStatus !== 'completed'" class="phone-recorded" role="status"><span aria-hidden="true">✓</span>Tu voto quedó registrado</p>
      <h1 v-if="assemblyStatus === 'completed'">Asamblea finalizada</h1>
      <h1 v-else-if="round?.status === 'annulled'">Votación anulada</h1>
      <h1 v-else-if="!voteRecorded">Sala de espera</h1>
      <p v-if="assemblyStatus !== 'completed'" class="phone-waiting phone-action" role="status"><span class="status-dot" aria-hidden="true"></span>{{ round?.status === 'open' ? 'Votación en curso' : 'Espera la siguiente papeleta' }}</p>
    </template>
  </section>
</template>
