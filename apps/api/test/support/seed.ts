import { randomUUID } from 'node:crypto'
import { hashCredential, newOpaqueCredential } from '../../src/auth/credentials.js'
import type { PrismaService } from '../../src/prisma/prisma.service.js'
import type { VotingService } from '../../src/voting/voting.service.js'

export type Delegate = { id: string; token: string }

export async function seedAssembly(prisma: PrismaService, service: VotingService, { label, delegates = [] }: { label: string; delegates?: string[] }) {
  const organizationId = randomUUID()
  await prisma.organization.create({ data: { id: organizationId, name: `${label}-${organizationId}`, type: 'union' } })
  try {
    const joinCode = newOpaqueCredential()
    const assemblyId = (await prisma.assembly.create({ data: { organizationId, name: label, status: 'lobby_open', joinCodeHash: hashCredential(joinCode) } })).id
    const people: Record<string, Delegate> = {}
    for (const name of delegates) {
      const [firstName, lastName = 'Delegado'] = name.split(' ')
      const joined = await service.joinAssembly(joinCode, firstName!, lastName)
      const session = await prisma.participantSession.findUniqueOrThrow({ where: { tokenHash: hashCredential(joined.participantSessionToken) } })
      people[name] = { id: session.id, token: joined.participantSessionToken }
    }
    await service.changeLobby(assemblyId, 'lobby_closed')
    return { organizationId, assemblyId, joinCode, people, cleanup: () => removeOrganization(prisma, organizationId) }
  } catch (error) {
    await removeOrganization(prisma, organizationId)
    throw error
  }
}

export async function removeOrganization(prisma: PrismaService, organizationId: string) {
  const assemblies = await prisma.assembly.findMany({ where: { organizationId }, select: { id: true } })
  const assemblyIds = assemblies.map((assembly) => assembly.id)
  await prisma.round.deleteMany({ where: { assemblyId: { in: assemblyIds } } })
  await prisma.participantSession.deleteMany({ where: { assemblyId: { in: assemblyIds } } })
  await prisma.assembly.deleteMany({ where: { organizationId } })
  await prisma.organization.deleteMany({ where: { id: organizationId } })
}
