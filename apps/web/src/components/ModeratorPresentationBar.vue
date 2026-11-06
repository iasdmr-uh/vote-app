<script setup lang="ts">
import { useAssembly } from '../useAssembly'
import { usePresentacion } from '../usePresentacion'

const { loading } = useAssembly()
const { presentation, slideName, startPresentation, stopPresentation, previousSlide, nextSlide } = usePresentacion()
</script>

<template>
      <section class="presentation-bar" :class="{ presenting: presentation.active }" aria-label="Presentar oficiales">
        <button v-if="!presentation.active" class="secondary" :disabled="loading" @click="startPresentation">Presentar oficiales</button>
        <template v-else>
          <span class="badge badge-info">PRESENTANDO</span>
          <button class="secondary presentation-arrow" aria-label="Diapositiva anterior" :disabled="loading || presentation.slide === 0" @click="previousSlide">←</button>
          <strong class="presentation-slide" aria-live="polite">{{ slideName }} · {{ presentation.slide + 1 }}/3</strong>
          <button class="secondary presentation-arrow" aria-label="Diapositiva siguiente" :disabled="loading || presentation.slide === 2" @click="nextSlide">→</button>
          <button class="link-button push-right" :disabled="loading" @click="stopPresentation">Terminar presentación</button>
        </template>
      </section>
</template>

<style scoped>
.presentation-bar { display: flex; flex-wrap: wrap; align-items: center; justify-content: flex-end; gap: .6rem; margin-bottom: 1rem; }
.presentation-bar.presenting { justify-content: flex-start; padding: .55rem .75rem; border: 1px solid #c7d3e7; border-radius: .75rem; background: #fff; }
.presentation-arrow { min-width: 46px; font-size: 1.15rem; }
.presentation-slide { color: var(--blue-dark); text-align: center; }
@media (min-width: 720px) { .presentation-slide { min-width: 12rem; } }
</style>
