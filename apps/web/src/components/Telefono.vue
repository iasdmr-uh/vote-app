<script setup lang="ts">
import { es } from '../locale/es'
import { computed } from 'vue'
import { decisionVerdict, displayOrder, electedSoFar, isDecision, isTied, percentOf, voteLabel } from '../resultados'
import { useAssembly } from '../useAssembly'
import PhoneBallot from './PhoneBallot.vue'
import PhoneJoinForm from './PhoneJoinForm.vue'
import PhoneResults from './PhoneResults.vue'
import ResultSummary from './ResultSummary.vue'
import PhoneVoteReview from './PhoneVoteReview.vue'

const {
  loading, error, notice, state, code, sessionToken, pendingJoinCode, selectedOptions,
  reviewingVote, voteSubmitting, assemblyStatus, round, ballotMaxChoices, request, handleParticipantUnauthorized,
  clearParticipantSession, refresh, realtimeActive, phoneOnline,
} = useAssembly()

const reviewedOptions = computed(() => round.value?.options?.filter((option) => selectedOptions.value.includes(option.id)) || [])
// Committees and runoffs take exactly the open seats; any other ballot takes one choice.
const seatsToFill = computed(() => round.value?.format === 'multiple_choice' ? ballotMaxChoices.value : null)
const selectionComplete = computed(() => seatsToFill.value ? selectedOptions.value.length === seatsToFill.value : selectedOptions.value.length > 0)
const voteRecorded = computed(() => state.value?.participationStatus === 'recorded')
const ballotShown = computed(() => assemblyStatus.value !== 'completed' && round.value?.status === 'open' && Boolean(round.value.options?.length) && !voteRecorded.value)
// The mesa inhabilitó this delegate: during an open vote they see the state, never the ballot.
const votingDisabled = computed(() => Boolean(state.value?.votingDisabled) && assemblyStatus.value !== 'completed' && round.value?.status === 'open' && !voteRecorded.value)
const showConnected = computed(() => realtimeActive.value && phoneOnline.value && assemblyStatus.value !== 'completed' && round.value?.status === 'open')
const resultBase = computed(() => state.value?.eligibleCount ?? 0)
const resultVoters = computed(() => state.value?.recordedCount ?? round.value?.participationCount ?? 0)
const resultRows = computed(() => {
  const results = displayOrder(round.value, state.value?.results || [])
  const outcome = state.value?.outcome
  return results.map((result, index) => ({
    key: result.optionId || result.label,
    label: result.label,
    count: result.count,
    rank: index + 1,
    // A decision's result is its verdict, so a tie needs no badge.
    tied: !outcome && !isDecision(round.value) && isTied(results, index),
    percent: percentOf(result.count, resultBase.value),
  }))
})
const officialResult = computed(() => state.value?.final ? state.value.officialResult : undefined)
const verdict = computed(() => round.value ? decisionVerdict(round.value, state.value?.outcome, state.value?.results) : '')

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
  <section v-else class="card participant-card phone-screen">
    <p v-if="showConnected" class="phone-connected" role="status"><span class="status-dot" aria-hidden="true"></span>{{ es.phone.connected }}</p>
    <div v-if="pendingJoinCode" class="notice error" role="alert">
      {{ es.phone.otherAssemblyQr }}
      <button class="secondary" @click="switchToIncomingAssembly">{{ es.phone.switchAssembly }}</button>
    </div>
    <PhoneVoteReview v-if="ballotShown && round && reviewingVote" :round="round" :reviewed-options="reviewedOptions" @confirm="submitVote" />
    <template v-else-if="votingDisabled && round">
      <p class="phone-status phone-status-disabled"><span class="status-dot" aria-hidden="true"></span>{{ round.title }} · {{ round.runoff ? voteLabel(round) : es.common.voteOpen }}</p>
      <h1>{{ es.phone.voteDisabled }}</h1>
    </template>
    <PhoneBallot v-else-if="ballotShown && round" :round="round" :seats-to-fill="seatsToFill" :selection-complete="selectionComplete" @review="reviewVote" />
    <template v-else>
      <p v-if="voteRecorded && assemblyStatus !== 'completed'" class="phone-recorded" role="status"><span aria-hidden="true">✓</span>{{ es.phone.voteRecorded }}</p>
      <h1 v-if="assemblyStatus === 'completed'">{{ es.common.assemblyEnded }}</h1>
      <ResultSummary v-if="round?.status === 'published'" :final="state?.final" :continuing="state?.continuing" :so-far="electedSoFar(round, state?.officialResult?.elected, state?.final)" />
      <PhoneResults v-if="resultRows.length || officialResult || verdict" :round="round" :rows="resultRows" :verdict="verdict" :base="resultBase" :voters="resultVoters" :official-result="officialResult" :outcome="state?.outcome" />
      <h1 v-else-if="round?.status === 'annulled' && assemblyStatus !== 'completed'">{{ es.common.voteAnnulled }}</h1>
      <h1 v-else-if="round?.status === 'closed' && assemblyStatus !== 'completed'">{{ es.results.preparing }}</h1>
      <h1 v-else-if="assemblyStatus !== 'completed' && !voteRecorded">{{ es.phone.waitingRoom }}</h1>
      <p v-if="assemblyStatus !== 'completed'" class="phone-waiting phone-action" role="status"><span class="status-dot" aria-hidden="true"></span>{{ round?.status === 'open' ? es.phone.voteInProgress : es.phone.waitForNextBallot }}</p>
    </template>
  </section>
</template>
