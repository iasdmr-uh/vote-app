<script setup lang="ts">
import { computed, nextTick, onMounted, onUnmounted, ref, watch } from 'vue'
import { decisionVerdict, displayOrder, isTied as tiedAt, majorityText, notVotedText, outcomeTag, percentOf, winnerText } from '../resultados'
import { useAssembly } from '../useAssembly'

defineProps<{
  statusLabel: string
  eligible: number
  recorded: number
}>()

const { state, round } = useAssembly()

const isCommittee = computed(() => round.value?.category === 'committee')

const results = computed(() => displayOrder(round.value, state.value?.results || []))
const outcome = computed(() => state.value?.outcome)
const majority = computed(() => round.value ? majorityText(round.value, outcome.value) : '')
const booleanDecision = computed(() => round.value?.category === 'decision' && round.value.decisionFormat === 'boolean')
const verdict = computed(() => booleanDecision.value && round.value ? decisionVerdict(round.value, outcome.value) : '')

function tagOf(result: { optionId?: string }) {
  return outcomeTag(outcome.value, result.optionId)
}

function isTied(index: number) {
  return tiedAt(results.value, index)
}

const columns = computed(() => results.value.length > 8 ? 2 : 1)
const rowsPerColumn = computed(() => Math.max(1, Math.ceil(results.value.length / columns.value)))
const resultsList = ref<HTMLElement | null>(null)
const density = ref(1)

async function fitResults() {
  const rows = rowsPerColumn.value + (verdict.value && !state.value?.final ? 1.2 : 0)
  density.value = Math.max(0.45, Math.min(1, 4.2 / rows))
  await nextTick()
  const list = resultsList.value
  while (list && list.scrollHeight > list.clientHeight + 1 && density.value > 0.45) {
    density.value = Math.max(0.45, density.value - 0.05)
    await nextTick()
  }
}

watch([results, () => state.value?.final, () => round.value?.title], () => { void fitResults() }, { immediate: true })
onMounted(() => window.addEventListener('resize', fitResults))
onUnmounted(() => window.removeEventListener('resize', fitResults))
</script>

<template>
  <header class="pj-results-head">
    <div>
      <p class="pj-status">{{ statusLabel }}</p>
      <h1 class="pj-title">{{ round?.title }}</h1>
      <p v-if="majority" class="pj-subtitle">{{ majority }}</p>
      <p v-else-if="isCommittee && (round?.electionSeats ?? round?.memberCount)" class="pj-subtitle">Se eligen {{ round?.electionSeats ?? round?.memberCount }} integrantes</p>
    </div>
    <p class="pj-card pj-turnout"><strong>{{ recorded }}</strong> <span>de {{ eligible }}</span><small>votaron<template v-if="eligible"> · {{ notVotedText(recorded, eligible) }}</template></small></p>
  </header>
  <div v-if="verdict && !state?.final" class="pj-elected" :class="{ 'pj-rejected': verdict === 'No aprobada' }"><h2><span v-if="verdict === 'Aprobada'" class="pj-check" aria-hidden="true">✓</span> {{ verdict }}</h2></div>
  <ol ref="resultsList" class="pj-results" :class="{ 'pj-unranked': booleanDecision }" :style="{ '--k': density, '--cols': columns, '--rows': rowsPerColumn }">
    <li v-for="(result, index) in results" :key="result.label" class="pj-card" :class="{ 'pj-first': index === 0 && result.count > 0 }">
      <span v-if="!booleanDecision" class="pj-rank">{{ index + 1 }}</span>
      <span class="pj-name"><span class="pj-label">{{ result.label }}</span><em v-if="tagOf(result) === 'elected'" class="pj-elected-tag">✓ {{ round ? winnerText(round, result.label) : '' }}</em><em v-else-if="tagOf(result) === 'runoff'" class="pj-tie">Desempate</em><em v-else-if="!outcome && isTied(index)" class="pj-tie">Empate</em></span>
      <strong class="pj-votes">{{ result.count }} {{ result.count === 1 ? 'voto' : 'votos' }}</strong>
      <span class="pj-percent">{{ percentOf(result.count, eligible) }} %</span>
      <span class="pj-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, percentOf(result.count, eligible))}%` }"></span></span>
    </li>
  </ol>
</template>

<style scoped>
.pj-card { border-radius: calc(var(--u) * 22); background: #fff; }
.pj-title { color: var(--ink); font-size: calc(var(--u) * 96); text-wrap: balance; font-weight: 800; letter-spacing: -.02em; line-height: 1.08; }
.pj .pj-subtitle { margin-top: calc(var(--u) * 8); color: var(--muted); font-size: calc(var(--u) * 38); font-weight: 500; }
.pj .pj-status { display: flex; align-items: center; gap: calc(var(--u) * 14); margin-bottom: calc(var(--u) * 12); color: var(--blue); font-size: calc(var(--u) * 26); font-weight: 800; letter-spacing: .08em; text-transform: uppercase; }
.pj-results-head { display: flex; align-items: flex-start; justify-content: space-between; gap: calc(var(--u) * 40); }
.pj-results-head > div { min-width: 0; }
.pj-turnout { display: grid; flex: none; grid-template-columns: auto auto; align-items: baseline; column-gap: calc(var(--u) * 14); padding: calc(var(--u) * 22) calc(var(--u) * 40); }
.pj-turnout strong { font-size: calc(var(--u) * 76); font-weight: 800; line-height: 1; }
.pj-turnout span { color: var(--muted); font-size: calc(var(--u) * 40); font-weight: 600; }
.pj-turnout small { grid-column: 1 / -1; justify-self: end; color: var(--muted); font-size: calc(var(--u) * 28); }
.pj-elected { margin-top: calc(var(--u) * 28); padding: calc(var(--u) * 28) calc(var(--u) * 48); border-radius: calc(var(--u) * 22); background: var(--blue-dark); color: #fff; }
.pj-check { color: var(--cream); }
.pj-elected h2 { color: #fff; font-size: calc(var(--u) * 76); font-weight: 800; line-height: 1.15; }
.pj-rejected { background: #fff2f0; }
.pj-rejected h2 { color: #b42318; }
.pj .pj-results {
  display: grid;
  min-height: 0;
  flex: 1 1 auto;
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), min-content);
  grid-auto-flow: column;
  align-content: start;
  overflow: hidden;
  gap: calc(var(--u) * 18 * var(--k)) calc(var(--u) * 32);
  margin-top: calc(var(--u) * 28);
  padding: 0;
  list-style: none;
}
.pj-results li { display: grid; grid-template-columns: auto minmax(0, 1fr) auto calc(var(--u) * 130 * var(--k)); align-items: center; column-gap: calc(var(--u) * 30 * var(--k)); row-gap: calc(var(--u) * 16 * var(--k)); padding: calc(var(--u) * 26 * var(--k)) calc(var(--u) * 40); }
.pj-unranked li { grid-template-columns: minmax(0, 1fr) auto calc(var(--u) * 130 * var(--k)); }
.pj-rank { display: grid; width: calc(var(--u) * 76 * var(--k)); height: calc(var(--u) * 76 * var(--k)); place-items: center; border-radius: 50%; background: var(--soft); color: var(--ink); font-size: calc(var(--u) * 32 * var(--k)); font-weight: 800; }
.pj-first .pj-rank { background: var(--blue); color: #fff; }
.pj-name { display: flex; min-width: 0; align-items: center; gap: calc(var(--u) * 20 * var(--k)); overflow: hidden; font-size: calc(var(--u) * 48 * var(--k)); font-weight: 600; white-space: nowrap; }
.pj-label { min-width: 0; overflow: hidden; text-overflow: ellipsis; }
.pj-name em { flex: none; padding: calc(var(--u) * 6 * var(--k)) calc(var(--u) * 18 * var(--k)); border-radius: 999px; font-size: calc(var(--u) * 26 * var(--k)); font-style: normal; font-weight: 700; }
.pj-tie { background: #f3d9a4; color: #8a5a14; }
.pj-elected-tag { background: #1f7a4d; color: #fff; }
.pj-votes { color: var(--blue); font-size: calc(var(--u) * 48 * var(--k)); font-weight: 800; white-space: nowrap; }
.pj-percent { color: var(--muted); font-size: calc(var(--u) * 40 * var(--k)); font-weight: 600; text-align: right; white-space: nowrap; }
.pj-bar { grid-column: 1 / -1; height: calc(var(--u) * 16 * var(--k)); overflow: hidden; border-radius: 999px; background: var(--soft); }
.pj-bar span { display: block; height: 100%; border-radius: inherit; background: var(--blue); }
</style>
