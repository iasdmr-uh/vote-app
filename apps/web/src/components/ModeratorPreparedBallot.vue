<script setup lang="ts">
import { countsOf, voteLabel } from '../resultados'
import type { PublicState, RoundRecord } from '../types'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const { preparedRunoff, round } = defineProps<{
  preparedRunoff?: RoundRecord
  round?: NonNullable<PublicState['currentRound']>
}>()

const { loading, ballotMaxChoices, state } = useAssembly()
const {
  currentRoundRecord, newRunoffCandidate, addRunoffCandidate, removeRunoffCandidate, moderatorAction, annulRound,
  rootRoundOf, voteNumber, roundChain, roundStatusLabels, acceptsNewCandidates, acceptsRegionalSecretary, addRegionalSecretary, removeRegionalSecretary,
  regionalSecretaryFirstName, regionalSecretaryLastName, eligibleOf,
} = useMesa()
</script>

<template>
            <template v-if="preparedRunoff">
              <p class="eyebrow">{{ voteLabel(preparedRunoff) }}</p>
              <h2 class="ballot-title">{{ rootRoundOf(preparedRunoff)?.title || preparedRunoff.title }}</h2>
              <ol class="ranked-rows runoff-candidates">
                <li v-for="(option, index) in preparedRunoff.options" :key="option.id" :class="{ first: index === 0 }"><span class="rank-number">{{ index + 1 }}</span><span class="ranked-label">{{ option.label }}<span v-if="option.isNew" class="badge badge-info">Nuevo</span></span><button v-if="option.isNew" type="button" class="link-button" :aria-label="`Quitar ${option.label}`" :disabled="loading" @click="removeRunoffCandidate(option.id)">Quitar</button></li>
              </ol>
              <form v-if="acceptsNewCandidates(preparedRunoff)" class="new-candidate" @submit.prevent="addRunoffCandidate"><input v-model="newRunoffCandidate" aria-label="Nombre del candidato" maxlength="160" placeholder="Nombre del candidato" /><button class="link-button" :disabled="loading || !newRunoffCandidate.trim()">+ Agregar</button></form>
              <div v-if="acceptsRegionalSecretary(preparedRunoff)" class="regional-secretary">
                <template v-if="preparedRunoff.regionalSecretaryVotes && state?.regionalSecretary">
                  <p role="status">{{ state.regionalSecretary.firstName }} {{ state.regionalSecretary.lastName }} vota en esta ronda como secretaría regional. Votan {{ eligibleOf(preparedRunoff) }} en total.</p>
                  <button type="button" class="link-button remove-link" :disabled="loading" @click="removeRegionalSecretary">Quitar a la secretaría regional</button>
                </template>
                <template v-else>
                  <p class="status-line">El empate persiste. La secretaría regional puede votar en secreto en esta ronda.</p>
                  <button v-if="state?.regionalSecretary" type="button" class="secondary" :disabled="loading" @click="addRegionalSecretary">Agregar a {{ state.regionalSecretary.firstName }} {{ state.regionalSecretary.lastName }}</button>
                  <form v-else class="regional-secretary-form" @submit.prevent="addRegionalSecretary">
                    <input v-model="regionalSecretaryFirstName" aria-label="Nombre de la secretaría regional" maxlength="80" placeholder="Nombre" />
                    <input v-model="regionalSecretaryLastName" aria-label="Apellido de la secretaría regional" maxlength="80" placeholder="Apellido" />
                    <button class="secondary" :disabled="loading || !regionalSecretaryFirstName.trim() || !regionalSecretaryLastName.trim()">Agregar a la secretaría regional</button>
                  </form>
                </template>
              </div>
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

<style scoped>
.regional-secretary { display: grid; gap: .5rem; margin-top: .75rem; padding: .75rem 1rem; border: 1px solid #c7d3e7; border-radius: .75rem; background: #f4f7fc; }
.regional-secretary p { margin: 0; }
.regional-secretary-form { display: flex; flex-wrap: wrap; gap: .5rem; }
.regional-secretary-form input { flex: 1 1 8rem; min-width: 0; }
</style>
