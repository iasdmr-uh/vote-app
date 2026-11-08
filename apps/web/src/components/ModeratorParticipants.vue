<script setup lang="ts">
import { es } from '../locale/es'
import { computed } from 'vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

const {
  origin, loading, state, code, qrImage, assemblyStatus, lobbyStatus, assemblyId, round, formatDateTime,
} = useAssembly()
const { attendance, roomLine, roomWarning, setVotingDisabled, removeFromRoom, returnToRoom, editParticipant, moderatorAction, issueResumeCode, rotateJoinCode, resumeQr } = useMesa()
const secretaryOut = computed(() => state.value?.regionalSecretary?.status === 'left')
const voteOpen = computed(() => Boolean(state.value?.rounds?.some((item) => item.status === 'open')))

function closePersonMenu(event: Event) {
  (event.currentTarget as HTMLElement).closest('details')?.removeAttribute('open')
}
</script>

<template>
  <aside class="card mesa-participants" aria-labelledby="mesa-participants-title">
    <div class="section-heading"><h2 id="mesa-participants-title">{{ es.moderator.participants }}</h2><span class="count-pill">{{ state?.participants?.length ?? 0 }}</span></div>
    <p v-if="roomLine" class="room-line" :class="{ 'quorum-warning': roomWarning }">{{ roomLine }}<strong v-if="roomWarning"> · {{ roomWarning }}</strong></p>
    <p v-if="attendance" class="attendance-summary"><span>{{ es.moderator.attendanceVoted(attendance.votedCount) }}</span><span v-if="attendance.pending !== null">{{ es.moderator.attendanceMissing(attendance.pending) }}</span><span v-if="attendance.disabled">{{ es.moderator.attendanceDisabled(attendance.disabled) }}</span></p>
    <ul class="mesa-person-list">
      <li v-for="(person, index) in state?.participants || []" :key="person.id || `${person.firstName}-${person.lastName}-${index}`" :class="{ 'person-disabled': person.votingDisabled }">
        <span class="person-name">{{ person.firstName }} {{ person.lastName }}<span v-if="person.votingDisabled" class="badge badge-disabled">{{ es.moderator.disabledBadge }}</span></span>
        <button v-if="person.id && person.votingDisabled && !voteOpen && assemblyStatus !== 'completed'" class="link-button" :disabled="loading" @click="setVotingDisabled(person.id, false)">{{ es.moderator.enable }}</button>
        <details v-if="person.id && !voteOpen && !(person.votingDisabled && assemblyStatus === 'completed')" class="person-menu">
          <summary :aria-label="es.moderator.personActions(`${person.firstName} ${person.lastName}`)">⋯</summary>
          <div class="person-menu-list">
            <template v-if="assemblyStatus === 'lobby_open' || assemblyStatus === 'lobby_closed'">
              <button type="button" @click="closePersonMenu($event); editParticipant(person)">{{ es.moderator.correct }}</button>
              <button type="button" class="remove-link" @click="closePersonMenu($event); moderatorAction(`/moderator/participants/${encodeURIComponent(person.id)}`, 'PATCH', { status: 'removed' })">{{ es.moderator.withdraw }}</button>
            </template>
            <button type="button" @click="closePersonMenu($event); issueResumeCode(person)">{{ es.moderator.reconnectDevice }}</button>
            <button v-if="!person.votingDisabled" type="button" class="remove-link" :disabled="loading" @click="closePersonMenu($event); setVotingDisabled(person.id, true)">{{ es.moderator.disable }}</button>
            <button v-if="assemblyStatus === 'in_progress' || assemblyStatus === 'lobby_closed'" type="button" class="remove-link" :disabled="loading" @click="closePersonMenu($event); removeFromRoom(person)">{{ es.moderator.removeFromRoom }}</button>
          </div>
        </details>
      </li>
      <li v-if="state?.regionalSecretary && !secretaryOut" class="regional-secretary-row"><span class="person-name">{{ state.regionalSecretary.firstName }} {{ state.regionalSecretary.lastName }}<span class="badge badge-info">{{ es.moderator.regionalSecretaryBadge }}</span></span><button v-if="!voteOpen && (assemblyStatus === 'in_progress' || assemblyStatus === 'lobby_closed')" type="button" class="link-button remove-link" :disabled="loading" @click="removeFromRoom(state!.regionalSecretary!)">{{ es.moderator.removeFromRoom }}</button></li>
      <li v-if="!state?.participants?.length && !state?.regionalSecretary" class="empty">{{ es.moderator.noParticipants }}</li>
    </ul>
    <div v-if="state?.leftParticipants?.length || secretaryOut" class="out-of-room">
      <h3>{{ es.moderator.outOfRoom }}</h3>
      <ul class="mesa-person-list">
        <li v-if="secretaryOut && state?.regionalSecretary"><span class="person-name">{{ state.regionalSecretary.firstName }} {{ state.regionalSecretary.lastName }}<span class="badge badge-info">{{ es.moderator.regionalSecretaryBadge }}</span></span></li>
        <li v-for="person in state?.leftParticipants || []" :key="person.id"><span class="person-name">{{ person.firstName }} {{ person.lastName }}</span><button v-if="assemblyStatus !== 'completed'" class="link-button" :disabled="loading" @click="returnToRoom(person.id)">{{ es.moderator.returnToRoom }}</button></li>
      </ul>
    </div>
    <div class="action-row lobby-actions"><button v-if="lobbyStatus === 'lobby_open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_closed' })">{{ es.moderator.closeEntry }}</button><button v-else-if="round?.status !== 'open'" class="secondary" :disabled="loading" @click="moderatorAction(`/moderator/assemblies/${assemblyId}/lobby`, 'PATCH', { status: 'lobby_open' })">{{ es.moderator.reopenEntry }}</button><a v-if="code" class="text-link" :href="`/?join=${encodeURIComponent(code)}`">{{ es.moderator.codeLine(code) }}</a><span v-else class="status-line">{{ es.moderator.codeUnavailable }}</span><button v-if="!voteOpen" class="link-button" :disabled="loading" @click="rotateJoinCode">{{ es.moderator.newCode }}</button></div>
    <div v-if="resumeQr" class="qr-panel" role="dialog" :aria-label="es.moderator.reconnectQrLabel"><img :src="resumeQr.image" :alt="es.moderator.reconnectQrAlt(resumeQr.name)" /><div><strong>{{ resumeQr.heading || es.moderator.reconnectionOf(resumeQr.name) }}</strong><p>{{ es.moderator.singleUse(formatDateTime(resumeQr.expiresAt)) }}</p><button class="secondary" @click="resumeQr = null">{{ es.moderator.hideQr }}</button></div></div>
    <div v-if="qrImage && lobbyStatus === 'lobby_open'" class="qr-panel"><img :src="qrImage" :alt="es.moderator.joinQrAlt" /><div><a :href="`/?code=${encodeURIComponent(code)}`">{{ origin }}/?code={{ code }}</a></div></div>
  </aside>
</template>

<style scoped>
.regional-secretary-row { display: flex; flex-wrap: wrap; align-items: center; gap: .5rem; }
</style>
