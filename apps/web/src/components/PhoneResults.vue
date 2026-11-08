<script setup lang="ts">
import { REGIONAL_SECRETARY_NOTE } from '../resultados'
import type { Outcome, PublicState } from '../types'
import ResultsList from './ResultsList.vue'

defineProps<{
  round?: NonNullable<PublicState['currentRound']>
  rows: Array<{ key: string; rank: number; label: string; count: number; percent: number; tied: boolean }>
  verdict: string
  base: number
  voters: number
  officialResult?: PublicState['officialResult']
  outcome?: Outcome
}>()
</script>

<template>
  <section class="phone-results" aria-labelledby="phone-results-title">
    <div class="phone-results-heading">
      <div><p class="eyebrow">RESULTADOS</p><h2 id="phone-results-title">{{ round?.title }}</h2></div>
      <p v-if="base" class="voters-total"><strong>{{ voters }} de {{ base }}</strong><span>votaron</span></p>
    </div>
    <p v-if="round?.regionalSecretaryVotes" class="status-line">{{ REGIONAL_SECRETARY_NOTE }}</p>
    <div v-if="verdict" class="official-card"><p class="eyebrow">RESULTADO</p><strong>{{ verdict }}</strong></div>
    <div v-else-if="officialResult" class="official-card"><p class="eyebrow">RESULTADO OFICIAL</p><strong>{{ officialResult.elected.map((person) => person.label).join(' · ') }}</strong><p v-if="officialResult.note">{{ officialResult.note }}</p></div>
    <ResultsList v-if="rows.length" :rows="rows" :outcome="outcome" :target="round" />
  </section>
</template>
