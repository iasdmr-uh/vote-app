<script setup lang="ts">
import { RESULT_WORDING, connectedText, majorityText, voteLabel } from '../resultados'
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
                <div class="eyebrow-row"><p class="status-label status-label-open"><span class="status-dot" aria-hidden="true"></span>VOTACIÓN ABIERTA</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div>
                <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
                <p class="vote-progress"><strong>{{ state?.recordedCount ?? 0 }}</strong><span>de {{ eligibleVotes }} ya {{ (state?.recordedCount ?? 0) === 1 ? 'votó' : 'votaron' }}</span></p>
                <span class="vote-progress-bar" aria-hidden="true"><span :style="{ width: `${eligibleVotes ? Math.min(100, Math.round(((state?.recordedCount ?? 0) / eligibleVotes) * 100)) : 0}%` }"></span></span>
                <p v-if="connectionCount" class="vote-connected">{{ connectedText(connectionCount.connected, connectionCount.base) }}</p>
                <div class="action-row ballot-actions"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular votación</button><button class="danger push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/close`)">Cerrar votación</button></div>
              </template>
              <template v-else>
                <div class="ballot-heading">
                  <div><div class="eyebrow-row"><p class="eyebrow">VOTACIÓN CERRADA</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2><p v-if="currentRoundRecord && majorityText(currentRoundRecord, currentRoundRecord.outcome)" class="majority-chip">{{ majorityText(currentRoundRecord, currentRoundRecord.outcome) }}</p></div>
                  <p v-if="currentRoundRecord" class="voters-total"><strong>{{ currentRoundRecord.participationCount ?? state?.recordedCount ?? 0 }} de {{ eligibleOf(currentRoundRecord) }}</strong><span>votaron</span></p>
                </div>
                <p class="status-line" role="status">{{ RESULT_WORDING.preparing }}</p>
                <div class="action-row ballot-actions"><button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular papeleta</button></div>
              </template>
</template>

<style scoped>
.majority-chip { display: inline-block; margin: .35rem 0 0; padding: .2rem .6rem; border-radius: 999px; background: #e8efff; color: var(--blue-dark); font-size: .75rem; font-weight: 700; }
</style>
