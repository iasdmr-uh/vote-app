<script setup lang="ts">
import { es } from '../locale/es'
import { ApiRequestError, useAssembly } from '../useAssembly'

const {
  loading, error, notice, state, code, firstName, lastName, sessionToken, sessionAssemblyId, pendingJoinCode,
  request, handleParticipantUnauthorized, normalizeState, refresh,
} = useAssembly()

async function join() {
  error.value = ''
  loading.value = true
  try {
    const joined = await request<Record<string, any>>(`/assemblies/${encodeURIComponent(code.value)}/join`, {
      method: 'POST', body: JSON.stringify({ firstName: firstName.value.trim(), lastName: lastName.value.trim() }),
    })
    sessionToken.value = joined.participantSessionToken
    sessionAssemblyId.value = String(joined.assembly?.id || '')
    localStorage.setItem('participantSessionToken', joined.participantSessionToken)
    if (sessionAssemblyId.value) localStorage.setItem('participantAssemblyId', sessionAssemblyId.value)
    pendingJoinCode.value = ''
    state.value = normalizeState(joined)
    notice.value = ''
    await refresh()
  } catch (e) {
    if (!handleParticipantUnauthorized(e, sessionToken.value)) {
      error.value = e instanceof ApiRequestError && e.status === 404
        ? es.phone.codeNotFound
        : (e as Error).message
    }
  }
  finally { loading.value = false }
}
</script>

<template>
  <section class="card join-card phone-screen">
    <h1>{{ es.phone.welcome }}</h1>
    <form class="phone-form" @submit.prevent="join">
      <label>{{ es.common.roomCode }}<input v-model="code" autocomplete="off" required /></label>
      <label>{{ es.phone.firstName }}<input v-model="firstName" autocomplete="given-name" required maxlength="80" :placeholder="es.phone.firstNamePlaceholder" /></label>
      <label>{{ es.phone.lastName }}<input v-model="lastName" autocomplete="family-name" required maxlength="100" :placeholder="es.phone.lastNamePlaceholder" /></label>
      <button class="primary phone-action" :disabled="loading">{{ loading ? es.phone.joining : es.phone.joinRoom }}</button>
    </form>
  </section>
</template>
