import { expect, test, type Locator, type Page } from '@playwright/test'

const api = '**/api/v1/**'
const assembly = { id: 'a1', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' }
const prophets = ['Isaías', 'Daniel', 'Jeremías', 'Ezequiel', 'Oseas']
const options = prophets.map((label, index) => ({ id: `o${index}`, label }))
const committee = {
  id: 'r1', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, runoff: false,
  participationCount: 36, eligibleCount: 40, options,
  results: [30, 20, 25, 20, 13].map((count, index) => ({ optionId: `o${index}`, label: prophets[index]!, count })),
  outcome: { seats: 3, base: 40, threshold: 21, elected: ['o0', 'o2'], runoff: ['o1', 'o3'], openSeats: 1 },
  explanation: { rule: 'simple', reasons: { o0: 'elected', o2: 'elected', o1: 'no_majority', o3: 'no_majority', o4: 'out' }, baseDelegates: 40, baseIncludesSecretary: false },
}
const committeeRows = [
  ['Isaías', 30, 75],
  ['Jeremías', 25, 63],
  ['Daniel', 20, 50],
  ['Ezequiel', 20, 50],
  ['Oseas', 13, 33],
  ['No votaron', 4, 10],
] as const
const decision = {
  id: 'd1', title: 'Reforma de estatutos', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'simple', voteNumber: 1, runoff: false,
  participationCount: 36, eligibleCount: 40, options: [{ id: 'favor', label: 'A favor' }, { id: 'contra', label: 'En contra' }],
  results: [{ optionId: 'favor', label: 'A favor', count: 14 }, { optionId: 'contra', label: 'En contra', count: 22 }],
  outcome: { seats: 1, base: 40, threshold: 21, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: false },
  explanation: { rule: 'simple', reasons: {}, baseDelegates: 40, baseIncludesSecretary: false },
}
const evenDecision = {
  ...decision,
  results: [{ optionId: 'favor', label: 'A favor', count: 18 }, { optionId: 'contra', label: 'En contra', count: 18 }],
}

const tiedCommittee = {
  id: 't1', title: 'Comisión de Música', status: 'published', category: 'committee', memberCount: 2, electionSeats: 2, voteNumber: 1, runoff: false,
  participationCount: 12, eligibleCount: 12, options,
  results: [8, 7, 7, 1, 1].map((count, index) => ({ optionId: `o${index}`, label: prophets[index]!, count })),
  outcome: { seats: 2, base: 12, threshold: 7, elected: ['o0'], runoff: ['o1', 'o2'], openSeats: 1 },
  explanation: { rule: 'simple', reasons: { o0: 'elected', o1: 'tied_at_cut', o2: 'tied_at_cut', o3: 'out', o4: 'out' }, baseDelegates: 12, baseIncludesSecretary: false },
}

function rowPattern([label, count, percent]: readonly [string, number, number]) {
  return new RegExp(`^${label}\\D*${count} ${count === 1 ? 'voto' : 'votos'}\\s*${percent} %$`)
}

async function expectRows(rows: Locator, expected: ReadonlyArray<readonly [string, number, number]>) {
  await expect(rows).toHaveCount(expected.length)
  for (const [index, row] of expected.entries()) await expect(rows.nth(index)).toHaveText(rowPattern(row))
}

async function mesaWith(page: Page, round: Record<string, unknown>) {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'a1')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    if (request.method() === 'GET' && new URL(request.url()).pathname.endsWith('/moderator/assemblies/a1')) {
      const { results: _results, outcome: _outcome, explanation: _explanation, ...current } = round
      await route.fulfill({ json: {
        assembly, participants: [{ id: 'p1', firstName: 'Delegado', lastName: '1' }], participantCount: 40, eligibleCount: 40, recordedCount: 36,
        currentRound: current, rounds: [round],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
  await page.goto('/moderator')
}

async function projectorWith(page: Page, round: Record<string, unknown>) {
  const { results, outcome, explanation, ...current } = round
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: { assembly, participantCount: 40, recordedCount: 36, eligibleCount: 40, round: current, results, outcome, explanation } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
  await page.goto('/projector?code=DEMO-ROOM')
}

for (const [where, scope] of [['published result', '.ballot-card'], ['results record', '.official-history']] as const) {
  test(`the mesa ${where} lists rows by votes with «No votaron» last and no position numbers`, async ({ page }) => {
    await mesaWith(page, committee)
    const area = page.locator(scope)
    await expectRows(area.locator('.ranked-rows > li'), committeeRows)
    await expect(area.locator('.rank-number')).toHaveCount(0)
  })

  test(`the mesa ${where} shows the base sum and the names each ballot marks`, async ({ page }) => {
    await mesaWith(page, committee)
    const area = page.locator(scope)
    await expect(area.getByText('36 votaron + 4 no votaron = 40', { exact: true })).toBeVisible()
    await expect(area.getByText('Cada papeleta marca 3 nombres · 3 × 36 = 108 votos', { exact: true })).toBeVisible()
  })

  test(`the mesa ${where} orders a decision by votes and never marks it tied`, async ({ page }) => {
    await mesaWith(page, decision)
    const area = page.locator(scope)
    await expectRows(area.locator('.ranked-rows > li'), [['En contra', 22, 55], ['A favor', 14, 35], ['No votaron', 4, 10]])
    await expect(area.getByText(/Cada papeleta marca/)).toHaveCount(0)
  })

  test(`the mesa ${where} does not mark an even decision as tied`, async ({ page }) => {
    await mesaWith(page, evenDecision)
    const area = page.locator(scope)
    await expectRows(area.locator('.ranked-rows > li'), [['A favor', 18, 45], ['En contra', 18, 45], ['No votaron', 4, 10]])
    await expect(area.locator('.ranked-rows .badge-warning')).toHaveCount(0)
  })
}

for (const [where, scope] of [['published result', '.ballot-card'], ['results record', '.official-history']] as const) {
  test(`the mesa ${where} marks rows tied at the cut as «Desempate»`, async ({ page }) => {
    await mesaWith(page, tiedCommittee)
    const rows = page.locator(scope).locator('.ranked-rows > li')
    await expect(rows.locator('.badge-warning')).toHaveText(['Desempate', 'Desempate'])
    await expect(rows.nth(1)).toContainText('Daniel')
    await expect(rows.nth(2)).toContainText('Jeremías')
  })

  test(`the mesa ${where} keeps «Desempate» on rows that continue without a majority`, async ({ page }) => {
    await mesaWith(page, committee)
    const rows = page.locator(scope).locator('.ranked-rows > li')
    await expect(rows.locator('.badge-warning')).toHaveText(['Desempate', 'Desempate'])
  })
}

test('the projector marks rows tied at the cut and rows without a majority as «Desempate»', async ({ page }) => {
  await projectorWith(page, tiedCommittee)
  await expect(page.locator('.pj-results .pj-tie')).toHaveText(['Desempate', 'Desempate'])
  await page.unrouteAll({ behavior: 'ignoreErrors' })
  await projectorWith(page, committee)
  await expect(page.locator('.pj-results .pj-tie')).toHaveText(['Desempate', 'Desempate'])
})

test('the projector lists rows by votes with «No votaron» last and no position numbers', async ({ page }) => {
  await projectorWith(page, committee)
  const rows = page.locator('.pj-results li')
  await expect(rows).toHaveCount(committeeRows.length)
  for (const [index, [label, count, percent]] of committeeRows.entries()) {
    await expect(rows.nth(index).locator('.pj-label')).toHaveText(label)
    await expect(rows.nth(index).locator('.pj-votes')).toHaveText(`${count} votos`)
    await expect(rows.nth(index).locator('.pj-percent')).toHaveText(`${percent} %`)
  }
  await expect(page.locator('.pj-rank')).toHaveCount(0)
})

test('the projector shows the base sum and the names each ballot marks', async ({ page }) => {
  await projectorWith(page, committee)
  await expect(page.getByText('36 votaron + 4 no votaron = 40', { exact: true })).toBeVisible()
  await expect(page.getByText('Cada papeleta marca 3 nombres · 3 × 36 = 108 votos', { exact: true })).toBeVisible()
})

test('the projector orders a decision by votes and never marks an even split as tied', async ({ page }) => {
  for (const [round, expected] of [[decision, ['En contra', 'A favor', 'No votaron']], [evenDecision, ['A favor', 'En contra', 'No votaron']]] as const) {
    await projectorWith(page, round)
    await expect(page.locator('.pj-results li .pj-label')).toHaveText([...expected])
    await expect(page.locator('.pj-results .pj-tie')).toHaveCount(0)
    await expect(page.getByText(/Cada papeleta marca/)).toHaveCount(0)
    await page.unrouteAll({ behavior: 'ignoreErrors' })
  }
})
