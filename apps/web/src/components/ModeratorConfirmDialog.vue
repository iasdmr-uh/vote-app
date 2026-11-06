<script setup lang="ts">
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const { loading } = useAssembly()
const { moderationConfirmation, moderationReason, confirmModeratorAction } = useMesa()
</script>

<template>
  <div v-if="moderationConfirmation" class="confirmation-backdrop" @click.self="moderationConfirmation = null">
    <section class="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="moderation-confirm-title" aria-describedby="moderation-confirm-description">
      <h2 id="moderation-confirm-title">{{ moderationConfirmation.title }}</h2>
      <p id="moderation-confirm-description">{{ moderationConfirmation.consequence }}</p>
      <label v-if="moderationConfirmation.reasonLabel" class="confirmation-reason">{{ moderationConfirmation.reasonLabel }}<textarea v-model="moderationReason" rows="3" maxlength="1000" required :placeholder="moderationConfirmation.reasonPlaceholder"></textarea></label>
      <div class="confirmation-actions">
        <button class="secondary" :disabled="loading" @click="moderationConfirmation = null">Cancelar</button>
        <button :class="moderationConfirmation.path.endsWith('/complete') || moderationConfirmation.path.endsWith('/close') || moderationConfirmation.path.endsWith('/annul') || moderationConfirmation.method === 'DELETE' || moderationConfirmation.path.includes('/participants/') ? 'danger' : 'primary'" :disabled="loading || (!!moderationConfirmation.reasonLabel && !moderationReason.trim()) || (!!moderationConfirmation.typedConfirmation && moderationReason.trim() !== moderationConfirmation.typedConfirmation)" @click="confirmModeratorAction">{{ loading ? 'Guardando…' : moderationConfirmation.label }}</button>
      </div>
    </section>
  </div>
</template>
