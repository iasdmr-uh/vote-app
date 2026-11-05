import { computed } from 'vue'
import { SLIDE_NAMES } from './diapositivas'
import type { PresentationSlide } from './types'
import { useAssembly } from './useAssembly'

const { loading, error, state, assemblyId, moderatorToken, request, refresh } = useAssembly()

const presentation = computed(() => state.value?.presentation ?? { active: false, slide: 0 as PresentationSlide })
const slideName = computed(() => SLIDE_NAMES[presentation.value.slide])

/** «Presentar oficiales» (#48): display only, so it applies at once like Inhabilitar, without a confirmation. */
async function setPresentation(active: boolean, slide: PresentationSlide) {
  if (loading.value || !assemblyId.value) return
  error.value = ''
  loading.value = true
  let succeeded = false
  try {
    await request('/moderator/presentation', { method: 'POST', body: JSON.stringify({ assemblyId: assemblyId.value, active, slide }) }, moderatorToken.value)
    if (state.value) state.value = { ...state.value, presentation: { active, slide } }
    succeeded = true
  } catch (e) { error.value = (e as Error).message }
  finally { loading.value = false }
  if (succeeded) await refresh(true)
}

function moveSlide(step: -1 | 1) {
  const slide = Math.min(2, Math.max(0, presentation.value.slide + step)) as PresentationSlide
  if (slide !== presentation.value.slide) void setPresentation(true, slide)
}

export function usePresentacion() {
  return {
    presentation, slideName,
    startPresentation: () => setPresentation(true, 0),
    stopPresentation: () => setPresentation(false, presentation.value.slide),
    previousSlide: () => moveSlide(-1),
    nextSlide: () => moveSlide(1),
  }
}
