<script setup lang="ts">
import type { PublicState } from '../types'
import SegmentedSelector from './SegmentedSelector.vue'
import { useAssembly } from '../useAssembly'
import { useMesa } from '../useMesa'

defineProps<{
  round?: NonNullable<PublicState['currentRound']>
}>()

const { loading } = useAssembly()
const {
  roundTitle, roundPositionId, positionMenuOpen, newDepartment, positionGroups, selectedPosition, choosePosition, addDepartment, roundCategory, committeeMemberCount, decisionFormat, approvalRule,
  showNextBallotForm, ballotCandidates, newBallotCandidate, removeBallotCandidate, addBallotCandidate, chooseRoundCategory, createRound,
} = useMesa()
</script>

<template>
  <div class="eyebrow-row"><p class="eyebrow">NUEVA PAPELETA</p><button v-if="round?.status === 'published' || round?.status === 'closed'" class="link-button" @click="showNextBallotForm = false">Volver al conteo</button></div>
  <form class="ballot-form" @submit.prevent="createRound">
    <div class="field-group"><span class="field-label" id="ballot-kind-label">¿Qué se vota?</span>
      <SegmentedSelector labelledby="ballot-kind-label" :options="[{ value: 'office', label: 'Cargo' }, { value: 'committee', label: 'Comisión' }, { value: 'decision', label: 'Decisión' }]" :model-value="roundCategory" @update:model-value="chooseRoundCategory" />
    </div>
    <div v-if="roundCategory === 'office'" class="field-group position-picker"><span class="field-label" id="position-label">Puesto</span>
      <button type="button" class="position-trigger" aria-labelledby="position-label" :aria-expanded="positionMenuOpen" aria-haspopup="listbox" @click="positionMenuOpen = !positionMenuOpen"><span :class="{ placeholder: !selectedPosition }">{{ selectedPosition?.label ?? 'Elige el puesto' }}</span><span class="chevron" aria-hidden="true">{{ positionMenuOpen ? '⌃' : '⌄' }}</span></button>
      <div v-if="positionMenuOpen" class="position-menu">
        <ul role="listbox" aria-labelledby="position-label">
          <template v-for="group in positionGroups" :key="group.group">
            <li class="position-group" role="presentation">{{ group.label }}</li>
            <li v-for="position in group.items" :key="position.id" role="option" class="position-option" :class="{ elected: position.elected, selected: position.id === roundPositionId }" :aria-selected="position.id === roundPositionId" :aria-disabled="Boolean(position.elected)" @click="choosePosition(position)"><span>{{ position.label }}</span><span v-if="position.elected" class="position-elected">{{ position.elected.label }}</span><span v-else-if="position.id === roundPositionId" class="position-check" aria-hidden="true">✓</span></li>
          </template>
        </ul>
        <div class="new-department"><input v-model="newDepartment" aria-label="Nombre del departamento" maxlength="160" placeholder="Nombre del departamento" @keydown.enter.prevent="addDepartment" /><button type="button" class="secondary" :disabled="loading || !newDepartment.trim()" @click="addDepartment">+ Agregar</button></div>
      </div>
    </div>
    <template v-else-if="roundCategory === 'committee'">
      <label>Nombre de la comisión<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Comisión de Finanzas" /></label>
      <label>¿Cuántos integrantes quedarán en la comisión?<input v-model.number="committeeMemberCount" class="member-count-input" type="number" min="1" max="40" required /></label>
    </template>
    <template v-else>
      <label>Decisión<input v-model="roundTitle" required maxlength="200" placeholder="Ej. Presupuesto 2027" /></label>
      <div class="field-group"><span class="field-label" id="decision-format-label">Papeleta</span>
        <SegmentedSelector labelledby="decision-format-label" :options="[{ value: 'boolean', label: 'A favor / En contra' }, { value: 'options', label: 'Opciones' }]" v-model="decisionFormat" />
      </div>
      <div class="field-group"><span class="field-label" id="approval-rule-label">Se aprueba con</span>
        <SegmentedSelector labelledby="approval-rule-label" :options="[{ value: 'simple', label: 'Mayoría simple' }, { value: 'three_quarters', label: '3/4' }]" v-model="approvalRule" />
      </div>
    </template>
    <div v-if="roundCategory !== 'decision' || decisionFormat === 'options'" class="field-group"><span class="field-label">{{ roundCategory === 'decision' ? 'Opciones' : 'Candidatos' }}</span>
      <ul v-if="ballotCandidates.length" class="candidate-rows"><li v-for="(name, index) in ballotCandidates" :key="name"><span>{{ name }}</span><button type="button" class="link-button remove-link" :aria-label="`Quitar ${name}`" @click="removeBallotCandidate(index)">Quitar</button></li></ul>
      <input v-model="newBallotCandidate" :aria-label="roundCategory === 'decision' ? 'Agregar opción' : 'Agregar candidato'" maxlength="160" :placeholder="roundCategory === 'decision' ? 'Opción y Enter' : 'Nombre y Enter'" @keydown.enter.prevent="addBallotCandidate" />
    </div>
    <button class="primary full-width" :disabled="loading">Preparar papeleta</button>
  </form>
</template>
