import type { Page } from '@playwright/test'
import { expect, test, type MockApi } from './api-fixture'

const assembly = { id: 'a1', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' }
const committee = { id: 'r1', title: 'Comisión de Finanzas', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, participationCount: 38, eligibleCount: 38 }
const prophets = ['Isaías', 'Jeremías', 'Ezequiel', 'Daniel', 'Oseas']
const options = prophets.map((label, index) => ({ id: `o${index}`, label }))
const results = [22, 12, 8, 8, 0].map((count, index) => ({ optionId: `o${index}`, label: prophets[index]!, count }))
const outcome = { seats: 3, base: 38, threshold: 20, elected: ['o0'], runoff: ['o1', 'o2', 'o3'], openSeats: 2 }
const explanation = { rule: 'simple', reasons: { o0: 'elected', o1: 'no_majority', o2: 'tied_at_cut', o3: 'tied_at_cut', o4: 'out' }, baseDelegates: 38, baseIncludesSecretary: false }
const paragraph = 'Mayoría simple de 38 habilitados = 20 votos. Electo/a: Isaías (22). Sin mayoría: Jeremías (12). Desempate en el último puesto: Ezequiel (8) y Daniel (8). Pasan a la siguiente votación.'

const finalRound = { id: 'f1', title: 'Comisión de Música', category: 'committee', memberCount: 2, electionSeats: 2, voteNumber: 1, participationCount: 38, eligibleCount: 38, status: 'published', options: options.slice(0, 2) }
const finalResult = {
  results: results.slice(0, 2).map((row, index) => ({ ...row, count: [22, 21][index]! })),
  outcome: { seats: 2, base: 38, threshold: 20, elected: ['o0', 'o1'], runoff: [], openSeats: 0 },
  explanation: { rule: 'simple', reasons: { o0: 'elected', o1: 'elected' }, baseDelegates: 38, baseIncludesSecretary: false },
  final: true,
  officialResult: { elected: options.slice(0, 2).map(({ id, label }) => ({ optionId: id, label })), note: null, declaredBy: 'mesa', declaredAt: '2026-11-08T10:00:00.000Z', publishedAt: '2026-11-08T10:00:00.000Z', settledRoundId: 'f1', approved: null, registeredAt: null },
}
const finalParagraph = 'Mayoría simple de 38 habilitados = 20 votos. Electo/a: Isaías (22) y Jeremías (21).'

async function mesaWith(api: MockApi, round: Record<string, unknown>) {
  const { page } = api
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'a1')
  })
  api.on(({ request }) => {
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/moderator/assemblies/a1')) {
      const { results: _results, outcome: _outcome, explanation: _explanation, final: _final, officialResult: _official, ...current } = round
      return { json: {
        assembly, participants: [{ id: 'p1', firstName: 'Delegado', lastName: '1' }], participantCount: 38, eligibleCount: 38, recordedCount: 38,
        currentRound: current, rounds: [round],
      } }
    }
  })
  await page.goto('/moderator')
}

async function expectToggle(page: Page, scope: string, text: string) {
  const area = page.locator(scope)
  const button = area.getByRole('button', { name: '¿Cómo se decidió?' })
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(area.getByText(text, { exact: true })).toBeHidden()
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'true')
  await expect(area.getByText(text, { exact: true })).toBeVisible()
  await button.click()
  await expect(button).toHaveAttribute('aria-expanded', 'false')
  await expect(area.getByText(text, { exact: true })).toBeHidden()
}

test('the mesa opens and closes the explanation of a preliminary result', async ({ page, api }) => {
  await mesaWith(api, { ...committee, status: 'published', options, results, outcome, explanation })
  await expectToggle(page, '.ballot-card', paragraph)
})

test('the mesa opens and closes the explanation of a final result', async ({ page, api }) => {
  await mesaWith(api, { ...finalRound, ...finalResult })
  await expectToggle(page, '.ballot-card', finalParagraph)
})

test('the results record explains each result', async ({ page, api }) => {
  await mesaWith(api, { ...committee, status: 'published', options, results, outcome, explanation })
  await expectToggle(page, '.official-history', paragraph)
})

async function projectorWith(api: MockApi, state: Record<string, unknown>) {
  const { page } = api
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: { assembly, participantCount: 38, recordedCount: 38, eligibleCount: 38, ...state } }
    }
  })
  await page.goto('/projector?code=DEMO-ROOM')
}

test('the projector shows the explanation as a fixed line', async ({ page, api }) => {
  await projectorWith(api, { round: { ...committee, status: 'published' }, results, outcome, explanation, continuing: [] })
  await expect(page.locator('.pj-explanation')).toHaveText(paragraph)
  await expect(page.getByRole('button', { name: '¿Cómo se decidió?' })).toHaveCount(0)
})

test('the projector explains a final result in its count view', async ({ page, api }) => {
  await page.setViewportSize({ width: 1920, height: 1080 })
  const { final: _final, ...rest } = finalResult
  await projectorWith(api, { round: finalRound, ...rest, final: { elected: finalResult.officialResult.elected, approved: null } })
  await page.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(page.locator('.pj-explanation')).toHaveText(finalParagraph)
})

async function phoneWith(api: MockApi, state: Record<string, unknown>) {
  const { page } = api
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('participantAssemblyId', 'a1')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { json: { assembly, ...state } }
    }
  })
  await page.goto('/')
}

for (const [moment, state] of [
  ['an open vote', { participationStatus: 'pending', currentRound: { ...committee, status: 'open', format: 'multiple_choice', options } }],
  ['a published result', { participationStatus: 'recorded', currentRound: { ...committee, status: 'published', options }, results, outcome, explanation }],
] as const) {
  test(`the phone shows no rule, explanation or information button during ${moment}`, async ({ page, api }) => {
    await phoneWith(api, state)
    await expect(page.locator(`.phone-screen[data-round-status="${state.currentRound.status}"]`)).toBeVisible()
    await expect(page.locator('.result-summary, .result-so-far, .ranked-rows')).toHaveCount(0)
    await expect(page.getByRole('button', { name: '¿Cómo se decidió?' })).toHaveCount(0)
    await expect(page.getByText(/Mayoría simple|habilitados|Sin mayoría|Desempate en el último puesto/)).toHaveCount(0)
  })
}
