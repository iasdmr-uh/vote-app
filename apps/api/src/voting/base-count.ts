import type { Prisma } from '../generated/prisma/client.js'

export function countInRoom(client: Prisma.TransactionClient, assemblyId: string) {
  return client.participantSession.count({ where: { assemblyId, status: 'active', isRegionalSecretary: false } })
}

export async function basePeople(client: Prisma.TransactionClient, assemblyId: string) {
  const delegates = await client.participantSession.findMany({ where: { assemblyId, status: 'active', isRegionalSecretary: false }, select: { id: true } })
  const secretary = await client.participantSession.findFirst({ where: { assemblyId, isRegionalSecretary: true }, select: { id: true, status: true } })
  return { delegates: delegates.map(({ id }) => id), secretary }
}

export function baseOf(round: { regionalSecretaryVotes: boolean }, people: { delegates: string[]; secretary: { id: string; status: string } | null }) {
  return round.regionalSecretaryVotes && people.secretary?.status === 'active' ? [...people.delegates, people.secretary.id] : people.delegates
}

export async function liveRoundBases(client: Prisma.TransactionClient, assemblyId: string) {
  const people = await basePeople(client, assemblyId)
  const rounds = await client.round.findMany({ where: { assemblyId }, select: { id: true, regionalSecretaryVotes: true } })
  return new Map(rounds.map((round) => [round.id, baseOf(round, people).length]))
}

export async function roundBases(client: Prisma.TransactionClient, assemblyId: string) {
  const [live, frozen] = await Promise.all([
    liveRoundBases(client, assemblyId),
    client.round.findMany({
      where: { assemblyId, eligibleCount: { not: null } },
      select: { id: true, eligibleCount: true },
    }),
  ])
  for (const round of frozen) live.set(round.id, round.eligibleCount!)
  return live
}

export async function roundBase(client: Prisma.TransactionClient, assemblyId: string, roundId: string) {
  return (await roundBases(client, assemblyId)).get(roundId) ?? 0
}

export async function freezeRoundBase(tx: Prisma.TransactionClient, assemblyId: string, roundId: string) {
  const people = await basePeople(tx, assemblyId)
  const round = await tx.round.findUniqueOrThrow({ where: { id: roundId }, select: { regionalSecretaryVotes: true } })
  const base = baseOf(round, people)
  await tx.round.update({ where: { id: roundId }, data: { eligibleCount: base.length, regionalSecretaryInBase: base.length > people.delegates.length } })
}
