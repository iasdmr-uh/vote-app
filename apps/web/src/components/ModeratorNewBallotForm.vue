<script setup lang="ts">
import { es } from '../locale/es'
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
  <div class="eyebrow-row"><p class="eyebrow">{{ es.moderator.newBallotEyebrow }}</p><button v-if="round?.status === 'published' || round?.status === 'closed'" class="link-button" @click="showNextBallotForm = false">{{ es.moderator.backToCount }}</button></div>
  <form class="ballot-form" @submit.prevent="createRound">
    <div class="field-group"><span class="field-label" id="ballot-kind-label">{{ es.moderator.whatIsVoted }}</span>
      <SegmentedSelector labelledby="ballot-kind-label" :options="[{ value: 'office', label: es.moderator.categoryOffice }, { value: 'committee', label: es.moderator.categoryCommittee }, { value: 'decision', label: es.moderator.categoryDecision }]" :model-value="roundCategory" @update:model-value="chooseRoundCategory" />
    </div>
    <div v-if="roundCategory === 'office'" class="field-group position-picker"><span class="field-label" id="position-label">{{ es.moderator.position }}</span>
      <button type="button" class="position-trigger" aria-labelledby="position-label" :aria-expanded="positionMenuOpen" aria-haspopup="listbox" @click="positionMenuOpen = !positionMenuOpen"><span :class="{ placeholder: !selectedPosition }">{{ selectedPosition?.label ?? es.moderator.choosePosition }}</span><span class="chevron" aria-hidden="true">{{ positionMenuOpen ? '⌃' : '⌄' }}</span></button>
      <div v-if="positionMenuOpen" class="position-menu">
        <ul role="listbox" aria-labelledby="position-label">
          <template v-for="group in positionGroups" :key="group.group">
            <li class="position-group" role="presentation">{{ group.label }}</li>
            <li v-for="position in group.items" :key="position.id" role="option" class="position-option" :class="{ elected: position.elected, selected: position.id === roundPositionId }" :aria-selected="position.id === roundPositionId" :aria-disabled="Boolean(position.elected)" @click="choosePosition(position)"><span>{{ position.label }}</span><span v-if="position.elected" class="position-elected">{{ position.elected.label }}</span><span v-else-if="position.id === roundPositionId" class="position-check" aria-hidden="true">✓</span></li>
          </template>
        </ul>
        <div class="new-department"><input v-model="newDepartment" :aria-label="es.moderator.departmentName" maxlength="160" :placeholder="es.moderator.departmentName" @keydown.enter.prevent="addDepartment" /><button type="button" class="secondary" :disabled="loading || !newDepartment.trim()" @click="addDepartment">{{ es.moderator.add }}</button></div>
      </div>
    </div>
    <template v-else-if="roundCategory === 'committee'">
      <label>{{ es.moderator.committeeName }}<input v-model="roundTitle" required maxlength="200" :placeholder="es.moderator.committeeNamePlaceholder" /></label>
      <label>{{ es.moderator.committeeMemberQuestion }}<input v-model.number="committeeMemberCount" class="member-count-input" type="number" min="1" max="40" required /></label>
    </template>
    <template v-else>
      <label>{{ es.moderator.categoryDecision }}<input v-model="roundTitle" required maxlength="200" :placeholder="es.moderator.decisionPlaceholder" /></label>
      <div class="field-group"><span class="field-label" id="decision-format-label">{{ es.moderator.ballotFormat }}</span>
        <SegmentedSelector labelledby="decision-format-label" :options="[{ value: 'boolean', label: es.moderator.formatBoolean }, { value: 'options', label: es.moderator.options }]" v-model="decisionFormat" />
      </div>
      <div class="field-group"><span class="field-label" id="approval-rule-label">{{ es.moderator.approvesWith }}</span>
        <SegmentedSelector labelledby="approval-rule-label" :options="[{ value: 'simple', label: es.results.rules.simple }, { value: 'two_thirds', label: es.results.rules.two_thirds }, { value: 'three_quarters', label: es.results.rules.three_quarters }]" v-model="approvalRule" />
      </div>
    </template>
    <div v-if="roundCategory !== 'decision' || decisionFormat === 'options'" class="field-group"><span class="field-label">{{ roundCategory === 'decision' ? es.moderator.options : es.moderator.candidates }}</span>
      <ul v-if="ballotCandidates.length" class="candidate-rows"><li v-for="(name, index) in ballotCandidates" :key="name"><span>{{ name }}</span><button type="button" class="link-button remove-link" :aria-label="es.moderator.removeNamed(name)" @click="removeBallotCandidate(index)">{{ es.moderator.remove }}</button></li></ul>
      <input v-model="newBallotCandidate" :aria-label="roundCategory === 'decision' ? es.moderator.addOption : es.moderator.addCandidate" maxlength="160" :placeholder="roundCategory === 'decision' ? es.moderator.optionPlaceholder : es.moderator.namePlaceholder" @keydown.enter.prevent="addBallotCandidate" />
    </div>
    <button class="primary full-width" :disabled="loading">{{ es.moderator.prepareBallot }}</button>
  </form>
</template>
