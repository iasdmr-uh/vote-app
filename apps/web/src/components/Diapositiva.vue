<script setup lang="ts">
import { computed } from 'vue'
import { nameSize, positionsOf, votesText, type ResultSlide } from '../diapositivas'
import type { PresentationSlide } from '../types'
import { useAssembly } from '../useAssembly'

/** A 1920×1080 slide in the Agenda UH 2026 style (Figma 160:9): a published result, or a «Presentar oficiales» slide. */
const props = defineProps<{ result?: ResultSlide | null; presentation?: PresentationSlide }>()

const { state } = useAssembly()

const kind = computed(() => props.result?.kind ?? (['cover', 'board', 'departments'] as const)[props.presentation ?? 0])
const assemblyName = computed(() => state.value?.assemblyName || state.value?.assembly?.name || '')
const period = computed(() => state.value?.period || '')

// P4: Presidente and Vicepresidente on top, the rest of the Junta directiva below (Figma 162:163).
const board = computed(() => {
  const positions = positionsOf(state.value, 'board')
  const top = positions.slice(0, 2)
  const bottom = positions.slice(2)
  const gap = 40
  const width = bottom.length ? (1800 - gap * (bottom.length - 1)) / bottom.length : 0
  return {
    top: top.map((position, index) => ({ position, x: index === 0 ? 240 : 1050, center: index === 0 ? 555 : 1365 })),
    bottom: bottom.map((position, index) => ({ position, x: 60 + index * (width + gap), width, center: 60 + index * (width + gap) + width / 2 })),
  }
})

// P5: two columns joined by a center line; added departments shrink the rows to fit (Figma 162:214).
const departments = computed(() => {
  const positions = positionsOf(state.value, 'department')
  const rows = Math.max(1, Math.ceil(positions.length / 2))
  const pitch = Math.min(104, 715 / (rows - 0.135))
  const height = pitch * 0.865
  return {
    k: pitch / 104,
    height,
    items: positions.map((position, index) => ({ position, left: index % 2 === 0, y: 270 + Math.floor(index / 2) * pitch })),
    spine: { top: 270, bottom: 270 + (rows - 1) * pitch + height },
  }
})

// P6: up to 6 rows in one column; more go in two columns, smaller.
const committee = computed(() => {
  const rows = props.result?.kind === 'committee' ? props.result.rows : []
  const columns = rows.length > 6 ? 2 : 1
  const perColumn = Math.max(1, Math.ceil(rows.length / columns))
  return { rows, columns, perColumn, k: Math.min(1, 520 / (perColumn * 144)) }
})

const u = (value: number) => `calc(var(--u) * ${value})`
</script>

<template>
  <div class="slide" :class="`slide-${kind}`" :data-slide="kind">
    <template v-if="kind === 'cover'">
      <img class="slide-map" src="/brand/mapa-blanco.png" alt="" />
      <img class="slide-uh" src="/brand/uh-blanco.png" alt="Unión Hondureña" />
      <img class="cover-logo" src="/brand/conpoder-blanco.png" alt="Con poder y gloria" />
      <h1 class="cover-title">OFICIALES DE UNIÓN HONDUREÑA</h1>
      <p v-if="period" class="cover-period">{{ period }}</p>
      <span class="cover-rule" aria-hidden="true"></span>
      <p v-if="assemblyName" class="cover-assembly">{{ assemblyName }}</p>
    </template>

    <template v-else>
      <img class="slide-map" src="/brand/mapa.png" alt="" />
      <img class="slide-logo" src="/brand/conpoder.png" alt="Con poder y gloria" />
      <img class="slide-uh" src="/brand/uh-gris.png" alt="Unión Hondureña" />

      <section v-if="result?.kind === 'office'" class="slide-center">
        <h1 class="slide-kicker">{{ result.title }}</h1>
        <p class="office-name" :style="{ fontSize: u(nameSize(result.name)) }">{{ result.name }}</p>
        <span class="slide-rule" aria-hidden="true"></span>
        <p class="office-votes">{{ result.votes }}</p>
        <p v-if="result.label" class="office-label">{{ result.label }}</p>
      </section>

      <section v-else-if="result?.kind === 'decision'" class="slide-center">
        <p class="slide-kicker decision-kicker">DECISIÓN</p>
        <h1 class="decision-title">{{ result.title }}</h1>
        <p class="decision-pill" :class="result.approved ? 'decision-approved' : 'decision-rejected'"><span v-if="result.approved" aria-hidden="true">✓ </span>{{ result.verdict }}</p>
        <p class="decision-details">{{ result.details }}</p>
      </section>

      <section v-else-if="result?.kind === 'committee'" class="slide-center committee" :style="{ '--k': committee.k, '--cols': committee.columns, '--rows': committee.perColumn }">
        <h1 class="slide-kicker committee-kicker">{{ result.title }}</h1>
        <span class="slide-rule" aria-hidden="true"></span>
        <ol class="committee-rows">
          <li v-for="(row, index) in committee.rows" :key="`${row.label}-${index}`"><span class="committee-rank">{{ index + 1 }}</span><span class="committee-name">{{ row.label }}</span><span v-if="row.count !== null" class="committee-votes">{{ votesText(row.count) }}</span></li>
        </ol>
        <p class="committee-members">{{ result.members }}</p>
      </section>

      <template v-else-if="kind === 'board'">
        <h1 class="chart-title">JUNTA DIRECTIVA</h1>
        <span class="chart-rule" aria-hidden="true"></span>
        <div class="chart" aria-label="Junta directiva">
          <template v-if="board.top.length === 2">
            <span class="line" :style="{ left: u(555), top: u(526), width: u(3), height: u(64) }"></span>
            <span class="line" :style="{ left: u(1365), top: u(526), width: u(3), height: u(64) }"></span>
            <span class="line" :style="{ left: u(555), top: u(590), width: u(813), height: u(3) }"></span>
          </template>
          <template v-if="board.bottom.length">
            <span class="line" :style="{ left: u(960), top: u(board.top.length === 2 ? 590 : 526), width: u(3), height: u(board.top.length === 2 ? 60 : 124) }"></span>
            <span class="line" :style="{ left: u(board.bottom[0]!.center), top: u(650), width: u(board.bottom.at(-1)!.center - board.bottom[0]!.center + 3), height: u(3) }"></span>
            <span v-for="item in board.bottom" :key="`drop-${item.position.id}`" class="line" :style="{ left: u(item.center), top: u(650), width: u(3), height: u(40) }"></span>
          </template>
          <article v-for="item in board.top" :key="item.position.id" class="puesto puesto-top" :class="{ 'puesto-blank': !item.position.elected }" :style="{ left: u(item.x), top: u(400), width: u(630), height: u(126) }">
            <h2>{{ item.position.label }}</h2><p>{{ item.position.elected?.label }}</p>
          </article>
          <article v-for="item in board.bottom" :key="item.position.id" class="puesto puesto-bottom" :class="{ 'puesto-blank': !item.position.elected }" :style="{ left: u(item.x), top: u(690), width: u(item.width), height: u(120) }">
            <h2>{{ item.position.label }}</h2><p>{{ item.position.elected?.label }}</p>
          </article>
        </div>
      </template>

      <template v-else-if="kind === 'departments'">
        <h1 class="chart-title">DEPARTAMENTOS</h1>
        <span class="chart-rule" aria-hidden="true"></span>
        <div class="chart" aria-label="Departamentos" :style="{ '--k': departments.k }">
          <span v-if="departments.items.length > 1" class="line" :style="{ left: u(959), top: u(departments.spine.top), width: u(3), height: u(departments.spine.bottom - departments.spine.top) }"></span>
          <template v-for="item in departments.items" :key="item.position.id">
            <span class="line" :style="{ left: u(item.left ? 855 : 960), top: u(item.y + departments.height * 0.55), width: u(105), height: u(3) }"></span>
            <article class="puesto puesto-department" :class="{ 'puesto-blank': !item.position.elected }" :style="{ left: u(item.left ? 180 : 1065), top: u(item.y), width: u(675), height: u(departments.height) }">
              <h2>{{ item.position.label }}</h2><p>{{ item.position.elected?.label }}</p>
            </article>
          </template>
        </div>
      </template>
    </template>
  </div>
</template>

<style scoped>
.slide {
  --navy: #1f2e5c;
  --gold: #a5813e;
  --muted: #5f6673;
  --line: #6b7487;
  position: relative;
  width: calc(var(--u) * 1920);
  height: calc(var(--u) * 1080);
  overflow: hidden;
  background: #fff;
  color: var(--navy);
  font-family: Arial, "Arimo", sans-serif;
  text-align: center;
}
.slide :where(h1, h2, p, ol) { margin: 0; letter-spacing: normal; }
.slide img { position: absolute; display: block; }
.slide-map { left: calc(var(--u) * 210); top: calc(var(--u) * 200); width: calc(var(--u) * 1500); opacity: .16; pointer-events: none; }
.slide-logo { left: calc(var(--u) * 72); top: calc(var(--u) * 56); width: calc(var(--u) * 450); }
.slide-uh { left: calc(var(--u) * 1548); top: calc(var(--u) * 70); width: calc(var(--u) * 300); }

/* P1 cover */
.slide-cover { background: linear-gradient(135deg, #1f3470, #3d5fae); color: #fff; }
.slide-cover .slide-map { left: calc(var(--u) * 420); top: calc(var(--u) * 40); opacity: .16; }
.cover-logo { left: calc(var(--u) * 410); top: calc(var(--u) * 330); width: calc(var(--u) * 1100); }
.cover-title { position: absolute; left: calc(var(--u) * 120); top: calc(var(--u) * 600); width: calc(var(--u) * 1680); color: #fff; font-size: calc(var(--u) * 56); font-weight: 700; letter-spacing: .03em; line-height: 1.15; }
.cover-period { position: absolute; left: calc(var(--u) * 120); top: calc(var(--u) * 690); width: calc(var(--u) * 1680); font-size: calc(var(--u) * 40); line-height: 1.15; }
.cover-rule { position: absolute; left: calc(var(--u) * 780); top: calc(var(--u) * 770); width: calc(var(--u) * 360); height: calc(var(--u) * 3); background: #c7ab76; }
.cover-assembly { position: absolute; left: calc(var(--u) * 120); top: calc(var(--u) * 800); width: calc(var(--u) * 1680); color: #e4e9f5; font-size: calc(var(--u) * 29); line-height: 1.15; }

/* P2, P3, P6: centered under the logos */
.slide-center { position: absolute; inset: calc(var(--u) * 150) calc(var(--u) * 120) calc(var(--u) * 60); display: flex; flex-direction: column; align-items: center; justify-content: center; }
.slide-kicker { color: var(--gold); font-size: calc(var(--u) * 52); font-weight: 700; letter-spacing: .06em; line-height: 1.15; text-transform: uppercase; text-wrap: balance; }
.slide-rule { flex: none; width: calc(var(--u) * 360); height: calc(var(--u) * 3); background: var(--gold); }
.office-name { margin-top: calc(var(--u) * 24) !important; color: var(--navy); font-weight: 700; letter-spacing: -.01em; line-height: 1.12; text-wrap: balance; }
.office-name + .slide-rule { margin-top: calc(var(--u) * 38); }
.office-votes { margin-top: calc(var(--u) * 36) !important; color: var(--muted); font-size: calc(var(--u) * 40); line-height: 1.15; }
.office-label { margin-top: calc(var(--u) * 34) !important; color: var(--muted); font-size: calc(var(--u) * 28); font-weight: 700; letter-spacing: .06em; }

.decision-kicker { font-size: calc(var(--u) * 44); }
.decision-title { margin-top: calc(var(--u) * 22) !important; color: var(--navy); font-size: calc(var(--u) * 112); font-weight: 700; line-height: 1.12; text-wrap: balance; }
.decision-pill { margin-top: calc(var(--u) * 44) !important; padding: calc(var(--u) * 12) calc(var(--u) * 56); border-radius: 999px; color: #fff; font-size: calc(var(--u) * 60); font-weight: 700; letter-spacing: .04em; line-height: 1.25; text-transform: uppercase; }
.decision-approved { background: #1f7a4d; }
.decision-rejected { background: #a33a2f; }
.decision-details { margin-top: calc(var(--u) * 48) !important; color: var(--muted); font-size: calc(var(--u) * 38); line-height: 1.3; text-wrap: balance; }

.committee-kicker { font-size: calc(var(--u) * 52); }
.committee .slide-rule { margin-top: calc(var(--u) * 20); }
.committee-rows {
  display: grid;
  width: calc(var(--u) * (1000 + (var(--cols) - 1) * 680));
  grid-template-columns: repeat(var(--cols), minmax(0, 1fr));
  grid-template-rows: repeat(var(--rows), auto);
  grid-auto-flow: column;
  gap: calc(var(--u) * 22 * var(--k)) calc(var(--u) * 40);
  margin-top: calc(var(--u) * 66 * var(--k)) !important;
  padding: 0;
  list-style: none;
}
.committee-rows li { display: flex; min-width: 0; height: calc(var(--u) * 122 * var(--k)); align-items: center; gap: calc(var(--u) * 36 * var(--k)); padding: 0 calc(var(--u) * 42 * var(--k)); border: calc(var(--u) * 2) solid #8f9aab; border-radius: calc(var(--u) * 12); background: #fff; text-align: left; }
.committee-rank { flex: none; min-width: calc(var(--u) * 32 * var(--k)); color: var(--gold); font-size: calc(var(--u) * 56 * var(--k)); font-weight: 700; }
.committee-name { min-width: 0; flex: 1; overflow: hidden; color: var(--navy); font-size: calc(var(--u) * 64 * var(--k)); font-weight: 700; text-overflow: ellipsis; white-space: nowrap; }
.committee-votes { flex: none; color: var(--muted); font-size: calc(var(--u) * 34 * var(--k)); }
.committee-members { margin-top: calc(var(--u) * 110 * var(--k)) !important; color: var(--muted); font-size: calc(var(--u) * 30); }

/* P4, P5 org chart */
.chart-title { position: absolute; left: calc(var(--u) * 120); top: calc(var(--u) * 150); width: calc(var(--u) * 1680); color: var(--gold); font-size: calc(var(--u) * 46); font-weight: 700; letter-spacing: .06em; line-height: 1.15; }
.chart-rule { position: absolute; left: calc(var(--u) * 780); top: calc(var(--u) * 221); width: calc(var(--u) * 360); height: calc(var(--u) * 3); background: var(--gold); }
.chart { position: absolute; inset: 0; }
.line { position: absolute; background: var(--line); }
.puesto { position: absolute; display: flex; flex-direction: column; overflow: hidden; border: calc(var(--u) * 2) solid #8f9aab; border-radius: calc(var(--u) * 6); background: #fff; color: var(--navy); }
.puesto h2 { display: flex; flex: none; align-items: center; justify-content: center; margin: 0; background: #cfd0cd; color: var(--navy); font-weight: 700; letter-spacing: normal; line-height: 1.1; }
.puesto p { display: flex; min-height: 0; flex: 1; align-items: center; justify-content: center; overflow: hidden; padding: 0 calc(var(--u) * 12); color: var(--navy); line-height: 1.1; text-overflow: ellipsis; white-space: nowrap; }
.puesto-top h2 { height: calc(var(--u) * 58); font-size: calc(var(--u) * 27); }
.puesto-top p { font-size: calc(var(--u) * 32); }
.puesto-bottom h2 { height: calc(var(--u) * 56); font-size: calc(var(--u) * 26); }
.puesto-bottom p { font-size: calc(var(--u) * 30); }
.puesto-department h2 { height: 44%; font-size: calc(var(--u) * 21 * var(--k)); }
.puesto-department p { font-size: calc(var(--u) * 25 * var(--k)); }
</style>
