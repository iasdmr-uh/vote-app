import type { Page } from '@playwright/test'
import { expect, test, type MockApi } from './api-fixture'

const assembly = { id: 'a1', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' }
const committee = { id: 'r1', title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, electionSeats: 3 }
const options = ['Isaías', 'Jeremías', 'Ezequiel', 'Daniel', 'Oseas'].map((label, index) => ({ id: `o${index}`, label }))
const counts = { results: options.map((option, index) => ({ optionId: option.id, label: option.label, count: 4 - Math.min(index, 3) })) }
const runoffOutcome = { seats: 3, base: 4, threshold: 3, elected: ['o0'], runoff: ['o1', 'o2'], openSeats: 2 }
const finalOutcome = { seats: 3, base: 4, threshold: 3, elected: ['o0', 'o1', 'o2'], runoff: [], openSeats: 0 }
const decision = { id: 'd1', title: 'Reforma de estatutos', category: 'decision', decisionFormat: 'boolean', approvalRule: 'simple' }

type State = Record<string, unknown>

async function phoneWith(api: MockApi, state: () => State) {
  const { page } = api
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('participantAssemblyId', 'a1')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { json: { assembly, participationStatus: 'recorded', ...state() } }
    }
  })
  await page.goto('/')
}

async function projectorWith(api: MockApi, state: () => State) {
  const { page } = api
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: { assembly, participantCount: 4, recordedCount: 4, eligibleCount: 4, ...state() } }
    }
  })
  await page.goto('/projector?code=DEMO-ROOM')
}

async function refreshByPolling(page: Page) {
  const request = page.waitForRequest((req) => req.url().includes('/api/v1/'))
  await page.clock.runFor(8_000)
  await request
}

async function expectNoPhoneResult(page: Page, status: 'closed' | 'published', hidden: RegExp) {
  await expect(page.locator(`.phone-screen[data-round-status="${status}"]`)).toBeVisible()
  await expect(page.locator('.result-summary, .ranked-rows')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(hidden)
}

test('el teléfono no muestra el resultado al cerrar ni al publicar con todos los electos', async ({ page, api }) => {
  await page.clock.install()
  let status = 'closed'
  await phoneWith(api, () => status === 'closed'
    ? { currentRound: { ...committee, status, options } }
    : { currentRound: { ...committee, status, options }, ...counts, outcome: finalOutcome, final: { elected: options.slice(0, 3).map(({ id, label }) => ({ optionId: id, label })), approved: null } })

  await expectNoPhoneResult(page, 'closed', /resultado|Isaías/i)

  status = 'published'
  await refreshByPolling(page)
  await expectNoPhoneResult(page, 'published', /resultado|Electos|Isaías|Jeremías|Ezequiel/i)
})

test('el teléfono no dice quiénes pasan a la siguiente votación', async ({ page, api }) => {
  await phoneWith(api, () => ({ currentRound: { ...committee, status: 'published', options }, ...counts, outcome: runoffOutcome, continuing: [{ optionId: 'o1', label: 'Jeremías' }, { optionId: 'o2', label: 'Ezequiel' }] }))
  await expectNoPhoneResult(page, 'published', /Pasan a la siguiente votación|Isaías|Jeremías|Ezequiel/i)
})

test('el teléfono no muestra el resultado de una decisión', async ({ page, api }) => {
  await phoneWith(api, () => ({
    currentRound: { ...decision, status: 'published', options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }] },
    results: [{ optionId: 'f', label: 'A favor', count: 1 }, { optionId: 'c', label: 'En contra', count: 2 }],
    outcome: { seats: 1, base: 3, threshold: 2, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: false },
    final: { elected: [], approved: false },
  }))
  await expectNoPhoneResult(page, 'published', /resultado|aprobada|A favor|En contra/i)
})

test('el proyector dice que el resultado se prepara, luego quiénes pasan, y una votación anulada', async ({ page, api }) => {
  await page.clock.install()
  let status = 'closed'
  await projectorWith(api, () => status === 'closed'
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

test('el proyector dice resultado final sobre la diapositiva del electo', async ({ page, api }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  await projectorWith(api, () => ({
    round: { id: 'p1', title: 'Presidente', status: 'published', category: 'office' },
    results: [{ optionId: 'i', label: 'Isaías', count: 3 }, { optionId: 'j', label: 'Jeremías', count: 1 }],
    outcome: { seats: 1, base: 4, threshold: 3, elected: ['i'], runoff: [], openSeats: 0 },
    officialResult: { elected: [{ optionId: 'i', label: 'Isaías' }], note: null, declaredAt: '2026-11-08T10:00:00.000Z' },
    final: { elected: [{ optionId: 'i', label: 'Isaías' }], approved: null },
  }))
  await expect(page.locator('.result-summary')).toContainText('Resultado final')
  await expect(page.locator('.slide-office .office-name')).toHaveText('Isaías')
})

test('la mesa no ve conteos antes que la sala y agrega el resultado final a oficiales', async ({ page, api }) => {
  await page.clock.install()
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'a1')
  })
  let status = 'closed'
  let registeredAt: string | null = null
  let registerCalls = 0
  const elected = options.slice(0, 3).map(({ id, label }) => ({ optionId: id, label }))
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/a1')) {
      const round = { ...committee, status, options, participationCount: 4, eligibleCount: 4 }
      const published = status === 'published'
        ? { ...counts, outcome: finalOutcome, final: true, officialResult: { elected, note: null, declaredBy: 'mesa', declaredAt: '2026-11-08T10:00:00.000Z', publishedAt: '2026-11-08T10:00:00.000Z', settledRoundId: 'r1', approved: null, registeredAt } }
        : {}
      return { json: {
        assembly, participants: [{ id: 'p1', firstName: 'Delegado', lastName: '1' }], participantCount: 4, eligibleCount: 4, recordedCount: 4,
        currentRound: round, rounds: [{ ...round, ...published }],
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/elections/r1/register')) {
      registerCalls += 1
      registeredAt = '2026-11-08T10:05:00.000Z'
      return { status: 201, json: { roundId: 'r1', elected, approved: null, registeredAt } }
    }
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

const sede = { id: 'sede', title: 'Sede de la Asamblea 2027', category: 'decision', decisionFormat: 'options', approvalRule: 'simple', voteNumber: 2, runoff: true }
const finals = [
  {
    kind: 'un cargo',
    round: { id: 'p1', title: 'Presidente', status: 'published', category: 'office', format: 'single_choice', options: [{ id: 'i', label: 'Isaías' }, { id: 'j', label: 'Jeremías' }] },
    results: [{ optionId: 'i', label: 'Isaías', count: 3 }, { optionId: 'j', label: 'Jeremías', count: 1 }],
    outcome: { seats: 1, base: 4, threshold: 3, elected: ['i'], runoff: [], openSeats: 0 },
    final: { elected: [{ optionId: 'i', label: 'Isaías' }], approved: null },
    shown: 'Isaías',
  },
  {
    kind: 'una decisión con opciones',
    round: { ...sede, status: 'published', format: 'single_choice', options: [{ id: 's', label: 'San Pedro Sula' }, { id: 't', label: 'Tegucigalpa' }] },
    results: [{ optionId: 's', label: 'San Pedro Sula', count: 3 }, { optionId: 't', label: 'Tegucigalpa', count: 1 }],
    outcome: { seats: 1, base: 4, threshold: 3, elected: ['s'], runoff: [], openSeats: 0, rule: 'simple', approved: true },
    final: { elected: [{ optionId: 's', label: 'San Pedro Sula' }], approved: true },
    shown: 'San Pedro Sula',
  },
  {
    kind: 'una decisión de sí o no',
    round: { ...decision, status: 'published', format: 'single_choice', options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }] },
    results: [{ optionId: 'f', label: 'A favor', count: 3 }, { optionId: 'c', label: 'En contra', count: 1 }],
    outcome: { seats: 1, base: 4, threshold: 3, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: true },
    final: { elected: [], approved: true },
    shown: 'Aprobada',
  },
  {
    kind: 'una decisión rechazada',
    round: { ...decision, status: 'published', format: 'single_choice', options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }] },
    results: [{ optionId: 'f', label: 'A favor', count: 1 }, { optionId: 'c', label: 'En contra', count: 3 }],
    outcome: { seats: 1, base: 4, threshold: 3, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: false },
    final: { elected: [], approved: false },
    shown: 'No aprobada',
  },
]

for (const item of finals) {
  const officialResult = { elected: item.final.elected, note: null, declaredAt: '2026-11-08T10:00:00.000Z' }

  test(`el proyector muestra una vez el resultado final de ${item.kind}`, async ({ page, api }) => {
    await page.setViewportSize({ width: 1920, height: 1080 })
    await projectorWith(api, () => ({ round: item.round, results: item.results, outcome: item.outcome, officialResult, final: item.final }))
    await page.getByRole('button', { name: 'Ver conteo' }).click()
    await expect(page.locator('.pj-results li')).toHaveCount(3)
    await expect(page.locator('.result-summary')).toHaveCount(1)
    await expect(page.locator('.result-summary')).toContainText(item.shown)
    await expect(page.locator('.pj-elected')).toHaveCount(0)
  })
}

test('el teléfono no muestra el resultado final de una decisión con opciones', async ({ page, api }) => {
  const item = finals[1]
  await phoneWith(api, () => ({ currentRound: item.round, results: item.results, outcome: item.outcome, officialResult: null, final: item.final, recordedCount: 4, eligibleCount: 4 }))
  await expectNoPhoneResult(page, 'published', /resultado|San Pedro Sula|Tegucigalpa|aprobada/i)
})
