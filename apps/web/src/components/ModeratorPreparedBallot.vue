<script setup lang="ts">
import { countsOf, voteLabel } from '../resultados'
import type { PublicState, RoundRecord } from '../types'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const { preparedRunoff, round } = defineProps<{
  preparedRunoff?: RoundRecord
  round?: NonNullable<PublicState['currentRound']>
}>()

const { loading, ballotMaxChoices } = useAssembly()
const {
  currentRoundRecord, newRunoffCandidate, addRunoffCandidate, removeRunoffCandidate, moderatorAction, annulRound,
  rootRoundOf, voteNumber, roundChain, roundStatusLabels,
} = useMesa()
</script>

<template>
            <template v-if="preparedRunoff">
              <p class="eyebrow">{{ voteLabel(preparedRunoff) }}</p>
              <h2 class="ballot-title">{{ rootRoundOf(preparedRunoff)?.title || preparedRunoff.title }}</h2>
              <ol class="ranked-rows runoff-candidates">
                <li v-for="(option, index) in preparedRunoff.options" :key="option.id" :class="{ first: index === 0 }"><span class="rank-number">{{ index + 1 }}</span><span class="ranked-label">{{ option.label }}<span v-if="option.isNew" class="badge badge-info">Nuevo</span></span><button v-if="option.isNew" type="button" class="link-button" :aria-label="`Quitar ${option.label}`" :disabled="loading" @click="removeRunoffCandidate(option.id)">Quitar</button></li>
              </ol>
              <form class="new-candidate" @submit.prevent="addRunoffCandidate"><input v-model="newRunoffCandidate" aria-label="Nombre del candidato" maxlength="160" placeholder="Nombre del candidato" /><button class="link-button" :disabled="loading || !newRunoffCandidate.trim()">+ Agregar</button></form>
              <div class="action-row ballot-actions"><button class="primary push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(preparedRunoff.id)}/open`)">Abrir votación</button></div>
            </template>
            <template v-else-if="round?.status === 'draft'">
              <div class="eyebrow-row"><p class="eyebrow">PAPELETA PREPARADA</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div>
              <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
              <ul class="ballot-options"><li v-for="option in round.options || []" :key="option.id">{{ option.label }}</li></ul>
              <p v-if="round.category === 'committee' && ballotMaxChoices" class="status-line">Hasta {{ ballotMaxChoices }} por persona</p>
              <div class="action-row"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">{{ currentRoundRecord && voteNumber(currentRoundRecord) > 1 ? 'Cancelar esta votación' : 'Anular papeleta' }}</button><button class="primary push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/open`)">Abrir votación</button></div>
              <template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1">
                <h3 class="list-heading eyebrow">HISTORIAL DE ESTA ELECCIÓN</h3>
                <ul class="history-rows"><li v-for="item in roundChain(rootRoundOf(currentRoundRecord) || currentRoundRecord)" :key="item.id"><div><strong>{{ voteNumber(item) }}.ª votación</strong><span v-if="countsOf(item).length" class="muted"> · {{ countsOf(item).slice(0, 3).map((result) => `${result.label} ${result.count}`).join(' · ') }}</span><span v-else-if="item.annulReason" class="muted"> · {{ item.annulReason }}</span></div><span :class="['badge', item.status === 'published' ? 'badge-success' : item.status === 'annulled' ? 'badge-danger' : 'badge-info']">{{ (roundStatusLabels[item.status] || item.status).toUpperCase() }}</span></li></ul>
              </template>
            </template>
</template>
