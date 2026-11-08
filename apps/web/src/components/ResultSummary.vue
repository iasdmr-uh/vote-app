<script setup lang="ts">
import { computed } from 'vue'
import { es } from '../locale/es'

const props = defineProps<{
  final?: { elected: Array<{ label: string }>; approved: boolean | null } | null
  continuing?: Array<{ label: string }>
  soFar?: { title: string; names: string } | null
  showOption?: boolean
}>()

const summary = computed(() => {
  if (props.final) {
    const detail = props.final.approved === null
      ? { label: es.results.elected, names: props.final.elected.map((person) => person.label).join(' · ') }
      : props.showOption && props.final.approved && props.final.elected.length
        ? { label: es.results.approved, names: props.final.elected.map((option) => option.label).join(' · ') }
        : { label: '', names: props.final.approved ? es.results.approved : es.results.notApproved }
    return { title: es.results.final, ...detail }
  }
  if (props.continuing?.length) return { title: es.results.continuing, label: '', names: props.continuing.map((person) => person.label).join(' · ') }
  return null
})
</script>

<template>
  <div v-if="soFar || summary" class="result-summaries">
    <div v-if="soFar" class="result-summary result-so-far">
      <p class="eyebrow">{{ soFar.title }}</p>
      <strong>{{ soFar.names }}</strong>
    </div>
    <div v-if="summary" class="result-summary">
      <p class="eyebrow">{{ summary.title }}</p>
      <p v-if="summary.label" class="result-summary-label">{{ summary.label }}</p>
      <strong>{{ summary.names }}</strong>
    </div>
  </div>
</template>

<style scoped>
.result-summary { display: grid; gap: .3rem; margin: 0 0 1rem; padding: 1rem 1.1rem; border-radius: .75rem; border: 2px solid var(--blue-dark); }
.result-summary .eyebrow { margin: 0; }
.result-summary strong { font-size: 1.3rem; overflow-wrap: anywhere; }
.result-summary-label { margin: 0; font-size: .9rem; }
</style>
