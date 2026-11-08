import { expect, test, type Page } from '@playwright/test'

const api = '**/api/v1/**'
const assembly = '/moderator/assemblies/synthetic-assembly'

type Round = Record<string, unknown> & { id: string }

function tiedVote(voteNumber: number, extra: Record<string, unknown> = {}): Round {
  const a = `a${voteNumber}`
  const l = `l${voteNumber}`
  return {
    id: `v${voteNumber}`, title: 'Presidencia', status: 'published', category: 'office', voteNumber, runoff: voteNumber > 1, participationCount: 10, eligibleCount: 10,
    ...(voteNumber > 1 ? { committeeRootRoundId: 'v1', runoffSourceRoundId: `v${voteNumber - 1}` } : {}),
    options: [{ id: a, label: 'Ana Ruiz' }, { id: l, label: 'Luis Mora' }],
    results: [{ optionId: a, label: 'Ana Ruiz', count: 5 }, { optionId: l, label: 'Luis Mora', count: 5 }],
    outcome: { seats: 1, base: 10, threshold: 6, elected: [], runoff: [a, l], openSeats: 1 }, officialResult: null, ...extra,
  }
}

function draftVote(voteNumber: number, extra: Record<string, unknown> = {}): Round {
  return {
    id: `v${voteNumber}`, title: 'Presidencia', status: 'draft', category: 'office', voteNumber, runoff: true, committeeRootRoundId: 'v1', runoffSourceRoundId: `v${voteNumber - 1}`, eligibleCount: 10,
    options: [{ id: `a${voteNumber}`, label: 'Ana Ruiz', isNew: false }, { id: `l${voteNumber}`, label: 'Luis Mora', isNew: false }], officialResult: null, ...extra,
  }
}

async function mesaWith(page: Page, rounds: Round[], onRequest: (method: string, path: string, body: unknown) => Record<string, unknown> | null = () => null, extraState: () => Record<string, unknown> = () => ({})) {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const path = new URL(request.url()).pathname.replace(/^.*\/api\/v1/, '')
    if (request.method() === 'GET' && path === assembly) {
      const published = rounds.filter((round) => round.status !== 'draft')
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea', status: 'in_progress', lobbyStatus: 'lobby_closed', participants: [], rounds, currentRound: published.at(-1), ...extraState() } })
      return
    }
    const reply = onRequest(request.method(), path, request.postDataJSON())
    if (reply) await route.fulfill({ status: 201, json: reply })
    else await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
  await page.goto('/moderator')
}

test('the mesa adds the regional secretary to a tied 4th vote, sees the larger base, and can remove them', async ({ page }) => {
  const fourth = draftVote(4)
  const requests: Array<[string, string, unknown]> = []
  let secretary: Record<string, unknown> | null = null
  await mesaWith(page, [tiedVote(1), tiedVote(2), tiedVote(3), fourth], (method, path, body) => {
    if (!path.endsWith('/moderator/rounds/v4/regional-secretary')) return null
    requests.push([method, path, body])
    if (method === 'POST') {
      secretary = { id: 'rs', firstName: 'Marta', lastName: 'Regional' }
      Object.assign(fourth, { regionalSecretaryVotes: true, eligibleCount: 11 })
      return { participantId: 'rs', name: 'Marta Regional', resumeUrl: 'http://localhost:5173/?resume=abc', expiresAt: '2026-11-05T12:00:00.000Z' }
    }
    Object.assign(fourth, { regionalSecretaryVotes: false, eligibleCount: 10 })
    return { roundId: 'v4', removed: true }
  }, () => ({ regionalSecretary: secretary }))

  const ballot = page.locator('.ballot-card')
  await ballot.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(ballot.getByRole('textbox', { name: 'Nombre del candidato' })).toBeVisible()
  const add = ballot.getByRole('button', { name: 'Agregar a la secretaría regional' })
  await expect(add).toBeDisabled()
  await ballot.getByRole('textbox', { name: 'Nombre de la secretaría regional' }).fill('Marta')
  await ballot.getByRole('textbox', { name: 'Apellido de la secretaría regional' }).fill('Regional')
  await add.click()

  expect(requests[0]?.[0]).toBe('POST')
  expect(requests[0]?.[2]).toEqual({ firstName: 'Marta', lastName: 'Regional' })
  await expect(page.locator('.qr-panel')).toContainText('Ingreso de Marta Regional')
  await expect(ballot.locator('.regional-secretary')).toContainText('Marta Regional vota en esta ronda')
  await expect(ballot.locator('.regional-secretary')).toContainText('11')
  await expect(page.locator('.regional-secretary-row')).toContainText('Marta Regional')
  await expect(page.locator('.regional-secretary-row').getByRole('button', { name: 'Reconectar dispositivo' })).toBeVisible()

  await ballot.getByRole('button', { name: 'Quitar a la secretaría regional' }).click()
  await expect(ballot.getByRole('button', { name: 'Agregar a Marta Regional' })).toBeVisible()
  await expect(ballot.locator('.regional-secretary')).not.toContainText('vota en esta ronda')
  expect(requests[1]?.[0]).toBe('DELETE')
})

test('the mesa cannot add the regional secretary to a 3rd vote', async ({ page }) => {
  await mesaWith(page, [tiedVote(1), tiedVote(2), draftVote(3)])
  const ballot = page.locator('.ballot-card')
  await ballot.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(ballot.getByRole('textbox', { name: 'Nombre del candidato' })).toBeVisible()
  await expect(ballot.locator('.regional-secretary')).toHaveCount(0)
})

test('the mesa cannot add the regional secretary when the previous vote did not tie', async ({ page }) => {
  const untied = tiedVote(3, {
    results: [{ optionId: 'a3', label: 'Ana Ruiz', count: 5 }, { optionId: 'l3', label: 'Luis Mora', count: 4 }],
    participationCount: 9,
  })
  await mesaWith(page, [tiedVote(1), tiedVote(2), untied, draftVote(4)])
  const ballot = page.locator('.ballot-card')
  await ballot.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(ballot.getByRole('textbox', { name: 'Nombre del candidato' })).toBeVisible()
  await expect(ballot.locator('.regional-secretary')).toHaveCount(0)
})

test('a tied decision with options offers the regional secretary and no new candidate', async ({ page }) => {
  const asDecision = { title: 'Sede', category: 'decision', decisionFormat: 'options', approvalRule: 'simple' }
  await mesaWith(page, [tiedVote(1, asDecision), tiedVote(2, asDecision), tiedVote(3, asDecision), draftVote(4, asDecision)])
  const ballot = page.locator('.ballot-card')
  await ballot.getByRole('button', { name: /^Abrir/ }).first().click()
  await expect(ballot.locator('.regional-secretary')).toBeVisible()
  await expect(ballot.getByRole('textbox', { name: 'Nombre del candidato' })).toHaveCount(0)
})

test('a second election offers the same regional secretary by name', async ({ page }) => {
  const bodies: unknown[] = []
  await mesaWith(page, [tiedVote(1), tiedVote(2), tiedVote(3), draftVote(4)], (method, path, body) => {
    if (method !== 'POST' || !path.endsWith('/regional-secretary')) return null
    bodies.push(body)
    return { participantId: 'rs', name: 'Marta Regional', resumeUrl: 'http://localhost:5173/?resume=abc', expiresAt: '2026-11-05T12:00:00.000Z' }
  }, () => ({ regionalSecretary: { id: 'rs', firstName: 'Marta', lastName: 'Regional' } }))
  const ballot = page.locator('.ballot-card')
  await ballot.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(ballot.getByRole('textbox', { name: 'Nombre de la secretaría regional' })).toHaveCount(0)
  await ballot.getByRole('button', { name: 'Agregar a Marta Regional' }).click()
  expect(bodies[0]).toEqual({ firstName: 'Marta', lastName: 'Regional' })
})

test('the projector says the regional secretary takes part in the vote', async ({ page }) => {
  await page.route(api, async (route) => {
    await route.fulfill({ json: {
      assembly: { id: 'a', name: 'Asamblea', status: 'in_progress' }, lobbyStatus: 'lobby_closed', participantCount: 10, recordedCount: 3, eligibleCount: 11,
      round: { id: 'v4', title: 'Presidencia', status: 'open', category: 'office', voteNumber: 4, runoff: true, regionalSecretaryVotes: true },
    } })
  })
  await page.goto('/projector?code=synthetic')
  await expect(page.locator('.pj-status')).toContainText('Con la secretaría regional')
  await expect(page.locator('.pj-progress')).toContainText('de 11 ya votaron')
})

test('the record marks each vote with who that vote elected and lists the whole committee on the last one', async ({ page }) => {
  const root = {
    id: 'c1', title: 'Comisión', status: 'published', category: 'committee', memberCount: 3, voteNumber: 1, runoff: false, participationCount: 10, eligibleCount: 10,
    options: [{ id: 'a', label: 'Ana Ruiz' }, { id: 'b', label: 'Bruno Díaz' }, { id: 'c', label: 'Carla Mora' }, { id: 'd', label: 'Dora Paz' }],
    results: [{ optionId: 'a', label: 'Ana Ruiz', count: 7 }, { optionId: 'b', label: 'Bruno Díaz', count: 5 }, { optionId: 'c', label: 'Carla Mora', count: 5 }, { optionId: 'd', label: 'Dora Paz', count: 3 }],
    outcome: { seats: 3, base: 10, threshold: 6, elected: ['a'], runoff: ['b', 'c'], openSeats: 2 },
    officialResult: { elected: [{ optionId: 'a', label: 'Ana Ruiz' }, { optionId: 'c2', label: 'Carla Mora' }, { optionId: 'b2', label: 'Bruno Díaz' }], note: null, declaredBy: 'x', declaredAt: '', publishedAt: '' },
  }
  const runoff = {
    id: 'c2', title: 'Comisión', status: 'published', category: 'committee', memberCount: 3, electionSeats: 2, voteNumber: 2, runoff: true, committeeRootRoundId: 'c1', runoffSourceRoundId: 'c1', participationCount: 10, eligibleCount: 10,
    options: [{ id: 'b2', label: 'Bruno Díaz' }, { id: 'c2', label: 'Carla Mora' }],
    results: [{ optionId: 'c2', label: 'Carla Mora', count: 7 }, { optionId: 'b2', label: 'Bruno Díaz', count: 6 }],
    outcome: { seats: 2, base: 10, threshold: 6, elected: ['c2', 'b2'], runoff: [], openSeats: 0 }, officialResult: null,
  }
  await mesaWith(page, [root, runoff])
  const votes = page.locator('.official-round')
  await expect(votes.nth(0).locator('.declared-result')).toContainText('Ana Ruiz')
  await expect(votes.nth(0).locator('.declared-result')).not.toContainText('Carla Mora')
  await expect(votes.nth(1).locator('.declared-result p').first()).toHaveText('Carla Mora, Bruno Díaz')
  await expect(votes.nth(1).locator('.committee-members')).toHaveText('Comisión completa, en orden de elección: Ana Ruiz, Carla Mora, Bruno Díaz')
  await expect(votes.nth(0).locator('.committee-members')).toHaveCount(0)
})

test('the mesa sees the regional secretary in the list and takes them out without a way back', async ({ page }) => {
  const takeOuts: string[] = []
  let secretary: Record<string, unknown> = { id: 'rs', firstName: 'Marta', lastName: 'Regional', status: 'active' }
  await mesaWith(page, [tiedVote(1), tiedVote(2), tiedVote(3), draftVote(4)], (method, path) => {
    if (method !== 'POST' || !path.endsWith('/moderator/participants/rs/take-out')) return null
    takeOuts.push(path)
    secretary = { ...secretary, status: 'left' }
    return { id: 'rs', firstName: 'Marta', lastName: 'Regional', status: 'left' }
  }, () => ({
    participants: [{ id: 'p1', firstName: 'Abdías', lastName: 'Safat', votingDisabled: false }],
    regionalSecretary: secretary,
    leftParticipants: secretary.status === 'left' ? [{ id: 'p9', firstName: 'Nahúm', lastName: 'Safat' }] : [],
  }))

  const row = page.locator('.regional-secretary-row')
  await expect(row).toContainText('Marta Regional')
  await expect(row).toContainText('Secretario regional')
  await expect(row.getByRole('button', { name: 'Inhabilitar' })).toHaveCount(0)
  await expect(row.getByRole('button', { name: 'Regresar a la sala' })).toHaveCount(0)

  await row.getByRole('button', { name: 'Retirar de la sala' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Retirar de la sala', exact: true }).click()
  await expect.poll(() => takeOuts).toEqual(['/moderator/participants/rs/take-out'])

  await expect(page.locator('.regional-secretary-row')).toHaveCount(0)
  const out = page.locator('.out-of-room')
  await expect(out).toContainText('Marta Regional')
  await expect(out).toContainText('Secretario regional')
  await expect(out.locator('li', { hasText: 'Marta Regional' }).getByRole('button')).toHaveCount(0)
  await expect(out.locator('li', { hasText: 'Nahúm Safat' }).getByRole('button', { name: 'Regresar a la sala' })).toBeVisible()
})
