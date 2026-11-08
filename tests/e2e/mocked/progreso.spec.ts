import { expect, test, type Page } from '@playwright/test'

const api = '**/api/v1/**'
const prophets = [{ id: 'i', label: 'Isaías' }, { id: 'j', label: 'Jeremías' }, { id: 'e', label: 'Ezequiel' }]
const pair = prophets.slice(0, 2)

const budget = {
  id: 'presupuesto', title: 'Presupuesto 2027', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters', voteNumber: 1, runoff: false,
  participationCount: 36, eligibleCount: 38, options: [{ id: 'f', label: 'A favor' }, { id: 'c', label: 'En contra' }],
  results: [{ optionId: 'f', label: 'A favor', count: 30 }, { optionId: 'c', label: 'En contra', count: 6 }],
  outcome: { seats: 1, base: 38, threshold: 29, elected: [], runoff: [], openSeats: 0, rule: 'three_quarters', approved: true }, officialResult: null,
}
const first = {
  id: 'presidencia', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 1, runoff: false, participationCount: 36, eligibleCount: 38, options: prophets,
  results: [{ optionId: 'i', label: 'Isaías', count: 17 }, { optionId: 'j', label: 'Jeremías', count: 17 }, { optionId: 'e', label: 'Ezequiel', count: 2 }],
  outcome: { seats: 1, base: 38, threshold: 20, elected: [], runoff: ['i', 'j'], openSeats: 1 }, officialResult: null,
}
const annulled = {
  id: 'presidencia-2', title: 'Presidencia', status: 'annulled', category: 'office', voteNumber: 2, runoff: true, committeeRootRoundId: 'presidencia', runoffSourceRoundId: 'presidencia',
  annulReason: 'Nombre mal escrito', options: pair, officialResult: null,
}

function repeated(status: 'open' | 'closed') {
  return { id: 'presidencia-3', title: 'Presidencia', status, category: 'office', voteNumber: 2, runoff: true, committeeRootRoundId: 'presidencia', runoffSourceRoundId: 'presidencia', options: pair, officialResult: null }
}

async function mesaWith(page: Page, current: ReturnType<typeof repeated>) {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  const requests: string[] = []
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() !== 'GET') requests.push(`${request.method()} ${url.pathname}`)
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [budget, first, annulled, current], currentRound: current } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for vote progress test' } })
  })
  await page.goto('/moderator')
  return requests
}

test('la mesa ve una pestaña por elección y decisión, con cada votación en una columna en orden', async ({ page }) => {
  await mesaWith(page, repeated('open'))
  const progress = page.locator('.election-progress')
  await expect(progress.getByRole('tab')).toHaveText(['Presupuesto 2027', 'Presidencia'])
  await expect(progress.getByRole('tab', { name: 'Presidencia' })).toHaveAttribute('aria-selected', 'true')
  const columns = progress.getByRole('tabpanel').locator('.progress-column')
  await expect(columns.locator('.progress-heading')).toHaveText(['1.ª VOTACIÓN', 'DESEMPATE · 2.ª VOTACIÓN', 'DESEMPATE · 2.ª VOTACIÓN'])

  const counted = columns.nth(0)
  await expect(counted.locator('.progress-rows li')).toHaveText([/Isaías\s*17\s*Desempate/, /Jeremías\s*17\s*Desempate/, /Ezequiel\s*2/])
  await expect(counted.locator('.progress-needed')).toHaveText('Mayoría: 20')
  await expect(counted.locator('.progress-outcome')).toHaveText('Pasan a la siguiente votación: Isaías y Jeremías')
  await expect(counted.locator('.progress-next')).toHaveText('Corresponde desempate por 1 puesto')

  const voided = columns.nth(1)
  await expect(voided.locator('.progress-state')).toHaveText('Anulada')
  await expect(voided).toContainText('Nombre mal escrito')
  await expect(voided.locator('.progress-rows, .progress-needed, .progress-outcome, .progress-next')).toHaveCount(0)

  const open = columns.nth(2)
  await expect(open.locator('.progress-state')).toHaveText('Votación abierta')
  await expect(open.locator('.progress-options li')).toHaveText(['Isaías', 'Jeremías'])
  await expect(open.locator('.progress-rows, .progress-needed, .progress-outcome, .progress-next')).toHaveCount(0)
})

test('una votación cerrada no muestra conteos hasta que la pantalla pública los muestra', async ({ page }) => {
  await mesaWith(page, repeated('closed'))
  const column = page.locator('.election-progress .progress-column').nth(2)
  await expect(column.locator('.progress-state')).toHaveText('Preparando el resultado')
  await expect(column.locator('.progress-options li')).toHaveText(['Isaías', 'Jeremías'])
  await expect(column.locator('.progress-rows, .progress-needed, .progress-outcome, .progress-next')).toHaveCount(0)
})

test('la pestaña de una decisión muestra su regla, su resultado y que está tomada', async ({ page }) => {
  await mesaWith(page, repeated('open'))
  const progress = page.locator('.election-progress')
  await progress.getByRole('tab', { name: 'Presupuesto 2027' }).click()
  await expect(progress.getByRole('tab', { name: 'Presupuesto 2027' })).toHaveAttribute('aria-selected', 'true')
  const column = progress.getByRole('tabpanel').locator('.progress-column')
  await expect(column).toHaveCount(1)
  await expect(column.locator('.progress-rows li')).toHaveText([/A favor\s*30/, /En contra\s*6/])
  await expect(column.locator('.progress-needed')).toHaveText('Se aprueba con 3/4 · 29 votos')
  await expect(column.locator('.progress-outcome')).toHaveText('Aprobada')
  await expect(column.locator('.progress-next')).toHaveText('Decisión tomada')
})

test('el avance de votaciones solo se consulta: cambiar de pestaña no envía nada y no usa palabras de competencia', async ({ page }) => {
  const requests = await mesaWith(page, repeated('open'))
  const progress = page.locator('.election-progress')
  await expect(progress.getByRole('tab')).toHaveCount(2)
  await expect(progress.locator('button:not([role="tab"]), input, select, textarea, a')).toHaveCount(0)
  await progress.getByRole('tab', { name: 'Presupuesto 2027' }).click()
  await progress.getByRole('tab', { name: 'Presidencia' }).click()
  expect(requests).toEqual([])
  await expect(progress).not.toContainText(/elimina|ganador|gana|perd|🏆/i)
})

test('el teléfono y el proyector no muestran el avance de votaciones', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'progress-session'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: { assembly: { id: 'a', name: 'Asamblea prueba', status: 'in_progress' }, participationStatus: 'pending', currentRound: repeated('open'), rounds: [budget, first, annulled, repeated('open')] } })
      return
    }
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: { assembly: { id: 'a', name: 'Asamblea prueba', status: 'in_progress' }, round: repeated('open'), rounds: [budget, first, annulled, repeated('open')] } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
  await page.goto('/')
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toBeVisible()
  await expect(page.locator('.election-progress')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/Presupuesto 2027|Mayoría|Corresponde/)
  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByText('Presidencia').first()).toBeVisible()
  await expect(page.locator('.election-progress')).toHaveCount(0)
  await expect(page.locator('body')).not.toContainText(/Presupuesto 2027|Corresponde/)
})
