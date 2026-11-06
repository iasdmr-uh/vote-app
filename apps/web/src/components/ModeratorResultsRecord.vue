<script setup lang="ts">
import { approvalText, completedCommittee, electedInVote, electedText, isDecision, notVotedText, REGIONAL_SECRETARY_NOTE, verdictOf, voteLabel } from '../resultados'
import type { RoundRecord } from '../types'
import ResultsList from './ResultsList.vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const { state } = useAssembly()
const { rootRoundOf, roundStatusLabels, eligibleOf, rankedRows, printActa } = useMesa()

function categoryText(target: RoundRecord) {
  if (isDecision(target)) return ['Decisión', approvalText(target, target.outcome)].filter(Boolean).join(' · ')
  return target.category === 'committee' ? `Comisión · ${target.memberCount} ${target.memberCount === 1 ? 'integrante' : 'integrantes'}` : 'Cargo'
}
</script>

<template>
  <section v-if="state?.rounds?.length" id="acta-de-resultados" class="card official-history">
    <div class="section-heading"><div><p class="eyebrow">ACTA DE RESULTADOS</p><h2>Resultados</h2></div><button class="secondary" @click="printActa">Imprimir acta</button></div>
    <article v-for="historyRound in state.rounds" :key="historyRound.id" class="official-round">
      <div class="section-heading"><div><h3>{{ rootRoundOf(historyRound)?.title || historyRound.title }}<span v-if="voteLabel(historyRound)" class="badge badge-info">{{ voteLabel(historyRound) }}</span></h3><p class="status-line">{{ categoryText(historyRound) }} · papeleta {{ roundStatusLabels[historyRound.status] || historyRound.status }}<template v-if="historyRound.results?.length"> · {{ historyRound.participationCount ?? 0 }} de {{ eligibleOf(historyRound) }} votaron · {{ notVotedText(historyRound.participationCount ?? 0, eligibleOf(historyRound)) }}</template><template v-if="historyRound.regionalSecretaryVotes"> · {{ REGIONAL_SECRETARY_NOTE }}</template><template v-if="historyRound.outcome && !isDecision(historyRound)"> · Mayoría: {{ historyRound.outcome.threshold }}</template></p></div></div>
      <p v-if="historyRound.status === 'annulled'" class="status-line">Anulada<template v-if="historyRound.annulReason">: {{ historyRound.annulReason }}</template></p>
      <ResultsList v-if="historyRound.results?.length" :rows="rankedRows(historyRound.results, eligibleOf(historyRound))" :outcome="historyRound.outcome" :target="historyRound" compact :show-bar="false" />
      <div v-if="historyRound.results?.length && historyRound.decisionFormat === 'boolean' && verdictOf(historyRound)" class="declared-result"><strong>{{ verdictOf(historyRound) }}</strong></div>
      <div v-else-if="electedInVote(historyRound).length" class="declared-result"><strong>{{ isDecision(historyRound) ? 'Aprobada' : electedInVote(historyRound).length === 1 ? electedText() : 'Electos' }}</strong><p>{{ electedInVote(historyRound).join(', ') }}</p><p v-if="completedCommittee(historyRound, state?.rounds ?? []).length" class="committee-members">Comisión completa, en orden de elección: {{ completedCommittee(historyRound, state?.rounds ?? []).join(', ') }}</p></div>
    </article>
  </section>
</template>

<style scoped>
.official-round h3 .badge { margin-left: .5rem; vertical-align: middle; }
</style>
