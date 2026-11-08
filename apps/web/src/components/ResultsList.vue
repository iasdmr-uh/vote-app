<script setup lang="ts">
import { es } from '../locale/es'
import { computed } from 'vue'
import { baseSumText, marksCheckText, notVotedRow, outcomeTag, winnerText, type ResultRow } from '../resultados'
import type { Outcome, PublicState, RoundRecord } from '../types'

const props = withDefaults(defineProps<{
  rows: ResultRow[]
  outcome?: Outcome
  target?: RoundRecord | NonNullable<PublicState['currentRound']>
  recorded?: number
  base?: number
  marks?: number
  showBar?: boolean
  compact?: boolean
}>(), {
  showBar: true,
  compact: false,
})

const checked = computed(() => props.recorded !== undefined && props.base !== undefined)
const allRows = computed(() => checked.value ? [...props.rows, notVotedRow(props.recorded!, props.base!)] : props.rows)
const marksLine = computed(() => checked.value && props.marks ? marksCheckText(props.marks, props.recorded!) : '')
</script>

<template>
  <ol class="ranked-rows result-rows" :class="{ 'compact-rows': compact }">
    <li v-for="row in allRows" :key="row.key" :class="{ 'not-voted-row': row.key === 'not-voted' }"><span class="ranked-label">{{ row.label }}<span v-if="outcomeTag(outcome, row.key) === 'elected'" class="badge badge-success">{{ target ? winnerText(target, row.label) : '' }}</span><span v-else-if="outcomeTag(outcome, row.key) === 'runoff'" class="badge badge-warning">{{ es.results.runoffTag }}</span></span><strong>{{ es.common.votes(row.count) }}</strong><span class="ranked-percent">{{ es.common.percent(row.percent) }}</span><span v-if="showBar" class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span></li>
  </ol>
  <div v-if="checked" class="result-checks">
    <p>{{ baseSumText(recorded!, base!) }}</p>
    <p v-if="marksLine">{{ marksLine }}</p>
  </div>
</template>
