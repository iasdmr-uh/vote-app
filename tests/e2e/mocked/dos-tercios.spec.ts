import { expect, test } from './api-fixture'
import { actaPositions, mockCompletedAssembly } from './acta-fixture'

const amendmentOutcome = { seats: 1, base: 28, threshold: 19, elected: [], runoff: [], openSeats: 0, rule: 'two_thirds', approved: false }

test('la mesa prepara una decisión con 2/3', async ({ page, api }) => {
  const bodies: Array<Record<string, unknown>> = []
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: '1' }], participantCount: 1, rounds: [], attendanceRound: null,
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/rounds')) {
      bodies.push(request.postDataJSON())
      return { status: 201, json: { id: 'r1' } }
    }
  })

  await page.goto('/moderator')
  await page.getByRole('radio', { name: 'Decisión' }).click()
  await page.getByLabel('Decisión', { exact: true }).fill('Reforma de Estatutos')
  await expect(page.getByRole('radiogroup', { name: 'Se aprueba con' }).getByRole('radio')).toHaveText(['Mayoría simple', '2/3', '3/4'])
  await page.getByRole('radio', { name: '2/3' }).click()
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect.poll(() => bodies.length).toBe(1)
  expect(bodies[0]).toEqual({ title: 'Reforma de Estatutos', format: 'single_choice', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds' })
})

test('el proyector nombra 2/3 y los votos necesarios', async ({ page, api }) => {
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 28, recordedCount: 26, eligibleCount: 28,
        round: { id: 'reforma', title: 'Reforma de Estatutos', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds', voteNumber: 1, runoff: false },
        results: [{ optionId: 'favor', label: 'A favor', count: 18 }, { optionId: 'contra', label: 'En contra', count: 8 }],
        outcome: amendmentOutcome,
      } }
    }
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('.decision-pill')).toHaveText('No aprobada')
  await page.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(page.locator('.pj-subtitle')).toHaveText('Se aprueba con 2/3 · 19 votos')
})

test('el acta nombra 2/3 y los votos necesarios', async ({ page, api }) => {
  await mockCompletedAssembly(api, {
    period: '2027–2029', positions: actaPositions,
    rounds: [{
      id: 'reforma', title: 'Reforma de Estatutos', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds',
      voteNumber: 1, participationCount: 26, eligibleCount: 28,
      options: [{ id: 'favor', label: 'A favor' }, { id: 'contra', label: 'En contra' }],
      results: [{ optionId: 'favor', label: 'A favor', count: 18 }, { optionId: 'contra', label: 'En contra', count: 8 }],
      outcome: amendmentOutcome, officialResult: null,
    }],
  })
  await page.goto('/moderator')
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  await page.emulateMedia({ media: 'print' })
  const acta = page.locator('.acta-print')
  await expect(acta.locator('.acta-kind')).toHaveText(['DECISIÓN · NO APROBADA'])
  await expect(acta.locator('.acta-meta')).toHaveText(['Se aprueba con 2/3 · 19 votos · 26 de 28 votaron · 2 no votaron'])
})

test('el teléfono no muestra la regla de aprobación antes de votar', async ({ page, api }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'two-thirds-session'))
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { json: {
        assembly: { id: 'two-thirds-assembly', name: 'Asamblea prueba', status: 'in_progress' }, participationStatus: 'pending',
        currentRound: {
          id: 'reforma', title: 'Reforma de Estatutos', status: 'open', format: 'single_choice', category: 'decision', decisionFormat: 'boolean',
          approvalRule: 'two_thirds', options: [{ id: 'favor', label: 'A favor' }, { id: 'contra', label: 'En contra' }],
        },
      } }
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Reforma de Estatutos' })).toBeVisible()
  await expect(page.getByText(/Se aprueba con|2\/3/)).toHaveCount(0)
})
