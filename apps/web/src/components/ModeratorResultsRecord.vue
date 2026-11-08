<script setup lang="ts">
import { es } from '../locale/es'
import { approvalText, completedCommittee, electedInVote, electedText, isDecision, marksPerBallot, notVotedText, resultRows, verdictOf, voteLabel } from '../resultados'
import type { RoundRecord } from '../types'
import ResultExplanation from './ResultExplanation.vue'
import ResultsList from './ResultsList.vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const { state } = useAssembly()
const { rootRoundOf, roundStatusLabels, eligibleOf, printActa } = useMesa()

function categoryText(target: RoundRecord) {
  if (isDecision(target)) return [es.moderator.categoryDecision, approvalText(target, target.outcome)].filter(Boolean).join(' · ')
  return target.category === 'committee' ? `${es.moderator.categoryCommittee} · ${es.results.members(target.memberCount ?? 0)}` : es.moderator.categoryOffice
}
</script>

<template>
  <section v-if="state?.rounds?.length" id="acta-de-resultados" class="card official-history">
    <div class="section-heading"><div><p class="eyebrow">{{ es.moderator.resultsEyebrow }}</p><h2>{{ es.moderator.resultsHeading }}</h2></div><button class="secondary" @click="printActa">{{ es.moderator.printActa }}</button></div>
    <article v-for="historyRound in state.rounds" :key="historyRound.id" class="official-round">
      <div class="section-heading"><div><h3>{{ rootRoundOf(historyRound)?.title || historyRound.title }}<span v-if="voteLabel(historyRound)" class="badge badge-info">{{ voteLabel(historyRound) }}</span></h3><p class="status-line">{{ categoryText(historyRound) }} · {{ es.moderator.ballotStatus(roundStatusLabels[historyRound.status] || historyRound.status) }}<template v-if="historyRound.results?.length"> · {{ es.common.votersTotal(historyRound.participationCount ?? 0, eligibleOf(historyRound)) }} {{ es.common.votedLabel }} · {{ notVotedText(historyRound.participationCount ?? 0, eligibleOf(historyRound)) }}</template><template v-if="historyRound.regionalSecretaryVotes"> · {{ es.results.regionalSecretaryNote }}</template><template v-if="historyRound.outcome && !isDecision(historyRound)"> · {{ es.moderator.majorityThreshold(historyRound.outcome.threshold) }}</template></p></div></div>
      <p v-if="historyRound.status === 'annulled'" class="status-line">{{ historyRound.annulReason ? es.moderator.annulledWithReason(historyRound.annulReason) : es.moderator.annulled }}</p>
      <ResultsList v-if="historyRound.results?.length" :rows="resultRows(historyRound.results, eligibleOf(historyRound))" :recorded="historyRound.participationCount ?? 0" :base="eligibleOf(historyRound)" :marks="marksPerBallot(historyRound)" :outcome="historyRound.outcome" :target="historyRound" compact :show-bar="false" />
      <ResultExplanation v-if="historyRound.results?.length" :target="historyRound" />
      <div v-if="historyRound.results?.length && historyRound.decisionFormat === 'boolean' && verdictOf(historyRound)" class="declared-result"><strong>{{ verdictOf(historyRound) }}</strong></div>
      <div v-else-if="electedInVote(historyRound).length" class="declared-result"><strong>{{ isDecision(historyRound) ? es.results.approved : electedInVote(historyRound).length === 1 ? electedText() : es.results.elected }}</strong><p>{{ electedInVote(historyRound).join(', ') }}</p><p v-if="completedCommittee(historyRound, state?.rounds ?? []).length" class="committee-members">{{ es.moderator.completeCommittee(completedCommittee(historyRound, state?.rounds ?? []).join(', ')) }}</p></div>
    </article>
  </section>
</template>

<style scoped>
.official-round h3 .badge { margin-left: .5rem; vertical-align: middle; }
</style>
