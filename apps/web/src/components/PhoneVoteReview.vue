<script setup lang="ts">
import { onMounted, nextTick, ref } from 'vue'
import type { PublicState } from '../types'
import { useAssembly } from '../useAssembly'

defineProps<{
  round: NonNullable<PublicState['currentRound']>
  reviewedOptions: Array<{ id: string; label: string }>
}>()

const emit = defineEmits<{ confirm: [] }>()

const { loading, voteSubmitting, reviewingVote } = useAssembly()

const reviewHeading = ref<HTMLElement | null>(null)

onMounted(() => {
  void nextTick(() => reviewHeading.value?.focus())
})
</script>

<template>
  <section class="vote-review" aria-labelledby="vote-review-title">
    <h2 id="vote-review-title" ref="reviewHeading" tabindex="-1">Confirma tu voto</h2>
    <dl class="review-details">
      <div><dt>{{ round.title }}</dt><dd>{{ reviewedOptions.map((option) => option.label).join(', ') }}</dd></div>
    </dl>
  </section>
  <div class="review-actions phone-action">
    <button class="secondary" :disabled="loading" @click="reviewingVote = false">Volver</button>
    <button class="primary" :disabled="loading || !reviewedOptions.length" @click="emit('confirm')">{{ voteSubmitting ? 'Enviando…' : 'Confirmar voto' }}</button>
  </div>
</template>
