import assert from 'node:assert/strict'
import { randomUUID } from 'node:crypto'
import test from 'node:test'
import pg from 'pg'
import { hashCredential, newOpaqueCredential } from '../src/auth/credentials.js'
import { PrismaService } from '../src/prisma/prisma.service.js'
import { VotingService } from '../src/voting/voting.service.js'
import type { RealtimeGateway } from '../src/realtime/realtime.gateway.js'

const testDatabaseUrl = process.env.TEST_DATABASE_URL

test('proposals, supports and decisions are refused once their stage closed or the committee was annulled', {
  skip: !testDatabaseUrl ? 'Define TEST_DATABASE_URL pointing to a disposable PostgreSQL database' : false,
}, async () => {
  process.env.DATABASE_URL = testDatabaseUrl
  const prisma = new PrismaService()
  await prisma.$connect()
  const service = new VotingService(prisma, new Proxy({}, { get: () => () => undefined }) as RealtimeGateway)
  const organizationId = randomUUID()
  const lockHolder = new pg.Client({ connectionString: testDatabaseUrl })
  await lockHolder.connect()
  try {
    await prisma.organization.create({ data: { id: organizationId, name: `race-test-${organizationId}`, type: 'union' } })
    const assembly = await prisma.assembly.create({ data: { organizationId, name: 'Race', status: 'in_progress', joinCodeHash: hashCredential(newOpaqueCredential()) } })
    const [candidate, delegate] = await Promise.all(['Ana', 'Luis'].map((firstName) => prisma.participantSession.create({ data: {
      assemblyId: assembly.id, firstName, lastName: 'Delegado', tokenHash: hashCredential(newOpaqueCredential()), assemblyRole: 'delegate', committeeEligible: true,
    } })))
    const round = await prisma.round.create({ data: {
      assemblyId: assembly.id, title: 'Nombramiento', category: 'committee', committeeType: 'nomination', committeeStage: 'approval', status: 'draft',
      countingRule: { kind: 'count_only' }, committeeConfiguration: { supportRule: 'one_per_eligible_delegate' },
    } })
    const proposal = await prisma.committeeProposal.create({ data: { roundId: round.id, candidateParticipantId: candidate!.id, proposedByParticipantId: delegate!.id, status: 'approved', decidedAt: new Date() } })

    // Simulates advanceCommitteeStage holding the round while it copies the approved candidates.
    await lockHolder.query('BEGIN')
    await lockHolder.query('SELECT id FROM rounds WHERE id = $1 FOR UPDATE', [round.id])
    let settled = false
    const correction = service.recordCommitteeApproval(round.id, proposal.id, { decision: 'rejected' }).finally(() => { settled = true })
    await new Promise((resolve) => setTimeout(resolve, 300))
    assert.equal(settled, false, 'the correction waits for the stage change instead of racing it')
    await lockHolder.query(`UPDATE rounds SET committee_stage = 'election' WHERE id = $1`, [round.id])
    await lockHolder.query('COMMIT')
    await assert.rejects(correction, /no está en aprobación/)
    assert.equal((await prisma.committeeProposal.findUniqueOrThrow({ where: { id: proposal.id } })).status, 'approved', 'the ballot and the proposal agree')

    // Same for a support arriving while supports are being closed.
    await prisma.round.update({ where: { id: round.id }, data: { committeeStage: 'support' } })
    await prisma.committeeProposal.update({ where: { id: proposal.id }, data: { status: 'proposed', decidedAt: null } })
    await lockHolder.query('BEGIN')
    await lockHolder.query('SELECT id FROM rounds WHERE id = $1 FOR UPDATE', [round.id])
    const support = service.supportCommitteeProposal(delegate!.id, round.id, proposal.id)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await lockHolder.query(`UPDATE rounds SET committee_stage = 'approval' WHERE id = $1`, [round.id])
    await lockHolder.query('COMMIT')
    await assert.rejects(support, /no está recibiendo apoyos/)
    assert.equal(await prisma.committeeProposalSupport.count({ where: { proposalId: proposal.id } }), 0)

    // And for a proposal arriving while proposals are being closed (review of PR #28).
    await prisma.round.update({ where: { id: round.id }, data: { committeeStage: 'proposals', committeeConfiguration: { proposalRule: 'eligible_delegate_only', supportRule: 'one_per_eligible_delegate' } } })
    await lockHolder.query('BEGIN')
    await lockHolder.query('SELECT id FROM rounds WHERE id = $1 FOR UPDATE', [round.id])
    const lateProposal = service.submitCommitteeProposal(delegate!.id, round.id, delegate!.id)
    await new Promise((resolve) => setTimeout(resolve, 300))
    await lockHolder.query(`UPDATE rounds SET committee_stage = 'support' WHERE id = $1`, [round.id])
    await lockHolder.query('COMMIT')
    await assert.rejects(lateProposal, /no está recibiendo propuestas/)
    assert.equal(await prisma.committeeProposal.count({ where: { roundId: round.id } }), 1, 'no proposal enters a closed stage')

    // An annulled committee keeps its stage but accepts nothing.
    for (const stage of ['proposals', 'support', 'approval'] as const) {
      await prisma.round.update({ where: { id: round.id }, data: { committeeStage: stage, status: 'draft' } })
      await service.annulRound(round.id, `Anulada en ${stage}`)
    }
    await prisma.round.update({ where: { id: round.id }, data: { committeeStage: 'proposals' } })
    await assert.rejects(service.submitCommitteeProposal(delegate!.id, round.id, delegate!.id), /no está recibiendo propuestas/)
    await prisma.round.update({ where: { id: round.id }, data: { committeeStage: 'support' } })
    await assert.rejects(service.supportCommitteeProposal(delegate!.id, round.id, proposal.id), /no está recibiendo apoyos/)
    const phone = await service.participantState(delegate!.id)
    assert.equal(phone.openRound?.status, 'annulled', 'the phone receives the annulled status to show instead of a stage form')
    assert.equal('committeeProposals' in phone, false, 'no support list is offered for an annulled committee')
    await prisma.round.update({ where: { id: round.id }, data: { committeeStage: 'approval' } })
    await prisma.committeeProposal.update({ where: { id: proposal.id }, data: { status: 'approved', decidedAt: new Date() } })
    await assert.rejects(service.recordCommitteeApproval(round.id, proposal.id, { decision: 'rejected' }), /no está en aprobación/)
  } finally {
    await lockHolder.query('ROLLBACK').catch(() => undefined)
    await lockHolder.end()
    await prisma.round.deleteMany({ where: { assembly: { organizationId } } })
    await prisma.participantSession.deleteMany({ where: { assembly: { organizationId } } })
    await prisma.assembly.deleteMany({ where: { organizationId } })
    await prisma.organization.deleteMany({ where: { id: organizationId } })
    await prisma.$disconnect()
  }
})
