import type { MockApi } from './api-fixture'

// The completed Asamblea of Figma A1–A3 (section 160:9): every kind of vote, and an org chart with blanks and an added department.

const outcome = (threshold: number, elected: string[], runoff: string[] = [], seats = 1) => ({ seats, base: 38, threshold, elected, runoff, openSeats: seats - elected.length })
const published = { note: null, declaredBy: 'shared_moderator_credential', declaredAt: '2026-11-03T15:00:00.000Z', publishedAt: '2026-11-03T15:01:00.000Z' }
const counted = (rows: Array<[string, string, number]>) => ({
  options: rows.map(([id, label]) => ({ id, label })),
  results: rows.map(([optionId, label, count]) => ({ optionId, label, count })),
})

export const actaRounds = [
  { id: 'r1', title: 'Presidente', status: 'published', category: 'office', voteNumber: 1, participationCount: 36, eligibleCount: 38,
    ...counted([['r1a', 'María López', 18], ['r1b', 'Carlos Gómez', 12], ['r1c', 'Rosa Díaz', 6]]), outcome: outcome(20, [], ['r1a', 'r1b']), officialResult: null },
  { id: 'r2', title: 'Presidente', status: 'published', category: 'office', committeeRootRoundId: 'r1', runoffSourceRoundId: 'r1', runoff: true, voteNumber: 2, participationCount: 37, eligibleCount: 38,
    ...counted([['r2a', 'María López', 25], ['r2b', 'Carlos Gómez', 12]]), outcome: outcome(20, ['r2a']), officialResult: { ...published, elected: [{ optionId: 'r2a', label: 'María López' }] } },
  { id: 'r3', title: 'Vicepresidente', status: 'published', category: 'office', voteNumber: 1, participationCount: 36, eligibleCount: 38,
    ...counted([['r3a', 'Juan Mora', 24], ['r3b', 'Elena Castro', 8], ['r3c', 'Pedro Vargas', 4]]), outcome: outcome(20, ['r3a']), officialResult: { ...published, elected: [{ optionId: 'r3a', label: 'Juan Mora' }] } },
  { id: 'r4', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, participationCount: 36, eligibleCount: 38,
    ...counted([['r4a', 'Ana Ruiz', 30], ['r4b', 'Jorge Banegas', 19], ['r4c', 'Elena Castro', 17], ['r4d', 'Pedro Vargas', 17], ['r4e', 'Sofía Méndez', 14], ['r4f', 'Luis Pérez', 11]]),
    outcome: outcome(20, ['r4a'], ['r4b', 'r4c', 'r4d'], 3), officialResult: { ...published, elected: [{ optionId: 'r4a', label: 'Ana Ruiz' }] } },
  { id: 'r5', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 2, committeeRootRoundId: 'r4', runoffSourceRoundId: 'r4', runoff: true, voteNumber: 2, participationCount: 36, eligibleCount: 38,
    ...counted([['r5a', 'Jorge Banegas', 26], ['r5b', 'Elena Castro', 24], ['r5c', 'Pedro Vargas', 22]]), outcome: outcome(20, ['r5a', 'r5b'], [], 2),
    officialResult: { ...published, elected: [{ optionId: 'r5a', label: 'Jorge Banegas' }, { optionId: 'r5b', label: 'Elena Castro' }] } },
  { id: 'r6', title: 'Secretario', status: 'annulled', category: 'office', voteNumber: 1, annulReason: 'Error en la papeleta', participationCount: 12, eligibleCount: 38, options: [{ id: 'r6a', label: 'Elena Castro' }] },
  { id: 'r7', title: 'Secretario', status: 'published', category: 'office', voteNumber: 1, participationCount: 35, eligibleCount: 38,
    ...counted([['r7a', 'Elena Castro', 22], ['r7b', 'Pedro Vargas', 13]]), outcome: outcome(20, ['r7a']), officialResult: { ...published, elected: [{ optionId: 'r7a', label: 'Elena Castro' }] } },
  { id: 'r8', title: 'Presupuesto 2027', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters', voteNumber: 1, participationCount: 36, eligibleCount: 38,
    ...counted([['r8a', 'A favor', 30], ['r8b', 'En contra', 6]]), outcome: { ...outcome(29, []), rule: 'three_quarters', approved: true }, officialResult: null },
  // A runoff the mesa prepared but never opened is not part of the record.
  { id: 'r9', title: 'Tesorero', status: 'draft', category: 'office', voteNumber: 1, options: [{ id: 'r9a', label: 'Pedro Vargas' }] },
]

const board = ['Presidente', 'Vicepresidente', 'Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3']
const departments = ['Auditor', 'Escuela Sabática', 'Obra Misionera', 'Niños', 'Jóvenes', 'Asistencia Social', 'Salud', 'Familia', 'Colportaje', 'Música', 'Industria y Comercio', 'Multimedia', 'Agricultura', 'Construcción']
const elected: Record<string, string> = {
  Presidente: 'María López', Vicepresidente: 'Juan Mora', Secretario: 'Elena Castro', 'Vocal 1': 'Ana Ruiz', 'Vocal 2': 'Luis Pérez', 'Vocal 3': 'Sofía Méndez',
  Auditor: 'Carlos Gómez', 'Escuela Sabática': 'Lucía Hernández', 'Obra Misionera': 'Rosa Díaz', Niños: 'Gabriela Paz', Jóvenes: 'Daniel Rivera', 'Asistencia Social': 'Mario Aguilar',
  Salud: 'Marta Flores', Familia: 'Patricia Cruz', Colportaje: 'José Martínez', Música: 'David Castillo', 'Industria y Comercio': 'Karen Ortiz', Multimedia: 'Andrea Molina', Agricultura: 'Óscar Reyes',
  // Tesorero and Construcción were not voted; Mayordomía was added by the mesa.
  Mayordomía: 'Iris Medina',
}

export const actaPositions = [
  ...board.map((label, index) => ({ group: 'board', label, sortOrder: index, custom: false })),
  ...departments.map((label, index) => ({ group: 'department', label, sortOrder: 100 + index, custom: false })),
  { group: 'department', label: 'Mayordomía', sortOrder: 200, custom: true },
].map((position, index) => ({ id: `pos-${index}`, ...position, elected: elected[position.label] ? { label: elected[position.label]!, roundId: 'r-any' } : null }))

export async function mockCompletedAssembly(api: MockApi, extra: Record<string, unknown> = { period: '2027–2029', positions: actaPositions }) {
  await api.page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
    window.print = () => {}
  })
  api.get('/moderator/assemblies/synthetic-assembly', () => ({ json: {
    id: 'synthetic-assembly', name: 'IV Asamblea Reorganizativa 2026', status: 'completed', completedAt: '2026-11-03T20:00:00.000Z',
    participants: Array.from({ length: 37 }, (_, index) => ({ id: `p${index}`, firstName: 'Delegado', lastName: `${index + 1}` })),
    leftParticipants: [{ id: 'p-left', firstName: 'Pedro', lastName: 'Vargas' }], participantCount: 37,
    rounds: actaRounds, ...extra,
  } }))
}
