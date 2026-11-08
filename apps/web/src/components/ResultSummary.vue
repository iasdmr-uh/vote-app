<script setup lang="ts">
import { computed } from 'vue'
import { RESULT_WORDING } from '../resultados'

const props = defineProps<{
  final?: { elected: Array<{ label: string }>; approved: boolean | null } | null
  continuing?: Array<{ label: string }>
}>()

const summary = computed(() => {
  if (props.final) {
    const detail = props.final.approved === null
      ? { label: RESULT_WORDING.elected, names: props.final.elected.map((person) => person.label).join(' · ') }
      : { label: '', names: props.final.approved ? RESULT_WORDING.approved : RESULT_WORDING.notApproved }
    return { title: RESULT_WORDING.final, ...detail }
  }
  if (props.continuing?.length) return { title: RESULT_WORDING.continuing, label: '', names: props.continuing.map((person) => person.label).join(' · ') }
  return null
})
</script>

<template>
  <div v-if="summary" class="result-summary">
    <p class="eyebrow">{{ summary.title }}</p>
    <p v-if="summary.label" class="result-summary-label">{{ summary.label }}</p>
    <strong>{{ summary.names }}</strong>
  </div>
</template>

<style scoped>
.result-summary { display: grid; gap: .3rem; margin: 0 0 1rem; padding: 1rem 1.1rem; border-radius: .75rem; border: 2px solid var(--blue-dark); }
.result-summary .eyebrow { margin: 0; }
.result-summary strong { font-size: 1.3rem; overflow-wrap: anywhere; }
.result-summary-label { margin: 0; font-size: .9rem; }
</style>
