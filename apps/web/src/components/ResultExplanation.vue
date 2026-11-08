<script setup lang="ts">
import { computed, ref, useId } from 'vue'
import { es } from '../locale/es'
import { explanationText } from '../resultados'
import type { RoundRecord } from '../types'

const props = defineProps<{ target: RoundRecord }>()

const open = ref(false)
const id = useId()
const text = computed(() => explanationText(props.target, props.target.outcome, props.target.explanation, props.target.results))
</script>

<template>
  <div v-if="text" class="result-explanation">
    <button type="button" class="link-button" :aria-expanded="open" :aria-controls="id" @click="open = !open">{{ es.results.howDecided }}</button>
    <p v-show="open" :id="id" class="result-explanation-text">{{ text }}</p>
  </div>
</template>

<style scoped>
.result-explanation { margin-top: .5rem; }
.result-explanation-text { margin: .35rem 0 0; color: var(--muted); font-size: .85rem; line-height: 1.45; }
</style>
