<script setup lang="ts">
import { countsOf, majorityText, notVotedText, verdictOf, voteLabel } from '../resultados'
import type { PublicState, RoundRecord } from '../types'
import ResultsList from './ResultsList.vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

defineProps<{
  round: NonNullable<PublicState['currentRound']>
  currentRoundRecord: RoundRecord
}>()

const { loading, state } = useAssembly()
const { showNextBallotForm, rootRoundOf, eligibleOf, rankedRows, runoffOf, openRunoff } = useMesa()

function runoffButtonText(target: RoundRecord) {
  const runoff = runoffOf(target)
  if (!runoff) return ''
  const seats = runoff.electionSeats ?? 1
  return runoff.category === 'committee' ? `Abrir desempate · ${seats} ${seats === 1 ? 'puesto' : 'puestos'}` : 'Abrir desempate'
}
</script>

<template>
  <div class="ballot-heading">
    <div><div class="eyebrow-row"><p class="eyebrow">CONTEO PUBLICADO</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2><p v-if="currentRoundRecord && majorityText(currentRoundRecord, currentRoundRecord.outcome)" class="majority-chip">{{ majorityText(currentRoundRecord, currentRoundRecord.outcome) }}</p></div>
    <p class="voters-total"><strong>{{ currentRoundRecord.participationCount ?? state?.recordedCount ?? 0 }} de {{ eligibleOf(currentRoundRecord) }}</strong><span>votaron<template v-if="eligibleOf(currentRoundRecord)"> · {{ notVotedText(currentRoundRecord.participationCount ?? state?.recordedCount ?? 0, eligibleOf(currentRoundRecord)) }}</template></span></p>
  </div>
  <p v-if="verdictOf(currentRoundRecord)" :class="['decision-verdict', { rejected: verdictOf(currentRoundRecord) === 'No aprobada' }]">{{ verdictOf(currentRoundRecord) }}</p>
  <ResultsList :rows="rankedRows(countsOf(currentRoundRecord), eligibleOf(currentRoundRecord))" :outcome="currentRoundRecord.outcome" :target="currentRoundRecord" />
  <div class="action-row ballot-actions">
    <button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button>
    <button v-if="runoffOf(currentRoundRecord)" class="primary push-right" :disabled="loading" @click="openRunoff(currentRoundRecord)">{{ runoffButtonText(currentRoundRecord) }}</button>
  </div>
</template>

<style scoped>
.majority-chip { display: inline-block; margin: .35rem 0 0; padding: .2rem .6rem; border-radius: 999px; background: #e8efff; color: var(--blue-dark); font-size: .75rem; font-weight: 700; }
.decision-verdict { margin: .75rem 0 0; padding: .7rem 1rem; border-radius: 10px; background: var(--blue-dark); color: #fff; font-size: 1.25rem; font-weight: 800; }
.decision-verdict.rejected { background: #fff2f0; color: #b42318; }
</style>
