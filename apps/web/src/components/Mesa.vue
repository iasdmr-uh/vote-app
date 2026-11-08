<script setup lang="ts">
import { es } from '../locale/es'
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
  secrecyCleanupPendingRounds, voteOpen, moderatorWorkflow, currentRoundRecord, moderatorWorkflowStep, otherPendingActas,
  repeatAllOptions, openCompletedAssembly, openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa,
  downloadActaSpreadsheet, downloadOperatorLog, deleteAssemblyData, createAssembly, signInModerator,
} = useMesa()
</script>

<template>
  <ModeratorConfirmDialog />
  <section v-if="moderatorAuthState === 'validating'" class="card join-card" aria-live="polite">
    <h1>{{ es.moderator.verifyingAccess }}</h1>
  </section>
  <section v-else-if="moderatorAuthState === 'validation_error'" class="validation-state">
    <header class="validation-heading"><h1>{{ es.moderator.validationErrorHeading }}</h1></header>
    <section class="card join-card validation-card">
      <h2>{{ es.moderator.validationFailed }}</h2>
      <button class="primary" :disabled="syncing" @click="refresh()">{{ syncing ? es.moderator.retrying : es.moderator.retryValidation }}</button>
    </section>
  </section>
  <section v-else-if="moderatorAuthState !== 'authenticated'" class="card join-card">
    <h1>{{ es.moderator.title }}</h1>
    <form @submit.prevent="signInModerator"><label>{{ es.moderator.credentialLabel }}<input v-model="moderatorCredential" type="password" autocomplete="current-password" required /></label><button class="primary">{{ es.moderator.continue }}</button></form>
  </section>
  <template v-else-if="moderatorAuthState === 'authenticated'">
    <section v-if="!assemblyId && completedAssemblies.length" class="card after-assembly"><h2>{{ es.moderator.completedWithData }}</h2><ul class="participant-list"><li v-for="item in completedAssemblies" :key="item.id"><span>{{ item.name }}<template v-if="item.completedAt"> · {{ formatDateTime(item.completedAt) }}</template></span><button class="secondary" @click="openCompletedAssembly(item.id)">{{ es.moderator.openActaAndDelete }}</button></li></ul></section>
    <section v-if="!assemblyId && liveAssembly" class="card"><p class="eyebrow">{{ es.moderator.activeAssemblyEyebrow }}</p><h2>{{ liveAssembly.name }}</h2><button class="primary" @click="openLiveAssembly">{{ es.moderator.backToActive }}</button></section>
    <section v-else-if="!assemblyId" class="card"><h2>{{ es.moderator.createAssembly }}</h2><form @submit.prevent="createAssembly"><div class="assembly-fields"><label>{{ es.moderator.name }}<input v-model="assemblyName" required /></label><label>{{ es.moderator.period }}<input v-model="assemblyPeriod" maxlength="60" :placeholder="es.moderator.periodPlaceholder" /></label></div><button class="primary" :disabled="loading">{{ es.moderator.createAssembly }}</button></form></section>
    <template v-else>
      <ModeratorPresentationBar />
      <ol class="workflow-steps" :aria-label="es.moderator.workflowLabel">
        <li v-for="(step, index) in moderatorWorkflow" :key="step" :class="{ complete: index < moderatorWorkflowStep, current: index === moderatorWorkflowStep && assemblyStatus !== 'completed' }" :aria-current="index === moderatorWorkflowStep && assemblyStatus !== 'completed' ? 'step' : undefined">
          <span class="workflow-step-number">{{ index < moderatorWorkflowStep ? '✓' : index + 1 }}</span><span>{{ step }}</span>
        </li>
      </ol>
      <p v-if="otherPendingActas.length" class="status-line pending-actas">{{ es.moderator.pendingActas(otherPendingActas.length) }} <button class="link-button" @click="showPendingActas">{{ es.moderator.viewPendingActas }}</button></p>
      <section v-if="secrecyCleanupPendingRounds.length" class="notice error" role="alert">
        <strong>{{ es.moderator.secrecyPending }}</strong> ({{ secrecyCleanupPendingRounds.map((item) => item.title).join(', ') }}).
        <button v-if="!voteOpen" class="secondary" :disabled="loading" @click="retrySecrecyCleanup">{{ es.moderator.retryCleanup }}</button>
      </section>
      <section v-if="assemblyStatus === 'completed'" class="status-panel assembly-completed" role="status"><span class="status-dot"></span><div><strong>{{ es.common.assemblyEnded }}</strong><p v-if="completionTime">{{ completionTime }}</p></div></section>
      <section v-if="assemblyStatus === 'completed'" class="card after-assembly"><p class="eyebrow">{{ es.moderator.afterAssemblyEyebrow }}</p><h2>{{ es.moderator.actaAndDeletion }}</h2>
        <ol class="after-steps"><li v-for="step in es.moderator.afterSteps" :key="step">{{ step }}</li></ol>
        <div class="action-row"><button class="primary" @click="printActa">{{ es.moderator.printOrSavePdf }}</button><button class="secondary" @click="downloadActaSpreadsheet">{{ es.moderator.downloadSpreadsheet }}</button><button class="secondary" :disabled="loading" @click="downloadOperatorLog()">{{ es.moderator.downloadLog }}</button><button class="danger" :disabled="loading" @click="deleteAssemblyData">{{ es.moderator.deleteData }}</button></div>
        <p class="status-line"><button class="link-button" @click="showPendingActas">{{ es.moderator.closeActaKeep }}</button></p>
      </section>
      <div v-else class="mesa-layout">
        <div class="mesa-main">
          <section class="card ballot-card">
            <ModeratorPreparedBallot v-if="preparedRunoff || round?.status === 'draft'" :prepared-runoff="preparedRunoff" :round="round" />
            <ModeratorPublishedBallot v-else-if="round?.status === 'published' && !showNextBallotForm && currentRoundRecord" :round="round" :current-round-record="currentRoundRecord" />
            <ModeratorVotingBallot v-else-if="round?.status === 'open' || (round?.status === 'closed' && !showNextBallotForm)" :round="round" :current-round-record="currentRoundRecord" />
            <div v-if="round?.status === 'annulled'" class="annulled-summary"><p class="eyebrow">{{ es.moderator.annulledEyebrow }}</p><h2 class="ballot-title">{{ round.title }}</h2><div class="action-row"><p v-if="round.annulReason" class="status-line">{{ round.annulReason }}</p><button class="secondary push-right" :disabled="loading" @click="repeatAllOptions(state?.rounds?.find((item) => item.id === round?.id))">{{ es.moderator.repeatSameOptions }}</button></div></div>
            <ModeratorNewBallotForm v-if="!round || round.status === 'annulled' || (['published', 'closed'].includes(round.status) && showNextBallotForm)" :round="round" />
          </section>
          <section v-if="assemblyStatus !== 'preparing'" class="card assembly-close"><div class="action-row"><h2>{{ es.moderator.finishAssembly }}</h2><button class="danger push-right" :disabled="loading || round?.status === 'open'" @click="completeAssembly">{{ es.moderator.finishAssemblyButton }}</button></div></section>
        </div>
        <ModeratorParticipants />
      </div>
      <ModeratorVoteProgress />
      <ModeratorResultsRecord />
    </template>
  </template>
  <ActaImpresa v-if="printingActa && moderatorAuthState === 'authenticated' && state?.rounds" :state="state" />
</template>
