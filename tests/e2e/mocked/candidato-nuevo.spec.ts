import { expect, test, type Page } from '@playwright/test'

const api = '**/api/v1/**'

async function signedInMesa(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
}

const root = {
  id: 'presidencia', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 1, runoff: false, participationCount: 36, eligibleCount: 38,
  options: [{ id: 'm', label: 'María López' }, { id: 'c', label: 'Carlos Gómez' }],
  results: [{ optionId: 'm', label: 'María López', count: 18 }, { optionId: 'c', label: 'Carlos Gómez', count: 18 }],
  outcome: { seats: 1, base: 38, threshold: 20, elected: [], runoff: ['m', 'c'], openSeats: 1 }, officialResult: null,
}

test('desde la 3.ª votación la mesa agrega un candidato «Nuevo», lo puede quitar y abre la votación (M22)', async ({ page }) => {
  await signedInMesa(page)
  const requests: string[] = []
  const second = {
    id: 'presidencia-2', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 2, runoff: true, committeeRootRoundId: 'presidencia', runoffSourceRoundId: 'presidencia',
    participationCount: 36, eligibleCount: 38, options: [{ id: 'm2', label: 'María López' }, { id: 'c2', label: 'Carlos Gómez' }],
    results: [{ optionId: 'm2', label: 'María López', count: 18 }, { optionId: 'c2', label: 'Carlos Gómez', count: 18 }],
    outcome: { seats: 1, base: 38, threshold: 20, elected: [], runoff: ['m2', 'c2'], openSeats: 1 }, officialResult: null,
  }
  const third = {
    id: 'presidencia-3', title: 'Presidencia', status: 'draft', category: 'office', voteNumber: 3, runoff: true, committeeRootRoundId: 'presidencia', runoffSourceRoundId: 'presidencia-2',
    options: [{ id: 'm3', label: 'María López', isNew: false }, { id: 'c3', label: 'Carlos Gómez', isNew: false }], officialResult: null,
  }
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [root, second, third], currentRound: second } })
      return
    }
    if (url.pathname.includes('/moderator/rounds/')) requests.push(`${request.method()} ${url.pathname.replace(/^.*\/moderator/, '')}`)
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/presidencia-3/candidates')) {
      const option = { id: 'r3', label: (request.postDataJSON() as { label: string }).label, isNew: true }
      third.options.push(option)
      await route.fulfill({ status: 201, json: { roundId: 'presidencia-3', option: { ...option, order: 2 } } })
      return
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith('/moderator/rounds/presidencia-3/candidates/r3')) {
      third.options = third.options.filter((option) => option.id !== 'r3')
      await route.fulfill({ json: { roundId: 'presidencia-3', optionId: 'r3', removed: true } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/presidencia-3/open')) {
      await route.fulfill({ status: 201, json: { roundId: 'presidencia-3', status: 'open', title: 'Presidencia' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for new candidate test' } })
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot).toContainText('DESEMPATE · 2.ª VOTACIÓN')
  await ballot.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  // The 3rd vote is shown before opening, so the mesa may add a candidate; nothing is opened yet.
  await expect(page.getByRole('dialog')).toHaveCount(0)
  await expect(ballot.locator('.eyebrow').first()).toHaveText('DESEMPATE · 3.ª VOTACIÓN')
  await expect(ballot.getByRole('heading', { name: 'Presidencia' })).toBeVisible()
  await expect(page.locator('.workflow-steps li.current')).toContainText('Papeleta')
  const rows = ballot.locator('.runoff-candidates > li')
  await expect(rows).toHaveCount(2)
  await expect(ballot.getByRole('button', { name: /^Quitar/ })).toHaveCount(0)
  await expect(ballot.getByRole('button', { name: '+ Agregar' })).toBeDisabled()

  const name = ballot.getByRole('textbox', { name: 'Nombre del candidato' })
  await name.fill('Rosa Díaz')
  await ballot.getByRole('button', { name: '+ Agregar' }).click()
  await expect(rows).toHaveCount(3)
  await expect(rows.nth(2)).toHaveText(/^3\s*Rosa Díaz\s*Nuevo\s*Quitar$/)
  await expect(rows.nth(0).locator('.badge')).toHaveCount(0)
  await expect(name).toHaveValue('')
  expect(requests).toContain('POST /rounds/presidencia-3/candidates')

  await ballot.getByRole('button', { name: 'Quitar Rosa Díaz' }).click()
  await expect(rows).toHaveCount(2)
  expect(requests).toContain('DELETE /rounds/presidencia-3/candidates/r3')

  await name.fill('Rosa Díaz')
  await name.press('Enter')
  await expect(rows.nth(2)).toContainText('Nuevo')
  await ballot.getByRole('button', { name: 'Abrir votación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir votación' }).click()
  await expect.poll(() => requests).toContain('POST /rounds/presidencia-3/open')
})

test('el primer desempate (2.ª votación) se abre directamente, sin agregar candidatos', async ({ page }) => {
  await signedInMesa(page)
  let opened = ''
  const second = {
    id: 'presidencia-2', title: 'Presidencia', status: 'draft', category: 'office', voteNumber: 2, runoff: true, committeeRootRoundId: 'presidencia', runoffSourceRoundId: 'presidencia',
    options: [{ id: 'm2', label: 'María López' }, { id: 'c2', label: 'Carlos Gómez' }], officialResult: null,
  }
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [root, second], currentRound: root } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/open')) {
      opened = url.pathname
      await route.fulfill({ status: 201, json: { roundId: 'presidencia-2', status: 'open' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/moderator')
  await page.locator('.ballot-card').getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(page.getByRole('textbox', { name: 'Nombre del candidato' })).toHaveCount(0)
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir votación' }).click()
  await expect.poll(() => opened).toContain('/moderator/rounds/presidencia-2/open')
})
