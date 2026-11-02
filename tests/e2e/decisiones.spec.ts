import { expect, test, type Page } from '@playwright/test'

// Decisions (#42): A favor / En contra or options, approved with mayoría simple or 3/4 of the habilitados.

const api = '**/api/v1/**'

async function asModerator(page: Page) {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
}

const budgetOptions = [{ id: 'favor', label: 'A favor' }, { id: 'contra', label: 'En contra' }]

test('la mesa prepara una decisión A favor / En contra con 3/4 y otra con opciones (M23)', async ({ page }) => {
  const bodies: Array<Record<string, any>> = []
  await asModerator(page)
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético' }], participantCount: 1, rounds: [], attendanceRound: null,
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/rounds')) {
      bodies.push(request.postDataJSON())
      await route.fulfill({ status: 201, json: { id: `r${bodies.length}` } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for decision form test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await expect(page.getByRole('radiogroup', { name: '¿Qué se vota?' }).getByRole('radio')).toHaveText(['Cargo', 'Comisión', 'Decisión'])
  await page.getByRole('radio', { name: 'Decisión' }).click()
  await page.getByLabel('Decisión', { exact: true }).fill('Presupuesto 2027')
  await expect(page.getByRole('radio', { name: 'A favor / En contra' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByRole('radio', { name: 'Mayoría simple' })).toHaveAttribute('aria-checked', 'true')
  await expect(page.getByLabel('Agregar opción')).toHaveCount(0)
  await page.getByRole('radio', { name: '3/4' }).click()
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect.poll(() => bodies.length).toBe(1)
  expect(bodies[0]).toEqual({ title: 'Presupuesto 2027', format: 'single_choice', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters' })

  // The form resets to A favor / En contra and mayoría simple; the mesa now writes the options.
  await expect(page.getByLabel('Decisión', { exact: true })).toHaveValue('')
  await page.getByLabel('Decisión', { exact: true }).fill('Sede de la Asamblea 2027')
  await page.getByRole('radio', { name: 'Opciones' }).click()
  await page.getByLabel('Agregar opción').fill('Tegucigalpa')
  await page.getByLabel('Agregar opción').press('Enter')
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect(page.getByRole('alert')).toContainText('Agrega al menos dos opciones')
  await page.getByLabel('Agregar opción').fill('San Pedro Sula')
  await page.getByLabel('Agregar opción').press('Enter')
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect.poll(() => bodies.length).toBe(2)
  expect(bodies[1]).toEqual({
    title: 'Sede de la Asamblea 2027', format: 'single_choice', category: 'decision', decisionFormat: 'options', approvalRule: 'simple',
    options: [{ label: 'Tegucigalpa' }, { label: 'San Pedro Sula' }],
  })
})

test('la mesa ve «Aprobada» y la regla en una decisión cerrada, y «No aprobada» en el acta', async ({ page }) => {
  await asModerator(page)
  const approved = {
    id: 'presupuesto', title: 'Presupuesto 2027', status: 'closed', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters', voteNumber: 1, runoff: false,
    participationCount: 36, eligibleCount: 38, options: budgetOptions,
    privateResults: [{ optionId: 'favor', label: 'A favor', count: 30 }, { optionId: 'contra', label: 'En contra', count: 6 }],
    outcome: { seats: 1, base: 38, threshold: 29, elected: [], runoff: [], openSeats: 0, rule: 'three_quarters', approved: true }, officialResult: null,
  }
  const rejected = {
    id: 'estatutos', title: 'Reforma de estatutos', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'simple', voteNumber: 1, runoff: false,
    participationCount: 38, eligibleCount: 38, options: [{ id: 'f2', label: 'A favor' }, { id: 'c2', label: 'En contra' }],
    results: [{ optionId: 'f2', label: 'A favor', count: 19 }, { optionId: 'c2', label: 'En contra', count: 19 }],
    outcome: { seats: 1, base: 38, threshold: 20, elected: [], runoff: [], openSeats: 0, rule: 'simple', approved: false }, officialResult: null,
  }
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [rejected, approved], currentRound: approved } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot).toContainText('VOTACIÓN CERRADA')
  await expect(ballot.locator('.majority-chip')).toHaveText('Se aprueba con 3/4 · 29 votos')
  await expect(ballot.locator('.decision-verdict')).toHaveText('Aprobada')
  await expect(ballot.locator('.ranked-rows > li').nth(0)).toHaveText(/A favor\s*30 votos\s*79 %/)
  await expect(ballot.locator('.ranked-rows .badge')).toHaveCount(0)
  const acta = page.locator('#acta-de-resultados')
  await expect(acta.locator('.official-round').nth(0)).toContainText('Decisión · Se aprueba con mayoría simple · 20 votos')
  await expect(acta.locator('.official-round').nth(0).locator('.declared-result')).toHaveText('No aprobada')
  await expect(acta.locator('.official-round').nth(0).locator('.badge-warning')).toHaveCount(0)
})

test('una decisión con opciones sin la mayoría marca Desempate y prepara la 2.ª votación entre las dos primeras', async ({ page }) => {
  let opened = ''
  await asModerator(page)
  const labels = ['Tegucigalpa', 'San Pedro Sula', 'La Ceiba', 'Choluteca']
  const counts = [14, 12, 6, 4]
  const first = {
    id: 'sede', title: 'Sede de la Asamblea 2027', status: 'published', category: 'decision', decisionFormat: 'options', approvalRule: 'simple', voteNumber: 1, runoff: false,
    participationCount: 36, eligibleCount: 38, options: labels.map((label, index) => ({ id: `o${index}`, label })),
    results: labels.map((label, index) => ({ optionId: `o${index}`, label, count: counts[index] })),
    outcome: { seats: 1, base: 38, threshold: 20, elected: [], runoff: ['o0', 'o1'], openSeats: 1, rule: 'simple', approved: false }, officialResult: null,
  }
  const repeat = {
    id: 'sede-2', title: 'Sede de la Asamblea 2027', status: 'draft', category: 'decision', decisionFormat: 'options', approvalRule: 'simple', voteNumber: 2, runoff: true,
    committeeRootRoundId: 'sede', runoffSourceRoundId: 'sede', options: labels.slice(0, 2).map((label, index) => ({ id: `r${index}`, label })), officialResult: null,
  }
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [first, repeat], currentRound: first } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/open')) {
      opened = url.pathname
      await route.fulfill({ status: 201, json: { roundId: 'sede-2', status: 'open' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot.locator('.majority-chip')).toHaveText('Se aprueba con mayoría simple · 20 votos')
  await expect(ballot.locator('.decision-verdict')).toHaveCount(0)
  await expect(ballot.locator('.ranked-rows > li .badge-warning')).toHaveText(['Desempate', 'Desempate'])
  await ballot.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir votación' }).click()
  await expect.poll(() => opened).toContain('/moderator/rounds/sede-2/open')
})

test('el teléfono vota una decisión A favor / En contra con una sola opción (T03) y ve el resultado', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'decision-session'))
  let recorded = false
  let published = false
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const round = { id: 'presupuesto', title: 'Presupuesto 2027', status: published ? 'published' : 'open', format: 'single_choice', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters', options: budgetOptions }
      await route.fulfill({ json: {
        assembly: { id: 'decision-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: recorded ? 'recorded' : 'pending', currentRound: round,
        ...(published ? {
          results: [{ optionId: 'favor', label: 'A favor', count: 30 }, { optionId: 'contra', label: 'En contra', count: 6 }], recordedCount: 36, eligibleCount: 38,
          outcome: { seats: 1, base: 38, threshold: 29, elected: [], runoff: [], openSeats: 0, rule: 'three_quarters', approved: true },
        } : {}),
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/presupuesto/vote')) {
      expect(request.postDataJSON()).toEqual({ optionId: 'favor', confirmation: true })
      recorded = true
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for decision ballot test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Presupuesto 2027' })).toBeVisible()
  await expect(page.locator('.phone-status')).toHaveText('VOTACIÓN ABIERTA')
  await expect(page.getByRole('radio')).toHaveCount(2)
  await expect(page.locator('.count-pill')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toBeDisabled()
  await page.getByLabel('En contra').check()
  await page.getByLabel('A favor').check()
  await expect(page.getByLabel('En contra')).not.toBeChecked()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details')).toContainText('A favor')
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()

  published = true
  await page.reload()
  await expect(page.locator('.official-card')).toHaveText(/RESULTADO\s*Aprobada/)
  await expect(page.locator('.phone-results .ranked-rows > li').nth(0)).toHaveText(/A favor\s*30 votos\s*79 %/)
})

test('el teléfono vota una decisión con opciones (T04)', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'decision-session'))
  const options = ['Tegucigalpa', 'San Pedro Sula', 'La Ceiba', 'Choluteca'].map((label, index) => ({ id: `o${index}`, label }))
  let voted: unknown
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'decision-assembly', name: 'Asamblea prueba', status: 'in_progress' }, participationStatus: voted ? 'recorded' : 'pending',
        currentRound: { id: 'sede', title: 'Sede de la Asamblea 2027', status: 'open', format: 'single_choice', category: 'decision', decisionFormat: 'options', approvalRule: 'simple', options },
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/sede/vote')) {
      voted = request.postDataJSON()
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/')
  await expect(page.getByRole('radio')).toHaveCount(4)
  await page.getByLabel('San Pedro Sula').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(voted).toEqual({ optionId: 'o1', confirmation: true })
})

for (const approved of [true, false]) {
  test(`el proyector muestra «${approved ? 'Aprobada' : 'No aprobada'}», la regla y los porcentajes sobre los habilitados (P21)`, async ({ page }) => {
    const counts = approved ? [30, 6] : [27, 9]
    await page.route(api, async (route) => {
      if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
        await route.fulfill({ json: {
          assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
          participantCount: 38, recordedCount: 36, eligibleCount: 38,
          round: { id: 'presupuesto', title: 'Presupuesto 2027', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters', voteNumber: 1, runoff: false },
          // Ranked by votes; the projector still shows A favor first.
          results: [{ optionId: 'contra', label: 'En contra', count: counts[1] }, { optionId: 'favor', label: 'A favor', count: counts[0] }].sort((a, b) => b.count - a.count),
          outcome: { seats: 1, base: 38, threshold: 29, elected: [], runoff: [], openSeats: 0, rule: 'three_quarters', approved },
        } })
        return
      }
      await route.fulfill({ status: 404, json: { message: 'No mock route' } })
    })

    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.getByRole('heading', { name: 'Presupuesto 2027' })).toBeVisible()
    await expect(page.locator('.pj-subtitle')).toHaveText('Se aprueba con 3/4 · 29 votos')
    await expect(page.locator('.pj-elected h2')).toHaveText(approved ? '✓ Aprobada' : 'No aprobada')
    const rows = page.locator('.pj-results li')
    await expect(rows.nth(0)).toHaveText(new RegExp(`^A favor\\s*${counts[0]} votos\\s*${Math.round((counts[0]! / 38) * 100)} %$`))
    await expect(rows.nth(1)).toHaveText(new RegExp(`^En contra\\s*${counts[1]} votos\\s*${Math.round((counts[1]! / 38) * 100)} %$`))
    await expect(page.locator('.pj-rank')).toHaveCount(0)
    await expect(page.locator('.pj-results em')).toHaveCount(0)
  })
}

test('el proyector marca la opción aprobada de una decisión con opciones', async ({ page }) => {
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 38, recordedCount: 37, eligibleCount: 38,
        round: { id: 'sede-2', title: 'Sede de la Asamblea 2027', status: 'published', category: 'decision', decisionFormat: 'options', approvalRule: 'simple', voteNumber: 2, runoff: true },
        results: [{ optionId: 's', label: 'San Pedro Sula', count: 22 }, { optionId: 't', label: 'Tegucigalpa', count: 15 }],
        outcome: { seats: 1, base: 38, threshold: 20, elected: ['s'], runoff: [], openSeats: 0, rule: 'simple', approved: true },
        officialResult: { elected: [{ optionId: 's', label: 'San Pedro Sula' }], note: null, declaredAt: '2026-11-02T10:00:00.000Z' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('.pj-subtitle')).toHaveText('Se aprueba con mayoría simple · 20 votos')
  await expect(page.locator('.pj-elected')).toContainText('San Pedro Sula')
  await expect(page.locator('.pj-results li').nth(0).locator('.pj-elected-tag')).toHaveText('✓ Aprobada')
})
