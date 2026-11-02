import { execFileSync } from 'node:child_process'
import { expect, test, type Page } from '@playwright/test'

/** Reads the downloaded acta sheet back as typed values: inline strings stay strings, <v> cells are numbers. */
function sheetRows(xml: string) {
  const unescape = (text: string) => text.replace(/&quot;/g, '"').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&amp;/g, '&')
  return [...xml.matchAll(/<row [^>]*>(.*?)<\/row>/g)].map(([, row]) => [...row!.matchAll(/<c [^>]*?(t="inlineStr")?>(.*?)<\/c>/g)]
    .map(([, inline, body]) => inline ? unescape(body!.replace(/^<is><t xml:space="preserve">|<\/t><\/is>$/g, '')) : Number(body!.replace(/<\/?v>/g, ''))))
}

const api = '**/api/v1/**'

/** Without a socket the app polls every 7 s; advancing the fake clock past that refreshes the state in place. */
async function refreshByPolling(page: Page) {
  const request = page.waitForRequest((req) => req.url().includes('/api/v1/'))
  await page.clock.runFor(8_000)
  await request
}

function participantState(participationStatus: 'pending' | 'recorded' = 'pending') {
  return {
    assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
    participationStatus,
    currentRound: {
      id: 'synthetic-round',
      title: 'Elección de prueba',
      status: 'open',
      options: [
        { id: 'synthetic-option-a', label: 'Opción Alfa (prueba)' },
        { id: 'synthetic-option-b', label: 'Opción Beta (prueba)' },
      ],
    },
  }
}

test('delegado ingresa con datos sintéticos y confirma su participación', async ({ page }) => {
  let voteCount = 0
  let releaseVote: (() => void) | undefined
  let markVoteStarted: (() => void) | undefined
  const votePending = new Promise<void>((resolve) => { releaseVote = resolve })
  const voteStarted = new Promise<void>((resolve) => { markVoteStarted = resolve })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      await route.fulfill({ json: { participantSessionToken: 'synthetic-participant-token', ...participantState() } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState(voteCount ? 'recorded' : 'pending') })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/synthetic-round/vote')) {
      voteCount += 1
      markVoteStarted?.()
      await votePending
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('navigation')).toHaveCount(0)
  await expect(page.getByRole('link', { name: 'Moderación' })).toHaveCount(0)
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Sintético')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()

  await page.getByLabel('Opción Alfa (prueba)').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.getByRole('heading', { name: 'Confirma tu voto' })).toBeFocused()
  await expect(page.locator('.review-details').getByText('Elección de prueba', { exact: true })).toBeVisible()
  await expect(page.locator('.review-details').getByText('Opción Alfa (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(page.getByLabel('Opción Alfa (prueba)')).toBeChecked()
  expect(voteCount).toBe(0)

  await page.getByLabel('Opción Beta (prueba)').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details').getByText('Opción Beta (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await voteStarted
  await expect(page.getByRole('button', { name: 'Enviando…' })).toBeDisabled()
  expect(voteCount).toBe(1)
  releaseVote?.()

  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  await page.reload()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  expect(voteCount).toBe(1)
})

test('delegado vota en comisión marcando exactamente los cupos', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'committee-session'))
  let recorded = false
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: recorded ? 'recorded' : 'pending',
        currentRound: { id: 'committee-round', title: 'Comisión de Finanzas', status: 'open', format: 'multiple_choice', category: 'committee', memberCount: 2, electionSeats: 2, options: [
          { id: 'candidate-a', label: 'Ana (prueba)' }, { id: 'candidate-b', label: 'Beto (prueba)' }, { id: 'candidate-c', label: 'Celia (prueba)' },
        ] },
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/committee-round/vote')) {
      expect(request.postDataJSON()).toEqual({ optionIds: ['candidate-a', 'candidate-b'], confirmation: true })
      recorded = true
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for secret committee ballot test' } })
  })

  await page.goto('/')
  await expect(page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
  await expect(page.getByRole('group', { name: '0 de 2' })).toBeVisible()
  await expect(page.getByText('0 de 2', { exact: true })).toBeVisible()
  const review = page.getByRole('button', { name: 'Revisar mi voto' })
  await expect(review).toBeDisabled()
  await page.getByLabel('Ana (prueba)').check()
  await expect(review).toBeDisabled()
  await page.getByLabel('Beto (prueba)').check()
  await expect(page.getByRole('group', { name: '2 de 2' })).toBeVisible()
  await expect(review).toBeEnabled()
  // Over the limit the box does not stay ticked, and no message is shown.
  await page.getByLabel('Celia (prueba)').click()
  await expect(page.getByLabel('Celia (prueba)')).not.toBeChecked()
  await expect(page.getByRole('group', { name: '2 de 2' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details')).toContainText('Ana (prueba), Beto (prueba)')
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
})

test('en un desempate se marcan exactamente los puestos que faltan y la papeleta no ofrece voto nulo', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'runoff-session'))
  let voted: unknown
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'committee-assembly', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: voted ? 'recorded' : 'pending',
        openRound: { roundId: 'finance-runoff', title: 'Comisión de Finanzas', status: 'open', format: 'multiple_choice', category: 'committee', memberCount: 3, electionSeats: 2, voteNumber: 2, runoff: true, options: [
          { optionId: 'candidate-b', label: 'Beto (prueba)' }, { optionId: 'candidate-c', label: 'Celia (prueba)' }, { optionId: 'candidate-d', label: 'Dora (prueba)' },
        ] },
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/finance-runoff/vote')) {
      voted = request.postDataJSON()
      await route.fulfill({ status: 201, json: { status: 'recorded' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for runoff test' } })
  })

  await page.goto('/')
  await expect(page.locator('.phone-status-open')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await expect(page.getByRole('group', { name: '0 de 2' })).toBeVisible()
  await expect(page.getByText(/voto nulo/i)).toHaveCount(0)
  const review = page.getByRole('button', { name: 'Revisar mi voto' })
  await expect(review).toBeDisabled()
  await expect(review).toHaveCSS('opacity', '0.4')
  await page.getByLabel('Beto (prueba)').check()
  await expect(page.getByRole('group', { name: '1 de 2' })).toBeVisible()
  await expect(review).toBeDisabled()
  await page.getByLabel('Dora (prueba)').check()
  await page.getByLabel('Celia (prueba)').click()
  await expect(page.getByLabel('Celia (prueba)')).not.toBeChecked()
  await expect(review).toBeEnabled()
  // Unmarking one drops below the seats again.
  await page.getByLabel('Dora (prueba)').uncheck()
  await expect(review).toBeDisabled()
  await page.getByLabel('Celia (prueba)').check()
  await review.click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(voted).toEqual({ optionIds: ['candidate-b', 'candidate-c'], confirmation: true })
})

test('moderador anula una papeleta con motivo y la repite con las mismas opciones; el acta marca el desempate calculado', async ({ page }) => {
  let annulled = false
  let repeated: Record<string, unknown> | null = null
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress',
        rounds: [
          { id: 'first', title: 'Presidencia', status: 'published', participationCount: 9, eligibleCount: 10, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gama' }],
            results: [{ optionId: 'b', label: 'Beta', count: 4 }, { optionId: 'a', label: 'Alfa', count: 4 }, { optionId: 'c', label: 'Gama', count: 1 }], officialResult: null,
            outcome: { seats: 1, base: 10, threshold: 6, elected: [], runoff: ['b', 'a'], openSeats: 1 } },
          { id: 'second', title: 'Secretaría', status: annulled ? 'annulled' : 'open', annulReason: annulled ? 'Nombre mal escrito' : null, options: [{ id: 'x', label: 'Rosa' }, { id: 'y', label: 'Pedro' }], officialResult: null },
        ],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/second/annul')) {
      expect(request.postDataJSON()).toEqual({ reason: 'Nombre mal escrito' })
      annulled = true
      await route.fulfill({ status: 201, json: { roundId: 'second', status: 'annulled' } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/second/repeat')) {
      repeated = request.postDataJSON()
      await route.fulfill({ status: 201, json: { id: 'third' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for annul test' } })
  })

  await page.goto('/moderator')
  const ranking = page.locator('.official-round').first().locator('.ranked-rows > li')
  await expect(ranking).toHaveCount(3)
  await expect(ranking.nth(0)).toHaveText(/^1\s*Beta\s*Desempate\s*4 votos\s*40 %/)
  await expect(ranking.nth(1)).toHaveText(/^2\s*Alfa\s*Desempate\s*4 votos\s*40 %/)
  await expect(ranking.nth(2)).toHaveText(/^3\s*Gama\s*1 voto\s*10 %/)
  await expect(page.locator('.official-round').first()).toContainText('9 de 10 votaron')
  await expect(page.locator('.official-round').first()).toContainText('Mayoría: 6')
  await expect(page.getByRole('button', { name: /Declarar|Repetir votación…/ })).toHaveCount(0)
  await expect(page.locator('.official-round').first()).not.toContainText('Voto nulo')

  await page.getByRole('button', { name: 'Anular votación' }).click()
  const annulDialog = page.getByRole('dialog')
  await expect(annulDialog).toContainText('se eliminarán y nunca se contarán')
  await expect(annulDialog.getByRole('button', { name: 'Anular papeleta' })).toBeDisabled()
  await annulDialog.getByLabel('Motivo (obligatorio, queda en el registro)').fill('Nombre mal escrito')
  await annulDialog.getByRole('button', { name: 'Anular papeleta' }).click()
  await expect(page.locator('.annulled-summary')).toContainText('PAPELETA ANULADA')
  await expect(page.locator('.annulled-summary')).toContainText('Nombre mal escrito')

  await page.locator('.annulled-summary').getByRole('button', { name: 'Repetir con las mismas opciones' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Repetir votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  expect(repeated).toEqual({ optionIds: ['x', 'y'] })
})

test('el teléfono muestra la declaración oficial aunque la última repetición esté cerrada sin publicar', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'declared-session'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assembly: { id: 'a', name: 'Asamblea prueba', status: 'in_progress' },
        participationStatus: 'recorded',
        openRound: { roundId: 'repeat', title: 'Presidencia — nueva votación', status: 'closed', format: 'single_choice', options: [] },
        officialResult: { elected: [{ optionId: 'm', label: 'María López' }], note: 'Electa por la Asamblea', declaredAt: '2026-10-14T10:00:00.000Z' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/')
  const official = page.locator('.official-card')
  await expect(official.getByText('RESULTADO OFICIAL', { exact: true })).toBeVisible()
  await expect(official).toContainText('María López')
  await expect(official).toContainText('Electa por la Asamblea')
  await expect(page.locator('.ranked-rows')).toHaveCount(0)
})

test('la mesa prepara una comisión escribiendo los candidatos y cuántos integrantes quedarán', async ({ page }) => {
  let createBody: Record<string, any> | undefined
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético' }], participantCount: 1, rounds: [], attendanceRound: null,
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/rounds')) {
      createBody = request.postDataJSON()
      await route.fulfill({ status: 201, json: { id: 'r1' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await page.getByRole('radio', { name: 'Una comisión' }).click()
  await expect(page.getByText('Nombramiento')).toHaveCount(0)
  await expect(page.getByText('Secretaría validó esta comisión')).toHaveCount(0)
  await page.getByLabel('Nombre de la comisión').fill('Comisión de Finanzas')
  await page.getByLabel('¿Cuántos integrantes quedarán en la comisión?').fill('2')
  await page.getByLabel('Agregar candidato').fill('Ana Reyes')
  await page.getByLabel('Agregar candidato').press('Enter')
  // Fewer candidates than seats is refused before reaching the server.
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect(page.getByRole('alert')).toContainText('Agrega al menos 2 candidatos')
  for (const name of ['Luis Mejía', 'Rosa Paz']) {
    await page.getByLabel('Agregar candidato').fill(name)
    await page.getByLabel('Agregar candidato').press('Enter')
  }
  await expect(page.locator('.candidate-rows > li')).toHaveText([/Ana Reyes/, /Luis Mejía/, /Rosa Paz/])
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect.poll(() => createBody).toBeTruthy()
  expect(createBody).toMatchObject({
    title: 'Comisión de Finanzas', format: 'multiple_choice', category: 'committee', memberCount: 2,
    options: [{ label: 'Ana Reyes' }, { label: 'Luis Mejía' }, { label: 'Rosa Paz' }],
  })
  for (const removed of ['committeeType', 'committeeConfiguration', 'decisionNote']) expect(createBody).not.toHaveProperty(removed)
})

test('la mesa ve quién ya votó (amarillo/verde) y los puntos se quedan tras cerrar', async ({ page }) => {
  let status: 'open' | 'closed' = 'open'
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes', voted: true }, { id: 'p2', firstName: 'Luis', lastName: 'Mejía', voted: false }, { id: 'p3', firstName: 'Rosa', lastName: 'Paz', voted: true }],
        participantCount: 3, attendanceRound: { roundId: 'r1', status, votedCount: 2 },
        rounds: [{ id: 'r1', title: 'Presidencia', status, format: 'single_choice', category: 'office', participationCount: 2, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null,
          ...(status === 'closed' ? { privateResults: [{ optionId: 'a', label: 'Alfa', count: 2 }, { optionId: 'b', label: 'Beta', count: 0 }] } : {}) }],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/r1/close')) {
      status = 'closed'
      await route.fulfill({ status: 201, json: { roundId: 'r1', status: 'closed' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for voted dots test' } })
  })

  await page.goto('/moderator')
  const summary = page.locator('.attendance-summary')
  await expect(summary).toContainText('2 votaron')
  await expect(summary).toContainText('1 falta')
  await expect(page.getByRole('img', { name: 'Ya votó' })).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Falta votar' })).toHaveCount(1)
  await expect(page.locator('li', { hasText: 'Luis Mejía' }).getByRole('img', { name: 'Falta votar' })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('VOTACIÓN CERRADA', { exact: true })).toBeVisible()
  await expect(page.getByRole('img', { name: 'Ya votó' })).toHaveCount(2)
  await expect(page.getByRole('img', { name: 'Falta votar' })).toHaveCount(1)
  await expect(summary).toContainText('2 votaron')
  await expect(summary).toContainText('1 falta')
})

test('delegado conserva la sesión al recargar y puede salir limpiando el estado local', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: { ...participantState(), assembly: { id: 'assembly-a', name: 'Asamblea A', status: 'in_progress' } } })
      return
    }
    if (route.request().method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-A/public-state')) {
      await route.fulfill({ json: { assembly: { id: 'assembly-a', name: 'Asamblea A' } } })
      return
    }
    if (route.request().method() === 'POST' && url.pathname.endsWith('/participant/leave')) {
      await route.fulfill({ json: { left: true } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for participant session test' } })
  })

  await page.goto('/?join=CODE-A')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await page.getByRole('button', { name: 'Salir', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByLabel('Código de sala')).toHaveValue('CODE-A')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('participantAssemblyId'))).toBeNull()
})

test('un 401 Unauthorized limpia la sesión y devuelve al ingreso del delegado', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'revoked-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'Not found' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByRole('alert')).toContainText('Vuelve a ingresar mientras el ingreso a la asamblea esté abierto')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
  expect(await page.evaluate(() => localStorage.getItem('participantAssemblyId'))).toBeNull()
})

test('un error temporal al cargar la sesión conserva la credencial del delegado', async ({ page }) => {
  await page.addInitScript(() => localStorage.setItem('participantSessionToken', 'valid-session-token'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ status: 503, json: { message: 'Servicio temporalmente no disponible' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'Not found' } })
  })

  await page.goto('/')
  await expect(page.getByRole('alert')).toContainText('Servicio temporalmente no disponible')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('valid-session-token')
})

test('delegado debe confirmar el cambio cuando abre un QR de otra Asamblea', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'old-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const assemblyId = request.headers()['authorization'] === 'Bearer new-session-token' ? 'assembly-b' : 'assembly-a'
      await route.fulfill({ json: { ...participantState(), assembly: { id: assemblyId, name: `Asamblea ${assemblyId === 'assembly-a' ? 'A' : 'B'}`, status: 'in_progress' } } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-B/public-state')) {
      await route.fulfill({ json: { assembly: { id: 'assembly-b', name: 'Asamblea B' } } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/CODE-B/join')) {
      await route.fulfill({ json: { participantSessionToken: 'new-session-token', ...participantState(), assembly: { id: 'assembly-b', name: 'Asamblea B', status: 'in_progress' } } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/leave')) {
      await route.fulfill({ json: { left: true } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for QR switch test' } })
  })

  await page.goto('/?join=CODE-B')
  await expect(page.getByRole('alert')).toContainText('Este QR corresponde a otra Asamblea')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cerrar sesión y cambiar a la Asamblea del QR' }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await expect(page.getByLabel('Código de sala')).toHaveValue('CODE-B')
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()

  await page.getByLabel('Nombre').fill('Nuevo')
  await page.getByLabel('Apellido').fill('Delegado')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('new-session-token')
})

test('un error de red conserva la selección y permite revisar y reintentar', async ({ page }) => {
  let voteCount = 0
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/DEMO-ROOM/join')) {
      await route.fulfill({ json: { participantSessionToken: 'synthetic-participant-token', ...participantState() } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState(voteCount ? 'recorded' : 'pending') })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/rounds/synthetic-round/vote')) {
      voteCount += 1
      if (voteCount === 1) {
        await route.fulfill({ status: 503, json: { message: 'Conexión temporalmente no disponible' } })
      } else {
        await route.fulfill({ status: 201, json: { status: 'recorded' } })
      }
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/')
  await page.getByLabel('Código de sala').fill('DEMO-ROOM')
  await page.getByLabel('Nombre').fill('Delegado')
  await page.getByLabel('Apellido').fill('Sintético')
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await page.getByLabel('Opción Beta (prueba)').check()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()

  await expect(page.getByRole('alert')).toContainText('Conexión temporalmente no disponible')
  await expect(page.locator('.review-details').getByText('Opción Beta (prueba)', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver', exact: true }).click()
  await expect(page.getByLabel('Opción Beta (prueba)')).toBeChecked()
  await page.getByRole('button', { name: 'Revisar mi voto' }).click()
  await expect(page.locator('.review-details').getByText('Elección de prueba', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()

  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(voteCount).toBe(2)
})

test('moderador ejecuta el cierre de una papeleta mediante acción confirmada', async ({ page }) => {
  let closed = false
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 4,
        eligibleCount: 4,
        recordedCount: 4,
        currentRound: { id: 'synthetic-round', title: 'Elección de prueba', status: closed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }, { id: 'b', label: 'Opción Beta (prueba)' }] },
        rounds: [{ id: 'synthetic-round', title: 'Elección de prueba', status: closed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }, { id: 'b', label: 'Opción Beta (prueba)' }],
          ...(closed ? { privateResults: [{ optionId: 'b', label: 'Opción Beta (prueba)', count: 3 }, { optionId: 'a', label: 'Opción Alfa (prueba)', count: 1 }] } : {}) }],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/close')) {
      closed = true
      await route.fulfill({ status: 201, json: { status: 'closed' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.locator('.brand')).toContainText('Asamblea de prueba')
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await expect(page.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByRole('dialog')).toContainText('Dejará de aceptar votos.')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  const privateCounts = page.locator('.ballot-card')
  await expect(privateCounts.getByText('VOTACIÓN CERRADA', { exact: true })).toBeVisible()
  await expect(privateCounts.getByText('Solo la mesa', { exact: true })).toBeVisible()
  await expect(privateCounts).toContainText(/4 de 4\s*votaron/)
  await expect(privateCounts.locator('.ranked-rows > li').first()).toHaveText(/^1\s*Opción Beta \(prueba\)\s*3 votos\s*75 %/)
  await expect(page.getByRole('button', { name: 'Publicar conteo' })).toBeVisible()
  // As on main, the mesa can move on to the next cargo without publishing this count.
  await page.getByRole('button', { name: 'Preparar otra papeleta' }).click()
  await expect(page.getByText('NUEVA PAPELETA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver al conteo' }).click()
  await expect(page.getByRole('button', { name: 'Publicar conteo' })).toBeVisible()
})

test('la mesa ve el resultado calculado de una comisión y abre el desempate por los puestos que faltan (M21)', async ({ page }) => {
  let opened = ''
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  const labels = ['Ana Ruiz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez']
  const counts = [30, 19, 17, 17, 14, 11]
  const first = {
    id: 'finanzas', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, runoff: false,
    participationCount: 36, eligibleCount: 38, options: labels.map((label, index) => ({ id: `o${index}`, label })),
    results: labels.map((label, index) => ({ optionId: `o${index}`, label, count: counts[index] })),
    outcome: { seats: 3, base: 38, threshold: 20, elected: ['o0'], runoff: ['o1', 'o2', 'o3'], openSeats: 2 },
    officialResult: { roundId: 'finanzas', elected: [{ optionId: 'o0', label: 'Ana Ruiz' }], note: null, declaredBy: 'results_engine', declaredAt: '2026-11-02T10:00:00.000Z', publishedAt: '2026-11-02T10:01:00.000Z' },
  }
  const runoff = {
    id: 'finanzas-2', title: 'Comisión de Finanzas', status: 'draft', category: 'committee', memberCount: 3, electionSeats: 2, voteNumber: 2, runoff: true,
    committeeRootRoundId: 'finanzas', runoffSourceRoundId: 'finanzas', options: labels.slice(1, 4).map((label, index) => ({ id: `r${index}`, label })), officialResult: null,
  }
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [first, runoff], currentRound: first } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/open')) {
      opened = url.pathname
      await route.fulfill({ status: 201, json: { roundId: 'finanzas-2', status: 'open' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for computed result test' } })
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot).toContainText('CONTEO PUBLICADO')
  await expect(ballot.locator('.majority-chip')).toHaveText('3 integrantes · Mayoría: 20')
  const rows = ballot.locator('.ranked-rows > li')
  await expect(rows.nth(0)).toHaveText(/^1\s*Ana Ruiz\s*Electa\s*30 votos\s*79 %/)
  await expect(rows.nth(1)).toHaveText(/^2\s*Juan Mora\s*Desempate\s*19 votos/)
  await expect(rows.nth(3)).toHaveText(/^4\s*Pedro Vargas\s*Desempate\s*17 votos/)
  await expect(rows.nth(4)).toHaveText(/^5\s*Sofía Méndez\s*14 votos/)
  await expect(page.getByRole('button', { name: /Declarar|Repetir votación|Retirar declaración/ })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '¿Quién queda electo?' })).toHaveCount(0)
  const acta = page.locator('#acta-de-resultados')
  await expect(acta.locator('.declared-result')).toContainText('Ana Ruiz')
  await expect(acta).toContainText('DESEMPATE · 2.ª VOTACIÓN')

  await ballot.getByRole('button', { name: 'Abrir desempate · 2 puestos' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir votación' }).click()
  await expect.poll(() => opened).toContain('/moderator/rounds/finanzas-2/open')
})

test('cargo sin mayoría: chip de mayoría, desempate entre los dos primeros y botón "Abrir desempate" (M20)', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  const first = {
    id: 'presidencia', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 1, runoff: false, participationCount: 36, eligibleCount: 38,
    options: [{ id: 'm', label: 'María López' }, { id: 'c', label: 'Carlos Gómez' }, { id: 'r', label: 'Rosa Díaz' }],
    results: [{ optionId: 'm', label: 'María López', count: 18 }, { optionId: 'c', label: 'Carlos Gómez', count: 12 }, { optionId: 'r', label: 'Rosa Díaz', count: 6 }],
    outcome: { seats: 1, base: 38, threshold: 20, elected: [], runoff: ['m', 'c'], openSeats: 1 }, officialResult: null,
  }
  const runoff = { id: 'presidencia-2', title: 'Presidencia', status: 'draft', category: 'office', voteNumber: 2, runoff: true, committeeRootRoundId: 'presidencia', runoffSourceRoundId: 'presidencia', options: [{ id: 'm2', label: 'María López' }, { id: 'c2', label: 'Carlos Gómez' }], officialResult: null }
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [first, runoff], currentRound: first } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot.locator('.majority-chip')).toHaveText('Mayoría: 20')
  await expect(ballot.locator('.ranked-rows > li .badge-warning')).toHaveCount(2)
  await expect(ballot.locator('.ranked-rows > li').nth(2)).not.toContainText('Desempate')
  await expect(ballot.locator('.voters-total')).toHaveText(/36 de 38\s*votaron · 2 no votaron/)
  await expect(page.locator('#acta-de-resultados')).toContainText('36 de 38 votaron · 2 no votaron')
  await expect(ballot.getByRole('button', { name: 'Abrir desempate', exact: true })).toBeVisible()
  await expect(page.locator('.workflow-steps li.current')).toContainText('Resultado')
})

test('moderador finaliza la Asamblea explícitamente y el panel queda en modo de consulta', async ({ page }) => {
  let roundClosed = false
  let assemblyCompleted = false
  const completedAt = '2026-10-02T18:30:00.000Z'
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly',
        name: 'Asamblea de prueba',
        status: assemblyCompleted ? 'completed' : 'in_progress',
        completedAt: assemblyCompleted ? completedAt : null,
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 1,
        eligibleCount: 1,
        rounds: [{ id: 'synthetic-round', title: 'Elección de prueba', status: roundClosed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }] }],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/close')) {
      roundClosed = true
      await route.fulfill({ status: 201, json: { status: 'closed' } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/complete')) {
      expect(request.postDataJSON()).toEqual({ confirmation: true })
      assemblyCompleted = true
      await route.fulfill({ status: 201, json: { status: 'completed', completedAt } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.locator('.brand')).toContainText('Asamblea de prueba')
  await expect(page.getByRole('button', { name: 'Finalizar Asamblea…' })).toBeDisabled()

  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Finalizar Asamblea…' })).toBeEnabled()

  await page.getByRole('button', { name: 'Finalizar Asamblea…' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Finalizar Asamblea' }).click()
  await expect(page.getByText('La Asamblea quedó finalizada. Imprime o guarda el acta antes de borrar los datos.')).toBeVisible()
  const completedStatus = page.getByRole('status').filter({ hasText: 'Asamblea finalizada' })
  await expect(completedStatus.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  await expect(completedStatus).toContainText('2026')
  await expect(page.getByRole('button', { name: /Finalizar Asamblea/ })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Preparar papeleta' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Publicar conteo' })).toHaveCount(0)
  // Completing with a closed, unpublished and undeclared ballot leaves those steps pending.
  const steps = page.getByRole('list', { name: 'Pasos de la mesa' }).getByRole('listitem')
  await expect(steps).toHaveText([/Ingreso/, /Papeleta/, /Votación/, /Conteo/, /Resultado/])
  await expect(steps.filter({ hasText: 'Votación' })).toHaveClass(/\bcomplete\b/)
  await expect(steps.filter({ hasText: 'Conteo' })).not.toHaveClass(/\bcomplete\b/)
  await expect(steps.filter({ hasText: 'Resultado' })).not.toHaveClass(/\bcomplete\b/)
  await expect(page.locator('.workflow-steps [aria-current="step"]')).toHaveCount(0)
})

test('después de finalizar, la mesa imprime el acta, descarga la hoja de cálculo y borra los datos', async ({ page }) => {
  let deleted = false
  let deleteBody: unknown
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
    // The print dialog would block the test; the acta stays rendered as it does while the dialog is open.
    window.print = () => { (window as unknown as { printed: number }).printed = ((window as unknown as { printed?: number }).printed ?? 0) + 1 }
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly') && !deleted) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z',
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético' }], participantCount: 1,
        rounds: [
          { id: 'r1', title: 'Presidencia', status: 'published', participationCount: 3, eligibleCount: 4, options: [{ id: 'a', label: 'Rosa' }, { id: 'b', label: 'Pedro' }],
            results: [{ optionId: 'a', label: 'Rosa', count: 2 }, { optionId: 'b', label: 'Pedro', count: 1 }],
            officialResult: { elected: [{ optionId: 'a', label: 'Rosa' }], note: null, declaredBy: 'shared_moderator_credential', declaredAt: '2026-10-02T18:00:00.000Z', publishedAt: '2026-10-02T18:01:00.000Z' } },
          { id: 'r2', title: 'Secretaría', status: 'annulled', annulReason: 'Nombre mal escrito', participationCount: 1, options: [{ id: 'c', label: 'Juan' }] },
          { id: 'r3', title: 'Tesorería', status: 'published', participationCount: 1, options: [{ id: 'f', label: '=HYPERLINK("http://x","y")' }],
            results: [{ optionId: 'f', label: '=HYPERLINK("http://x","y")', count: 1 }] },
        ],
      } })
      return
    }
    if (request.method() === 'DELETE' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      deleteBody = request.postDataJSON()
      deleted = true
      await route.fulfill({ json: { assemblyId: 'synthetic-assembly', deleted: true, vacuumed: true } })
      return
    }
    if (url.pathname.endsWith('/moderator/session')) { await route.fulfill({ json: { authenticated: true } }); return }
    if (url.pathname.endsWith('/moderator/assemblies/active')) { await route.fulfill({ json: { assembly: null } }); return }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeVisible()

  const download = page.waitForEvent('download')
  await page.getByRole('button', { name: 'Descargar hoja de cálculo' }).click()
  expect((await download).suggestedFilename()).toBe('acta-asamblea-de-prueba.xlsx')
  const sheet = execFileSync('unzip', ['-p', await (await download).path() as string, 'xl/worksheets/sheet1.xml'], { encoding: 'utf8' })
  expect(sheetRows(sheet)).toContainEqual(['Presidencia', 'publicada', '3 de 4 votaron · 1 no votó', 1, 'Rosa', 2, 50, '', 'sí'])
  expect(sheetRows(sheet)).toContainEqual(['Presidencia', 'publicada', '3 de 4 votaron · 1 no votó', 2, 'Pedro', 1, 25, '', ''])
  expect(sheetRows(sheet)).toContainEqual(['Secretaría', 'anulada: Nombre mal escrito', '1 votó', '', '', '', '', '', ''])
  // A name typed as a formula is a text cell: no formula element exists, and re-saving keeps it as text.
  expect(sheetRows(sheet)).toContainEqual(['Tesorería', 'publicada', '1 votó', 1, '=HYPERLINK("http://x","y")', 1, '', '', ''])
  expect(sheet).not.toContain('<f>')

  const acta = page.locator('.acta-print')
  await expect(acta).toHaveCount(0)
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  expect(await page.evaluate(() => (window as unknown as { printed: number }).printed)).toBe(1)
  await expect(acta).toBeHidden()
  await page.emulateMedia({ media: 'print' })
  await expect(acta).toBeVisible()
  await expect(acta.getByRole('heading', { name: 'Acta de resultados' })).toBeVisible()
  await expect(acta.getByText('Electos:')).toBeVisible()
  await expect(acta.getByText('Anulada por la mesa: Nombre mal escrito. Sus votos no se contaron.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeHidden()
  await page.emulateMedia({ media: 'screen' })
  await page.evaluate(() => window.dispatchEvent(new Event('afterprint')))
  await expect(acta).toHaveCount(0)

  await page.getByRole('button', { name: 'Borrar datos de la Asamblea' }).click()
  const dialog = page.getByRole('dialog')
  await expect(dialog.getByRole('button', { name: 'Borrar datos' })).toBeDisabled()
  await dialog.getByLabel('Escribe BORRAR para confirmar').fill('borrar')
  await expect(dialog.getByRole('button', { name: 'Borrar datos' })).toBeDisabled()
  await dialog.getByLabel('Escribe BORRAR para confirmar').fill('BORRAR')
  await dialog.getByRole('button', { name: 'Borrar datos' }).click()
  await expect(page.getByText('Se borraron los datos de la Asamblea. Al apagar, sigue el cierre de la guía del técnico.')).toBeVisible()
  expect(deleteBody).toEqual({ confirmation: true })
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('assemblyId'))).toBeNull()
})

test('con la pestaña cerrada, la mesa recupera una Asamblea finalizada para el acta y el borrado', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token'))
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/moderator/session')) { await route.fulfill({ json: { authenticated: true } }); return }
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: null, completed: [{ id: 'done-assembly', name: 'Asamblea finalizada de prueba', completedAt: '2026-10-02T18:30:00.000Z' }] } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/done-assembly')) {
      await route.fulfill({ json: { id: 'done-assembly', name: 'Asamblea finalizada de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z', participants: [], participantCount: 0, rounds: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Asambleas finalizadas con datos guardados' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir acta y borrado' }).click()
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Borrar datos de la Asamblea' })).toBeEnabled()
  expect(await page.evaluate(() => sessionStorage.getItem('assemblyId'))).toBe('done-assembly')
})

test('la mesa cierra un acta recuperada sin borrarla y vuelve a la lista', async ({ page }) => {
  await page.addInitScript(() => sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token'))
  let deleteCalls = 0
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'DELETE') deleteCalls += 1
    if (url.pathname.endsWith('/moderator/session')) { await route.fulfill({ json: { authenticated: true } }); return }
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: null, completed: [
        { id: 'first', name: 'Primera Asamblea', completedAt: '2026-10-02T18:30:00.000Z' },
        { id: 'second', name: 'Segunda Asamblea', completedAt: '2026-10-01T18:30:00.000Z' },
      ] } })
      return
    }
    const id = url.pathname.split('/').pop()
    if (id === 'first' || id === 'second') {
      await route.fulfill({ json: { id, name: id === 'first' ? 'Primera Asamblea' : 'Segunda Asamblea', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z', participants: [], participantCount: 0, rounds: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await page.getByRole('listitem').filter({ hasText: 'Primera Asamblea' }).getByRole('button', { name: 'Abrir acta y borrado' }).click()
  await expect(page.locator('.brand').getByText('Primera Asamblea', { exact: true })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar el acta sin borrar' }).click()
  await expect(page.getByRole('heading', { name: 'Asambleas finalizadas con datos guardados' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('assemblyId'))).toBeNull()
  await page.getByRole('listitem').filter({ hasText: 'Segunda Asamblea' }).getByRole('button', { name: 'Abrir acta y borrado' }).click()
  await expect(page.locator('.brand').getByText('Segunda Asamblea', { exact: true })).toBeVisible()
  expect(deleteCalls).toBe(0)
})

test('con otra Asamblea activa, la mesa abre un acta pendiente, la cierra sin borrar y vuelve a la activa', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    localStorage.setItem('assemblyJoinCode', 'LIVE-CODE')
    localStorage.setItem('assemblyJoinCodeAssemblyId', 'live')
  })
  let deleteCalls = 0
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'DELETE') deleteCalls += 1
    if (url.pathname.endsWith('/moderator/session')) { await route.fulfill({ json: { authenticated: true } }); return }
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: { id: 'live', name: 'Asamblea en curso', status: 'lobby_closed' }, completed: [{ id: 'old', name: 'Asamblea anterior', completedAt: '2026-10-02T18:30:00.000Z' }] } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/live')) {
      await route.fulfill({ json: { id: 'live', name: 'Asamblea en curso', status: 'lobby_closed', completedAt: null, participants: [], participantCount: 0, rounds: [] } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/old')) {
      await route.fulfill({ json: { id: 'old', name: 'Asamblea anterior', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z', participants: [], participantCount: 0, rounds: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.locator('.brand').getByText('Asamblea en curso', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Ver actas pendientes' }).click()
  await page.getByRole('button', { name: 'Abrir acta y borrado' }).click()
  await expect(page.locator('.brand').getByText('Asamblea anterior', { exact: true })).toBeVisible()

  await page.getByRole('button', { name: 'Cerrar el acta sin borrar' }).click()
  await expect(page.getByRole('heading', { name: 'Asambleas finalizadas con datos guardados' })).toBeVisible()
  await page.reload()
  await expect(page.getByRole('heading', { name: 'Asambleas finalizadas con datos guardados' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toHaveCount(0)

  await page.getByRole('button', { name: 'Volver a la Asamblea activa' }).click()
  await expect(page.locator('.brand').getByText('Asamblea en curso', { exact: true })).toBeVisible()
  await expect(page.getByText('Código: LIVE-CODE')).toBeVisible()
  expect(deleteCalls).toBe(0)
})

test('el proyector muestra la dirección de la red que da el servidor, no la de la laptop', async ({ page }) => {
  const joinUrl = 'http://192.168.1.50/?join=DEMO-ROOM'
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: { assembly: { name: 'Asamblea de prueba', status: 'lobby_open' }, joinUrl, participantCount: 0, participants: [] } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('img.projector-qr')).toBeVisible()
  await expect(page.getByText('192.168.1.50', { exact: true })).toBeVisible()
  await expect(page.locator('.pj')).not.toContainText('127.0.0.1')
})

test('delegado y proyector ven que la Asamblea concluyó y conservan resultados publicados', async ({ page }) => {
  const completedAt = '2026-10-02T18:30:00.000Z'
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('assemblyJoinCode', 'DEMO-ROOM')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: {
        assemblyStatus: 'completed',
        assemblyCompletedAt: completedAt,
        lobbyStatus: 'closed',
        openRound: { roundId: 'synthetic-round', title: 'Elección publicada', status: 'published', options: [] },
        participationStatus: 'recorded',
        results: [{ label: 'Opción declarada', count: 1 }],
      } })
      return
    }
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea de prueba', status: 'completed', completedAt, lobbyStatus: 'lobby_closed' },
        participantCount: 1,
        currentRound: { id: 'synthetic-round', title: 'Elección publicada', status: 'published' },
        results: [{ label: 'Opción declarada', count: 1 }],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Asamblea finalizada' })).toBeVisible()
  await expect(page.locator('.phone-results')).toContainText('Opción declarada')
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  await expect(page.getByText('Espera la siguiente papeleta')).toHaveCount(0)

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Elección publicada' })).toBeVisible()
  await expect(page.getByText('Opción declarada')).toBeVisible()
})

test('moderador con credencial caducada vuelve a mostrar acceso y elimina el token guardado', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'stale-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
  })

  await page.goto('/moderator')
  await expect(page.getByLabel('Credencial de moderación')).toBeVisible()
  await expect(page.getByText('La credencial guardada ya no es válida. Ingresa de nuevo la clave de moderación.')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBeNull()
})

test('abrir /moderator sin credencial solo muestra el formulario de acceso', async ({ page }) => {
  let moderatorRequests = 0
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.includes('/moderator/')) moderatorRequests += 1
    await route.fulfill({ status: 401, json: { message: 'Unauthorized' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Moderación' })).toBeVisible()
  await expect(page.getByLabel('Credencial de moderación')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toHaveCount(0)
  expect(moderatorRequests).toBe(0)
})

test('moderador valida la credencial antes de mostrar el panel cuando aún no hay Asamblea', async ({ page }) => {
  let authorization = ''
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/session')) {
      authorization = request.headers().authorization || ''
      await route.fulfill({ json: { authenticated: true } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: null } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await page.getByLabel('Credencial de moderación').fill('synthetic-moderator-token')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toBeVisible()
  await expect(page.getByLabel('Credencial de moderación')).toHaveCount(0)
  expect(authorization).toBe('Bearer synthetic-moderator-token')
})

test('moderador recupera la Asamblea activa en una pestaña nueva y puede reabrir el ingreso', async ({ page }) => {
  let lobbyPatch: unknown
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/moderator/session')) {
      await route.fulfill({ json: { authenticated: true } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      await route.fulfill({ json: { assembly: { id: 'synthetic-assembly', name: 'Asamblea recuperada', status: 'lobby_closed' } } })
      return
    }
    if (request.method() === 'PATCH' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/lobby')) {
      lobbyPatch = request.postDataJSON()
      await route.fulfill({ json: { id: 'synthetic-assembly', status: 'lobby_open' } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea recuperada', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético', status: 'active' }],
        participantCount: 1, rounds: [],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await page.getByLabel('Credencial de moderación').fill('synthetic-moderator-token')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByText('Se recuperó la Asamblea activa: Asamblea recuperada.')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toHaveCount(0)
  await expect(page.getByText('El código de ingreso no está disponible en este dispositivo.')).toBeVisible()
  await expect(page.getByRole('button', { name: 'Reconectar dispositivo' })).toBeHidden()
  await page.getByLabel('Acciones para Delegado Sintético').click()
  await expect(page.getByRole('button', { name: 'Reconectar dispositivo' })).toBeVisible()
  await page.getByRole('button', { name: 'Reabrir ingreso' }).click()
  await expect(page.getByRole('heading', { name: '¿Reabrir el ingreso?' })).toBeVisible()
  await page.getByRole('dialog').getByRole('button', { name: 'Reabrir ingreso' }).click()
  await expect.poll(() => lobbyPatch).toEqual({ status: 'lobby_open' })
})

test('error temporal al validar conserva la credencial guardada y permite reintentar', async ({ page }) => {
  let validationAttempts = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'saved-moderator-token')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/moderator/session')) {
      validationAttempts += 1
      if (validationAttempts === 1) {
        await route.fulfill({ status: 503, json: { message: 'Servicio temporalmente no disponible' } })
      } else {
        await route.fulfill({ json: { authenticated: true } })
      }
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'No se pudo validar el acceso' })).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBe('saved-moderator-token')
  await page.getByRole('button', { name: 'Reintentar validación' }).click()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(validationAttempts).toBe(2)
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBe('saved-moderator-token')
})

test('proyector presenta estado y progreso sintético sin nombres ni opciones', async ({ page }) => {
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 42,
        eligibleCount: 42,
        recordedCount: 17,
        currentRound: { id: 'synthetic-round', title: 'Elección de prueba', status: 'open' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByText('Votación abierta')).toBeVisible()
  await expect(page.locator('.pj-progress strong')).toHaveText('17')
  await expect(page.getByText('de 42 ya votaron')).toBeVisible()
  await expect(page.getByRole('progressbar')).toHaveAttribute('aria-valuemax', '42')
  await expect(page.getByText('Delegado Sintético')).toHaveCount(0)
  await expect(page.getByText('Opción Alfa (prueba)')).toHaveCount(0)
})

test('delegado reconecta su sesión en un dispositivo nuevo con el QR de la mesa', async ({ page }) => {
  let resumeBody: unknown
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/assemblies/resume')) {
      resumeBody = request.postDataJSON()
      await route.fulfill({ json: { participantSessionToken: 'synthetic-resumed-token', ...participantState('recorded') } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      expect(request.headers().authorization).toBe('Bearer synthetic-resumed-token')
      await route.fulfill({ json: participantState('recorded') })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.goto('/?resume=synthetic-resume-code-0123456789')
  await expect(page.getByText('Tu sesión se reconectó en este dispositivo.')).toBeVisible()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
  expect(resumeBody).toEqual({ resumeCode: 'synthetic-resume-code-0123456789' })
  await expect(page).toHaveURL(/\/$/)
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('synthetic-resumed-token')
})

test('delegado con un QR ya rotado conserva su sesión sin errores', async ({ page }) => {
  let publicStateCalls = 0
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState() })
      return
    }
    if (url.pathname.endsWith('/assemblies/ROTATED-CODE/public-state')) {
      publicStateCalls += 1
      await route.fulfill({ status: 404, json: { message: 'Asamblea no encontrada' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.clock.install()
  await page.goto('/?join=ROTATED-CODE')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await refreshByPolling(page)
  await refreshByPolling(page)
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await expect(page.getByRole('alert')).toHaveCount(0)
  expect(publicStateCalls).toBe(1)
})

test('moderador ve la limpieza pendiente aunque se actualice el estado y puede reintentarla', async ({ page }) => {
  let cleanupDone = false
  let cleanupRequests = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/secrecy-cleanup')) {
      cleanupRequests += 1
      cleanupDone = true
      await route.fulfill({ json: { assemblyId: 'synthetic-assembly', secrecyCleanupPending: false } })
      return
    }
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null, participants: [], participantCount: 0,
        rounds: [{ id: 'synthetic-round', title: 'Presidencia', status: 'closed', options: [{ id: 'a', label: 'A' }], participationCount: 1, secrecyCleanupPending: !cleanupDone }],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for synthetic UI test' } })
  })

  await page.clock.install()
  await page.goto('/moderator')
  const panel = page.getByRole('alert').filter({ hasText: 'Limpieza del secreto del voto pendiente' })
  await expect(panel).toBeVisible()
  await refreshByPolling(page)
  await expect(panel).toBeVisible()
  await panel.getByRole('button', { name: 'Reintentar limpieza' }).click()
  await expect(page.getByText('Limpieza completada. Ya se pueden publicar resultados.')).toBeVisible()
  await expect(panel).toHaveCount(0)
  expect(cleanupRequests).toBe(1)
})

test('un cargo con mayoría queda electo sin intervención de la mesa y la elección se completa', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', participantCount: 9,
        rounds: [{
          id: 'presidency', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 1, runoff: false, participationCount: 9, eligibleCount: 9,
          options: [{ id: 'm', label: 'María López' }, { id: 'c', label: 'Carlos Gómez' }, { id: 'r', label: 'Rosa Díaz' }],
          results: [{ optionId: 'm', label: 'María López', count: 6 }, { optionId: 'c', label: 'Carlos Gómez', count: 2 }, { optionId: 'r', label: 'Rosa Díaz', count: 1 }],
          outcome: { seats: 1, base: 9, threshold: 5, elected: ['m'], runoff: [], openSeats: 0 },
          officialResult: { roundId: 'presidency', elected: [{ optionId: 'm', label: 'María López' }], note: null, declaredBy: 'results_engine', declaredAt: '2026-11-02T10:00:00.000Z', publishedAt: '2026-11-02T10:01:00.000Z' },
        }],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/moderator')
  await expect(page.getByText('CONTEO PUBLICADO', { exact: true })).toBeVisible()
  const ballot = page.locator('.ballot-card')
  await expect(ballot).toContainText(/9 de 9\s*votaron/)
  const rows = ballot.locator('.ranked-rows > li')
  await expect(rows).toHaveText([/^1\s*María López\s*Electa\s*6 votos\s*67 %/, /^2\s*Carlos Gómez\s*2 votos\s*22 %/, /^3\s*Rosa Díaz\s*1 voto\s*11 %/])
  await expect(ballot.locator('.majority-chip')).toHaveText('Mayoría: 5')
  await expect(ballot.getByRole('button', { name: /Abrir desempate|Declarar|Repetir/ })).toHaveCount(0)
  await expect(page.locator('.workflow-steps li.complete')).toHaveCount(5)
})

test('Salir avisa a la mesa con POST /participant/leave y limpia la sesión del teléfono', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'leaving-session-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  const leaveCalls: Array<{ method: string; authorization?: string }> = []
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/participant/leave')) {
      leaveCalls.push({ method: request.method(), authorization: request.headers().authorization })
      await route.fulfill({ status: 201, json: { status: 'left' } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState() })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for leave test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await page.getByRole('button', { name: 'Salir', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  expect(leaveCalls).toEqual([{ method: 'POST', authorization: 'Bearer leaving-session-token' }])
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
  await expect(page.getByRole('alert')).toHaveCount(0)
})

test('la mesa muestra «<Nombre> salió de la sala» al recibir participant.left', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  let leftAlready = false
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      const people = [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes' }, ...(leftAlready ? [] : [{ id: 'p2', firstName: 'Pedro', lastName: 'Vargas' }])]
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'lobby_open', completedAt: null,
        participants: people, participantCount: people.length, rounds: [],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for participant.left test' } })
  })
  let connectAuth: Record<string, string> | undefined
  let markConnected: (() => void) | undefined
  const connected = new Promise<void>((resolve) => { markConnected = resolve })
  let server: { send: (message: string) => void } | undefined
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    server = ws
    ws.send(`0${JSON.stringify({ sid: 'synthetic-engine', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`)
    ws.onMessage((message) => {
      const packet = String(message)
      if (!packet.startsWith('40/events,')) return
      connectAuth = JSON.parse(packet.slice('40/events,'.length))
      ws.send('40/events,{"sid":"synthetic-socket"}')
      markConnected?.()
    })
  })

  await page.goto('/moderator')
  await expect(page.getByText('Pedro Vargas')).toBeVisible()
  await connected
  expect(connectAuth).toMatchObject({ audience: 'moderator', assemblyId: 'synthetic-assembly' })
  await expect(page.getByText(/salió de la sala/)).toHaveCount(0)
  leftAlready = true
  server!.send('42/events,["participant.left",{"participantId":"p2","firstName":"Pedro","lastName":"Vargas"}]')
  await expect(page.getByRole('status').filter({ hasText: 'Pedro Vargas salió de la sala' })).toBeVisible()
  await expect(page.locator('.mesa-person-list')).not.toContainText('Pedro Vargas')
  await expect(page.locator('.mesa-person-list')).toContainText('Ana Reyes')
})

test('el proyector nunca muestra un estado crudo como «lobby_open»', async ({ page }) => {
  const rawStates = /lobby_open|lobby_closed|in_progress|\b(preparing|draft|open|closed|published|annulled|completed|removed|left)\b/
  const scenarios: Array<{ name: string; state: Record<string, unknown> }> = [
    { name: 'preparando', state: { assembly: { name: 'Asamblea de prueba', status: 'preparing', lobbyStatus: 'lobby_closed' }, participantCount: 0 } },
    { name: 'ingreso abierto', state: { assembly: { name: 'Asamblea de prueba', status: 'lobby_open', lobbyStatus: 'lobby_open' }, joinUrl: 'http://192.168.1.50/?join=DEMO-ROOM', participantCount: 1, participants: [{ firstName: 'Ana', lastName: 'Reyes' }] } },
    { name: 'ingreso cerrado', state: { assembly: { name: 'Asamblea de prueba', status: 'lobby_closed', lobbyStatus: 'lobby_closed' }, participantCount: 1 } },
    ...(['draft', 'open', 'closed', 'annulled'] as const).map((status) => ({ name: `papeleta ${status}`, state: {
      assembly: { name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' }, participantCount: 3, eligibleCount: 3, recordedCount: 1,
      currentRound: { id: 'r1', title: 'Presidencia', status, annulReason: status === 'annulled' ? 'Nombre mal escrito' : null },
    } })),
    { name: 'conteo publicado', state: {
      assembly: { name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' }, participantCount: 3, eligibleCount: 3, recordedCount: 3,
      currentRound: { id: 'r1', title: 'Presidencia', status: 'published' }, results: [{ optionId: 'a', label: 'Alfa', count: 2 }, { optionId: 'b', label: 'Beta', count: 1 }],
    } },
    { name: 'asamblea finalizada', state: { assembly: { name: 'Asamblea de prueba', status: 'completed', lobbyStatus: 'lobby_closed', completedAt: '2026-10-02T18:30:00.000Z' }, participantCount: 3 } },
  ]
  let current = scenarios[0]!.state
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: current })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for raw state test' } })
  })

  for (const scenario of scenarios) {
    current = scenario.state
    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.locator('.pj h1'), scenario.name).toBeVisible()
    await expect(page.locator('.pj'), scenario.name).not.toContainText(rawStates)
  }
})

test('la mesa cuenta a quien votó y salió en la base, y solo marca como pendientes a los presentes sin votar', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes', voted: true }, { id: 'p3', firstName: 'Rosa', lastName: 'Paz', voted: false }],
        leftParticipants: [{ id: 'p2', firstName: 'Pedro', lastName: 'Vargas' }],
        participantCount: 2, attendanceRound: { roundId: 'r1', status: 'open', votedCount: 2, eligibleCount: 3 },
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'open', format: 'single_choice', category: 'office', participationCount: 2, eligibleCount: 3, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null }],
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for left voter test' } })
  })

  await page.goto('/moderator')
  await expect(page.locator('.vote-progress')).toContainText('de 3 ya votaron')
  const summary = page.locator('.attendance-summary')
  await expect(summary).toContainText('2 votaron')
  await expect(summary).toContainText('1 falta')
  await expect(page.locator('li', { hasText: 'Rosa Paz' }).getByRole('img', { name: 'Falta votar' })).toBeVisible()
})

test('el acta incluye a quienes salieron en la lista y en el total de registrados', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
    window.print = () => {}
  })
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z',
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes' }], leftParticipants: [{ id: 'p2', firstName: 'Pedro', lastName: 'Vargas' }], participantCount: 1,
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'published', participationCount: 2, eligibleCount: 2, options: [{ id: 'a', label: 'Alfa' }], results: [{ optionId: 'a', label: 'Alfa', count: 2 }], officialResult: null }],
      } })
      return
    }
    if (url.pathname.endsWith('/moderator/session')) { await route.fulfill({ json: { authenticated: true } }); return }
    if (url.pathname.endsWith('/moderator/assemblies/active')) { await route.fulfill({ json: { assembly: null } }); return }
    await route.fulfill({ status: 404, json: { message: 'No mock route for acta left test' } })
  })

  await page.goto('/moderator')
  await page.getByRole('button', { name: 'Imprimir o guardar PDF' }).click()
  const acta = page.locator('.acta-print')
  await expect(acta).toContainText('Participantes registrados: 2.')
  await expect(acta.locator('ol li')).toHaveText(['Ana Reyes', 'Pedro Vargas (salió)'])
})

for (const roundStatus of ['published', 'closed'] as const) {
  test(`al reabrir el ingreso con la votación ${roundStatus === 'published' ? 'publicada' : 'cerrada sin publicar'}, el proyector vuelve a mostrar el QR`, async ({ page }) => {
    await page.route(api, async (route) => {
      const url = new URL(route.request().url())
      if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
        await route.fulfill({ json: {
          assembly: { name: 'Asamblea de prueba', status: 'lobby_open', lobbyStatus: 'lobby_open' }, joinUrl: 'http://192.168.1.50/?join=DEMO-ROOM',
          participantCount: 2, participants: [{ firstName: 'Ana', lastName: 'Reyes' }, { firstName: 'Rosa', lastName: 'Paz' }], eligibleCount: 2, recordedCount: 2,
          round: { id: 'r1', title: 'Presidencia', status: roundStatus, category: 'office' }, ...(roundStatus === 'published' ? { results: [{ label: 'Alfa', count: 2 }] } : {}),
        } })
        return
      }
      await route.fulfill({ status: 404, json: { message: 'No mock route for reopened lobby test' } })
    })

    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.getByText('192.168.1.50')).toBeVisible()
    await expect(page.getByText('Rosa Paz')).toBeVisible()
    await expect(page.getByText('Alfa')).toHaveCount(0)
    await expect(page.getByText('Votación cerrada')).toHaveCount(0)
  })
}

test('si el servidor no confirma la salida, el teléfono avisa y conserva la sesión para reintentar', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'leaving-session-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  let leaveStatus = 503
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (url.pathname.endsWith('/participant/leave')) {
      await route.fulfill({ status: leaveStatus, json: leaveStatus === 503 ? { message: 'Servicio no disponible' } : { left: true } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: participantState() })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for failed leave test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  await page.getByRole('button', { name: 'Salir', exact: true }).click()
  await expect(page.getByRole('alert')).toContainText('No se pudo salir')
  await expect(page.getByRole('heading', { name: 'Elección de prueba' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('leaving-session-token')

  leaveStatus = 200
  await page.getByRole('button', { name: 'Salir', exact: true }).click()
  await expect(page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeNull()
})

test('si no se confirma la salida de la Asamblea anterior, el QR de otra Asamblea no cambia la sesión', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'old-session-token')
    localStorage.setItem('participantAssemblyId', 'assembly-a')
  })
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      await route.fulfill({ json: { ...participantState(), assembly: { id: 'assembly-a', name: 'Asamblea A', status: 'in_progress' } } })
      return
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/assemblies/CODE-B/public-state')) {
      await route.fulfill({ json: { assembly: { id: 'assembly-b', name: 'Asamblea B' } } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/participant/leave')) {
      await route.fulfill({ status: 503, json: { message: 'Servicio no disponible' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for failed switch test' } })
  })

  await page.goto('/?join=CODE-B')
  await page.getByRole('button', { name: 'Cerrar sesión y cambiar a la Asamblea del QR' }).click()
  await expect(page.getByRole('alert').filter({ hasText: 'No se pudo salir' })).toBeVisible()
  expect(await page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBe('old-session-token')
  await expect(page.getByRole('button', { name: 'Entrar a la sala' })).toHaveCount(0)
})

test('el proyector marca Electa y Desempate en una comisión publicada, con la mayoría bajo el título (P20)', async ({ page }) => {
  const labels = ['Ana Ruiz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez']
  const counts = [30, 19, 17, 17, 14, 11]
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 37, recordedCount: 36, eligibleCount: 38,
        round: { id: 'finanzas', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, runoff: false },
        results: labels.map((label, index) => ({ optionId: `o${index}`, label, count: counts[index] })),
        outcome: { seats: 3, base: 38, threshold: 20, elected: ['o0'], runoff: ['o1', 'o2', 'o3'], openSeats: 2 },
        officialResult: { elected: [{ optionId: 'o0', label: 'Ana Ruiz' }], note: null, declaredAt: '2026-11-02T10:00:00.000Z' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByRole('heading', { name: 'Comisión de Finanzas' })).toBeVisible()
  await expect(page.locator('.pj-subtitle')).toHaveText('3 integrantes · Mayoría: 20')
  await expect(page.locator('.pj-results li').nth(0).locator('.pj-elected-tag')).toHaveText('✓ Electa')
  await expect(page.locator('.pj-results .pj-tie')).toHaveText(['Desempate', 'Desempate', 'Desempate'])
  await expect(page.locator('.pj-elected')).toHaveCount(0)
  await expect(page.locator('.pj-turnout')).toHaveText(/36\s*de 38\s*votaron · 2 no votaron/)
})

test('el proyector rotula el desempate de un cargo y suma el electo al publicarlo', async ({ page }) => {
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 38, recordedCount: 37, eligibleCount: 38,
        round: { id: 'presidencia-2', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 2, runoff: true },
        results: [{ optionId: 'm', label: 'María López', count: 22 }, { optionId: 'c', label: 'Carlos Gómez', count: 15 }],
        outcome: { seats: 1, base: 38, threshold: 20, elected: ['m'], runoff: [], openSeats: 0 },
        officialResult: { elected: [{ optionId: 'm', label: 'María López' }], note: null, declaredAt: '2026-11-02T10:00:00.000Z' },
      } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('.pj-status')).toHaveText(/Conteo publicado · DESEMPATE · 2\.ª VOTACIÓN/i)
  await expect(page.locator('.pj-subtitle')).toHaveText('Mayoría: 20')
  await expect(page.locator('.pj-elected')).toContainText('María López')
  await expect(page.locator('.pj-results li').nth(0).locator('.pj-elected-tag')).toHaveText('✓ Electa')
})

test('la mesa inhabilita y habilita: badge gris, «N inhabilitados» y «faltan» sin contarlos', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  const disabled = new Set(['p3'])
  const calls: string[] = []
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      const people = [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes', voted: true }, { id: 'p2', firstName: 'Luis', lastName: 'Mejía', voted: false }, { id: 'p3', firstName: 'Rosa', lastName: 'Paz', voted: false }]
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: people.map((person) => ({ ...person, votingDisabled: disabled.has(person.id) })),
        participantCount: 3, attendanceRound: { roundId: 'r1', status: 'open', votedCount: 1, eligibleCount: 3 },
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'open', format: 'single_choice', category: 'office', participationCount: 1, eligibleCount: 3, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null }],
      } })
      return
    }
    const toggle = url.pathname.match(/\/moderator\/participants\/(\w+)\/(disable|enable)-voting$/)
    if (request.method() === 'POST' && toggle) {
      calls.push(`${toggle[1]}:${toggle[2]}`)
      if (toggle[2] === 'disable') disabled.add(toggle[1]!)
      else disabled.delete(toggle[1]!)
      await route.fulfill({ json: { id: toggle[1], votingDisabled: toggle[2] === 'disable' } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for inhabilitar test' } })
  })

  await page.goto('/moderator')
  const summary = page.locator('.attendance-summary')
  await expect(summary).toContainText('1 votó')
  await expect(summary).toContainText('1 falta')
  await expect(summary).toContainText('1 inhabilitado')
  const rosa = page.locator('.mesa-person-list li', { hasText: 'Rosa Paz' })
  await expect(rosa.getByText('Inhabilitado', { exact: true })).toBeVisible()
  await expect(rosa.getByRole('img', { name: 'Inhabilitado' })).toBeVisible()
  await expect(page.locator('.mesa-person-list li.person-disabled')).toHaveCount(1)

  await rosa.getByRole('button', { name: 'Habilitar' }).click()
  await expect(rosa.getByText('Inhabilitado', { exact: true })).toHaveCount(0)
  await expect(summary).toContainText('2 faltan')
  await expect(summary).not.toContainText('inhabilitado')

  const luis = page.locator('.mesa-person-list li', { hasText: 'Luis Mejía' })
  await luis.locator('summary').click()
  await luis.getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(luis.getByText('Inhabilitado', { exact: true })).toBeVisible()
  await expect(luis.getByRole('button', { name: 'Habilitar' })).toBeVisible()
  await expect(summary).toContainText('1 falta')
  await expect(summary).toContainText('1 inhabilitado')
  expect(calls).toEqual(['p3:enable', 'p2:disable'])
})

test('la mesa inhabilita desde el aviso «salió de la sala» y la persona vuelve a la lista', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  let pedro: 'active' | 'left' | 'disabled' = 'active'
  const calls: string[] = []
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      const people = [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes', voted: false, votingDisabled: false }, ...(pedro === 'left' ? [] : [{ id: 'p2', firstName: 'Pedro', lastName: 'Vargas', voted: false, votingDisabled: pedro === 'disabled' }])]
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: people, participantCount: people.length, attendanceRound: { roundId: 'r1', status: 'open', votedCount: 0, eligibleCount: people.length },
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'open', format: 'single_choice', category: 'office', participationCount: 0, options: [{ id: 'a', label: 'Alfa' }], officialResult: null }],
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/participants/p2/disable-voting')) {
      calls.push('p2:disable')
      pedro = 'disabled'
      await route.fulfill({ json: { id: 'p2', votingDisabled: true } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for inhabilitar notice test' } })
  })
  let markConnected: (() => void) | undefined
  const connected = new Promise<void>((resolve) => { markConnected = resolve })
  let server: { send: (message: string) => void } | undefined
  await page.routeWebSocket(/\/socket\.io\//, (ws) => {
    server = ws
    ws.send(`0${JSON.stringify({ sid: 'synthetic-engine', upgrades: [], pingInterval: 25000, pingTimeout: 20000, maxPayload: 1000000 })}`)
    ws.onMessage((message) => {
      if (!String(message).startsWith('40/events,')) return
      ws.send('40/events,{"sid":"synthetic-socket"}')
      markConnected?.()
    })
  })

  await page.goto('/moderator')
  await expect(page.locator('.mesa-person-list')).toContainText('Pedro Vargas')
  await connected
  pedro = 'left'
  server!.send('42/events,["participant.left",{"participantId":"p2","firstName":"Pedro","lastName":"Vargas"}]')
  const notice = page.getByRole('status').filter({ hasText: 'Pedro Vargas salió de la sala' })
  await expect(notice).toBeVisible()
  await expect(page.locator('.mesa-person-list')).not.toContainText('Pedro Vargas')
  await notice.getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(notice).toHaveCount(0)
  const row = page.locator('.mesa-person-list li', { hasText: 'Pedro Vargas' })
  await expect(row.getByText('Inhabilitado', { exact: true })).toBeVisible()
  await expect(page.locator('.attendance-summary')).toContainText('1 inhabilitado')
  expect(calls).toEqual(['p2:disable'])
})

test('el teléfono de un delegado inhabilitado muestra «Voto inhabilitado» sin opciones ni botón', async ({ page }) => {
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-session-token')
    localStorage.setItem('participantAssemblyId', 'synthetic-assembly')
  })
  let votingDisabled = true
  await page.clock.install()
  await page.route(api, async (route) => {
    const url = new URL(route.request().url())
    if (route.request().method() === 'GET' && url.pathname.endsWith('/participant/me')) {
      const state = participantState()
      await route.fulfill({ json: { ...state, votingDisabled, currentRound: { ...state.currentRound, options: votingDisabled ? [] : state.currentRound.options } } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for inhabilitado phone test' } })
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Voto inhabilitado' })).toBeVisible()
  await expect(page.locator('.phone-status-disabled')).toContainText('VOTACIÓN ABIERTA')
  await expect(page.locator('.phone-status-disabled')).toContainText('Elección de prueba')
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  await expect(page.getByRole('radio')).toHaveCount(0)

  // Habilitado again: the ballot comes back on the next refresh.
  votingDisabled = false
  await refreshByPolling(page)
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Voto inhabilitado' })).toHaveCount(0)
})
