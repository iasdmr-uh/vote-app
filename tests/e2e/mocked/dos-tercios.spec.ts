import { expect, test } from '@playwright/test'
import { actaPositions, mockCompletedAssembly } from './acta-fixture'

const api = '**/api/v1/**'
const amendmentOutcome = { seats: 1, base: 28, threshold: 19, elected: [], runoff: [], openSeats: 0, rule: 'two_thirds', approved: false }

test('la mesa prepara una decisión con 2/3', async ({ page }) => {
  const bodies: Array<Record<string, unknown>> = []
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: '1' }], participantCount: 1, rounds: [], attendanceRound: null,
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/rounds')) {
      bodies.push(request.postDataJSON())
      await route.fulfill({ status: 201, json: { id: 'r1' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for the 2/3 form test' } })
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

test('el proyector nombra 2/3 y los votos necesarios', async ({ page }) => {
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 28, recordedCount: 26, eligibleCount: 28,
        round: { id: 'reforma', title: 'Reforma de Estatutos', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds', approvalThreshold: 19, voteNumber: 1, runoff: false },
        results: [{ optionId: 'favor', label: 'A favor', count: 18 }, { optionId: 'contra', label: 'En contra', count: 8 }],
        outcome: amendmentOutcome,
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('.decision-pill')).toHaveText('No aprobada')
  await page.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(page.locator('.pj-subtitle')).toHaveText('Se aprueba con 2/3 · 19 votos')
})

test('el acta nombra 2/3 y los votos necesarios', async ({ page }) => {
  await mockCompletedAssembly(page, {
    period: '2027–2029', positions: actaPositions,
    rounds: [{
      id: 'reforma', title: 'Reforma de Estatutos', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'two_thirds', approvalThreshold: 19,
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

const phoneRounds = [
  { approvalRule: 'two_thirds', approvalThreshold: 19, text: 'Se aprueba con 2/3 · 19 votos' },
  { approvalRule: 'three_quarters', approvalThreshold: 21, text: 'Se aprueba con 3/4 · 21 votos' },
  { approvalRule: 'simple', approvalThreshold: 15, text: 'Se aprueba con mayoría simple · 15 votos' },
]

for (const { approvalRule, approvalThreshold, text } of phoneRounds) {
  test(`el teléfono muestra «${text}» antes de votar`, async ({ page }) => {
    await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'two-thirds-session'))
    await page.route(api, async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/participant/me')) {
        await route.fulfill({ json: {
          assembly: { id: 'two-thirds-assembly', name: 'Asamblea prueba', status: 'in_progress' }, participationStatus: 'pending',
          currentRound: {
            id: 'reforma', title: 'Reforma de Estatutos', status: 'open', format: 'single_choice', category: 'decision', decisionFormat: 'boolean',
            approvalRule, approvalThreshold, options: [{ id: 'favor', label: 'A favor' }, { id: 'contra', label: 'En contra' }],
          },
        } })
        return
      }
      await route.fulfill({ status: 404, json: { message: 'No mock route for the phone rule test' } })
    })

    await page.goto('/')
    await expect(page.getByRole('heading', { name: 'Reforma de Estatutos' })).toBeVisible()
    await expect(page.getByText(text)).toBeVisible()
  })
}

test('el teléfono no muestra una regla de aprobación en una elección', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'election-session'))
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'election-assembly', name: 'Asamblea prueba', status: 'in_progress' }, participationStatus: 'pending',
        currentRound: { id: 'presidente', title: 'Presidente', status: 'open', format: 'single_choice', category: 'office', options: [{ id: 'isaias', label: 'Isaías' }, { id: 'jeremias', label: 'Jeremías' }] },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for the election phone test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Presidente' })).toBeVisible()
  await expect(page.getByText(/Se aprueba con/)).toHaveCount(0)
})
