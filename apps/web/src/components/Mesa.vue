<script setup lang="ts">
import { countsOf, decisionTie, rankOf, voteCountOf } from '../resultados'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const {
  origin, loading, syncing, state, code, moderatorAuthState, assemblyId, qrImage, printingActa, completedAssemblies, liveAssembly,
  assemblyStatus, lobbyStatus, round, eligibleVotes, completionTime, ballotMaxChoices, participantLeft, refresh, formatDateTime,
} = useAssembly()
const {
  moderationConfirmation, moderationReason, moderatorCredential, assemblyName, roundTitle, roundCategory, committeeMemberCount,
  repeatSelections, repeatSeats, showNextBallotForm, resumeQr, officialSelections, officialNotes, ballotCandidates, newBallotCandidate,
  repeatDialogRoundId, declareDialogRoundId,
  secrecyCleanupPendingRounds, roundStatusLabels, attendance, moderatorWorkflow, currentRoundRecord, currentRoundDeclared,
  moderatorWorkflowStep, repeatContext, repeatDialogRound, declareDialogRound, otherPendingActas,
  roundChain, isDecidable, latestCounted, voteNumber, rootRoundOf, nextVoteNumber, eligibleOf, rankedRows,
  annulRound, repeatAllOptions, openRepeatDialog, confirmRepeatDialog, openDeclareDialog, confirmDeclareDialog, addBallotCandidate,
  removeBallotCandidate, chooseRoundCategory, moderatorAction, confirmModeratorAction, rotateJoinCode, issueResumeCode, openCompletedAssembly,
  openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa, downloadActaSpreadsheet, deleteAssemblyData,
  createAssembly, editParticipant, createRound, formatActor, signInModerator,
} = useMesa()

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
  <div v-if="repeatDialogRound" class="confirmation-backdrop" @click.self="repeatDialogRoundId = ''">
    <section class="confirmation-dialog repeat-dialog" role="dialog" aria-modal="true" aria-labelledby="repeat-dialog-title">
      <p class="eyebrow">REPETIR VOTACIÓN</p>
      <h2 id="repeat-dialog-title">{{ rootRoundOf(repeatDialogRound)?.title || repeatDialogRound.title }} — {{ nextVoteNumber(repeatDialogRound) }}.ª votación</h2>
      <fieldset class="dialog-options"><legend>¿Quiénes pasan a la nueva votación?</legend>
        <label v-for="option in repeatDialogRound.options" :key="option.id" class="check-row"><input v-model="repeatSelections[repeatDialogRound.id]" type="checkbox" :value="option.id" /><span>{{ option.label }}</span><small>{{ voteCountOf(repeatDialogRound, option) }} {{ voteCountOf(repeatDialogRound, option) === 1 ? 'voto' : 'votos' }}</small></label>
      </fieldset>
      <label v-if="repeatDialogRound.category === 'committee'">Cupos a elegir en la nueva votación<input v-model.number="repeatSeats[repeatDialogRound.id]" type="number" min="1" :max="(repeatSelections[repeatDialogRound.id] || []).length || undefined" /></label>
      <div class="confirmation-actions">
        <button class="secondary" :disabled="loading" @click="repeatDialogRoundId = ''">Cancelar</button>
        <button class="primary" :disabled="loading || !(repeatSelections[repeatDialogRound.id] || []).length" @click="confirmRepeatDialog">Preparar {{ nextVoteNumber(repeatDialogRound) }}.ª votación</button>
      </div>
    </section>
  </div>
  <div v-if="declareDialogRound" class="confirmation-backdrop" @click.self="declareDialogRoundId = ''">
    <section class="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="declare-dialog-title">
      <p class="eyebrow">{{ declareDialogRound.officialResult ? 'CORREGIR DECLARACIÓN' : 'DECLARAR RESULTADO' }}</p>
      <h2 id="declare-dialog-title">{{ declareDialogRound.title }}</h2>
      <fieldset class="dialog-options"><legend>¿Quién queda electo?</legend>
        <label v-for="option in declareDialogRound.options" :key="option.id" class="check-row"><input v-model="officialSelections[declareDialogRound.id]" type="checkbox" :value="option.id" /><span>{{ option.label }}</span><small>{{ voteCountOf(latestCounted(declareDialogRound), option) }} {{ voteCountOf(latestCounted(declareDialogRound), option) === 1 ? 'voto' : 'votos' }}</small></label>
      </fieldset>
      <label>Observación (opcional)<textarea v-model="officialNotes[declareDialogRound.id]" rows="2" maxlength="1000" placeholder="Ej. Decisión de desempate de la Asamblea"></textarea></label>
      <div class="confirmation-actions">
        <button class="secondary" :disabled="loading" @click="declareDialogRoundId = ''">Cancelar</button>
        <button class="primary" :disabled="loading || !(officialSelections[declareDialogRound.id] || []).length" @click="confirmDeclareDialog">{{ declareDialogRound.officialResult ? 'Guardar corrección' : 'Declarar resultado oficial' }}</button>
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
            <template v-if="round?.status === 'draft'">
              <div class="eyebrow-row"><p class="eyebrow">PAPELETA PREPARADA</p><span v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1" class="badge badge-info">{{ voteNumber(currentRoundRecord) }}.ª VOTACIÓN</span></div>
              <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
              <p v-if="repeatContext" class="card-subtitle">{{ repeatContext }}</p>
              <ul class="ballot-options"><li v-for="option in round.options || []" :key="option.id">{{ option.label }}</li></ul>
              <p v-if="round.category === 'committee' && ballotMaxChoices" class="status-line">Hasta {{ ballotMaxChoices }} por persona</p>
              <div class="action-row"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">{{ currentRoundRecord && voteNumber(currentRoundRecord) > 1 ? 'Cancelar la repetición' : 'Anular papeleta' }}</button><button class="primary push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/open`)">Abrir votación</button></div>
              <template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1">
                <h3 class="list-heading eyebrow">HISTORIAL DE ESTA ELECCIÓN</h3>
                <ul class="history-rows"><li v-for="item in roundChain(rootRoundOf(currentRoundRecord) || currentRoundRecord)" :key="item.id"><div><strong>{{ voteNumber(item) }}.ª votación</strong><span v-if="countsOf(item).length" class="muted"> · {{ countsOf(item).slice(0, 3).map((result) => `${result.label} ${result.count}`).join(' · ') }}</span><span v-else-if="item.annulReason" class="muted"> · {{ item.annulReason }}</span></div><span :class="['badge', item.status === 'published' ? 'badge-success' : item.status === 'annulled' ? 'badge-danger' : 'badge-info']">{{ (roundStatusLabels[item.status] || item.status).toUpperCase() }}</span></li></ul>
              </template>
            </template>
            <template v-else-if="round?.status === 'published' && !showNextBallotForm && currentRoundRecord">
              <div class="ballot-heading">
                <div><p class="eyebrow">CONTEO PUBLICADO</p><h2 class="ballot-title">{{ rootRoundOf(currentRoundRecord)?.title || round.title }}<template v-if="voteNumber(currentRoundRecord) > 1"> — {{ voteNumber(currentRoundRecord) }}.ª votación</template></h2></div>
                <p class="voters-total"><strong>{{ currentRoundRecord.participationCount ?? state?.recordedCount ?? 0 }} de {{ eligibleOf(currentRoundRecord) }}</strong><span>votaron</span></p>
              </div>
              <ol class="ranked-rows">
                <li v-for="row in rankedRows(countsOf(currentRoundRecord), eligibleOf(currentRoundRecord))" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span><span class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span></li>
              </ol>
              <p v-if="currentRoundDeclared" class="summary-box summary-success">Declarado: {{ rootRoundOf(currentRoundRecord)?.officialResult?.elected.map((person) => person.label).join(', ') }}</p>
              <div class="action-row ballot-actions">
                <button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button>
                <div v-if="!currentRoundDeclared" class="button-group">
                  <button :class="decisionTie(currentRoundRecord) ? 'primary' : 'secondary'" :disabled="loading" @click="openRepeatDialog(currentRoundRecord)">Repetir votación…</button>
                  <button :class="decisionTie(currentRoundRecord) ? 'secondary' : 'primary'" :disabled="loading || !rootRoundOf(currentRoundRecord) || !isDecidable(rootRoundOf(currentRoundRecord)!)" @click="openDeclareDialog(rootRoundOf(currentRoundRecord)!)">Declarar resultado…</button>
                </div>
              </div>
            </template>
            <template v-else-if="round?.status === 'open' || (round?.status === 'closed' && !showNextBallotForm)">
              <template v-if="round.status === 'open'">
                <p class="status-label status-label-open"><span class="status-dot" aria-hidden="true"></span>VOTACIÓN ABIERTA</p>
                <h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}<template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1"> — {{ voteNumber(currentRoundRecord) }}.ª votación</template></h2>
                <p class="vote-progress"><strong>{{ state?.recordedCount ?? 0 }}</strong><span>de {{ eligibleVotes }} ya {{ (state?.recordedCount ?? 0) === 1 ? 'votó' : 'votaron' }}</span></p>
                <span class="vote-progress-bar" aria-hidden="true"><span :style="{ width: `${eligibleVotes ? Math.min(100, Math.round(((state?.recordedCount ?? 0) / eligibleVotes) * 100)) : 0}%` }"></span></span>
                <div class="action-row ballot-actions"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular votación</button><button class="danger push-right" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/close`)">Cerrar votación</button></div>
              </template>
              <template v-else>
                <div class="ballot-heading">
                  <div><div class="eyebrow-row"><p class="eyebrow">VOTACIÓN CERRADA</p><span class="badge badge-private">Solo la mesa</span></div><h2 class="ballot-title">{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}<template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1"> — {{ voteNumber(currentRoundRecord) }}.ª votación</template></h2></div>
                  <p v-if="currentRoundRecord" class="voters-total"><strong>{{ currentRoundRecord.participationCount ?? state?.recordedCount ?? 0 }} de {{ eligibleOf(currentRoundRecord) }}</strong><span>votaron</span></p>
                </div>
                <ol v-if="currentRoundRecord?.privateResults?.length" class="ranked-rows">
                  <li v-for="row in rankedRows(currentRoundRecord.privateResults, eligibleOf(currentRoundRecord))" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span><span class="result-bar" aria-hidden="true"><span :style="{ width: `${Math.min(100, row.percent)}%` }"></span></span></li>
                </ol>
                <div class="action-row ballot-actions"><button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button><div class="button-group"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular papeleta</button><button class="primary" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/publish`)">Publicar conteo</button></div></div>
              </template>
            </template>
            <div v-if="round?.status === 'annulled'" class="annulled-summary"><p class="eyebrow">PAPELETA ANULADA</p><h2 class="ballot-title">{{ round.title }}</h2><div class="action-row"><p v-if="round.annulReason" class="status-line">{{ round.annulReason }}</p><button class="secondary push-right" :disabled="loading" @click="repeatAllOptions(state?.rounds?.find((item) => item.id === round?.id))">Repetir con las mismas opciones</button></div></div>
            <template v-if="!round || round.status === 'annulled' || (['published', 'closed'].includes(round.status) && showNextBallotForm)">
              <div class="eyebrow-row"><p class="eyebrow">NUEVA PAPELETA</p><button v-if="round?.status === 'published' || round?.status === 'closed'" class="link-button" @click="showNextBallotForm = false">Volver al conteo</button></div>
              <form class="ballot-form" @submit.prevent="createRound">
                <div class="field-group"><span class="field-label" id="ballot-kind-label">¿Qué se vota?</span>
                  <div class="segmented" role="radiogroup" aria-labelledby="ballot-kind-label"><button type="button" role="radio" :aria-checked="roundCategory === 'office'" :class="{ active: roundCategory === 'office' }" @click="chooseRoundCategory('office')">Un cargo</button><button type="button" role="radio" :aria-checked="roundCategory === 'committee'" :class="{ active: roundCategory === 'committee' }" @click="chooseRoundCategory('committee')">Una comisión</button></div>
                </div>
                <label v-if="roundCategory === 'office'">Nombre del cargo<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Presidencia" /></label>
                <template v-else>
                  <label>Nombre de la comisión<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Comisión de Finanzas" /></label>
                  <label>¿Cuántos integrantes quedarán en la comisión?<input v-model.number="committeeMemberCount" class="member-count-input" type="number" min="1" max="40" required /></label>
                </template>
                <div class="field-group"><span class="field-label">Candidatos</span>
                  <ul v-if="ballotCandidates.length" class="candidate-rows"><li v-for="(name, index) in ballotCandidates" :key="name"><span>{{ name }}</span><button type="button" class="link-button remove-link" :aria-label="`Quitar ${name}`" @click="removeBallotCandidate(index)">Quitar</button></li></ul>
                  <input v-model="newBallotCandidate" aria-label="Agregar candidato" maxlength="160" placeholder="Nombre y Enter" @keydown.enter.prevent="addBallotCandidate" />
                </div>
                <button class="primary full-width" :disabled="loading">Preparar papeleta</button>
              </form>
            </template>
          </section>
          <section v-if="assemblyStatus !== 'preparing'" class="card assembly-close"><div class="action-row"><h2>Finalizar Asamblea</h2><button class="danger push-right" :disabled="loading || round?.status === 'open'" @click="completeAssembly">Finalizar Asamblea…</button></div></section>
        </div>
        <aside class="card mesa-participants" aria-labelledby="mesa-participants-title">
          <div class="section-heading"><h2 id="mesa-participants-title">Participantes</h2><span class="count-pill">{{ state?.participants?.length ?? 0 }}</span></div>
          <p v-if="attendance" class="attendance-summary"><span><span class="vote-dot vote-dot-done" aria-hidden="true"></span>{{ attendance.votedCount }} {{ attendance.votedCount === 1 ? 'votó' : 'votaron' }}</span><span><span class="vote-dot vote-dot-pending" aria-hidden="true"></span>{{ attendance.pending }} {{ attendance.pending === 1 ? 'falta' : 'faltan' }}</span></p>
          <p v-if="participantLeft" class="left-notice" role="status" aria-live="polite"><span aria-hidden="true">←</span>{{ participantLeft }} salió de la sala</p>
          <ul class="mesa-person-list">
            <li v-for="(person, index) in state?.participants || []" :key="person.id || `${person.firstName}-${person.lastName}-${index}`">
              <span v-if="person.voted !== undefined" :class="['vote-dot', person.voted ? 'vote-dot-done' : 'vote-dot-pending']" role="img" :aria-label="person.voted ? 'Ya votó' : 'Falta votar'" :title="person.voted ? 'Ya votó' : 'Falta votar'"></span>
              <span class="person-name">{{ person.firstName }} {{ person.lastName }}</span>
              <details v-if="person.id" class="person-menu">
                <summary :aria-label="`Acciones para ${person.firstName} ${person.lastName}`">⋯</summary>
                <div class="person-menu-list">
                  <template v-if="assemblyStatus === 'lobby_open' || assemblyStatus === 'lobby_closed'">
                    <button type="button" @click="closePersonMenu($event); editParticipant(person)">Corregir</button>
                    <button type="button" class="remove-link" @click="closePersonMenu($event); moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', { status: 'removed' })">Retirar</button>
                  </template>
                  <button type="button" @click="closePersonMenu($event); issueResumeCode(person)">Reconectar dispositivo</button>
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
        <div class="section-heading"><div><p class="eyebrow">ACTA DE RESULTADOS</p><h2>Declaraciones oficiales de la mesa</h2></div><button class="secondary" @click="printActa">Imprimir acta</button></div>
        <article v-for="historyRound in state.rounds" :key="historyRound.id" class="official-round">
          <div class="section-heading"><div><h3>{{ historyRound.title }}</h3><p class="status-line">{{ historyRound.category === 'committee' ? `Comisión · ${historyRound.memberCount} ${historyRound.memberCount === 1 ? 'integrante' : 'integrantes'}` : 'Cargo' }} · papeleta {{ roundStatusLabels[historyRound.status] || historyRound.status }}<template v-if="historyRound.results?.length"> · {{ historyRound.participationCount ?? 0 }} de {{ eligibleOf(historyRound) }} votaron</template></p></div></div>
          <p v-if="historyRound.status === 'annulled'" class="status-line">Anulada<template v-if="historyRound.annulReason">: {{ historyRound.annulReason }}</template></p>
          <ol v-if="historyRound.results?.length" class="ranked-rows compact-rows">
            <li v-for="row in rankedRows(historyRound.results, eligibleOf(historyRound))" :key="row.key" :class="{ first: row.rank === 1 }"><span class="rank-number">{{ row.rank }}</span><span class="ranked-label">{{ row.label }}<span v-if="row.tied" class="badge badge-warning">Empate</span></span><strong>{{ row.count }} {{ row.count === 1 ? 'voto' : 'votos' }}</strong><span class="ranked-percent">{{ row.percent }} %</span></li>
          </ol>
          <div v-if="assemblyStatus !== 'completed' && ['closed', 'published', 'annulled'].includes(historyRound.status) && !rootRoundOf(historyRound)?.officialResult && roundChain(rootRoundOf(historyRound) || historyRound).at(-1)?.id === historyRound.id" class="action-row"><button class="secondary" :disabled="loading" @click="openRepeatDialog(historyRound)">Repetir votación…</button></div>
          <div v-if="historyRound.officialResult" class="declared-result">
            <strong>Declaración {{ historyRound.officialResult.publishedAt ? 'publicada' : 'interna' }}</strong>
            <p>Electos: {{ historyRound.officialResult.elected.map((person) => person.label).join(', ') }}</p>
            <p v-if="historyRound.officialResult.note">Observación: {{ historyRound.officialResult.note }}</p>
            <small>{{ formatDateTime(historyRound.officialResult.declaredAt) }} · {{ formatActor(historyRound.officialResult.declaredBy) }}</small>
          </div>
          <p v-else-if="!historyRound.committeeRootRoundId" class="status-line">La mesa aún no ha registrado una declaración oficial.</p>
          <p v-if="historyRound.committeeRootRoundId" class="status-line">Repetición de «{{ state.rounds.find((item) => item.id === historyRound.committeeRootRoundId)?.title }}»</p>
          <div v-if="isDecidable(historyRound)" class="action-row">
            <button class="secondary" :disabled="loading" @click="openDeclareDialog(historyRound)">{{ historyRound.officialResult ? 'Corregir declaración…' : 'Declarar resultado…' }}</button>
            <button v-if="historyRound.officialResult && !historyRound.officialResult.publishedAt && roundChain(historyRound).some((item) => item.status === 'published')" class="primary" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(historyRound.id)}/official-result/publish`)">Publicar declaración</button>
            <button v-if="historyRound.officialResult && assemblyStatus !== 'completed'" class="link-button remove-link" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(historyRound.id)}/official-result`, 'DELETE')">Retirar declaración</button>
          </div>
        </article>
      </section>
    </template>
  </template>
  <section v-if="printingActa && moderatorAuthState === 'authenticated' && state?.rounds" class="acta-print">
    <h1>Acta de resultados</h1>
    <p><strong>{{ state.assembly?.name }}</strong><template v-if="completionTime"> · finalizada {{ completionTime }}</template> · impresa {{ formatDateTime(new Date().toISOString()) }}</p>
    <p>Participantes registrados: {{ state.participants?.length ?? 0 }}. Los votos son secretos: el sistema no guarda quién votó por quién.</p>
    <article v-for="item in state.rounds" :key="`acta-${item.id}`">
      <h2>{{ item.title }}</h2>
      <p>{{ item.category === 'committee' ? 'Comisión' : 'Cargo' }} · papeleta {{ roundStatusLabels[item.status] || item.status }}<template v-if="item.participationCount !== undefined"> · {{ item.participationCount }} {{ item.participationCount === 1 ? 'persona votó' : 'personas votaron' }}</template><template v-if="item.committeeRootRoundId"> · repetición de «{{ state.rounds.find((root) => root.id === item.committeeRootRoundId)?.title }}»</template></p>
      <p v-if="item.status === 'annulled'">Anulada por la mesa<template v-if="item.annulReason">: {{ item.annulReason }}</template>. Sus votos no se contaron.</p>
      <table v-if="item.results?.length"><thead><tr><th>Lugar</th><th>Opción</th><th>Votos</th></tr></thead><tbody><tr v-for="(result, index) in item.results" :key="result.optionId"><td>{{ rankOf(item.results, index) }}</td><td>{{ result.label }}</td><td>{{ result.count }}</td></tr></tbody></table>
      <p v-else-if="item.status !== 'annulled'">Conteo no publicado.</p>
      <p v-if="item.officialResult"><strong>Declarado electo por la mesa:</strong> {{ item.officialResult.elected.map((person) => person.label).join(', ') }} ({{ formatDateTime(item.officialResult.declaredAt) }})<template v-if="item.officialResult.note">. Observación: {{ item.officialResult.note }}</template></p>
    </article>
    <h2>Participantes</h2>
    <ol><li v-for="person in state.participants || []" :key="`acta-person-${person.id}`">{{ person.firstName }} {{ person.lastName }}</li></ol>
    <p class="acta-signatures"><span>Moderación</span><span>Secretaría</span></p>
  </section></template>
