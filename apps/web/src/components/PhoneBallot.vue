<script setup lang="ts">
import { es } from '../locale/es'
import { voteLabel } from '../resultados'
import { useAssembly } from '../useAssembly'
import type { PublicState } from '../types'

const props = defineProps<{
  round: NonNullable<PublicState['currentRound']>
  seatsToFill: number | null
  selectionComplete: boolean
}>()

const emit = defineEmits<{ review: [] }>()

const { loading, error, selectedOptions, voteSubmitting, round: currentRound } = useAssembly()

function toggleBallotOption(optionId: string, input: HTMLInputElement) {
  const checked = input.checked
  if (currentRound.value?.format !== 'multiple_choice') {
    selectedOptions.value = checked ? [optionId] : []
    return
  }
  if (checked) {
    if (props.seatsToFill && selectedOptions.value.length >= props.seatsToFill) {
      input.checked = false
      return
    }
    selectedOptions.value = [...selectedOptions.value, optionId]
  } else selectedOptions.value = selectedOptions.value.filter((id) => id !== optionId)
  error.value = ''
}
</script>

<template>
  <p class="phone-status phone-status-open"><span class="status-dot" aria-hidden="true"></span>{{ round.runoff ? voteLabel(round) : es.phone.voteOpen }}</p>
  <div v-if="seatsToFill" class="phone-ballot-heading"><h1>{{ round.title }}</h1><span class="count-pill">{{ es.phone.selectedOfSeats(selectedOptions.length, seatsToFill) }}</span></div>
  <h1 v-else>{{ round.title }}</h1>
  <fieldset class="options" :aria-label="seatsToFill ? es.phone.selectedOfSeats(selectedOptions.length, seatsToFill) : undefined">
    <label v-for="option in round.options" :key="option.id" class="option"><input :type="round.format === 'multiple_choice' ? 'checkbox' : 'radio'" name="option" :value="option.id" :checked="selectedOptions.includes(option.id)" @change="toggleBallotOption(option.id, $event.target as HTMLInputElement)" /><span>{{ option.label }}</span></label>
  </fieldset>
  <button class="primary phone-action phone-ballot-submit" :disabled="loading || voteSubmitting || !selectionComplete" @click="emit('review')">{{ es.phone.reviewVote }}</button>
</template>
