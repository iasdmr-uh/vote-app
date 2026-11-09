import { expect, test } from './api-fixture'

test('el proyector muestra la dirección de la red que da el servidor, no la de la laptop', async ({ page, api }) => {
  const joinUrl = 'http://192.168.1.50/?join=DEMO-ROOM'
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: { assembly: { name: 'Asamblea de prueba', status: 'lobby_open' }, joinUrl, participantCount: 0, participants: [] } }
    }
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('img.projector-qr')).toBeVisible()
  await expect(page.getByText('192.168.1.50', { exact: true })).toBeVisible()
  await expect(page.locator('.pj')).not.toContainText('127.0.0.1')
})

test('delegado y proyector ven que la Asamblea concluyó y solo el proyector conserva resultados publicados', async ({ page, api }) => {
  const completedAt = '2026-10-02T18:30:00.000Z'
  await page.addInitScript(() => {
    localStorage.setItem('participantSessionToken', 'synthetic-participant-token')
    localStorage.setItem('assemblyJoinCode', 'DEMO-ROOM')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/participant/me')) {
      return { json: {
        assemblyStatus: 'completed',
        assemblyCompletedAt: completedAt,
        lobbyStatus: 'closed',
        openRound: { roundId: 'synthetic-round', title: 'Elección publicada', status: 'published', options: [] },
        participationStatus: 'recorded',
        results: [{ label: 'Opción declarada', count: 1 }],
      } }
    }
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: {
        assembly: { name: 'Asamblea de prueba', status: 'completed', completedAt, lobbyStatus: 'lobby_closed' },
        participantCount: 1,
        currentRound: { id: 'synthetic-round', title: 'Elección publicada', status: 'published' },
        results: [{ label: 'Opción declarada', count: 1 }],
      } }
    }
  })

  await page.goto('/')
  await expect(page.getByRole('heading', { name: 'Asamblea finalizada' })).toBeVisible()
  await expect(page.getByText('Opción declarada')).toHaveCount(0)
  await expect(page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  await expect(page.getByText('Espera la siguiente papeleta')).toHaveCount(0)

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  await expect(page.getByRole('heading', { name: 'Elección publicada' })).toBeVisible()
  await expect(page.getByText('Opción declarada')).toBeVisible()
})

test('proyector presenta estado y progreso sintético sin nombres ni opciones', async ({ page, api }) => {
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: {
        assembly: { name: 'Asamblea de prueba', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 42,
        eligibleCount: 42,
        recordedCount: 17,
        currentRound: { id: 'synthetic-round', title: 'Elección de prueba', status: 'open' },
      } }
    }
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

test('el proyector nunca muestra un estado crudo como «lobby_open»', async ({ page, api }) => {
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
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: current }
    }
  })

  for (const scenario of scenarios) {
    current = scenario.state
    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.locator('.pj h1'), scenario.name).toBeVisible()
    await expect(page.locator('.pj'), scenario.name).not.toContainText(rawStates)
  }
})

for (const roundStatus of ['published', 'closed'] as const) {
  test(`al reabrir el ingreso con la votación ${roundStatus === 'published' ? 'publicada' : 'cerrada sin publicar'}, el proyector vuelve a mostrar el QR`, async ({ page, api }) => {
    api.on(({ url }) => {
      if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
        return { json: {
          assembly: { name: 'Asamblea de prueba', status: 'lobby_open', lobbyStatus: 'lobby_open' }, joinUrl: 'http://192.168.1.50/?join=DEMO-ROOM',
          participantCount: 2, participants: [{ firstName: 'Ana', lastName: 'Reyes' }, { firstName: 'Rosa', lastName: 'Paz' }], eligibleCount: 2, recordedCount: 2,
          round: { id: 'r1', title: 'Presidencia', status: roundStatus, category: 'office' }, ...(roundStatus === 'published' ? { results: [{ label: 'Alfa', count: 2 }] } : {}),
        } }
      }
    })

    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.getByText('192.168.1.50')).toBeVisible()
    await expect(page.getByText('Rosa Paz')).toBeVisible()
    await expect(page.getByText('Alfa')).toHaveCount(0)
    await expect(page.getByText('Votación cerrada')).toHaveCount(0)
  })
}

test('el proyector marca Electo/a y Desempate en una comisión publicada, con la mayoría bajo el título (P20)', async ({ page, api }) => {
  const labels = ['Ana Ruiz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez']
  const counts = [30, 19, 17, 17, 14, 11]
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 37, recordedCount: 36, eligibleCount: 38,
        round: { id: 'finanzas', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, runoff: false },
        results: labels.map((label, index) => ({ optionId: `o${index}`, label, count: counts[index] })),
        outcome: { seats: 3, base: 38, threshold: 20, elected: ['o0'], runoff: ['o1', 'o2', 'o3'], openSeats: 2 },
        officialResult: { elected: [{ optionId: 'o0', label: 'Ana Ruiz' }], note: null, declaredAt: '2026-11-02T10:00:00.000Z' },
      } }
    }
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.getByRole('heading', { name: 'Comisión de Finanzas' })).toBeVisible()
  await expect(page.locator('.pj-subtitle')).toHaveText('3 integrantes · Mayoría: 20')
  await expect(page.locator('.pj-results li').nth(0).locator('.pj-elected-tag')).toHaveText('✓ Electo/a')
  await expect(page.locator('.pj-results .pj-tie')).toHaveText(['Desempate', 'Desempate', 'Desempate'])
  await expect(page.locator('.pj-elected')).toHaveCount(0)
  await expect(page.locator('.pj-turnout')).toHaveText(/36\s*de 38\s*votaron · 2 no votaron/)
})

test('el proyector rotula el desempate de un cargo y suma el electo al publicarlo', async ({ page, api }) => {
  api.on(({ url }) => {
    if (url.pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      return { json: {
        assembly: { name: 'Asamblea Ordinaria 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' },
        participantCount: 38, recordedCount: 37, eligibleCount: 38,
        round: { id: 'presidencia-2', title: 'Presidencia', status: 'published', category: 'office', voteNumber: 2, runoff: true },
        results: [{ optionId: 'm', label: 'María López', count: 22 }, { optionId: 'c', label: 'Carlos Gómez', count: 15 }],
        outcome: { seats: 1, base: 38, threshold: 20, elected: ['m'], runoff: [], openSeats: 0 },
        officialResult: { elected: [{ optionId: 'm', label: 'María López' }], note: null, declaredAt: '2026-11-02T10:00:00.000Z' },
        final: { elected: [{ optionId: 'm', label: 'María López' }], approved: null },
      } }
    }
  })

  await page.goto('/projector?code=DEMO-ROOM')
  await expect(page.locator('.slide-office .office-name')).toHaveText('María López')
  await page.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(page.locator('.pj-status')).toHaveText(/Conteo publicado · DESEMPATE · 2\.ª VOTACIÓN/i)
  await expect(page.locator('.pj-subtitle')).toHaveText('Mayoría: 20')
  await expect(page.locator('.result-summary')).toContainText('María López')
  await expect(page.locator('.pj-elected')).toHaveCount(0)
  await expect(page.locator('.pj-results li').nth(0).locator('.pj-elected-tag')).toHaveText('✓ Electo/a')
})
