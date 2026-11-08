<script setup lang="ts">
import { es } from '../locale/es'
import { connectedText, majorityText, voteLabel } from '../resultados'
import type { PublicState, RoundRecord } from '../types'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

defineProps<{
  round: NonNullable<PublicState['currentRound']>
  currentRoundRecord?: RoundRecord
}>()

const { state, eligibleVotes, connectionCount, loading } = useAssembly()
const { showNextBallotForm, rootRoundOf, eligibleOf, annulRound, moderatorAction } = useMesa()
</script>

<template>
              <template v-if="round.status === 'open'">
                <div class="eyebrow-row"><p class="status-label status-label-open"><span class="status-dot" aria-hidden="true"></span>{{ es.common.voteOpen }}</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span><span v-if="round.regionalSecretaryVotes" class="badge badge-info">{{ es.results.regionalSecretaryNote }}</span></div>
                <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
                <p class="vote-progress"><strong>{{ state?.recordedCount ?? 0 }}</strong><span>{{ es.moderator.votedProgress(eligibleVotes, state?.recordedCount ?? 0) }}</span></p>
                <span class="vote-progress-bar" aria-hidden="true"><span :style="{ width: `${eligibleVotes ? Math.min(100, Math.round(((state?.recordedCount ?? 0) / eligibleVotes) * 100)) : 0}%` }"></span></span>
                <p v-if="connectionCount" class="vote-connected">{{ connectedText(connectionCount.connected, connectionCount.base) }}</p>
                <div class="action-row ballot-actions"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">{{ es.moderator.annulVote }}</button><button class="danger push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/close`)">{{ es.moderator.closeVote }}</button></div>
              </template>
              <template v-else>
                <div class="ballot-heading">
                  <div><div class="eyebrow-row"><p class="eyebrow">{{ es.moderator.closedEyebrow }}</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2><p v-if="currentRoundRecord && majorityText(currentRoundRecord, currentRoundRecord.outcome)" class="majority-chip">{{ majorityText(currentRoundRecord, currentRoundRecord.outcome) }}</p></div>
                  <p v-if="currentRoundRecord" class="voters-total"><strong>{{ es.common.votersTotal(currentRoundRecord.participationCount ?? state?.recordedCount ?? 0, eligibleOf(currentRoundRecord)) }}</strong><span>{{ es.common.votedLabel }}</span></p>
                </div>
                <p class="status-line" role="status">{{ es.results.preparing }}</p>
                <div class="action-row ballot-actions"><button class="link-button" @click="showNextBallotForm = true">{{ es.moderator.prepareAnother }}</button><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">{{ es.moderator.annulBallot }}</button></div>
              </template>
</template>

<style scoped>
.majority-chip { display: inline-block; margin: .35rem 0 0; padding: .2rem .6rem; border-radius: 999px; background: #e8efff; color: var(--blue-dark); font-size: .75rem; font-weight: 700; }
</style>
