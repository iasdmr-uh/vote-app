<script setup lang="ts">
import { outcomeTag, winnerText } from '../resultados'
import type { Outcome, PublicState, RoundRecord } from '../types'

withDefaults(defineProps<{
  rows: Array<{ key: string; rank: number; label: string; count: number; percent: number; tied: boolean }>
  outcome?: Outcome
  target?: RoundRecord | NonNullable<PublicState['currentRound']>
  showBar?: boolean
  compact?: boolean
}>(), {
  showBar: true,
  compact: false,
})
</script>

<template>
  <ol class="ranked-rows" :class="{ 'compact-rows': compact }">
    <li v-for="row in rows" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="outcomeTag(outcome, row.key) === 'elected'" class="badge badge-success">{{ target ? winnerText(target, row.label) : '' }}</span><span v-else-if="outcomeTag(outcome, row.key) === 'runoff'" class="badge badge-warning">Desempate</span><span v-else-if="!outcome && row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span><span v-if="showBar" class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span></li>
  </ol>
</template>
