import assert from 'node:assert/strict'
import test from 'node:test'
import { UnprocessableEntityException } from '@nestjs/common'
import { VotingService } from '../src/voting/voting.service.js'

const service = new VotingService({} as never, {} as never)
const base = {
  title: 'Comisión',
  format: 'single_choice' as const,
  options: [{ label: 'Delegado A' }, { label: 'Delegado B' }],
  countingRule: { kind: 'count_only' },
}

test('committee configuration requires an explicit type and validates only committee-specific sizes', async () => {
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee' }), UnprocessableEntityException)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee', committeeType: 'nomination', memberCount: 4 }), UnprocessableEntityException)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee', committeeType: 'nomination', memberCount: 3 }), UnprocessableEntityException)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'committee', committeeType: 'finance', memberCount: 4 }), UnprocessableEntityException)
  await assert.rejects(service.createRound('assembly', { ...base, category: 'office', committeeType: 'finance' }), UnprocessableEntityException)
})

test('a declared committee composition must match its configured number of seats', async () => {
  const database = {
    $transaction: async (work: (tx: unknown) => unknown) => work({
      $queryRaw: async () => [{ id: 'round', assembly_id: 'assembly', status: 'closed', category: 'committee', member_count: 3 }],
      round: { findUniqueOrThrow: async () => ({ committeeRootRoundId: null }), findMany: async () => [{ status: 'closed' }] },
    }),
  }
  const voting = new VotingService(database as never, {} as never)
  await assert.rejects(
    voting.declareOfficialResult('round', { optionIds: ['one', 'two'] }),
    UnprocessableEntityException,
  )
})

test('the mesa records the delegation decision on a proposal; the system does not compute a majority', async () => {
  const recorded: Record<string, unknown>[] = []
  const tx = {
    $queryRaw: async () => [],
    round: { findUnique: async () => ({ assemblyId: 'assembly', status: 'draft', category: 'committee', committeeType: 'nomination', committeeStage: 'approval', committeeConfiguration: {} }) },
    committeeProposal: {
      findFirst: async () => ({ id: 'proposal' }),
      update: async ({ data }: { data: Record<string, unknown> }) => { recorded.push(data); return { id: 'proposal', ...data } },
    },
    auditEvent: { create: async ({ data }: { data: { metadata: Record<string, unknown> } }) => { recorded.push(data.metadata); return data } },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx) } as never, {} as never)
  await voting.recordCommitteeApproval('round', 'proposal', { decision: 'approved', yesVotes: 2, noVotes: 3 })
  assert.equal(recorded[0]?.status, 'approved', 'the recorded decision stands even when the optional counts would not be a majority')
  assert.equal(recorded[0]?.approvalYes, 2)
  assert.equal(recorded[0]?.approvalNo, 3)
  assert.equal('voterId' in recorded[0]!, false, 'only aggregate counts are retained')
  assert.equal(recorded[1]?.decision, 'approved')
  recorded.length = 0
  await voting.recordCommitteeApproval('round', 'proposal', { decision: 'rejected' })
  assert.equal(recorded[0]?.status, 'rejected')
  assert.equal(recorded[0]?.approvalYes, null, 'counts are optional')
})

test('a recorded delegation decision can be corrected, but proposals that lacked supports cannot be approved', async () => {
  let where: Record<string, unknown> | undefined
  const tx = {
    $queryRaw: async () => [],
    round: { findUnique: async () => ({ assemblyId: 'assembly', status: 'draft', category: 'committee', committeeType: 'nomination', committeeStage: 'approval', committeeConfiguration: {} }) },
    committeeProposal: {
      findFirst: async (args: { where: Record<string, unknown> }) => { where = args.where; return null },
      update: async () => assert.fail('must not update'),
    },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx) } as never, {} as never)
  await assert.rejects(voting.recordCommitteeApproval('round', 'proposal', { decision: 'rejected' }), /Propuesta apoyada no disponible/)
  assert.deepEqual(where?.OR, [{ status: 'supported' }, { decidedAt: { not: null } }], 'decided proposals stay correctable; support-rejected ones have no decision date')
})

test('nomination proposals open with only Secretaría validation and a support minimum; the candidate count is optional', async () => {
  const createdRound = { id: 'round', title: 'Comisión', format: 'multiple_choice', category: 'committee', committeeType: 'nomination', memberCount: 5, decisionNote: 'validada', committeeStage: 'configuration_required', committeeConfiguration: {}, countingRule: { kind: 'count_only' }, status: 'draft', options: [] }
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'lobby_closed' }],
    participantSession: { count: async () => 10 },
    round: { create: async ({ data }: { data: { committeeStage: string } }) => { createdRound.committeeStage = data.committeeStage as typeof createdRound.committeeStage; return createdRound } },
    auditEvent: { create: async () => ({}) },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUniqueOrThrow: async () => createdRound } } as never, {} as never)
  // No proposal or support rule: Secretaría decided the system does not check who may propose or support.
  const rules = { institutionallyValidated: true, validationReference: 'ACTA-1', eligibilityRule: 'delegados elegibles', votingMethod: 'secreta', supportMinimum: 2 }
  const input = { ...base, options: [], category: 'committee' as const, committeeType: 'nomination' as const, memberCount: 5, decisionNote: 'validada' }
  assert.equal((await voting.createRound('assembly', { ...input, committeeConfiguration: rules })).committeeStage, 'proposals', 'without a candidate count it defaults to the member count')
  assert.equal((await voting.createRound('assembly', { ...input, committeeConfiguration: { ...rules, candidateCount: 4 } })).committeeStage, 'configuration_required', 'fewer candidates than seats')
  assert.equal((await voting.createRound('assembly', { ...input, committeeConfiguration: { ...rules, candidateCount: 10 } })).committeeStage, 'proposals')
  // Mesa v2: reference, decision note, eligibility and method are optional context for the acta.
  const minimal = { ...base, options: [], category: 'committee' as const, committeeType: 'nomination' as const, memberCount: 5 }
  assert.equal((await voting.createRound('assembly', { ...minimal, committeeConfiguration: { institutionallyValidated: true, supportMinimum: 2 } })).committeeStage, 'proposals')
  assert.equal((await voting.createRound('assembly', { ...minimal, committeeConfiguration: { supportMinimum: 2 } })).committeeStage, 'configuration_required', 'Secretaría validation is still required')
})

test('"Voto nulo" is added by the system and cannot be typed as a regular option', async () => {
  await assert.rejects(service.createRound('assembly', { ...base, options: [{ label: 'A' }, { label: 'voto NULO' }] }), /se agrega automáticamente/)
})

test('nomination configuration remains blocked when support or majority decisions are missing', async () => {
  const createdRound = { id: 'round', title: 'Comisión', format: 'multiple_choice', category: 'committee', committeeType: 'nomination', memberCount: 5, decisionNote: 'validada', committeeStage: 'configuration_required', committeeConfiguration: {}, countingRule: { kind: 'count_only' }, status: 'draft', options: [] }
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'in_progress' }],
    participantSession: { count: async () => 0 },
    round: { create: async () => createdRound },
    auditEvent: { create: async () => ({}) },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUniqueOrThrow: async () => createdRound } } as never, {} as never)
  const result = await voting.createRound('assembly', {
    ...base, options: [], category: 'committee', committeeType: 'nomination', memberCount: 5,
    decisionNote: 'validada',
    committeeConfiguration: {
      institutionallyValidated: true, validationReference: 'ACTA-1', eligibilityRule: 'delegados elegibles',
      votingMethod: 'secreta', proposalRule: 'eligible_delegate_only',
    },
  })
  assert.equal(result.committeeStage, 'configuration_required')
  assert.deepEqual(result.options, [], 'no ballot is created while institutional rules are unresolved')
})

test('cannot begin nomination proposals when the support minimum exceeds the active participants', async () => {
  const createdRound = { id: 'round', title: 'Comisión', format: 'multiple_choice', category: 'committee', committeeType: 'nomination', memberCount: 5, decisionNote: 'validada', committeeStage: 'configuration_required', committeeConfiguration: {}, countingRule: { kind: 'count_only' }, status: 'draft', options: [] }
  const tx = {
    $queryRaw: async () => [{ id: 'assembly', status: 'lobby_closed' }],
    participantSession: { count: async () => 5 },
    round: { create: async ({ data }: { data: { committeeStage: string } }) => { createdRound.committeeStage = data.committeeStage as typeof createdRound.committeeStage; return createdRound } },
    auditEvent: { create: async () => ({}) },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx), round: { findUniqueOrThrow: async () => createdRound } } as never, {} as never)
  const result = await voting.createRound('assembly', {
    ...base, options: [], category: 'committee', committeeType: 'nomination', memberCount: 5, decisionNote: 'validada',
    committeeConfiguration: { institutionallyValidated: true, validationReference: 'ACTA-1', eligibilityRule: 'delegados elegibles', votingMethod: 'secreta', proposalRule: 'eligible_delegate_only', supportRule: 'one_per_eligible_delegate', supportMinimum: 6, candidateCount: 7 },
  })
  assert.equal(result.committeeStage, 'configuration_required')
})

test('closing nomination supports rechecks the active participants before changing proposal status', async () => {
  let proposalsRead = false
  const tx = {
    $queryRaw: async () => [{ id: 'round', assembly_id: 'assembly', status: 'draft', committee_stage: 'support', committee_type: 'nomination', member_count: 5, committee_configuration: { supportMinimum: 4 } }],
    participantSession: { count: async () => 3 },
    committeeProposal: { findMany: async () => { proposalsRead = true; return [{ id: 'proposal', _count: { supporters: 4 } }] }, update: async () => assert.fail('must not mutate proposal status') },
    round: { update: async () => assert.fail('must not advance the stage') },
  }
  const voting = new VotingService({ $transaction: async (work: (value: unknown) => unknown) => work(tx) } as never, {} as never)
  await assert.rejects(voting.advanceCommitteeStage('round', 'approval'), /mínimo configurado \(4\) supera los 3 participantes activos/)
  assert.equal(proposalsRead, false, 'reject before reading or mutating support results')
})

test('recovery lists completed assemblies still holding data, so a closed tab does not lose the acta', async () => {
  const completedAt = new Date('2026-10-14T20:00:00.000Z')
  const voting = new VotingService({ assembly: {
    findFirst: async () => null,
    findMany: async ({ where }: { where: { status: string } }) => where.status === 'completed' ? [{ id: 'done', name: 'Asamblea 2026', completedAt }] : [],
  } } as never, {} as never)
  assert.deepEqual(await voting.activeAssembly(), { assembly: null, completed: [{ id: 'done', name: 'Asamblea 2026', completedAt: completedAt.toISOString() }] })
})
