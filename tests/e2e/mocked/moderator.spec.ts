import type { Page } from '@playwright/test'
import { expect, test } from './api-fixture'

async function refreshByPolling(page: Page) {
  const request = page.waitForRequest((req) => req.url().includes('/api/v1/'))
  await page.clock.runFor(8_000)
  await request
}

test('moderador anula una papeleta con motivo y la repite con las mismas opciones; el acta marca el desempate calculado', async ({ page, api }) => {
  let annulled = false
  let repeated: Record<string, unknown> | null = null
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress',
        rounds: [
          { id: 'first', title: 'Presidencia', status: 'published', participationCount: 9, eligibleCount: 10, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }, { id: 'c', label: 'Gama' }],
            results: [{ optionId: 'b', label: 'Beta', count: 4 }, { optionId: 'a', label: 'Alfa', count: 4 }, { optionId: 'c', label: 'Gama', count: 1 }], officialResult: null,
            outcome: { seats: 1, base: 10, threshold: 6, elected: [], runoff: ['b', 'a'], openSeats: 1 } },
          { id: 'second', title: 'Secretaría', status: annulled ? 'annulled' : 'open', annulReason: annulled ? 'Nombre mal escrito' : null, options: [{ id: 'x', label: 'Rosa' }, { id: 'y', label: 'Pedro' }], officialResult: null },
        ],
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/second/annul')) {
      expect(request.postDataJSON()).toEqual({ reason: 'Nombre mal escrito' })
      annulled = true
      return { status: 201, json: { roundId: 'second', status: 'annulled' } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/second/repeat')) {
      repeated = request.postDataJSON()
      return { status: 201, json: { id: 'third' } }
    }
  })

  await page.goto('/moderator')
  const ranking = page.locator('.official-round').first().locator('.ranked-rows > li')
  await expect(ranking).toHaveCount(4)
  await expect(ranking.nth(0)).toHaveText(/^Beta\s*Desempate\s*4 votos\s*40 %/)
  await expect(ranking.nth(1)).toHaveText(/^Alfa\s*Desempate\s*4 votos\s*40 %/)
  await expect(ranking.nth(2)).toHaveText(/^Gama\s*1 voto\s*10 %/)
  await expect(ranking.nth(3)).toHaveText(/^No votaron\s*1 voto\s*10 %/)
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

test('la mesa prepara una comisión escribiendo los candidatos y cuántos integrantes quedarán', async ({ page, api }) => {
  let createBody: Record<string, any> | undefined
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético' }], participantCount: 1, rounds: [], attendanceRound: null,
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/rounds')) {
      createBody = request.postDataJSON()
      return { status: 201, json: { id: 'r1' } }
    }
  })

  await page.goto('/moderator')
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await page.getByRole('radio', { name: 'Comisión', exact: true }).click()
  await expect(page.getByText('Nombramiento')).toHaveCount(0)
  await expect(page.getByText('Secretaría validó esta comisión')).toHaveCount(0)
  await page.getByLabel('Nombre de la comisión').fill('Comisión de Finanzas')
  await page.getByLabel('¿Cuántos integrantes quedarán en la comisión?').fill('2')
  await page.getByLabel('Agregar candidato').fill('Ana Reyes')
  await page.getByLabel('Agregar candidato').press('Enter')
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

test('la mesa ve cuántos votaron y faltan, sin marcar a cada persona, también tras cerrar', async ({ page, api }) => {
  let status: 'open' | 'closed' = 'open'
  let anaDisabled = false
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes', votingDisabled: anaDisabled }, { id: 'p2', firstName: 'Luis', lastName: 'Mejía' }, { id: 'p3', firstName: 'Rosa', lastName: 'Paz' }, { id: 'p4', firstName: 'Pedro', lastName: 'Luna', votingDisabled: true }],
        regionalSecretary: { id: 'rs', firstName: 'Marta', lastName: 'Regional', status: 'active' },
        leftParticipants: [{ id: 'p5', firstName: 'Jonás', lastName: 'Amitai' }],
        participantCount: 4, attendanceRound: { roundId: 'r1', status, votedCount: 2, eligibleCount: 4 },
        rounds: [{ id: 'r1', title: 'Presidencia', status, format: 'single_choice', category: 'office', participationCount: 2, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null }],
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/r1/close')) {
      status = 'closed'
      return { status: 201, json: { roundId: 'r1', status: 'closed' } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/participants/p1/disable-voting')) {
      anaDisabled = true
      return { status: 201, json: { id: 'p1', firstName: 'Ana', lastName: 'Reyes', status: 'active', votingDisabled: true } }
    }
  })

  await page.goto('/moderator')
  const summary = page.locator('.attendance-summary')
  await expect(summary).toContainText('2 votaron')
  await expect(summary).toContainText('1 falta')
  await expect(summary).toContainText('1 inhabilitado')
  await expect(page.locator('.mesa-person-list li', { hasText: 'Luis Mejía' })).toBeVisible()
  await expect(page.locator('.mesa-person-list').getByRole('img')).toHaveCount(0)
  const secretaryRow = page.locator('.regional-secretary-row')
  await expect(secretaryRow).toContainText('Marta Regional')
  await expect(secretaryRow).not.toContainText('Votó')
  await expect(secretaryRow).not.toContainText('Falta')
  await expect(secretaryRow.getByRole('button', { name: 'Retirar de la sala' })).toHaveCount(0)
  await expect(secretaryRow.getByRole('button', { name: 'Reconectar dispositivo' })).toHaveCount(0)
  const luisMenu = page.locator('.mesa-person-list li', { hasText: 'Luis Mejía' })
  await expect(page.getByLabel('Acciones para Luis Mejía')).toHaveCount(0)
  await expect(luisMenu.getByRole('button', { name: 'Reconectar dispositivo' })).toHaveCount(0)
  await expect(luisMenu.getByRole('button', { name: 'Inhabilitar' })).toHaveCount(0)
  await expect(luisMenu.getByRole('button', { name: 'Retirar de la sala' })).toHaveCount(0)
  await expect(page.locator('.mesa-person-list li', { hasText: 'Pedro Luna' }).getByRole('button', { name: 'Habilitar' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Nuevo código' })).toHaveCount(0)
  const jonasOut = page.locator('.out-of-room li', { hasText: 'Jonás Amitai' })
  await expect(jonasOut).toBeVisible()
  await expect(jonasOut.getByRole('button', { name: 'Regresar a la sala' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Presentar oficiales' })).toHaveCount(0)
  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('VOTACIÓN CERRADA', { exact: true })).toBeVisible()
  await expect(page.locator('.mesa-person-list').getByRole('img')).toHaveCount(0)
  await expect(summary).toContainText('2 votaron')
  await expect(summary).not.toContainText('falta')
  await expect(summary).toContainText('1 inhabilitado')
  await expect(secretaryRow.getByRole('button', { name: 'Retirar de la sala' })).toBeVisible()
  await expect(page.locator('.mesa-person-list li', { hasText: 'Pedro Luna' }).getByRole('button', { name: 'Habilitar' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Nuevo código' })).toBeVisible()
  await expect(jonasOut.getByRole('button', { name: 'Regresar a la sala' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Presentar oficiales' })).toBeVisible()
  await page.getByLabel('Acciones para Luis Mejía').click()
  await expect(luisMenu.getByRole('button', { name: 'Reconectar dispositivo' })).toBeVisible()
  await expect(luisMenu.getByRole('button', { name: 'Inhabilitar' })).toBeVisible()
  await expect(luisMenu.getByRole('button', { name: 'Retirar de la sala' })).toBeVisible()
  await page.getByLabel('Acciones para Luis Mejía').click()

  await page.getByLabel('Acciones para Ana Reyes').click()
  await page.locator('.mesa-person-list li', { hasText: 'Ana Reyes' }).getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(summary).toContainText('2 inhabilitados')
  await expect(summary).toContainText('2 votaron')
  await expect(summary).not.toContainText('falta')
})

test('la mesa no ve acciones sobre la lista mientras una votación está abierta, aunque haya un borrador más reciente', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes' }, { id: 'p2', firstName: 'Pedro', lastName: 'Luna', votingDisabled: true }],
        regionalSecretary: null, participantCount: 2, attendanceRound: { roundId: 'r1', status: 'open', votedCount: 0, eligibleCount: 2 },
        rounds: [
          { id: 'r1', title: 'Presidencia', status: 'open', format: 'single_choice', category: 'office', participationCount: 0, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null },
          { id: 'r2', title: 'Secretaría', status: 'draft', format: 'single_choice', category: 'office', participationCount: 0, options: [{ id: 'c', label: 'Gama' }, { id: 'd', label: 'Delta' }], officialResult: null },
        ],
      } }
    }
  })

  await page.goto('/moderator')
  await expect(page.locator('.mesa-person-list li', { hasText: 'Ana Reyes' })).toBeVisible()
  const ana = page.locator('.mesa-person-list li', { hasText: 'Ana Reyes' })
  await expect(page.getByLabel('Acciones para Ana Reyes')).toHaveCount(0)
  await expect(ana.getByRole('button', { name: 'Reconectar dispositivo' })).toHaveCount(0)
  await expect(ana.getByRole('button', { name: 'Inhabilitar' })).toHaveCount(0)
  await expect(ana.getByRole('button', { name: 'Retirar de la sala' })).toHaveCount(0)
  await expect(page.locator('.mesa-person-list li', { hasText: 'Pedro Luna' }).getByRole('button', { name: 'Habilitar' })).toHaveCount(0)
})

test('moderador ejecuta el cierre de una papeleta mediante acción confirmada', async ({ page, api }) => {
  let closed = false
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 4,
        eligibleCount: 4,
        recordedCount: 4,
        currentRound: { id: 'synthetic-round', title: 'Elección de prueba', status: closed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }, { id: 'b', label: 'Opción Beta (prueba)' }] },
        rounds: [{ id: 'synthetic-round', title: 'Elección de prueba', status: closed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }, { id: 'b', label: 'Opción Beta (prueba)' }] }],
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/close')) {
      closed = true
      return { status: 201, json: { status: 'closed' } }
    }
  })

  await page.goto('/moderator')
  await expect(page.locator('.brand')).toContainText('Asamblea de prueba')
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await expect(page.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByRole('dialog')).toContainText('Dejará de aceptar votos.')
  await page.getByRole('dialog').getByRole('button', { name: 'Cerrar votación' }).click()
  await expect(page.getByText('Acción registrada.')).toBeVisible()
  const closedCard = page.locator('.ballot-card')
  await expect(closedCard.getByText('VOTACIÓN CERRADA', { exact: true })).toBeVisible()
  await expect(closedCard).toContainText('Preparando el resultado')
  await expect(closedCard.locator('.ranked-rows > li')).toHaveCount(0)
  await expect(page.getByRole('button', { name: /Publicar/ })).toHaveCount(0)
  await page.getByRole('button', { name: 'Preparar otra papeleta' }).click()
  await expect(page.getByText('NUEVA PAPELETA', { exact: true })).toBeVisible()
  await page.getByRole('button', { name: 'Volver al conteo' }).click()
  await expect(closedCard).toContainText('Preparando el resultado')
})

test('la mesa ve el resultado calculado de una comisión y abre el desempate por los puestos que faltan (M21)', async ({ page, api }) => {
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
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [first, runoff], currentRound: first } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/open')) {
      opened = url.pathname
      return { status: 201, json: { roundId: 'finanzas-2', status: 'open' } }
    }
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot).toContainText('CONTEO PUBLICADO')
  await expect(ballot.locator('.majority-chip')).toHaveText('3 integrantes · Mayoría: 20')
  const rows = ballot.locator('.ranked-rows > li')
  await expect(rows.nth(0)).toHaveText(/^Ana Ruiz\s*Electo\/a\s*30 votos\s*79 %/)
  await expect(rows.nth(1)).toHaveText(/^Juan Mora\s*Desempate\s*19 votos/)
  await expect(rows.nth(3)).toHaveText(/^Pedro Vargas\s*Desempate\s*17 votos/)
  await expect(rows.nth(4)).toHaveText(/^Sofía Méndez\s*14 votos/)
  await expect(page.getByRole('button', { name: /Declarar|Repetir votación|Retirar declaración/ })).toHaveCount(0)
  await expect(page.getByRole('group', { name: '¿Quién queda electo?' })).toHaveCount(0)
  const acta = page.locator('#acta-de-resultados')
  await expect(acta.locator('.declared-result')).toContainText('Ana Ruiz')
  await expect(acta).toContainText('DESEMPATE · 2.ª VOTACIÓN')

  await ballot.getByRole('button', { name: 'Abrir desempate · 2 puestos' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir votación' }).click()
  await expect.poll(() => opened).toContain('/moderator/rounds/finanzas-2/open')
})

test('cargo sin mayoría: chip de mayoría, desempate entre los dos primeros y botón "Abrir desempate" (M20)', async ({ page, api }) => {
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
  api.on(({ url }) => {
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: { id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', status: 'in_progress', rounds: [first, runoff], currentRound: first } }
    }
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

test('moderador finaliza la Asamblea explícitamente y el panel queda en modo de consulta', async ({ page, api }) => {
  let roundClosed = false
  let assemblyCompleted = false
  const completedAt = '2026-10-02T18:30:00.000Z'
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly',
        name: 'Asamblea de prueba',
        status: assemblyCompleted ? 'completed' : 'in_progress',
        completedAt: assemblyCompleted ? completedAt : null,
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 1,
        eligibleCount: 1,
        rounds: [{ id: 'synthetic-round', title: 'Elección de prueba', status: roundClosed ? 'closed' : 'open', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }] }],
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/rounds/synthetic-round/close')) {
      roundClosed = true
      return { status: 201, json: { status: 'closed' } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/complete')) {
      expect(request.postDataJSON()).toEqual({ confirmation: true })
      assemblyCompleted = true
      return { status: 201, json: { status: 'completed', completedAt } }
    }
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
  const steps = page.getByRole('list', { name: 'Pasos de la mesa' }).getByRole('listitem')
  await expect(steps).toHaveText([/Ingreso/, /Papeleta/, /Votación/, /Conteo/, /Resultado/])
  await expect(steps.filter({ hasText: 'Votación' })).toHaveClass(/\bcomplete\b/)
  await expect(steps.filter({ hasText: 'Conteo' })).not.toHaveClass(/\bcomplete\b/)
  await expect(steps.filter({ hasText: 'Resultado' })).not.toHaveClass(/\bcomplete\b/)
  await expect(page.locator('.workflow-steps [aria-current="step"]')).toHaveCount(0)
})

test('con la pestaña cerrada, la mesa recupera una Asamblea finalizada para el acta y el borrado', async ({ page, api }) => {
  await page.addInitScript(() => sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token'))
  api.on(({ url }) => {
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      return { json: { assembly: null, completed: [{ id: 'done-assembly', name: 'Asamblea finalizada de prueba', completedAt: '2026-10-02T18:30:00.000Z' }] } }
    }
    if (url.pathname.endsWith('/moderator/assemblies/done-assembly')) {
      return { json: { id: 'done-assembly', name: 'Asamblea finalizada de prueba', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z', participants: [], participantCount: 0, rounds: [] } }
    }
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Asambleas finalizadas con datos guardados' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toBeVisible()
  await page.getByRole('button', { name: 'Abrir acta y borrado' }).click()
  await expect(page.getByRole('heading', { name: 'Acta y borrado de datos' })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Borrar datos de la Asamblea' })).toBeEnabled()
  expect(await page.evaluate(() => sessionStorage.getItem('assemblyId'))).toBe('done-assembly')
})

test('la mesa cierra un acta recuperada sin borrarla y vuelve a la lista', async ({ page, api }) => {
  await page.addInitScript(() => sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token'))
  let deleteCalls = 0
  api.on(({ request, url }) => {
    if (request.method() === 'DELETE') deleteCalls += 1
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      return { json: { assembly: null, completed: [
        { id: 'first', name: 'Primera Asamblea', completedAt: '2026-10-02T18:30:00.000Z' },
        { id: 'second', name: 'Segunda Asamblea', completedAt: '2026-10-01T18:30:00.000Z' },
      ] } }
    }
    const id = url.pathname.split('/').pop()
    if (id === 'first' || id === 'second') {
      return { json: { id, name: id === 'first' ? 'Primera Asamblea' : 'Segunda Asamblea', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z', participants: [], participantCount: 0, rounds: [] } }
    }
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

test('con otra Asamblea activa, la mesa abre un acta pendiente, la cierra sin borrar y vuelve a la activa', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    localStorage.setItem('assemblyJoinCode', 'LIVE-CODE')
    localStorage.setItem('assemblyJoinCodeAssemblyId', 'live')
  })
  let deleteCalls = 0
  api.on(({ request, url }) => {
    if (request.method() === 'DELETE') deleteCalls += 1
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      return { json: { assembly: { id: 'live', name: 'Asamblea en curso', status: 'lobby_closed' }, completed: [{ id: 'old', name: 'Asamblea anterior', completedAt: '2026-10-02T18:30:00.000Z' }] } }
    }
    if (url.pathname.endsWith('/moderator/assemblies/live')) {
      return { json: { id: 'live', name: 'Asamblea en curso', status: 'lobby_closed', completedAt: null, participants: [], participantCount: 0, rounds: [] } }
    }
    if (url.pathname.endsWith('/moderator/assemblies/old')) {
      return { json: { id: 'old', name: 'Asamblea anterior', status: 'completed', completedAt: '2026-10-02T18:30:00.000Z', participants: [], participantCount: 0, rounds: [] } }
    }
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

test('moderador con credencial caducada vuelve a mostrar acceso y elimina el token guardado', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'stale-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(() => {
    return { status: 401, json: { message: 'Unauthorized' } }
  })

  await page.goto('/moderator')
  await expect(page.getByLabel('Credencial de moderación')).toBeVisible()
  await expect(page.getByText('La credencial guardada ya no es válida. Ingresa de nuevo la clave de moderación.')).toBeVisible()
  expect(await page.evaluate(() => sessionStorage.getItem('moderatorToken'))).toBeNull()
})

test('abrir /moderator sin credencial solo muestra el formulario de acceso', async ({ page, api }) => {
  let moderatorRequests = 0
  api.on(({ url }) => {
    if (url.pathname.includes('/moderator/')) moderatorRequests += 1
    return { status: 401, json: { message: 'Unauthorized' } }
  })

  await page.goto('/moderator')
  await expect(page.getByRole('heading', { name: 'Moderación' })).toBeVisible()
  await expect(page.getByLabel('Credencial de moderación')).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Crear Asamblea' })).toHaveCount(0)
  expect(moderatorRequests).toBe(0)
})

test('moderador valida la credencial antes de mostrar el panel cuando aún no hay Asamblea', async ({ page, api }) => {
  let authorization = ''
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/session')) {
      authorization = request.headers().authorization || ''
      return { json: { authenticated: true } }
    }
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/active')) {
      return { json: { assembly: null } }
    }
  })

  await page.goto('/moderator')
  await page.getByLabel('Credencial de moderación').fill('synthetic-moderator-token')
  await page.getByRole('button', { name: 'Continuar' }).click()
  await expect(page.getByRole('heading', { name: 'Crear Asamblea' })).toBeVisible()
  await expect(page.getByLabel('Credencial de moderación')).toHaveCount(0)
  expect(authorization).toBe('Bearer synthetic-moderator-token')
})

test('moderador recupera la Asamblea activa en una pestaña nueva y puede reabrir el ingreso', async ({ page, api }) => {
  let lobbyPatch: unknown
  api.on(({ request, url }) => {
    if (url.pathname.endsWith('/moderator/assemblies/active')) {
      return { json: { assembly: { id: 'synthetic-assembly', name: 'Asamblea recuperada', status: 'lobby_closed' } } }
    }
    if (request.method() === 'PATCH' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/lobby')) {
      lobbyPatch = request.postDataJSON()
      return { json: { id: 'synthetic-assembly', status: 'lobby_open' } }
    }
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea recuperada', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético', status: 'active' }],
        participantCount: 1, rounds: [],
      } }
    }
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

test('error temporal al validar conserva la credencial guardada y permite reintentar', async ({ page, api }) => {
  let validationAttempts = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'saved-moderator-token')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/moderator/session')) {
      validationAttempts += 1
      if (validationAttempts === 1) {
        return { status: 503, json: { message: 'Servicio temporalmente no disponible' } }
      } else {
        return { json: { authenticated: true } }
      }
    }
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

test('durante una votación abierta la mesa ve la limpieza pendiente sin poder reintentarla', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null, participants: [], participantCount: 0,
        rounds: [
          { id: 'annulled-round', title: 'Presidencia', status: 'annulled', options: [{ id: 'a', label: 'A' }], participationCount: 1, secrecyCleanupPending: true },
          { id: 'open-round', title: 'Presidencia, de nuevo', status: 'open', options: [{ id: 'b', label: 'B' }], participationCount: 0 },
        ],
      } }
    }
  })

  await page.goto('/moderator')
  const panel = page.getByRole('alert').filter({ hasText: 'Limpieza del secreto del voto pendiente' })
  await expect(panel).toBeVisible()
  await expect(panel.getByRole('button', { name: 'Reintentar limpieza' })).toHaveCount(0)
})

test('durante una votación abierta la mesa no ofrece preparar la siguiente votación', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  const open = { id: 'open-round', title: 'Presidencia, de nuevo', status: 'open', options: [{ id: 'b', label: 'Opción Beta (prueba)' }, { id: 'c', label: 'Opción Gama (prueba)' }], participationCount: 0 }
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        assembly: { id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participants: [{ id: 'synthetic-person', firstName: 'Delegado', lastName: 'Sintético' }],
        participantCount: 4,
        eligibleCount: 4,
        recordedCount: 0,
        regionalSecretary: { firstName: 'Secretaría', lastName: 'Regional' },
        currentRound: open,
        rounds: [
          { id: 'annulled-round', title: 'Presidencia', status: 'annulled', annulReason: 'Error de la mesa', options: [{ id: 'a', label: 'Opción Alfa (prueba)' }], participationCount: 1 },
          open,
        ],
      } }
    }
  })

  await page.goto('/moderator')
  const ballot = page.locator('.ballot-card')
  await expect(ballot.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await expect(ballot.getByRole('button', { name: 'Cerrar votación', exact: true })).toBeVisible()
  await expect(ballot.getByRole('button', { name: 'Anular votación', exact: true })).toBeVisible()
  await expect(page.getByRole('button', { name: 'Preparar otra papeleta', exact: true })).toHaveCount(0)
  await expect(page.getByText('NUEVA PAPELETA', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Repetir con las mismas opciones', exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Nombre del departamento', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Agregar candidato', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Agregar opción', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Nombre del candidato', { exact: true })).toHaveCount(0)
  await expect(page.getByLabel('Nombre de la secretaría regional', { exact: true })).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Agregar a Secretaría Regional', exact: true })).toHaveCount(0)
})

test('moderador ve la limpieza pendiente aunque se actualice el estado y puede reintentarla', async ({ page, api }) => {
  let cleanupDone = false
  let cleanupRequests = 0
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/secrecy-cleanup')) {
      cleanupRequests += 1
      cleanupDone = true
      return { json: { assemblyId: 'synthetic-assembly', secrecyCleanupPending: false } }
    }
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null, participants: [], participantCount: 0,
        rounds: [{ id: 'synthetic-round', title: 'Presidencia', status: 'closed', options: [{ id: 'a', label: 'A' }], participationCount: 1, secrecyCleanupPending: !cleanupDone }],
      } }
    }
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

test('un cargo con mayoría queda electo sin intervención de la mesa y la elección se completa', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', participantCount: 9,
        rounds: [{
          id: 'presidency', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 1, runoff: false, participationCount: 9, eligibleCount: 9,
          options: [{ id: 'm', label: 'María López' }, { id: 'c', label: 'Carlos Gómez' }, { id: 'r', label: 'Rosa Díaz' }],
          results: [{ optionId: 'm', label: 'María López', count: 6 }, { optionId: 'c', label: 'Carlos Gómez', count: 2 }, { optionId: 'r', label: 'Rosa Díaz', count: 1 }],
          outcome: { seats: 1, base: 9, threshold: 5, elected: ['m'], runoff: [], openSeats: 0 },
          officialResult: { roundId: 'presidency', elected: [{ optionId: 'm', label: 'María López' }], note: null, declaredBy: 'results_engine', declaredAt: '2026-11-02T10:00:00.000Z', publishedAt: '2026-11-02T10:01:00.000Z' },
        }],
      } }
    }
  })

  await page.goto('/moderator')
  await expect(page.getByText('CONTEO PUBLICADO', { exact: true })).toBeVisible()
  const ballot = page.locator('.ballot-card')
  await expect(ballot).toContainText(/9 de 9\s*votaron/)
  const rows = ballot.locator('.ranked-rows > li')
  await expect(rows).toHaveText([/^María López\s*Electo\/a\s*6 votos\s*67 %/, /^Carlos Gómez\s*2 votos\s*22 %/, /^Rosa Díaz\s*1 voto\s*11 %/, /^No votaron\s*0 votos\s*0 %/])
  await expect(ballot.locator('.majority-chip')).toHaveText('Mayoría: 5')
  await expect(ballot.getByRole('button', { name: /Abrir desempate|Declarar|Repetir/ })).toHaveCount(0)
  await expect(page.locator('.workflow-steps li.complete')).toHaveCount(5)
})

test('la mesa retira a alguien de la sala, lo ve en Fuera de la sala y lo regresa', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  let out = false
  const calls: string[] = []
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      const people = [{ id: 'p1', firstName: 'Elías', lastName: 'Tisbita' }, ...(out ? [] : [{ id: 'p2', firstName: 'Eliseo', lastName: 'Safat' }])]
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: people, participantCount: people.length, rounds: [],
        leftParticipants: out ? [{ id: 'p2', firstName: 'Eliseo', lastName: 'Safat' }] : [],
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/participants/p2/take-out')) {
      calls.push('take-out')
      out = true
      return { json: { id: 'p2', firstName: 'Eliseo', lastName: 'Safat', status: 'left' } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/participants/p2/return')) {
      calls.push('return')
      out = false
      return { json: { id: 'p2', firstName: 'Eliseo', lastName: 'Safat', status: 'active' } }
    }
  })

  await page.goto('/moderator')
  await expect(page.getByText('Fuera de la sala')).toHaveCount(0)
  await page.getByLabel('Acciones para Eliseo Safat').click()
  await page.getByRole('button', { name: 'Retirar de la sala' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Retirar de la sala', exact: true }).click()
  await expect(page.locator('.out-of-room')).toContainText('Eliseo Safat')
  await expect(page.locator('.mesa-person-list').first()).not.toContainText('Eliseo Safat')
  await page.locator('.out-of-room').getByRole('button', { name: 'Regresar a la sala' }).click()
  await expect(page.locator('.mesa-person-list').first()).toContainText('Eliseo Safat')
  await expect(page.getByText('Fuera de la sala')).toHaveCount(0)
  expect(calls).toEqual(['take-out', 'return'])
})

test('la mesa ve la línea de quórum, en rojo sin quórum, y el aviso al abrir una votación', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  let room = { present: 3, accredited: 4, quorum: 3 }
  let opened = ''
  const draft = { id: 'r1', title: 'Presidencia', status: 'draft', category: 'position', format: 'single_choice', options: [{ id: 'o1', label: 'Isaías' }, { id: 'o2', label: 'Jeremías' }], voteNumber: 1, runoff: false, officialResult: null }
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Elías', lastName: 'Tisbita' }], participantCount: room.present, room,
        rounds: [draft], currentRound: draft,
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/open')) {
      opened = url.pathname
      return { status: 201, json: { roundId: 'r1', status: 'open' } }
    }
  })

  await page.goto('/moderator')
  const line = page.locator('.room-line')
  await expect(line).toHaveText('En sala 3 de 4 · quórum 3')
  await expect(line).not.toHaveClass(/quorum-warning/)
  await page.getByRole('button', { name: 'Abrir votación' }).click()
  await expect(page.getByRole('dialog')).not.toContainText('Sin quórum')
  await page.getByRole('dialog').getByRole('button', { name: 'Cancelar' }).click()

  room = { present: 2, accredited: 4, quorum: 3 }
  await page.reload()
  await expect(line).toContainText('En sala 2 de 4 · quórum 3')
  await expect(line).toContainText('Sin quórum')
  await expect(line).toHaveClass(/quorum-warning/)
  await expect(line).toHaveCSS('color', 'rgb(156, 51, 41)')
  await page.getByRole('button', { name: 'Abrir votación' }).click()
  await expect(page.getByRole('dialog').getByRole('alert')).toContainText('Sin quórum')
  await page.getByRole('dialog').getByRole('button', { name: 'Abrir votación' }).click()
  await expect.poll(() => opened).toContain('/moderator/rounds/r1/open')
})

test('la mesa cuenta a quien votó y salió en la base, y solo marca como pendientes a los presentes sin votar', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes', voted: true }, { id: 'p3', firstName: 'Rosa', lastName: 'Paz', voted: false }],
        leftParticipants: [{ id: 'p2', firstName: 'Pedro', lastName: 'Vargas' }],
        participantCount: 2, attendanceRound: { roundId: 'r1', status: 'open', votedCount: 2, eligibleCount: 3 },
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'open', format: 'single_choice', category: 'office', participationCount: 2, eligibleCount: 3, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null }],
      } }
    }
  })

  await page.goto('/moderator')
  await expect(page.locator('.vote-progress')).toContainText('de 3 ya votaron')
  const summary = page.locator('.attendance-summary')
  await expect(summary).toContainText('2 votaron')
  await expect(summary).toContainText('1 falta')
  await expect(page.locator('.mesa-person-list li', { hasText: 'Rosa Paz' })).toBeVisible()
})

test('la mesa inhabilita y habilita entre votaciones: badge gris y «N inhabilitados», sin «faltan» tras cerrar', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  const disabled = new Set(['p3'])
  const calls: string[] = []
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      const people = [{ id: 'p1', firstName: 'Ana', lastName: 'Reyes' }, { id: 'p2', firstName: 'Luis', lastName: 'Mejía' }, { id: 'p3', firstName: 'Rosa', lastName: 'Paz' }]
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea de prueba', status: 'in_progress', completedAt: null,
        participants: people.map((person) => ({ ...person, votingDisabled: disabled.has(person.id) })),
        participantCount: 3, attendanceRound: { roundId: 'r1', status: 'closed', votedCount: 1, eligibleCount: 3 },
        rounds: [{ id: 'r1', title: 'Presidencia', status: 'closed', format: 'single_choice', category: 'office', participationCount: 1, eligibleCount: 3, options: [{ id: 'a', label: 'Alfa' }, { id: 'b', label: 'Beta' }], officialResult: null, privateResults: [{ optionId: 'a', label: 'Alfa', count: 1 }, { optionId: 'b', label: 'Beta', count: 0 }] }],
      } }
    }
    const toggle = url.pathname.match(/\/moderator\/participants\/(\w+)\/(disable|enable)-voting$/)
    if (request.method() === 'POST' && toggle) {
      calls.push(`${toggle[1]}:${toggle[2]}`)
      if (toggle[2] === 'disable') disabled.add(toggle[1]!)
      else disabled.delete(toggle[1]!)
      return { json: { id: toggle[1], votingDisabled: toggle[2] === 'disable' } }
    }
  })

  await page.goto('/moderator')
  const summary = page.locator('.attendance-summary')
  await expect(summary).toContainText('1 votó')
  await expect(summary).not.toContainText('falta')
  await expect(summary).toContainText('1 inhabilitado')
  const rosa = page.locator('.mesa-person-list li', { hasText: 'Rosa Paz' })
  await expect(rosa.getByText('Inhabilitado', { exact: true })).toBeVisible()
  await expect(rosa.getByRole('img')).toHaveCount(0)
  await expect(page.locator('.mesa-person-list li.person-disabled')).toHaveCount(1)

  await rosa.getByRole('button', { name: 'Habilitar' }).click()
  await expect(rosa.getByText('Inhabilitado', { exact: true })).toHaveCount(0)
  await expect(summary).not.toContainText('inhabilitado')
  await expect(summary).toContainText('1 votó')

  const luis = page.locator('.mesa-person-list li', { hasText: 'Luis Mejía' })
  await luis.locator('summary').click()
  await luis.getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(luis.getByText('Inhabilitado', { exact: true })).toBeVisible()
  await expect(luis.getByRole('button', { name: 'Habilitar' })).toBeVisible()
  await expect(summary).toContainText('1 inhabilitado')
  await expect(summary).not.toContainText('falta')
  expect(calls).toEqual(['p3:enable', 'p2:disable'])
})
