<script setup lang="ts">
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const {
  origin, loading, state, code, qrImage, assemblyStatus, lobbyStatus, assemblyId, round, formatDateTime,
} = useAssembly()
const { attendance, setVotingDisabled, removeFromRoom, returnToRoom, editParticipant, moderatorAction, issueResumeCode, rotateJoinCode, resumeQr, regionalSecretaryInBallot } = useMesa()

function closePersonMenu(event: Event) {
  (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}
</script>

<template>
  <aside class="card mesa-participants" aria-labelledby="mesa-participants-title">
    <div class="section-heading"><h2 id="mesa-participants-title">Participantes</h2><span class="count-pill">{{ state?.participants?.length ?? 0 }}</span></div>
    <p v-if="attendance" class="attendance-summary"><span>{{ attendance.votedCount }} {{ attendance.votedCount === 1 ? 'votó' : 'votaron' }}</span><span>{{ attendance.pending }} {{ attendance.pending === 1 ? 'falta' : 'faltan' }}</span><span v-if="attendance.disabled">{{ attendance.disabled }} {{ attendance.disabled === 1 ? 'inhabilitado' : 'inhabilitados' }}</span></p>
    <ul class="mesa-person-list">
      <li v-for="(person, index) in state?.participants || []" :key="person.id || `${person.firstName}-${person.lastName}-${index}`" :class="{ 'person-disabled': person.votingDisabled }">
        <span class="person-name">{{ person.firstName }} {{ person.lastName }}<span v-if="person.votingDisabled" class="badge badge-disabled">Inhabilitado</span></span>
        <button v-if="person.id && person.votingDisabled && assemblyStatus !== 'completed'" class="link-button" :disabled="loading" @click="setVotingDisabled(person.id, false)">Habilitar</button>
        <details v-if="person.id && !(person.votingDisabled && assemblyStatus === 'completed')" class="person-menu">
          <summary :aria-label="`Acciones para ${person.firstName} ${person.lastName}`">⋯</summary>
          <div class="person-menu-list">
            <template v-if="assemblyStatus === 'lobby_open' || assemblyStatus === 'lobby_closed'">
              <button type="button" @click="closePersonMenu($event); editParticipant(person)">Corregir</button>
              <button type="button" class="remove-link" @click="closePersonMenu($event); moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', { status: 'removed' })">Retirar</button>
            </template>
            <button type="button" @click="closePersonMenu($event); issueResumeCode(person)">Reconectar dispositivo</button>
            <button v-if="!person.votingDisabled" type="button" class="remove-link" :disabled="loading" @click="closePersonMenu($event); setVotingDisabled(person.id, true)">Inhabilitar</button>
            <button v-if="assemblyStatus === 'in_progress' || assemblyStatus === 'lobby_closed'" type="button" class="remove-link" :disabled="loading" @click="closePersonMenu($event); removeFromRoom(person)">Retirar de la sala</button>
          </div>
        </details>
      </li>
      <li v-if="!state?.participants?.length" class="empty">Sin participantes</li>
    </ul>
    <div v-if="state?.leftParticipants?.length" class="out-of-room">
      <h3>Fuera de la sala</h3>
      <ul class="mesa-person-list">
        <li v-for="person in state.leftParticipants" :key="person.id"><span class="person-name">{{ person.firstName }} {{ person.lastName }}</span><button v-if="assemblyStatus !== 'completed'" class="link-button" :disabled="loading" @click="returnToRoom(person.id)">Regresar a la sala</button></li>
      </ul>
    </div>
    <p v-if="regionalSecretaryInBallot && state?.regionalSecretary" class="regional-secretary-row"><span class="person-name">{{ state.regionalSecretary.firstName }} {{ state.regionalSecretary.lastName }}<span class="badge badge-info">Secretaría regional</span></span><span v-if="round?.status === 'open'" class="muted">{{ state.regionalSecretary.voted ? 'Votó' : 'Falta' }}</span><button type="button" class="link-button" :disabled="loading" @click="issueResumeCode(state!.regionalSecretary!)">Reconectar dispositivo</button></p>
    <div class="action-row lobby-actions"><button v-if="lobbyStatus === 'lobby_open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_closed' })">Cerrar ingreso</button><button v-else-if="round?.status !== 'open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_open' })">Reabrir ingreso</button><a v-if="code" class="text-link" :href="`/?join=${encodeURIComponent(code)}`">Código: {{ code }}</a><span v-else class="status-line">El código de ingreso no está disponible en este dispositivo.</span><button class="link-button" :disabled="loading" @click="rotateJoinCode">Nuevo código</button></div>
    <div v-if="resumeQr" class="qr-panel" role="dialog" aria-label="QR de reconexión"><img :src="resumeQr.image" :alt="`Código QR de reconexión para ${resumeQr.name}`" /><div><strong>{{ resumeQr.heading || `Reconexión de ${resumeQr.name}` }}</strong><p>Un solo uso · vence {{ formatDateTime(resumeQr.expiresAt) }}</p><button class="secondary" @click="resumeQr = null">Ocultar QR</button></div></div>
    <div v-if="qrImage && lobbyStatus === 'lobby_open'" class="qr-panel"><img :src="qrImage" alt="Código QR para unirse a la Asamblea" /><div><a :href="`/?code=${encodeURIComponent(code)}`">{{ origin }}/?code={{ code }}</a></div></div>
  </aside>
</template>

<style scoped>
.regional-secretary-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; margin: .5rem 0; }
</style>
