<script setup lang="ts">
import { computed, ref } from 'vue'
import { es } from '../locale/es'
import { useAssembly } from '../useAssembly'
import { latestTabId, voteProgress } from '../vote-progress'

const { state } = useAssembly()
const tabs = computed(() => voteProgress(state.value?.rounds ?? []))
const chosenId = ref('')
const latestId = computed(() => latestTabId(state.value?.rounds ?? []))
const selected = computed(() => tabs.value.find((tab) => tab.id === chosenId.value) ?? tabs.value.find((tab) => tab.id === latestId.value))
</script>

<template>
  <section v-if="tabs.length" class="card election-progress">
    <div class="section-heading"><div><p class="eyebrow">{{ es.moderator.progress.eyebrow }}</p><h2>{{ es.moderator.progress.heading }}</h2></div></div>
    <div class="progress-tabs" role="tablist" :aria-label="es.moderator.progress.tabsLabel">
      <button
        v-for="tab in tabs"
        :id="`progress-tab-${tab.id}`"
        :key="tab.id"
        type="button"
        role="tab"
        class="progress-tab"
        :aria-selected="tab.id === selected?.id"
        :aria-controls="`progress-panel-${tab.id}`"
        @click="chosenId = tab.id"
      >{{ tab.title }}</button>
    </div>
    <div v-if="selected" :id="`progress-panel-${selected.id}`" class="progress-columns" role="tabpanel" :aria-labelledby="`progress-tab-${selected.id}`">
      <article v-for="column in selected.columns" :key="column.id" class="progress-column" :class="`progress-${column.state}`">
        <p class="progress-heading eyebrow">{{ column.heading }}</p>
        <p v-if="column.stateText" class="progress-state">{{ column.stateText }}</p>
        <p v-if="column.reason" class="progress-reason">{{ column.reason }}</p>
        <ul v-if="column.state !== 'counted'" class="progress-options">
          <li v-for="option in column.options" :key="option">{{ option }}</li>
        </ul>
        <template v-else>
          <ol class="progress-rows">
            <li v-for="row in column.rows" :key="row.key"><span>{{ row.label }}</span><strong>{{ row.count }}</strong><em v-if="row.tag" class="badge">{{ row.tag }}</em></li>
          </ol>
          <p class="progress-needed">{{ column.needed }}</p>
          <p class="progress-outcome">{{ column.outcome }}</p>
          <p class="progress-next">{{ column.nextStep }}</p>
        </template>
      </article>
    </div>
  </section>
</template>
