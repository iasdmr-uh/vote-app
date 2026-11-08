<script setup lang="ts">
import { es } from '../locale/es'
import { countsOf, electedSoFar, majorityText, marksPerBallot, notVotedText, resultRows, verdictOf, voteLabel } from '../resultados'
import type { PublicState, RoundRecord } from '../types'
import ResultExplanation from './ResultExplanation.vue'
import ResultsList from './ResultsList.vue'
import ResultSummary from './ResultSummary.vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'
import { computed } from 'vue'

const props = defineProps<{
  round: NonNullable<PublicState['currentRound']>
  currentRoundRecord: RoundRecord
}>()

const { loading, state } = useAssembly()
const { showNextBallotForm, rootRoundOf, eligibleOf, runoffOf, openRunoff, registerOfficial } = useMesa()

const election = computed(() => rootRoundOf(props.currentRoundRecord)?.officialResult ?? null)
const final = computed(() => props.currentRoundRecord.final && election.value ? { elected: election.value.elected, approved: election.value.approved ?? null } : null)
const soFar = computed(() => electedSoFar(rootRoundOf(props.currentRoundRecord), election.value?.elected, props.currentRoundRecord.final))

function runoffButtonText(target: RoundRecord) {
  const runoff = runoffOf(target)
  if (!runoff) return ''
  const seats = runoff.electionSeats ?? 1
  return runoff.category === 'committee' ? es.moderator.openRunoffSeats(seats) : es.moderator.openRunoff
}
</script>

<template>
  <div class="ballot-heading">
    <div><div class="eyebrow-row"><p class="eyebrow">{{ es.moderator.publishedEyebrow }}</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2><p v-if="currentRoundRecord && majorityText(currentRoundRecord, currentRoundRecord.outcome)" class="majority-chip">{{ majorityText(currentRoundRecord, currentRoundRecord.outcome) }}</p></div>
    <p class="voters-total"><strong>{{ es.common.votersTotal(currentRoundRecord.participationCount ?? state?.recordedCount ?? 0, eligibleOf(currentRoundRecord)) }}</strong><span>{{ es.common.votedLabel }}<template v-if="eligibleOf(currentRoundRecord)"> · {{ notVotedText(currentRoundRecord.participationCount ?? state?.recordedCount ?? 0, eligibleOf(currentRoundRecord)) }}</template></span></p>
  </div>
  <p v-if="verdictOf(currentRoundRecord)" :class="['decision-verdict', { rejected: verdictOf(currentRoundRecord) === es.results.notApproved }]">{{ verdictOf(currentRoundRecord) }}</p>
  <ResultSummary :final="final" :continuing="currentRoundRecord.continuing" :so-far="soFar" />
  <p v-if="final && election?.registeredAt" class="status-line">{{ es.results.registered }}</p>
  <div v-else-if="final" class="action-row"><button class="primary" :disabled="loading" @click="registerOfficial(currentRoundRecord)">{{ es.results.register }}</button></div>
  <ResultsList :rows="resultRows(countsOf(currentRoundRecord), eligibleOf(currentRoundRecord))" :recorded="currentRoundRecord.participationCount ?? state?.recordedCount ?? 0" :base="eligibleOf(currentRoundRecord)" :marks="marksPerBallot(currentRoundRecord)" :outcome="currentRoundRecord.outcome" :target="currentRoundRecord" />
  <ResultExplanation :target="currentRoundRecord" />
  <div class="action-row ballot-actions">
    <button class="link-button" @click="showNextBallotForm = true">{{ es.moderator.prepareAnother }}</button>
    <button v-if="runoffOf(currentRoundRecord)" class="primary push-right" :disabled="loading" @click="openRunoff(currentRoundRecord)">{{ runoffButtonText(currentRoundRecord) }}</button>
  </div>
</template>

<style scoped>
.majority-chip { display: inline-block; margin: .35rem 0 0; padding: .2rem .6rem; border-radius: 999px; background: #e8efff; color: var(--blue-dark); font-size: .75rem; font-weight: 700; }
.decision-verdict { margin: .75rem 0 0; padding: .7rem 1rem; border-radius: 10px; background: var(--blue-dark); color: #fff; font-size: 1.25rem; font-weight: 800; }
.decision-verdict.rejected { background: #fff2f0; color: #b42318; }
</style>
