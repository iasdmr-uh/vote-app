import { expect, test, type Page } from '@playwright/test'

const api = '**/api/v1/**'
const assembly = { id: 'a1', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' }
const committee = { id: 'r1', title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, electionSeats: 3 }
const options = ['Isaías', 'Jeremías', 'Ezequiel', 'Daniel', 'Oseas'].map((label, index) => ({ id: `o${index}`, label }))
const counts = { results: options.map((option, index) => ({ optionId: option.id, label: option.label, count: 4 - Math.min(index, 3) })) }
const runoffOutcome = { seats: 3, base: 4, threshold: 3, elected: ['o0'], runoff: ['o1', 'o2'], openSeats: 2 }
const finalOutcome = { seats: 3, base: 4, threshold: 3, elected: ['o0', 'o1', 'o2'], runoff: [], openSeats: 0 }
const decision = { id: 'd1', title: 'Reforma de estatutos', category: 'decision', decisionFormat: 'boolean', approvalRule: 'simple' }

type State = Record<string, unknown>

async function phoneWith(page: Page, state: () => State) {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('participantAssemblyId', 'a1')
  })
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: { assembly, participationStatus: 'recorded', ...state() } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
  await page.goto('/')
}

async function projectorWith(page: Page, state: () => State) {
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: { assembly, participantCount: 4, recordedCount: 4, eligibleCount: 4, ...state() } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
  await page.goto('/projector?code=DEMO-ROOM')
}

async function refreshByPolling(page: Page) {
  const request = page.waitForRequest((req) => req.url().includes('/api/v1/'))
  await page.clock.runFor(8_000)
  await request
}

test('el teléfono dice que el resultado se prepara y luego muestra el resultado final con todos los electos', async ({ page }) => {
  await page.clock.install()
  let status = 'closed'
  await phoneWith(page, () => status === 'closed'
    ? { currentRound: { ...committee, status, options } }
    : { currentRound: { ...committee, status, options }, ...counts, outcome: finalOutcome, final: { elected: options.slice(0, 3).map(({ id, label }) => ({ optionId: id, label })), approved: null } })

  await expect(page.getByText('Preparando el resultado')).toBeVisible()
  await expect(page.getByText('RESULTADOS', { exact: true })).toHaveCount(0)

  status = 'published'
  await refreshByPolling(page)
  const card = page.locator('.result-summary')
  await expect(card).toContainText('Resultado final')
  await expect(card).toContainText('Electos')
  await expect(card).toContainText('Isaías · Jeremías · Ezequiel')
  await expect(page.getByText('Preparando el resultado')).toHaveCount(0)
})

test('el teléfono dice quiénes pasan a la siguiente votación', async ({ page }) => {
  await phoneWith(page, () => ({ currentRound: { ...committee, status: 'published', options }, ...counts, outcome: runoffOutcome, continuing: [{ optionId: 'o1', label: 'Jeremías' }, { optionId: 'o2', label: 'Ezequiel' }] }))
  const card = page.locator('.result-summary')
  await expect(card).toContainText('Pasan a la siguiente votación')
  await expect(card).toContainText('Jeremías · Ezequiel')
  await expect(card).not.toContainText('Resultado final')
})

test('el teléfono dice resultado final y no aprobada en una decisión', async ({ page }) => {
  await phoneWith(page, () => ({
    currentRound: { ...decision, status: 'published', options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }] },
    results: [{ optionId: 'f', label: 'A favor', count: 1 }, { optionId: 'c', label: 'En contra', count: 2 }],
    outcome: { seats: 1, base: 3, threshold: 2, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: false },
    final: { elected: [], approved: false },
  }))
  const card = page.locator('.result-summary')
  await expect(card).toContainText('Resultado final')
  await expect(card).toContainText('No aprobada')
})

test('el proyector dice que el resultado se prepara, luego quiénes pasan, y una votación anulada', async ({ page }) => {
  await page.clock.install()
  let status = 'closed'
  await projectorWith(page, () => status === 'closed'
    ? { round: { ...committee, status } }
    : status === 'annulled'
      ? { round: { ...committee, status } }
      : { round: { ...committee, status }, ...counts, outcome: runoffOutcome, continuing: [{ optionId: 'o1', label: 'Jeremías' }, { optionId: 'o2', label: 'Ezequiel' }] })

  await expect(page.locator('.pj-status')).toHaveText('Preparando el resultado')
  status = 'published'
  await refreshByPolling(page)
  const summary = page.locator('.result-summary')
  await expect(summary).toContainText('Pasan a la siguiente votación')
  await expect(summary).toContainText('Jeremías · Ezequiel')
  status = 'annulled'
  await refreshByPolling(page)
  await expect(page.locator('.pj-status')).toHaveText('Votación anulada')
})

test('el proyector dice resultado final sobre la diapositiva del electo', async ({ page }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await projectorWith(page, () => ({
    round: { id: 'p1', title: 'Presidente', status: 'published', category: 'office' },
    results: [{ optionId: 'i', label: 'Isaías', count: 3 }, { optionId: 'j', label: 'Jeremías', count: 1 }],
    outcome: { seats: 1, base: 4, threshold: 3, elected: ['i'], runoff: [], openSeats: 0 },
    officialResult: { elected: [{ optionId: 'i', label: 'Isaías' }], note: null, declaredAt: '2026-11-08T10:00:00.000Z' },
    final: { elected: [{ optionId: 'i', label: 'Isaías' }], approved: null },
  }))
  await expect(page.locator('.result-summary')).toContainText('Resultado final')
  await expect(page.locator('.slide-office .office-name')).toHaveText('Isaías')
})

test('la mesa no ve conteos antes que la sala y agrega el resultado final a oficiales', async ({ page }) => {
  await page.clock.install()
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'a1')
  })
  let status = 'closed'
  let registeredAt: string | null = null
  let registerCalls = 0
  const elected = options.slice(0, 3).map(({ id, label }) => ({ optionId: id, label }))
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/a1')) {
      const round = { ...committee, status, options, participationCount: 4, eligibleCount: 4 }
      const published = status === 'published'
        ? { ...counts, outcome: finalOutcome, final: true, officialResult: { elected, note: null, declaredBy: 'mesa', declaredAt: '2026-11-08T10:00:00.000Z', publishedAt: '2026-11-08T10:00:00.000Z', settledRoundId: 'r1', approved: null, registeredAt } }
        : {}
      await route.fulfill({ json: {
        assembly, participants: [{ id: 'p1', firstName: 'Delegado', lastName: '1' }], participantCount: 4, eligibleCount: 4, recordedCount: 4,
        currentRound: round, rounds: [{ ...round, ...published }],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/elections/r1/register')) {
      registerCalls += 1
      registeredAt = '2026-11-08T10:05:00.000Z'
      await route.fulfill({ status: 201, json: { roundId: 'r1', elected, approved: null, registeredAt } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/moderator')
  const card = page.locator('.ballot-card')
  await expect(card).toContainText('Preparando el resultado')
  await expect(card.locator('.ranked-rows > li')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Publicar/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Anular papeleta' })).toBeVisible()

  status = 'published'
  await refreshByPolling(page)
  await expect(card.locator('.result-summary')).toContainText('Resultado final')
  await page.getByRole('button', { name: 'Agregar a oficiales' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog).toContainText('Isaías · Jeremías · Ezequiel')
  await dialog.getByRole('button', { name: 'Agregar a oficiales' }).click()
  await expect(card).toContainText('Registrado como oficial')
  await expect(page.getByRole('button', { name: 'Agregar a oficiales' })).toHaveCount(0)
  expect(registerCalls).toBe(1)
})
