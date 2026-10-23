<script setup lang="ts">
import { committeeVoters, countsOf, decisionTie, rankOf, resultPercent, voteCountOf } from '../resultados'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const {
  origin, loading, syncing, state, code, moderatorAuthState, assemblyId, qrImage, printingActa, completedAssemblies, liveAssembly,
  assemblyStatus, lobbyStatus, round, totalParticipants, eligibleVotes, completionTime, ballotMaxChoices, openProjectorWindow, refresh,
  formatDateTime,
} = useAssembly()
const {
  moderationConfirmation, moderationReason, moderatorCredential, assemblyName, roundTitle, roundCategory, committeeMemberCount,
  repeatSelections, repeatSeats, showNextBallotForm, resumeQr, officialSelections, officialNotes, ballotCandidates, newBallotCandidate,
  repeatDialogRoundId, declareDialogRoundId,
  secrecyCleanupPendingRounds, assemblyStatusLabels, roundStatusLabels, attendance, moderatorWorkflow, currentRoundRecord, currentRoundDeclared,
  moderatorWorkflowStep, moderatorSessionSummary, repeatContext, repeatDialogRound, declareDialogRound, otherPendingActas,
  roundChain, isDecidable, latestCounted, voteNumber, rootRoundOf, nextVoteNumber,
  annulRound, repeatAllOptions, openRepeatDialog, confirmRepeatDialog, openDeclareDialog, confirmDeclareDialog, addBallotCandidate,
  removeBallotCandidate, chooseRoundCategory, moderatorAction, confirmModeratorAction, rotateJoinCode, issueResumeCode, openCompletedAssembly,
  openLiveAssembly, showPendingActas, retrySecrecyCleanup, completeAssembly, printActa, downloadActaSpreadsheet, deleteAssemblyData,
  createAssembly, editParticipant, createRound, formatActor, signInModerator,
} = useMesa()
</script>

<template>
  <div v-if="moderationConfirmation" class="confirmation-backdrop" @click.self="moderationConfirmation = null">
    <section class="confirmation-dialog" role="dialog" aria-modal="true" aria-labelledby="moderation-confirm-title" aria-describedby="moderation-confirm-description">
      <p class="eyebrow">CONFIRMACIÓN DE MESA</p>
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
      <p class="hint">{{ decisionTie(repeatDialogRound) ? `Ya marcamos a quienes empataron por ${repeatDialogRound.category === 'committee' ? 'los cupos' : 'el primer lugar'}. Puedes cambiarlo.` : 'Marca a las personas que pasan a la nueva votación.' }}</p>
      <label v-if="repeatDialogRound.category === 'committee'">Cupos a elegir en la nueva votación<input v-model.number="repeatSeats[repeatDialogRound.id]" type="number" min="1" :max="(repeatSelections[repeatDialogRound.id] || []).length || undefined" placeholder="Por defecto, los mismos cupos" /></label>
      <p class="info-box">Al terminar, el resultado oficial se declara en «{{ rootRoundOf(repeatDialogRound)?.title || repeatDialogRound.title }}».</p>
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
      <p>La Asamblea ya validó quién queda electo. Se muestra en el proyector y queda en el acta.</p>
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
    <p class="eyebrow">ACCESO DE MESA</p><h1>Verificando acceso</h1>
    <p class="lead">Estamos validando la credencial con el servidor.</p>
  </section>
  <section v-else-if="moderatorAuthState === 'validation_error'" class="validation-state">
    <header class="validation-heading"><p class="eyebrow">PANEL DE MODERACIÓN</p><h1>Error de validación</h1></header>
    <section class="card join-card validation-card">
      <p class="eyebrow">ACCESO DE MESA</p><h2>No se pudo validar el acceso</h2>
      <p class="lead">La credencial se conserva. Comprueba la conexión e inténtalo de nuevo.</p>
      <button class="primary" :disabled="syncing" @click="refresh()">{{ syncing ? 'Reintentando…' : 'Reintentar validación' }}</button>
    </section>
  </section>
  <section v-else-if="moderatorAuthState !== 'authenticated'" class="card join-card">
    <p class="eyebrow">ACCESO DE MESA</p><h1>Moderación</h1>
    <p class="lead">Ingresa la credencial operativa autorizada por la organización.</p>
    <form @submit.prevent="signInModerator"><label>Credencial de moderación<input v-model="moderatorCredential" type="password" autocomplete="current-password" required /></label><button class="primary">Continuar</button></form>
  </section>
  <template v-else-if="moderatorAuthState === 'authenticated'">
    <section class="page-heading"><div class="heading-copy"><p class="eyebrow">PANEL DE MODERACIÓN</p><h1>Control de Asamblea</h1><p>{{ moderatorSessionSummary }}</p></div><div class="heading-projector"><button class="primary" @click="openProjectorWindow">Abrir proyector en otra ventana</button><p>La moderación permanece en esta ventana privada; la pantalla externa muestra solo la vista pública.</p></div></section>
    <section v-if="!assemblyId && completedAssemblies.length" class="card after-assembly"><p class="eyebrow">DESPUÉS DE LA ASAMBLEA</p><h2>Asambleas finalizadas con datos guardados</h2><p>Ábrela para imprimir el acta y borrar sus datos.</p><ul class="participant-list"><li v-for="item in completedAssemblies" :key="item.id"><span>{{ item.name }}<template v-if="item.completedAt"> · finalizada {{ formatDateTime(item.completedAt) }}</template></span><button class="secondary" @click="openCompletedAssembly(item.id)">Abrir acta y borrado</button></li></ul></section>
    <section v-if="!assemblyId && liveAssembly" class="card"><p class="eyebrow">ASAMBLEA ACTIVA</p><h2>{{ liveAssembly.name }}</h2><p>Sigue en curso. Vuelve a ella cuando termines con las actas.</p><button class="primary" @click="openLiveAssembly">Volver a la Asamblea activa</button></section>
    <section v-else-if="!assemblyId" class="card"><h2>Crear Asamblea</h2><form @submit.prevent="createAssembly"><label>Nombre<input v-model="assemblyName" required /></label><button class="primary" :disabled="loading">Crear Asamblea y generar código</button></form></section>
    <template v-else>
      <ol class="workflow-steps" aria-label="Pasos de la moderación">
        <li v-for="(step, index) in moderatorWorkflow" :key="step" :class="{ complete: index < moderatorWorkflowStep, current: index === moderatorWorkflowStep && assemblyStatus !== 'completed' }" :aria-current="index === moderatorWorkflowStep && assemblyStatus !== 'completed' ? 'step' : undefined">
          <span class="workflow-step-number">{{ index + 1 }}</span><span>{{ step }}</span>
        </li>
      </ol>
      <section class="summary-grid">
        <div class="card metric"><span>Estado</span><strong>{{ round?.status === 'annulled' ? 'Papeleta anulada' : round?.status === 'published' ? 'Resultados publicados' : round?.status === 'closed' ? 'Votación cerrada' : round?.status === 'open' ? 'Votación abierta' : lobbyStatus === 'lobby_open' ? 'Ingreso abierto' : assemblyStatusLabels[assemblyStatus] || assemblyStatus }}</strong></div>
        <div class="card metric"><span>Participación</span><strong v-if="round">{{ state?.recordedCount ?? 0 }}<small> / {{ eligibleVotes }} {{ eligibleVotes === 1 ? 'voto' : 'votos' }}</small></strong><strong v-else>{{ totalParticipants }} {{ totalParticipants === 1 ? 'participante' : 'participantes' }}</strong></div>
        <div class="card metric"><span>Papeleta</span><strong>{{ round?.status === 'annulled' ? 'Anulada' : round?.status === 'published' ? 'Publicada' : round?.status === 'closed' ? 'Cerrada' : round ? 'Preparada' : 'Sin iniciar' }}</strong></div>
      </section>
      <p v-if="otherPendingActas.length" class="status-line pending-actas">{{ otherPendingActas.length === 1 ? 'Hay 1 Asamblea finalizada' : `Hay ${otherPendingActas.length} Asambleas finalizadas` }} con datos guardados. <button class="link-button" @click="showPendingActas">Ver actas pendientes</button></p>
      <section v-if="secrecyCleanupPendingRounds.length" class="notice error" role="alert">
        <strong>Limpieza del secreto del voto pendiente.</strong>
        No se podrán publicar resultados ni finalizar la Asamblea hasta completarla ({{ secrecyCleanupPendingRounds.map((item) => item.title).join(', ') }}). Los votos ya no se aceptan en esas papeletas.
        <button class="secondary" :disabled="loading" @click="retrySecrecyCleanup">Reintentar limpieza</button>
      </section>
      <section v-if="assemblyStatus === 'completed'" class="status-panel assembly-completed" role="status"><span class="status-dot"></span><div><strong>Asamblea finalizada</strong><p>El sistema está en modo de consulta.<template v-if="completionTime"> Se registró {{ completionTime }}.</template></p></div></section>
      <section v-if="assemblyStatus === 'completed'" class="card after-assembly"><p class="eyebrow">DESPUÉS DE LA ASAMBLEA</p><h2>Acta y borrado de datos</h2>
        <ol class="after-steps"><li>Imprime el acta o guárdala como PDF. Si quieres los conteos en Excel, descarga también la hoja de cálculo.</li><li>Entrega el acta a Secretaría: es el registro oficial.</li><li>Borra los datos. Se eliminan nombres, votos y registros de esta laptop.</li></ol>
        <div class="action-row"><button class="primary" @click="printActa">Imprimir o guardar PDF</button><button class="secondary" @click="downloadActaSpreadsheet">Descargar hoja de cálculo</button><button class="danger" :disabled="loading" @click="deleteAssemblyData">Borrar datos de la Asamblea</button></div>
        <p class="status-line">¿Aún no vas a borrar? <button class="link-button" @click="showPendingActas">Cerrar el acta sin borrar</button>. Seguirá en la lista de Asambleas finalizadas.</p>
      </section>
      <template v-else>
      <section class="card"><div class="section-heading"><div><p class="eyebrow">INGRESO</p><h2>Participantes</h2></div><button class="secondary" @click="refresh()">Actualizar lista</button></div>
        <p v-if="attendance" class="status-line attendance-summary">{{ state?.participants?.length ?? 0 }} personas · {{ attendance.votedCount }} ya {{ attendance.votedCount === 1 ? 'votó' : 'votaron' }} · {{ attendance.pending }} {{ attendance.pending === 1 ? 'falta' : 'faltan' }}<template v-if="attendance.status !== 'open'"> · última votación</template></p>
        <ul class="participant-list"><li v-for="(person, index) in state?.participants || []" :key="person.id || `${person.firstName}-${person.lastName}-${index}`"><div><span v-if="person.voted !== undefined" :class="['vote-dot', person.voted ? 'vote-dot-done' : 'vote-dot-pending']" role="img" :aria-label="person.voted ? 'Ya votó' : 'Falta votar'" :title="person.voted ? 'Ya votó' : 'Falta votar'"></span><span>{{ person.firstName }} {{ person.lastName }}</span></div><span v-if="person.id && (assemblyStatus === 'lobby_open' || assemblyStatus === 'lobby_closed')" class="person-actions"><button class="link-button" @click="editParticipant(person)">Corregir</button><button class="link-button remove-link" @click="moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', { status: 'removed' })">Retirar</button></span><span v-if="person.id" class="person-actions"><button class="link-button" @click="issueResumeCode(person)">Reconectar dispositivo</button></span></li><li v-if="!state?.participants?.length" class="empty">La lista aparecerá aquí cuando se unan.</li></ul>
        <p v-if="attendance" class="vote-dot-legend"><span><span class="vote-dot vote-dot-pending" aria-hidden="true"></span>Falta votar</span><span><span class="vote-dot vote-dot-done" aria-hidden="true"></span>Ya votó</span><span>Solo indica si votó, nunca por quién.</span></p>
        <div class="action-row"><button v-if="lobbyStatus === 'lobby_open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_closed' })">Cerrar ingreso</button><template v-else><span class="status-line">El ingreso está cerrado.</span><button v-if="round?.status !== 'open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_open' })">Reabrir ingreso</button></template><a v-if="code" class="text-link" :href="`/?join=${encodeURIComponent(code)}`">Código: {{ code }}</a><span v-else class="status-line">El código de ingreso no está disponible en este dispositivo.</span><button class="link-button" :disabled="loading" @click="rotateJoinCode">Generar nuevo código</button></div>
        <div v-if="resumeQr" class="qr-panel" role="dialog" aria-label="QR de reconexión"><img :src="resumeQr.image" :alt="`Código QR de reconexión para ${resumeQr.name}`" /><div><strong>Reconexión de {{ resumeQr.name }}</strong><p>Pide a la persona que escanee este QR con su nuevo dispositivo. Es de un solo uso y vence {{ formatDateTime(resumeQr.expiresAt) }}. No lo muestres en el proyector.</p><button class="secondary" @click="resumeQr = null">Ocultar QR</button></div></div>
        <div v-if="qrImage" class="qr-panel"><img :src="qrImage" alt="Código QR para unirse a la Asamblea" /><div><strong>Escanea para unirte</strong><p>Abre este enlace en el proyector y muestra el código QR durante el ingreso.</p><a :href="`/?code=${encodeURIComponent(code)}`">{{ origin }}/?code={{ code }}</a></div></div>
      </section>
      <section class="card ballot-card">
        <template v-if="round?.status === 'draft'">
          <div class="eyebrow-row"><p class="eyebrow">PAPELETA PREPARADA</p><span v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1" class="badge badge-info">{{ voteNumber(currentRoundRecord) }}.ª VOTACIÓN</span></div>
          <h2>{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}</h2>
          <p v-if="repeatContext" class="card-subtitle">{{ repeatContext }}</p>
          <h3 class="list-heading">Opciones en la papeleta</h3>
          <ul class="ballot-options"><li v-for="option in round.options || []" :key="option.id">{{ option.label }}</li></ul>
          <p v-if="round.category === 'committee' && ballotMaxChoices" class="status-line">Cada persona marca de 1 a {{ ballotMaxChoices }} {{ ballotMaxChoices === 1 ? 'candidato' : 'candidatos' }}.</p>
          <div class="action-row"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">{{ currentRoundRecord && voteNumber(currentRoundRecord) > 1 ? 'Cancelar la repetición' : 'Anular papeleta' }}</button><button class="primary" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/open`)">Abrir votación</button></div>
          <template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1">
            <h3 class="list-heading eyebrow">HISTORIAL DE ESTA ELECCIÓN</h3>
            <ul class="history-rows"><li v-for="item in roundChain(rootRoundOf(currentRoundRecord) || currentRoundRecord)" :key="item.id"><div><strong>{{ voteNumber(item) }}.ª votación</strong><span v-if="countsOf(item).length" class="muted"> · {{ countsOf(item).slice(0, 3).map((result) => `${result.label} ${result.count}`).join(' · ') }}</span><span v-else-if="item.annulReason" class="muted"> · {{ item.annulReason }}</span></div><span :class="['badge', item.status === 'published' ? 'badge-success' : item.status === 'annulled' ? 'badge-danger' : 'badge-info']">{{ (roundStatusLabels[item.status] || item.status).toUpperCase() }}</span></li></ul>
            <p class="form-note">El resultado oficial se declara al final, una sola vez, y el acta muestra ambas votaciones.</p>
          </template>
        </template>
        <template v-else-if="round?.status === 'published' && !showNextBallotForm && currentRoundRecord">
          <div class="eyebrow-row"><p class="eyebrow">CONTEO PUBLICADO</p><span class="badge badge-success">VISIBLE PARA TODOS</span></div>
          <h2>{{ rootRoundOf(currentRoundRecord)?.title || round.title }}<template v-if="voteNumber(currentRoundRecord) > 1"> — {{ voteNumber(currentRoundRecord) }}.ª votación</template></h2>
          <div class="results-list ranked-results"><div v-for="(result, index) in countsOf(currentRoundRecord)" :key="result.optionId"><span>{{ rankOf(countsOf(currentRoundRecord), index) }} {{ result.label }}</span><strong>{{ result.count }} <small>· {{ resultPercent(countsOf(currentRoundRecord), result.count, committeeVoters(currentRoundRecord)) }} %</small></strong><span class="result-bar" aria-hidden="true"><span :style="{ width: `${resultPercent(countsOf(currentRoundRecord), result.count, committeeVoters(currentRoundRecord))}%` }"></span></span></div></div>
          <p class="status-line">{{ currentRoundRecord.category === 'committee' ? `${currentRoundRecord.participationCount ?? 0} de ${totalParticipants} participantes votaron · cada persona marcó hasta ${currentRoundRecord.electionSeats ?? currentRoundRecord.memberCount} · % sobre quienes votaron` : `Total: ${countsOf(currentRoundRecord).reduce((total, result) => total + result.count, 0)} votos · ${totalParticipants} participantes` }}</p>
          <p v-if="decisionTie(currentRoundRecord)" class="summary-box summary-warning">{{ decisionTie(currentRoundRecord)!.text }}</p>
          <p v-if="currentRoundDeclared" class="summary-box summary-success">Resultado oficial declarado: {{ rootRoundOf(currentRoundRecord)?.officialResult?.elected.map((person) => person.label).join(', ') }}. Puedes corregirlo en el <a href="#acta-de-resultados">acta de resultados</a>.</p>
          <template v-else>
            <h3 class="list-heading eyebrow">¿QUÉ DECIDE LA ASAMBLEA?</h3>
            <div class="decision-cards">
              <article :class="['decision-card', { highlighted: decisionTie(currentRoundRecord) }]"><h4>Repetir la votación</h4><p>Hay empate o nadie alcanzó la mayoría. Se vota otra vez solo entre las personas que elijas.</p><button :class="decisionTie(currentRoundRecord) ? 'primary' : 'secondary'" :disabled="loading" @click="openRepeatDialog(currentRoundRecord)">Repetir votación…</button></article>
              <article :class="['decision-card', { highlighted: !decisionTie(currentRoundRecord) }]"><h4>Declarar el resultado</h4><p>La Asamblea ya validó quién queda electo. Se muestra en el proyector y queda en el acta.</p><button :class="decisionTie(currentRoundRecord) ? 'secondary' : 'primary'" :disabled="loading || !rootRoundOf(currentRoundRecord) || !isDecidable(rootRoundOf(currentRoundRecord)!)" @click="openDeclareDialog(rootRoundOf(currentRoundRecord)!)">Declarar resultado oficial…</button></article>
            </div>
          </template>
          <div class="card-footer-links"><button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta</button><button class="danger" :disabled="loading" @click="completeAssembly">Finalizar Asamblea…</button></div>
        </template>
        <template v-else-if="round?.status === 'open' || (round?.status === 'closed' && !showNextBallotForm)">
          <p class="eyebrow">{{ round.status === 'open' ? 'VOTACIÓN ABIERTA' : 'VOTACIÓN CERRADA' }}</p><h2>{{ (currentRoundRecord && rootRoundOf(currentRoundRecord)?.title) || round.title }}<template v-if="currentRoundRecord && voteNumber(currentRoundRecord) > 1"> — {{ voteNumber(currentRoundRecord) }}.ª votación</template></h2>
          <p v-if="round.status === 'open' && round.category === 'committee' && ballotMaxChoices" class="card-subtitle">Cada persona marca de 1 a {{ ballotMaxChoices }} {{ ballotMaxChoices === 1 ? 'candidato' : 'candidatos' }}. El conteo permanece oculto hasta que lo publiques.</p>
          <div v-if="round.status === 'open'" class="action-row"><p class="status-line">La votación está abierta. Los resultados permanecerán ocultos hasta que la mesa los publique.</p><div class="button-group"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular votación</button><button class="danger" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/close`)">Cerrar votación</button></div></div>
          <template v-else>
            <section v-if="currentRoundRecord?.privateResults?.length" class="private-results" aria-labelledby="private-results-title">
              <div class="private-results-heading"><h3 id="private-results-title">Conteo para revisión de la mesa</h3><span class="badge badge-private">Solo visible para la mesa</span></div>
              <div class="results-list ranked-results"><div v-for="(result, index) in currentRoundRecord.privateResults" :key="result.optionId"><span>{{ rankOf(currentRoundRecord.privateResults, index) }} {{ result.label }}</span><strong>{{ result.count }} <small>· {{ resultPercent(currentRoundRecord.privateResults, result.count, committeeVoters(currentRoundRecord)) }} %</small></strong><span class="result-bar" aria-hidden="true"><span :style="{ width: `${resultPercent(currentRoundRecord.privateResults, result.count, committeeVoters(currentRoundRecord))}%` }"></span></span></div></div>
            </section>
            <div class="action-row"><p class="status-line">La papeleta está cerrada. Cerrar no elige a nadie: publica el conteo y la mesa decide qué sigue.</p><div class="button-group"><button class="link-button remove-link" :disabled="loading" @click="annulRound(round)">Anular papeleta</button><button class="primary" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(round.id)}/publish`)">Publicar conteo</button></div></div>
            <div class="card-footer-links"><button class="link-button" @click="showNextBallotForm = true">Preparar otra papeleta sin publicar este conteo</button></div>
          </template>
        </template>
        <div v-if="round?.status === 'annulled'" class="annulled-summary"><p class="eyebrow">PAPELETA ANULADA</p><h2>{{ round.title }}</h2><div class="action-row"><p class="status-line">Papeleta anulada<template v-if="round.annulReason">: {{ round.annulReason }}</template>. Sus votos no se contarán.</p><button class="secondary" :disabled="loading" @click="repeatAllOptions(state?.rounds?.find((item) => item.id === round?.id))">Repetir con las mismas opciones</button></div></div>
        <template v-if="!round || round.status === 'annulled' || (['published', 'closed'].includes(round.status) && showNextBallotForm)">
          <div class="eyebrow-row"><p class="eyebrow">PASO 3 · PREPARAR PAPELETA</p><button v-if="round?.status === 'published' || round?.status === 'closed'" class="link-button" @click="showNextBallotForm = false">Volver al conteo</button></div>
          <h2>Nueva papeleta</h2>
          <form class="ballot-form" @submit.prevent="createRound">
            <div class="field-group"><span class="field-label" id="ballot-kind-label">¿Qué se vota?</span>
              <div class="segmented" role="radiogroup" aria-labelledby="ballot-kind-label"><button type="button" role="radio" :aria-checked="roundCategory === 'office'" :class="{ active: roundCategory === 'office' }" @click="chooseRoundCategory('office')">Un cargo</button><button type="button" role="radio" :aria-checked="roundCategory === 'committee'" :class="{ active: roundCategory === 'committee' }" @click="chooseRoundCategory('committee')">Una comisión</button></div>
            </div>
            <label v-if="roundCategory === 'office'">Nombre del cargo<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Presidencia" /></label>
            <template v-else>
              <label>Nombre de la comisión<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Comisión de Finanzas" /></label>
              <label>¿Cuántos integrantes quedarán en la comisión?<input v-model.number="committeeMemberCount" class="member-count-input" type="number" min="1" max="40" required aria-describedby="committee-members-hint" /></label>
              <p id="committee-members-hint" class="hint">Es el máximo de candidatos que cada persona puede marcar. Puede marcar menos, pero no más.</p>
            </template>
            <div class="field-group"><span class="field-label">{{ roundCategory === 'office' ? 'Candidatos' : 'Candidatos (pueden ser más que los integrantes)' }}</span>
              <ul v-if="ballotCandidates.length" class="candidate-rows"><li v-for="(name, index) in ballotCandidates" :key="name"><span>{{ name }}</span><button type="button" class="link-button remove-link" :aria-label="`Quitar ${name}`" @click="removeBallotCandidate(index)">Quitar</button></li></ul>
              <input v-model="newBallotCandidate" aria-label="Agregar candidato" maxlength="160" placeholder="Escribe otro nombre y pulsa Enter" @keydown.enter.prevent="addBallotCandidate" />
            </div>
            <p v-if="roundCategory === 'committee' && committeeMemberCount" class="info-box">Cada persona podrá marcar de 1 a {{ committeeMemberCount }} {{ committeeMemberCount === 1 ? 'candidato' : 'candidatos' }}. Al publicar el conteo, el proyector muestra a todos los candidatos ordenados de mayor a menor votos.</p>
            <button class="primary full-width" :disabled="loading">Preparar papeleta</button>
            <p class="form-note">La papeleta queda en borrador: la revisas y luego pulsas «Abrir votación».</p>
          </form>
        </template>
      </section>
      <section v-if="assemblyStatus !== 'preparing' && round?.status !== 'published'" class="card assembly-close"><p class="eyebrow">CIERRE DE SESIÓN</p><h2>Finalizar Asamblea</h2><p>Registra el cierre después de que la mesa haya aprobado la decisión. Se conservarán resultados y registros para consulta.</p><p v-if="round?.status === 'open'" class="status-line">Cierra la papeleta abierta antes de finalizar la Asamblea.</p><button class="danger" :disabled="loading || round?.status === 'open'" @click="completeAssembly">Finalizar Asamblea</button></section>
      </template>
      <section v-if="state?.rounds?.length" id="acta-de-resultados" class="card official-history">
        <div class="section-heading"><div><p class="eyebrow">ACTA DE RESULTADOS</p><h2>Declaraciones oficiales de la mesa</h2></div><button class="secondary" @click="printActa">Imprimir acta</button></div>
        <article v-for="historyRound in state.rounds" :key="historyRound.id" class="official-round">
          <div class="section-heading"><div><h3>{{ historyRound.title }}</h3><p class="status-line">{{ historyRound.category === 'committee' ? `Comisión · ${historyRound.memberCount} ${historyRound.memberCount === 1 ? 'integrante' : 'integrantes'}` : 'Cargo' }} · papeleta {{ roundStatusLabels[historyRound.status] || historyRound.status }}</p></div></div>
          <p v-if="historyRound.status === 'annulled'" class="status-line">Anulada<template v-if="historyRound.annulReason">: {{ historyRound.annulReason }}</template></p>
          <div v-if="historyRound.results?.length" class="results-list compact-results ranked-results">
            <div v-for="(result, index) in historyRound.results" :key="result.optionId"><span>{{ rankOf(historyRound.results, index) }} {{ result.label }}</span><strong>{{ result.count }} <small>{{ resultPercent(historyRound.results, result.count, committeeVoters(historyRound)) }} %</small></strong><span class="result-bar" aria-hidden="true"><span :style="{ width: `${resultPercent(historyRound.results, result.count, committeeVoters(historyRound))}%` }"></span></span></div>
          </div>
          <div v-if="assemblyStatus !== 'completed' && ['closed', 'published', 'annulled'].includes(historyRound.status) && !rootRoundOf(historyRound)?.officialResult && roundChain(rootRoundOf(historyRound) || historyRound).at(-1)?.id === historyRound.id" class="action-row"><button class="secondary" :disabled="loading" @click="openRepeatDialog(historyRound)">Repetir votación…</button></div>
          <div v-if="historyRound.officialResult" class="declared-result">
            <strong>Declaración {{ historyRound.officialResult.publishedAt ? 'publicada' : 'interna' }}</strong>
            <p>Electos: {{ historyRound.officialResult.elected.map((person) => person.label).join(', ') }}</p>
            <p v-if="historyRound.officialResult.note">Observación: {{ historyRound.officialResult.note }}</p>
            <small>Registrada {{ formatDateTime(historyRound.officialResult.declaredAt) }} por {{ formatActor(historyRound.officialResult.declaredBy) }}</small>
          </div>
          <p v-else-if="!historyRound.committeeRootRoundId" class="status-line">La mesa aún no ha registrado una declaración oficial.</p>
          <p v-if="historyRound.committeeRootRoundId" class="status-line">Repetición de «{{ state.rounds.find((item) => item.id === historyRound.committeeRootRoundId)?.title }}»: el resultado oficial se registra en esa papeleta.</p>
          <div v-if="isDecidable(historyRound)" class="action-row">
            <button class="secondary" :disabled="loading" @click="openDeclareDialog(historyRound)">{{ historyRound.officialResult ? 'Corregir declaración…' : 'Declarar resultado…' }}</button>
            <button v-if="historyRound.officialResult && !historyRound.officialResult.publishedAt && roundChain(historyRound).some((item) => item.status === 'published')" class="primary" :disabled="loading" @click="moderatorAction(`/moderator/rounds/${encodeURIComponent(historyRound.id)}/official-result/publish`)">Publicar declaración</button>
            <span v-else-if="historyRound.officialResult?.publishedAt" class="status-line">Visible al público</span>
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
