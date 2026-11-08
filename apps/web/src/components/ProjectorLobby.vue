<script setup lang="ts">
import { computed } from 'vue'
import { es } from '../locale/es'
import { useAssembly } from '../useAssembly'

defineProps<{ assemblyName: string }>()

const LOBBY_SLOTS = 21

const { state, qrImage, projectorJoinUrl } = useAssembly()

const projectorJoinHost = computed(() => { try { return new URL(projectorJoinUrl.value).host } catch { return '' } })

const participants = computed(() => state.value?.participants || [])
const lobbyTotal = computed(() => state.value?.participantCount ?? participants.value.length)
const lobbyNames = computed(() => participants.value.slice(0, lobbyTotal.value > LOBBY_SLOTS ? LOBBY_SLOTS - 1 : LOBBY_SLOTS))
const lobbyMore = computed(() => lobbyTotal.value > LOBBY_SLOTS ? lobbyTotal.value - lobbyNames.value.length : 0)
</script>

<template>
  <h1 class="pj-title pj-title-lobby">{{ assemblyName }}</h1>
  <div class="pj-lobby" :aria-label="es.projector.lobbyLabel">
    <div class="pj-card pj-join">
      <img v-if="qrImage" class="pj-qr projector-qr" :src="qrImage" :alt="es.common.joinQrAlt" />
      <strong v-if="projectorJoinHost" class="pj-host">{{ projectorJoinHost }}</strong>
    </div>
    <div class="pj-card pj-room">
      <div class="pj-room-head"><h2>{{ es.projector.inTheRoom }}</h2><strong>{{ lobbyTotal }}</strong></div>
      <ul class="pj-names" :aria-label="es.projector.peopleInRoom">
        <li v-for="(person, index) in lobbyNames" :key="`${person.firstName}-${person.lastName}-${index}`">{{ person.firstName }} {{ person.lastName }}</li>
        <li v-if="lobbyMore" class="pj-more">{{ es.projector.more(lobbyMore) }}</li>
      </ul>
    </div>
  </div>
</template>

<style scoped>
.pj-card { border-radius: calc(var(--u) * 22); background: #fff; }
.pj-title { color: var(--ink); font-size: calc(var(--u) * 96); text-wrap: balance; font-weight: 800; letter-spacing: -.02em; line-height: 1.08; }
.pj-title-lobby { font-size: calc(var(--u) * 96); }
.pj-lobby { display: grid; min-height: 0; flex: 1; grid-template-columns: calc(var(--u) * 510) minmax(0, 1fr); gap: calc(var(--u) * 48); margin-top: calc(var(--u) * 64); }
.pj-join { display: flex; flex-direction: column; align-items: center; justify-content: center; gap: calc(var(--u) * 24); padding: calc(var(--u) * 40); }
.pj-qr { width: calc(var(--u) * 400); max-width: 100%; height: auto; }
.pj-host { color: var(--blue); font-size: calc(var(--u) * 56); font-weight: 800; overflow-wrap: anywhere; text-align: center; }
.pj-room { min-width: 0; padding: calc(var(--u) * 48) calc(var(--u) * 56); }
.pj-room-head { display: flex; align-items: center; justify-content: space-between; gap: calc(var(--u) * 24); margin-bottom: calc(var(--u) * 28); }
.pj-room-head h2 { font-size: calc(var(--u) * 42); font-weight: 800; }
.pj-room-head strong { color: var(--blue); font-size: calc(var(--u) * 120); font-weight: 800; line-height: .9; }
.pj-names { display: grid; grid-template-columns: repeat(3, minmax(0, 1fr)); grid-auto-rows: calc(var(--u) * 56); gap: calc(var(--u) * 14) calc(var(--u) * 16); padding: 0; list-style: none; }
.pj-names li { overflow: hidden; padding: calc(var(--u) * 10) calc(var(--u) * 20); border-radius: calc(var(--u) * 8); background: #f4f6fa; color: #243451; font-size: calc(var(--u) * 30); line-height: calc(var(--u) * 36); text-overflow: ellipsis; white-space: nowrap; }
.pj-names .pj-more { color: var(--blue); font-weight: 800; }
</style>
