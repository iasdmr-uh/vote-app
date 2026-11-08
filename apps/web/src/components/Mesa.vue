<script setup lang="ts">
import ActaImpresa from './ActaImpresa.vue'
import ModeratorConfirmDialog from './ModeratorConfirmDialog.vue'
import ModeratorNewBallotForm from './ModeratorNewBallotForm.vue'
import ModeratorParticipants from './ModeratorParticipants.vue'
import ModeratorPreparedBallot from './ModeratorPreparedBallot.vue'
import ModeratorPresentationBar from './ModeratorPresentationBar.vue'
import ModeratorPublishedBallot from './ModeratorPublishedBallot.vue'
import ModeratorResultsRecord from './ModeratorResultsRecord.vue'
import ModeratorVoteProgress from './ModeratorVoteProgress.vue'
import ModeratorVotingBallot from './ModeratorVotingBallot.vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const {
  loading, syncing, state, moderatorAuthState, assemblyId, printingActa, completedAssemblies, liveAssembly,
  assemblyStatus, round, completionTime, refresh, formatDateTime,
} = useAssembly()
const {
  moderatorCredential, assemblyName, assemblyPeriod, showNextBallotForm, preparedRunoff,
  secrecyCleanupPendingRounds, moderatorWorkflow, currentRoundRecord, moderatorWorkflowStep, otherPendingActas,
  repeatAllOptions, openCompletedAssembly, openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa,
  downloadActaSpreadsheet, downloadOperatorLog, deleteAssemblyData, createAssembly, signInModerator,
} = useMesa()
</script>

<template>
  <ModeratorConfirmDialog />
  <section v-if="moderatorAuthState === 'validating'" class="card join-card" aria-live="polite">
    <h1>Verificando acceso</h1>
  </section>
  <section v-else-if="moderatorAuthState === 'validation_error'" class="validation-state">
    <header class="validation-heading"><h1>Error de validación</h1></header>
    <section class="card join-card validation-card">
      <h2>No se pudo validar el acceso</h2>
      <button class="primary" :disabled="syncing" @click="refresh()">{{ syncing ? 'Reintentando…' : 'Reintentar validación' }}</button>
    </section>
  </section>
  <section v-else-if="moderatorAuthState !== 'authenticated'" class="card join-card">
    <h1>Moderación</h1>
    <form @submit.prevent="signInModerator"><label>Credencial de moderación<input v-model="moderatorCredential" type="password" autocomplete="current-password" required /></label><button class="primary">Continuar</button></form>
  </section>
  <template v-else-if="moderatorAuthState === 'authenticated'">
    <section v-if="!assemblyId && completedAssemblies.length" class="card after-assembly"><h2>Asambleas finalizadas con datos guardados</h2><ul class="participant-list"><li v-for="item in completedAssemblies" :key="item.id"><span>{{ item.name }}<template v-if="item.completedAt"> · {{ formatDateTime(item.completedAt) }}</template></span><button class="secondary" @click="openCompletedAssembly(item.id)">Abrir acta y borrado</button></li></ul></section>
    <section v-if="!assemblyId && liveAssembly" class="card"><p class="eyebrow">ASAMBLEA ACTIVA</p><h2>{{ liveAssembly.name }}</h2><button class="primary" @click="openLiveAssembly">Volver a la Asamblea activa</button></section>
    <section v-else-if="!assemblyId" class="card"><h2>Crear Asamblea</h2><form @submit.prevent="createAssembly"><div class="assembly-fields"><label>Nombre<input v-model="assemblyName" required /></label><label>Periodo<input v-model="assemblyPeriod" maxlength="60" placeholder="2027–2029" /></label></div><button class="primary" :disabled="loading">Crear Asamblea</button></form></section>
    <template v-else>
      <ModeratorPresentationBar />
      <ol class="workflow-steps" aria-label="Pasos de la mesa">
        <li v-for="(step, index) in moderatorWorkflow" :key="step" :class="{ complete: index < moderatorWorkflowStep, current: index === moderatorWorkflowStep && assemblyStatus !== 'completed' }" :aria-current="index === moderatorWorkflowStep && assemblyStatus !== 'completed' ? 'step' : undefined">
          <span class="workflow-step-number">{{ index < moderatorWorkflowStep ? '✓' : index + 1 }}</span><span>{{ step }}</span>
        </li>
      </ol>
      <p v-if="otherPendingActas.length" class="status-line pending-actas">{{ otherPendingActas.length === 1 ? '1 Asamblea finalizada' : `${otherPendingActas.length} Asambleas finalizadas` }} con datos guardados. <button class="link-button" @click="showPendingActas">Ver actas pendientes</button></p>
      <section v-if="secrecyCleanupPendingRounds.length" class="notice error" role="alert">
        <strong>Limpieza del secreto del voto pendiente</strong> ({{ secrecyCleanupPendingRounds.map((item) => item.title).join(', ') }}).
        <button class="secondary" :disabled="loading" @click="retrySecrecyCleanup">Reintentar limpieza</button>
      </section>
      <section v-if="assemblyStatus === 'completed'" class="status-panel assembly-completed" role="status"><span class="status-dot"></span><div><strong>Asamblea finalizada</strong><p v-if="completionTime">{{ completionTime }}</p></div></section>
      <section v-if="assemblyStatus === 'completed'" class="card after-assembly"><p class="eyebrow">DESPUÉS DE LA ASAMBLEA</p><h2>Acta y borrado de datos</h2>
        <ol class="after-steps"><li>Imprime o guarda el acta.</li><li>Entrégala a Secretaría.</li><li>Borra los datos de esta laptop.</li></ol>
        <div class="action-row"><button class="primary" @click="printActa">Imprimir o guardar PDF</button><button class="secondary" @click="downloadActaSpreadsheet">Descargar hoja de cálculo</button><button class="secondary" :disabled="loading" @click="downloadOperatorLog()">Descargar registro</button><button class="danger" :disabled="loading" @click="deleteAssemblyData">Borrar datos de la Asamblea</button></div>
        <p class="status-line"><button class="link-button" @click="showPendingActas">Cerrar el acta sin borrar</button></p>
      </section>
      <div v-else class="mesa-layout">
        <div class="mesa-main">
          <section class="card ballot-card">
            <ModeratorPreparedBallot v-if="preparedRunoff || round?.status === 'draft'" :prepared-runoff="preparedRunoff" :round="round" />
            <ModeratorPublishedBallot v-else-if="round?.status === 'published' && !showNextBallotForm && currentRoundRecord" :round="round" :current-round-record="currentRoundRecord" />
            <ModeratorVotingBallot v-else-if="round?.status === 'open' || (round?.status === 'closed' && !showNextBallotForm)" :round="round" :current-round-record="currentRoundRecord" />
            <div v-if="round?.status === 'annulled'" class="annulled-summary"><p class="eyebrow">PAPELETA ANULADA</p><h2 class="ballot-title">{{ round.title }}</h2><div class="action-row"><p v-if="round.annulReason" class="status-line">{{ round.annulReason }}</p><button class="secondary push-right" :disabled="loading" @click="repeatAllOptions(state?.rounds?.find((item) => item.id === round?.id))">Repetir con las mismas opciones</button></div></div>
            <ModeratorNewBallotForm v-if="!round || round.status === 'annulled' || (['published', 'closed'].includes(round.status) && showNextBallotForm)" :round="round" />
          </section>
          <section v-if="assemblyStatus !== 'preparing'" class="card assembly-close"><div class="action-row"><h2>Finalizar Asamblea</h2><button class="danger push-right" :disabled="loading || round?.status === 'open'" @click="completeAssembly">Finalizar Asamblea…</button></div></section>
        </div>
        <ModeratorParticipants />
      </div>
      <ModeratorVoteProgress />
      <ModeratorResultsRecord />
    </template>
  </template>
  <ActaImpresa v-if="printingActa && moderatorAuthState === 'authenticated' && state?.rounds" :state="state" />
</template>
