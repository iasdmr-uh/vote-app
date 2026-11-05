<script setup lang="ts">
import { computed } from 'vue'
import { actaKind, actaMetaText, actaRows, actaSummary, orgChart, votesText } from '../resultados'
import type { Position, PublicState, RoundRecord } from '../types'

const props = defineProps<{ state: PublicState }>()

/** Votes that already happened; a prepared draft or the vote still open is not part of the record. */
const rounds = computed(() => (props.state.rounds || []).filter((item) => item.status !== 'draft' && item.status !== 'open'))

/** Base of the last counted vote, or everyone registered, those who left included. */
const habilitados = computed(() => {
  const counted = [...rounds.value].reverse().find((item) => item.status !== 'annulled' && item.eligibleCount !== undefined)
  return counted?.eligibleCount ?? (props.state.participants?.length ?? 0) + (props.state.leftParticipants?.length ?? 0)
})

const dateText = computed(() => {
  const at = props.state.assembly?.completedAt || props.state.assemblyCompletedAt
  return new Intl.DateTimeFormat('es-HN', { day: 'numeric', month: 'long', year: 'numeric' }).format(at ? new Date(at) : new Date())
})
const assemblyName = computed(() => props.state.assembly?.name || props.state.assemblyName || '')
const chart = computed(() => props.state.positions?.length ? orgChart(props.state.positions) : null)

function titleOf(item: RoundRecord) {
  return props.state.rounds?.find((other) => other.id === item.committeeRootRoundId)?.title || item.title
}

function nameOf(position: Position) {
  return position.elected?.label || ''
}
</script>

<template>
  <section class="acta-print">
    <img class="acta-map" src="/brand/mapa.png" alt="" />
    <img class="acta-footer-logo" src="/brand/uh-gris.png" alt="Unión Hondureña" />
    <table class="acta-pages acta-history">
      <thead>
        <tr><td>
          <header class="acta-header">
            <img class="acta-logo" src="/brand/conpoder.png" alt="Con poder y gloria" />
            <h1>ACTA DE VOTACIONES</h1>
            <p class="acta-subtitle">{{ [assemblyName, dateText].filter(Boolean).join(' · ') }}</p>
            <div class="acta-rule"></div>
          </header>
        </td></tr>
      </thead>
      <tfoot><tr><td class="acta-bottom-space"></td></tr></tfoot>
      <tbody>
        <tr><td><p class="acta-summary">{{ actaSummary(rounds, habilitados) }}</p></td></tr>
        <tr v-for="(item, index) in rounds" :key="`acta-${item.id}`" class="acta-round-row">
          <td>
            <article class="acta-round" :data-round-id="item.id">
              <header class="acta-round-header">
                <h2><span class="acta-round-number">{{ index + 1 }}.</span> {{ titleOf(item) }}</h2>
                <span class="acta-kind" :class="`tone-${actaKind(item).tone}`">{{ actaKind(item).text }}</span>
              </header>
              <p v-if="actaMetaText(item)" class="acta-meta">{{ actaMetaText(item) }}</p>
              <ol v-if="item.results?.length" class="acta-results">
                <li v-for="row in actaRows(item)" :key="row.key" :class="{ winner: row.winner }">
                  <span class="acta-rank">{{ row.rank }}</span>
                  <span class="acta-name">{{ row.label }}<span v-if="row.tag" class="acta-tag" :class="row.tag === 'Desempate' || row.tag === 'Empate' ? 'tag-amber' : 'tag-green'">{{ row.tag }}</span></span>
                  <strong class="acta-votes">{{ votesText(row.count) }}</strong>
                  <span class="acta-percent">{{ row.percent === null ? '' : `${row.percent} %` }}</span>
                </li>
              </ol>
              <p v-else-if="item.status !== 'annulled'" class="acta-meta">Conteo no publicado</p>
            </article>
          </td>
        </tr>
      </tbody>
    </table>

    <table v-if="chart" class="acta-pages acta-org" :class="{ crowded: chart.departmentRows.length > 7 }">
      <thead>
        <tr><td>
          <header class="acta-header">
            <img class="acta-logo" src="/brand/conpoder.png" alt="Con poder y gloria" />
            <h1>OFICIALES DE UNIÓN HONDUREÑA</h1>
            <p v-if="state.period" class="acta-subtitle">{{ state.period }}</p>
            <div class="acta-rule"></div>
          </header>
        </td></tr>
      </thead>
      <tfoot><tr><td class="acta-bottom-space"></td></tr></tfoot>
      <tbody><tr><td>
      <div v-if="chart.boardTop.length" class="acta-board" :style="{ '--n': Math.max(1, chart.boardBottom.length) }">
        <h3>JUNTA DIRECTIVA</h3>
        <div class="acta-board-top" :class="{ single: chart.boardTop.length === 1 }">
          <div v-for="position in chart.boardTop" :key="position.id" class="acta-puesto" :data-position="position.label"><div class="acta-puesto-label">{{ position.label }}</div><div class="acta-puesto-name">{{ nameOf(position) }}</div></div>
        </div>
        <template v-if="chart.boardBottom.length">
          <div v-if="chart.boardTop.length > 1" class="acta-line acta-board-join"></div>
          <div class="acta-line acta-board-stem"></div>
          <div v-if="chart.boardBottom.length > 1" class="acta-line acta-board-bar"></div>
          <div class="acta-board-bottom">
            <div v-for="position in chart.boardBottom" :key="position.id" class="acta-puesto" :data-position="position.label"><div class="acta-puesto-label">{{ position.label }}</div><div class="acta-puesto-name">{{ nameOf(position) }}</div></div>
          </div>
        </template>
      </div>
      <div v-if="chart.departmentRows.length" class="acta-departments">
        <div class="acta-line acta-spine"></div>
        <h3>DEPARTAMENTOS</h3>
        <div v-for="(row, rowIndex) in chart.departmentRows" :key="rowIndex" class="acta-department-row">
          <div v-for="position in row" :key="position.id" class="acta-puesto" :data-position="position.label"><div class="acta-puesto-label">{{ position.label }}</div><div class="acta-puesto-name">{{ nameOf(position) }}</div></div>
          <div class="acta-line acta-branch" :class="{ half: row.length === 1 }"></div>
        </div>
      </div>
      </td></tr></tbody>
    </table>
  </section>
</template>

<style>
@media print {
  @page { size: letter; margin: 0; }
  .acta-print {
    --navy: #1f2e5c; --gold: #a5813e; --puesto-head: #cfd0cd; --puesto-border: #8f9aab; --connector: #6b7487;
    --acta-muted: #5f6673; --green: #1f7a4d; --amber: #9a6a12; --red: #a33a2f;
    position: relative; display: block; width: 816px; margin: 0 auto; color: var(--navy);
    font-family: Arial, "Arimo", sans-serif; font-size: 13px; line-height: 1.25;
    -webkit-print-color-adjust: exact; print-color-adjust: exact;
  }
  .acta-print .acta-map { position: fixed; z-index: 0; top: 380px; left: -20px; width: 860px; opacity: .15; }
  .acta-print .acta-footer-logo { position: fixed; bottom: 30px; left: 50%; width: 230px; transform: translateX(-50%); }

  .acta-print .acta-pages, .acta-print .acta-org { position: relative; z-index: 1; }
  .acta-print .acta-pages { width: 100%; border-collapse: collapse; }
  .acta-print :is(h1, h2, h3) { color: inherit; letter-spacing: 0; }
  .acta-print .acta-pages td { padding: 0 52px; }
  .acta-print .acta-pages .acta-bottom-space { height: 96px; padding: 0; }
  .acta-print .acta-round-row { break-inside: avoid; page-break-inside: avoid; }

  .acta-print .acta-header { padding-top: 40px; text-align: center; }
  .acta-print .acta-logo { display: block; width: 300px; height: 40px; margin: 0 auto; object-fit: contain; }
  .acta-print .acta-header h1 { margin: 24px 0 0; font-size: 24px; line-height: 28px; font-weight: 700; }
  .acta-print .acta-subtitle { margin: 6px 0 0; font-size: 16px; line-height: 18px; }
  .acta-print .acta-rule { width: 260px; height: 1.5px; margin: 14px auto 22px; background: var(--gold); }
  .acta-print .acta-summary { margin: 0 0 14px; color: var(--acta-muted); font-size: 12px; text-align: center; }

  .acta-print .acta-round { margin-bottom: 14px; overflow: hidden; border: 1px solid var(--puesto-border); border-radius: 6px; background: #fff; }
  .acta-print .acta-round-header { display: flex; align-items: center; justify-content: space-between; gap: 12px; min-height: 28px; padding: 0 12px; background: var(--puesto-head); }
  .acta-print .acta-round-header h2 { margin: 0; font-size: 13px; font-weight: 700; }
  .acta-print .acta-round-number { color: var(--gold); margin-right: 4px; }
  .acta-print .acta-kind { font-size: 11px; font-weight: 700; letter-spacing: .04em; white-space: nowrap; }
  .acta-print .tone-vote { color: var(--gold); }
  .acta-print .tone-approved { color: var(--green); }
  .acta-print .tone-annulled, .acta-print .tone-rejected { color: var(--red); }
  .acta-print .acta-meta { margin: 0; padding: 8px 12px 4px; color: var(--acta-muted); font-size: 11px; }
  .acta-print .acta-results { margin: 0; padding: 0 12px 6px; list-style: none; }
  .acta-print .acta-results li { display: grid; grid-template-columns: 24px 1fr auto 54px; align-items: center; min-height: 23px; }
  .acta-print .acta-rank { color: var(--acta-muted); font-size: 11px; font-weight: 700; }
  .acta-print .acta-results .winner .acta-name { font-weight: 700; }
  .acta-print .acta-tag { display: inline-block; margin-left: 10px; padding: 1px 8px; border-radius: 999px; font-size: 9.5px; font-weight: 700; letter-spacing: .06em; text-transform: uppercase; vertical-align: 1px; }
  .acta-print .tag-green { background: #e2f0e8; color: var(--green); }
  .acta-print .tag-amber { background: #f4ead6; color: var(--amber); }
  .acta-print .acta-votes { font-size: 13px; text-align: right; }
  .acta-print .acta-percent { color: var(--acta-muted); font-size: 12px; text-align: right; }

  .acta-print .acta-org { break-before: page; page-break-before: always; }
  .acta-print .acta-org td { padding: 0; }
  .acta-print .acta-org .acta-bottom-space { height: 60px; }
  .acta-print .acta-org .acta-rule { margin-bottom: 28px; }
  .acta-print .acta-org h3 { margin: 0; color: var(--gold); font-size: 13px; font-weight: 700; letter-spacing: .04em; }
  .acta-print .acta-puesto { border: 1px solid var(--puesto-border); border-radius: 6px; background: #fff; text-align: center; break-inside: avoid; }
  .acta-print .acta-puesto-label { height: 28px; padding: 0 6px; border-radius: 5px 5px 0 0; background: var(--puesto-head); font-size: 13px; font-weight: 700; line-height: 28px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
  .acta-print .acta-puesto-name { height: 30px; padding: 0 6px; font-size: 15px; line-height: 34px; white-space: nowrap; text-overflow: ellipsis; overflow: hidden; }
  .acta-print .acta-line { position: absolute; background: var(--connector); }

  .acta-print .acta-board { position: relative; margin: 0 32px; padding: 16px 0 32px; border: 1px solid #d5d9e0; border-radius: 14px; background: #ffffffd9; break-inside: avoid; }
  .acta-print .acta-board h3 { padding: 0 20px 15px; }
  .acta-print .acta-board-top { display: flex; justify-content: space-between; padding: 0 20px; }
  .acta-print .acta-board-top.single { justify-content: center; }
  .acta-print .acta-board-top .acta-puesto { position: relative; width: 320px; }
  .acta-print .acta-board-join { top: 130px; left: 180px; right: 180px; height: 1.5px; }
  .acta-print .acta-board-top:not(.single) .acta-puesto::after { content: ""; position: absolute; top: 100%; left: calc(50% - .75px); width: 1.5px; height: 24px; margin-top: 1px; background: var(--connector); }
  .acta-print .acta-board-stem { top: 106px; left: calc(50% - .75px); width: 1.5px; height: 38px; }
  .acta-print .acta-board-top:not(.single) ~ .acta-board-stem { top: 130px; height: 14px; }
  .acta-print .acta-board-bar { top: 144px; height: 1.5px; left: calc(12px + (100% - 24px - (var(--n) - 1) * 12px) / var(--n) / 2); right: calc(12px + (100% - 24px - (var(--n) - 1) * 12px) / var(--n) / 2); }
  .acta-print .acta-board-bottom { display: flex; gap: 12px; margin-top: 52px; padding: 0 12px; }
  .acta-print .acta-board-bottom .acta-puesto { position: relative; flex: 1; min-width: 0; }
  .acta-print .acta-board-bottom .acta-puesto::before { content: ""; position: absolute; bottom: 100%; left: calc(50% - .75px); width: 1.5px; height: 14px; margin-bottom: 1px; background: var(--connector); }

  .acta-print .acta-departments { position: relative; margin: 0 52px; padding-top: 20px; }
  .acta-print .acta-departments h3 { position: relative; margin-bottom: 15px; }
  .acta-print .acta-spine { top: 0; bottom: 29px; left: calc(50% - .75px); width: 1.5px; }
  .acta-print .acta-department-row { position: relative; display: grid; grid-template-columns: 320px 320px; justify-content: space-between; margin-bottom: 4px; break-inside: avoid; }
  .acta-print .acta-branch { top: 34px; left: 320px; right: 320px; height: 1.5px; }
  .acta-print .acta-branch.half { right: 50%; }
  .acta-print .acta-org.crowded .acta-department-row .acta-puesto-name { height: 24px; line-height: 26px; }
  .acta-print .acta-org.crowded .acta-department-row .acta-branch { top: 31px; }
  .acta-print .acta-org.crowded .acta-spine { bottom: 26px; }
}
</style>
