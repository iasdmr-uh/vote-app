<script setup lang="ts">
import { approvalText, countsOf, decisionVerdict, electedText, isDecision, majorityText, outcomeTag, rankedResults, turnoutOf, votedText, voteLabel, winnerText } from '../resultados'
import type { RoundRecord } from '../types'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const {
  origin, loading, syncing, state, code, moderatorAuthState, assemblyId, qrImage, printingActa, completedAssemblies, liveAssembly,
  assemblyStatus, lobbyStatus, round, eligibleVotes, completionTime, ballotMaxChoices, participantLeft, participantLeftId, refresh, formatDateTime,
} = useAssembly()
const {
  moderationConfirmation, moderationReason, moderatorCredential, assemblyName, roundTitle, roundCategory, committeeMemberCount, decisionFormat, approvalRule,
  showNextBallotForm, resumeQr, ballotCandidates, newBallotCandidate, preparedRunoff, newRunoffCandidate,
  secrecyCleanupPendingRounds, roundStatusLabels, attendance, moderatorWorkflow, currentRoundRecord,
  moderatorWorkflowStep, otherPendingActas,
  roundChain, voteNumber, rootRoundOf, eligibleOf, rankedRows, runoffOf,
  annulRound, repeatAllOptions, openRunoff, addBallotCandidate, addRunoffCandidate, removeRunoffCandidate,
  removeBallotCandidate, chooseRoundCategory, moderatorAction, confirmModeratorAction, rotateJoinCode, issueResumeCode, setVotingDisabled, openCompletedAssembly,
  openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa, downloadActaSpreadsheet, deleteAssemblyData,
  createAssembly, editParticipant, createRound, signInModerator,
} = useMesa()

function runoffButtonText(target: NonNullable<typeof currentRoundRecord.value>) {
  const runoff = runoffOf(target)
  if (!runoff) return ''
  const seats = runoff.electionSeats ?? 1
  return runoff.category === 'committee' ? `Abrir desempate · ${seats} ${seats === 1 ? 'puesto' : 'puestos'}` : 'Abrir desempate'
}

/** Aprobada / No aprobada, or the winning option, of a decision's computed result. */
function verdictOf(target: RoundRecord) {
  return decisionVerdict(target, target.outcome, countsOf(target))
}

/** "Cargo", "Comisión · 3 integrantes" or "Decisión · Se aprueba con 3/4 · 29 votos" in the acta. */
function categoryText(target: RoundRecord) {
  if (isDecision(target)) return ['Decisión', approvalText(target, target.outcome)].filter(Boolean).join(' · ')
  return target.category === 'committee' ? `Comisión · ${target.memberCount} ${target.memberCount === 1 ? 'integrante' : 'integrantes'}` : 'Cargo'
}

function closePersonMenu(event: Event) {
  (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}
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
    <section v-else-if="!assemblyId" class="card"><h2>Crear Asamblea</h2><form @submit.prevent="createAssembly"><label>Nombre<input v-model="assemblyName" required /></label><button class="primary" :disabled="loading">Crear Asamblea</button></form></section>
    <template v-else>
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
        <div class="action-row"><button class="primary" @click="printActa">Imprimir o guardar PDF</button><button class="secondary" @click="downloadActaSpreadsheet">Descargar hoja de cálculo</button><button class="danger" :disabled="loading" @click="deleteAssemblyData">Borrar datos de la Asamblea</button></div>
        <p class="status-line"><button class="link-button" @click="showPendingActas">Cerrar el acta sin borrar</button></p>
      </section>
      <div v-else class="mesa-layout">
        <div class="mesa-main">
          <section class="card ballot-card">
            <template v-if="preparedRunoff">
              <p class="eyebrow">{{ voteLabel(preparedRunoff) }}</p>
              <h2 class="ballot-title">{{ rootRoundOf(preparedRunoff)?.title || preparedRunoff.title }}</h2>
              <ol class="ranked-rows runoff-candidates">
                <li v-for="(option, index) in preparedRunoff.options" :key="option.id" :class="{ first: index === 0 }"><span class="rank-number">{{ index + 1 }}</span><span class="ranked-label">{{ option.label }}<span v-if="option.isNew" class="badge badge-info">Nuevo</span></span><button v-if="option.isNew" type="button" class="link-button" :aria-label="`Quitar ${option.label}`" :disabled="loading" @click="removeRunoffCandidate(option.id)">Quitar</button></li>
              </ol>
              <form class="new-candidate" @submit.prevent="addRunoffCandidate"><input v-model="newRunoffCandidate" aria-label="Nombre del candidato" maxlength="160" placeholder="Nombre del candidato" /><button class="link-button" :disabled="loading || !newRunoffCandidate.trim()">+ Agregar</button></form>
              <div class="action-row ballot-actions"><button class="primary push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(preparedRunoff.id)}/open`)">Abrir votación</button></div>
            </template>
            <template v-else-if="round?.status === 'draft'">
              <div class="eyebrow-row"><p class="eyebrow">PAPELETA PREPARADA</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div>
              <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
              <ul class="ballot-options"><li v-for="option in round.options || []" :key="option.id">{{ option.label }}</li></ul>
              <p v-if="round.category === 'committee' && ballotMaxChoices" class="status-line">Hasta {{ ballotMaxChoices }} por persona</p>
              <div class="action-row"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">{{ currentRoundRecord && voteNumber(currentRoundRecord) > 1 ? 'Cancelar esta votación' : 'Anular papeleta' }}</button><button class="primary push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/open`)">Abrir votación</button></div>
              <template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1">
                <h3 class="list-heading eyebrow">HISTORIAL DE ESTA ELECCIÓN</h3>
                <ul class="history-rows"><li v-for="item in roundChain(rootRoundOf(currentRoundRecord) || currentRoundRecord)" :key="item.id"><div><strong>{{ voteNumber(item) }}.ª votación</strong><span v-if="countsOf(item).length" class="muted"> · {{ countsOf(item).slice(0, 3).map((result) => `${result.label} ${result.count}`).join(' · ') }}</span><span v-else-if="item.annulReason" class="muted"> · {{ item.annulReason }}</span></div><span :class="['badge', item.status === 'published' ? 'badge-success' : item.status === 'annulled' ? 'badge-danger' : 'badge-info']">{{ (roundStatusLabels[item.status] || item.status).toUpperCase() }}</span></li></ul>
              </template>
            </template>
            <template v-else-if="round?.status === 'published' && !showNextBallotForm && currentRoundRecord">
              <div class="ballot-heading">
                <div><div class="eyebrow-row"><p class="eyebrow">CONTEO PUBLICADO</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2><p v-if="currentRoundRecord && majorityText(currentRoundRecord, currentRoundRecord.outcome)" class="majority-chip">{{ majorityText(currentRoundRecord, currentRoundRecord.outcome) }}</p></div>
                <p class="voters-total"><strong>{{ currentRoundRecord.participationCount ?? state?.recordedCount ?? 0 }} de {{ eligibleOf(currentRoundRecord) }}</strong><span>votaron</span></p>
              </div>
              <p v-if="verdictOf(currentRoundRecord)" :class="['decision-verdict', { rejected: verdictOf(currentRoundRecord) === 'No aprobada' }]">{{ verdictOf(currentRoundRecord) }}</p>
              <ol class="ranked-rows">
                <li v-for="row in rankedRows(countsOf(currentRoundRecord), eligibleOf(currentRoundRecord))" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="outcomeTag(currentRoundRecord.outcome, row.key) === 'elected'" class="badge badge-success">{{ winnerText(currentRoundRecord, row.label) }}</span><span v-else-if="outcomeTag(currentRoundRecord.outcome, row.key) === 'runoff'" class="badge badge-warning">Desempate</span><span v-else-if="!currentRoundRecord.outcome && row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span><span class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span></li>
              </ol>
              <div class="action-row ballot-actions">
                <button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button>
                <button v-if="runoffOf(currentRoundRecord)" class="primary push-right" :disabled="loading" @click="openRunoff(currentRoundRecord)">{{ runoffButtonText(currentRoundRecord) }}</button>
              </div>
            </template>
            <template v-else-if="round?.status === 'open' || (round?.status === 'closed' && !showNextBallotForm)">
              <template v-if="round.status === 'open'">
                <div class="eyebrow-row"><p class="status-label status-label-open"><span class="status-dot" aria-hidden="true"></span>VOTACIÓN ABIERTA</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span></div>
                <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
                <p class="vote-progress"><strong>{{ state?.recordedCount ?? 0 }}</strong><span>de {{ eligibleVotes }} ya {{ (state?.recordedCount ?? 0) === 1 ? 'votó' : 'votaron' }}</span></p>
                <span class="vote-progress-bar" aria-hidden="true"><span :style="{ width: `${eligibleVotes ? Math.min(100, Math.round(((state?.recordedCount ?? 0) / eligibleVotes) * 100)) : 0}%` }"></span></span>
                <div class="action-row ballot-actions"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular votación</button><button class="danger push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/close`)">Cerrar votación</button></div>
              </template>
              <template v-else>
                <div class="ballot-heading">
                  <div><div class="eyebrow-row"><p class="eyebrow">VOTACIÓN CERRADA</p><span v-if="voteLabel(currentRoundRecord)" class="badge badge-info">{{ voteLabel(currentRoundRecord) }}</span><span class="badge badge-private">Solo la mesa</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2><p v-if="currentRoundRecord && majorityText(currentRoundRecord, currentRoundRecord.outcome)" class="majority-chip">{{ majorityText(currentRoundRecord, currentRoundRecord.outcome) }}</p></div>
                  <p v-if="currentRoundRecord" class="voters-total"><strong>{{ currentRoundRecord.participationCount ?? state?.recordedCount ?? 0 }} de {{ eligibleOf(currentRoundRecord) }}</strong><span>votaron</span></p>
                </div>
                <p v-if="currentRoundRecord && verdictOf(currentRoundRecord)" :class="['decision-verdict', { rejected: verdictOf(currentRoundRecord) === 'No aprobada' }]">{{ verdictOf(currentRoundRecord) }}</p>
                <ol v-if="currentRoundRecord?.privateResults?.length" class="ranked-rows">
                  <li v-for="row in rankedRows(currentRoundRecord.privateResults, eligibleOf(currentRoundRecord))" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="outcomeTag(currentRoundRecord.outcome, row.key) === 'elected'" class="badge badge-success">{{ winnerText(currentRoundRecord, row.label) }}</span><span v-else-if="outcomeTag(currentRoundRecord.outcome, row.key) === 'runoff'" class="badge badge-warning">Desempate</span><span v-else-if="!currentRoundRecord.outcome && row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span><span class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span></li>
                </ol>
                <div class="action-row ballot-actions"><button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button><div class="button-group"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular papeleta</button><button class="primary" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/publish`)">Publicar conteo</button></div></div>
              </template>
            </template>
            <div v-if="round?.status === 'annulled'" class="annulled-summary"><p class="eyebrow">PAPELETA ANULADA</p><h2 class="ballot-title">{{ round.title }}</h2><div class="action-row"><p v-if="round.annulReason" class="status-line">{{ round.annulReason }}</p><button class="secondary push-right" :disabled="loading" @click="repeatAllOptions(state?.rounds?.find((item) => item.id === round?.id))">Repetir con las mismas opciones</button></div></div>
            <template v-if="!round || round.status === 'annulled' || (['published', 'closed'].includes(round.status) && showNextBallotForm)">
              <div class="eyebrow-row"><p class="eyebrow">NUEVA PAPELETA</p><button v-if="round?.status === 'published' || round?.status === 'closed'" class="link-button" @click="showNextBallotForm = false">Volver al conteo</button></div>
              <form class="ballot-form" @submit.prevent="createRound">
                <div class="field-group"><span class="field-label" id="ballot-kind-label">¿Qué se vota?</span>
                  <div class="segmented" role="radiogroup" aria-labelledby="ballot-kind-label"><button type="button" role="radio" :aria-checked="roundCategory === 'office'" :class="{ active: roundCategory === 'office' }" @click="chooseRoundCategory('office')">Cargo</button><button type="button" role="radio" :aria-checked="roundCategory === 'committee'" :class="{ active: roundCategory === 'committee' }" @click="chooseRoundCategory('committee')">Comisión</button><button type="button" role="radio" :aria-checked="roundCategory === 'decision'" :class="{ active: roundCategory === 'decision' }" @click="chooseRoundCategory('decision')">Decisión</button></div>
                </div>
                <label v-if="roundCategory === 'office'">Nombre del cargo<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Presidencia" /></label>
                <template v-else-if="roundCategory === 'committee'">
                  <label>Nombre de la comisión<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Comisión de Finanzas" /></label>
                  <label>¿Cuántos integrantes quedarán en la comisión?<input v-model.number="committeeMemberCount" class="member-count-input" type="number" min="1" max="40" required /></label>
                </template>
                <template v-else>
                  <label>Decisión<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Presupuesto 2027" /></label>
                  <div class="field-group"><span class="field-label" id="decision-format-label">Papeleta</span>
                    <div class="segmented" role="radiogroup" aria-labelledby="decision-format-label"><button type="button" role="radio" :aria-checked="decisionFormat === 'boolean'" :class="{ active: decisionFormat === 'boolean' }" @click="decisionFormat = 'boolean'">A favor / En contra</button><button type="button" role="radio" :aria-checked="decisionFormat === 'options'" :class="{ active: decisionFormat === 'options' }" @click="decisionFormat = 'options'">Opciones</button></div>
                  </div>
                  <div class="field-group"><span class="field-label" id="approval-rule-label">Se aprueba con</span>
                    <div class="segmented" role="radiogroup" aria-labelledby="approval-rule-label"><button type="button" role="radio" :aria-checked="approvalRule === 'simple'" :class="{ active: approvalRule === 'simple' }" @click="approvalRule = 'simple'">Mayoría simple</button><button type="button" role="radio" :aria-checked="approvalRule === 'three_quarters'" :class="{ active: approvalRule === 'three_quarters' }" @click="approvalRule = 'three_quarters'">3/4</button></div>
                  </div>
                </template>
                <div v-if="roundCategory !== 'decision' || decisionFormat === 'options'" class="field-group"><span class="field-label">{{ roundCategory === 'decision' ? 'Opciones' : 'Candidatos' }}</span>
                  <ul v-if="ballotCandidates.length" class="candidate-rows"><li v-for="(name, index) in ballotCandidates" :key="name"><span>{{ name }}</span><button type="button" class="link-button remove-link" :aria-label="`Quitar ${name}`" @click="removeBallotCandidate(index)">Quitar</button></li></ul>
                  <input v-model="newBallotCandidate" :aria-label="roundCategory === 'decision' ? 'Agregar opción' : 'Agregar candidato'" maxlength="160" :placeholder="roundCategory === 'decision' ? 'Opción y Enter' : 'Nombre y Enter'" @keydown.enter.prevent="addBallotCandidate" />
                </div>
                <button class="primary full-width" :disabled="loading">Preparar papeleta</button>
              </form>
            </template>
          </section>
          <section v-if="assemblyStatus !== 'preparing'" class="card assembly-close"><div class="action-row"><h2>Finalizar Asamblea</h2><button class="danger push-right" :disabled="loading || round?.status === 'open'" @click="completeAssembly">Finalizar Asamblea…</button></div></section>
        </div>
        <aside class="card mesa-participants" aria-labelledby="mesa-participants-title">
          <div class="section-heading"><h2 id="mesa-participants-title">Participantes</h2><span class="count-pill">{{ state?.participants?.length ?? 0 }}</span></div>
          <p v-if="attendance" class="attendance-summary"><span><span class="vote-dot vote-dot-done" aria-hidden="true"></span>{{ attendance.votedCount }} {{ attendance.votedCount === 1 ? 'votó' : 'votaron' }}</span><span><span class="vote-dot vote-dot-pending" aria-hidden="true"></span>{{ attendance.pending }} {{ attendance.pending === 1 ? 'falta' : 'faltan' }}</span><span v-if="attendance.disabled"><span class="vote-dot vote-dot-disabled" aria-hidden="true"></span>{{ attendance.disabled }} {{ attendance.disabled === 1 ? 'inhabilitado' : 'inhabilitados' }}</span></p>
          <p v-if="participantLeft" class="left-notice" role="status" aria-live="polite"><span aria-hidden="true">←</span>{{ participantLeft }} salió de la sala<button v-if="participantLeftId && assemblyStatus !== 'completed'" class="link-button push-right" :disabled="loading" @click="setVotingDisabled(participantLeftId, true)">Inhabilitar</button></p>
          <ul class="mesa-person-list">
            <li v-for="(person, index) in state?.participants || []" :key="person.id || `${person.firstName}-${person.lastName}-${index}`" :class="{ 'person-disabled': person.votingDisabled }">
              <span v-if="person.votingDisabled" class="vote-dot vote-dot-disabled" role="img" aria-label="Inhabilitado" title="Inhabilitado"></span>
              <span v-else-if="person.voted !== undefined" :class="['vote-dot', person.voted ? 'vote-dot-done' : 'vote-dot-pending']" role="img" :aria-label="person.voted ? 'Ya votó' : 'Falta votar'" :title="person.voted ? 'Ya votó' : 'Falta votar'"></span>
              <span class="person-name">{{ person.firstName }} {{ person.lastName }}<span v-if="person.votingDisabled" class="badge badge-disabled">Inhabilitado</span></span>
              <button v-if="person.id && person.votingDisabled && assemblyStatus !== 'completed'" class="link-button" :disabled="loading" @click="setVotingDisabled(person.id, false)">Habilitar</button>
              <details v-else-if="person.id && !person.votingDisabled" class="person-menu">
                <summary :aria-label="`Acciones para ${person.firstName} ${person.lastName}`">⋯</summary>
                <div class="person-menu-list">
                  <template v-if="assemblyStatus === 'lobby_open' || assemblyStatus === 'lobby_closed'">
                    <button type="button" @click="closePersonMenu($event); editParticipant(person)">Corregir</button>
                    <button type="button" class="remove-link" @click="closePersonMenu($event); moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', { status: 'removed' })">Retirar</button>
                  </template>
                  <button type="button" @click="closePersonMenu($event); issueResumeCode(person)">Reconectar dispositivo</button>
                  <button type="button" class="remove-link" :disabled="loading" @click="closePersonMenu($event); setVotingDisabled(person.id, true)">Inhabilitar</button>
                </div>
              </details>
            </li>
            <li v-if="!state?.participants?.length" class="empty">Sin participantes</li>
          </ul>
          <div class="action-row lobby-actions"><button v-if="lobbyStatus === 'lobby_open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_closed' })">Cerrar ingreso</button><button v-else-if="round?.status !== 'open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_open' })">Reabrir ingreso</button><a v-if="code" class="text-link" :href="`/?join=${encodeURIComponent(code)}`">Código: {{ code }}</a><span v-else class="status-line">El código de ingreso no está disponible en este dispositivo.</span><button class="link-button" :disabled="loading" @click="rotateJoinCode">Nuevo código</button></div>
          <div v-if="resumeQr" class="qr-panel" role="dialog" aria-label="QR de reconexión"><img :src="resumeQr.image" :alt="`Código QR de reconexión para ${resumeQr.name}`" /><div><strong>Reconexión de {{ resumeQr.name }}</strong><p>Un solo uso · vence {{ formatDateTime(resumeQr.expiresAt) }}</p><button class="secondary" @click="resumeQr = null">Ocultar QR</button></div></div>
          <div v-if="qrImage && lobbyStatus === 'lobby_open'" class="qr-panel"><img :src="qrImage" alt="Código QR para unirse a la Asamblea" /><div><a :href="`/?code=${encodeURIComponent(code)}`">{{ origin }}/?code={{ code }}</a></div></div>
        </aside>
      </div>
      <section v-if="state?.rounds?.length" id="acta-de-resultados" class="card official-history">
        <div class="section-heading"><div><p class="eyebrow">ACTA DE RESULTADOS</p><h2>Resultados</h2></div><button class="secondary" @click="printActa">Imprimir acta</button></div>
        <article v-for="historyRound in state.rounds" :key="historyRound.id" class="official-round">
          <div class="section-heading"><div><h3>{{ rootRoundOf(historyRound)?.title || historyRound.title }}<span v-if="voteLabel(historyRound)" class="badge badge-info">{{ voteLabel(historyRound) }}</span></h3><p class="status-line">{{ categoryText(historyRound) }} · papeleta {{ roundStatusLabels[historyRound.status] || historyRound.status }}<template v-if="historyRound.results?.length"> · {{ historyRound.participationCount ?? 0 }} de {{ eligibleOf(historyRound) }} votaron</template><template v-if="historyRound.outcome && !isDecision(historyRound)"> · Mayoría: {{ historyRound.outcome.threshold }}</template></p></div></div>
          <p v-if="historyRound.status === 'annulled'" class="status-line">Anulada<template v-if="historyRound.annulReason">: {{ historyRound.annulReason }}</template></p>
          <ol v-if="historyRound.results?.length" class="ranked-rows compact-rows">
            <li v-for="row in rankedRows(historyRound.results, eligibleOf(historyRound))" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="outcomeTag(historyRound.outcome, row.key) === 'elected'" class="badge badge-success">{{ winnerText(historyRound, row.label) }}</span><span v-else-if="outcomeTag(historyRound.outcome, row.key) === 'runoff'" class="badge badge-warning">Desempate</span><span v-else-if="!historyRound.outcome && row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span></li>
          </ol>
          <div v-if="historyRound.results?.length && historyRound.decisionFormat === 'boolean' && verdictOf(historyRound)" class="declared-result"><strong>{{ verdictOf(historyRound) }}</strong></div>
          <div v-else-if="historyRound.officialResult" class="declared-result"><strong>{{ isDecision(historyRound) ? 'Aprobada' : historyRound.officialResult.elected.length === 1 ? electedText(historyRound.officialResult.elected[0]!.label) : 'Electos' }}</strong><p>{{ historyRound.officialResult.elected.map((person) => person.label).join(', ') }}</p></div>
        </article>
      </section>
    </template>
  </template>
  <section v-if="printingActa && moderatorAuthState === 'authenticated' && state?.rounds" class="acta-print">
    <h1>Acta de resultados</h1>
    <p><strong>{{ state.assembly?.name }}</strong><template v-if="completionTime"> · finalizada {{ completionTime }}</template> · impresa {{ formatDateTime(new Date().toISOString()) }}</p>
    <p>Participantes registrados: {{ (state.participants?.length ?? 0) + (state.leftParticipants?.length ?? 0) }}. Los votos son secretos: el sistema no guarda quién votó por quién.</p>
    <article v-for="item in state.rounds" :key="`acta-${item.id}`">
      <h2>{{ rootRoundOf(item)?.title || item.title }}</h2>
      <p>{{ isDecision(item) ? categoryText(item) : item.category === 'committee' ? 'Comisión' : 'Cargo' }} · papeleta {{ roundStatusLabels[item.status] || item.status }}<template v-if="item.participationCount !== undefined"> · {{ votedText(turnoutOf(item).recorded, turnoutOf(item).eligible) }}</template><template v-if="voteLabel(item)"> · {{ voteLabel(item).toLowerCase() }}</template><template v-if="item.outcome && !isDecision(item)"> · mayoría: {{ item.outcome.threshold }}</template></p>
      <p v-if="item.results?.length && item.decisionFormat === 'boolean' && verdictOf(item)"><strong>{{ verdictOf(item) }}</strong></p>
      <p v-if="item.status === 'annulled'">Anulada por la mesa<template v-if="item.annulReason">: {{ item.annulReason }}</template>. Sus votos no se contaron.</p>
      <table v-if="item.results?.length"><thead><tr><th>Lugar</th><th>Opción</th><th>Votos</th><th>%</th></tr></thead><tbody><tr v-for="result in rankedResults(item.results, turnoutOf(item).eligible)" :key="result.optionId"><td>{{ result.rank }}<template v-if="outcomeTag(item.outcome, result.optionId) === 'elected'"> ({{ winnerText(item, result.label).toLowerCase() }})</template><template v-else-if="outcomeTag(item.outcome, result.optionId) === 'runoff'"> (desempate)</template><template v-else-if="!item.outcome && result.tied"> (empate)</template></td><td>{{ result.label }}</td><td>{{ result.count }}</td><td>{{ turnoutOf(item).eligible ? `${result.percent} %` : '' }}</td></tr></tbody></table>
      <p v-else-if="item.status !== 'annulled'">Conteo no publicado.</p>
      <p v-if="item.officialResult"><strong>{{ isDecision(item) ? 'Aprobada' : 'Electos' }}:</strong> {{ item.officialResult.elected.map((person) => person.label).join(', ') }}</p>
    </article>
    <h2>Participantes</h2>
    <ol><li v-for="person in state.participants || []" :key="`acta-person-${person.id}`">{{ person.firstName }} {{ person.lastName }}</li><li v-for="person in state.leftParticipants || []" :key="`acta-left-${person.id}`">{{ person.firstName }} {{ person.lastName }} (salió)</li></ol>
    <p class="acta-signatures"><span>Moderación</span><span>Secretaría</span></p>
  </section></template>

<style scoped>
.majority-chip { display: inline-block; margin: .35rem 0 0; padding: .2rem .6rem; border-radius: 999px; background: #e8efff; color: var(--blue-dark); font-size: .75rem; font-weight: 700; }
.official-round h3 .badge { margin-left: .5rem; vertical-align: middle; }
.decision-verdict { margin: .75rem 0 0; padding: .7rem 1rem; border-radius: 10px; background: var(--blue-dark); color: #fff; font-size: 1.25rem; font-weight: 800; }
.decision-verdict.rejected { background: #fff2f0; color: #b42318; }
</style>
