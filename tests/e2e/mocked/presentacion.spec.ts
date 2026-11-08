import { expect, test, type Page } from '@playwright/test'

/** #48: slides in the Agenda UH 2026 style on the projector (Figma 160:9, P1–P6). */
const api = '**/api/v1/**'

const assembly = { name: 'IV Asamblea Reorganizativa 2026', status: 'in_progress', lobbyStatus: 'lobby_closed' }

async function projectorWith(page: Page, publicState: Record<string, unknown> | (() => Record<string, unknown>)) {
  await page.route(api, async (route) => {
    if (new URL(route.request().url()).pathname.endsWith('/assemblies/DEMO-ROOM/public-state')) {
      await route.fulfill({ json: typeof publicState === 'function' ? publicState() : publicState })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route' } })
  })
}

/** Without a socket the app polls every 7 s; advancing the fake clock past that refreshes the state in place. */
async function refreshByPolling(page: Page) {
  const request = page.waitForRequest((req) => req.url().includes('/public-state'))
  await page.clock.runFor(8_000)
  await request
}

test.describe('diapositivas del proyector', () => {
  test.use({ viewport: { width: 1920, height: 1080 } })

  test('P2: el cargo electo en grande, sus votos sobre los habilitados y el desempate', async ({ page }) => {
    await projectorWith(page, {
      assembly, participantCount: 38, recordedCount: 37, eligibleCount: 38,
      round: { id: 'presidente-2', title: 'Presidente', status: 'published', category: 'office', voteNumber: 2, runoff: true },
      results: [{ optionId: 'm', label: 'María López', count: 25 }, { optionId: 'c', label: 'Carlos Gómez', count: 12 }],
      outcome: { seats: 1, base: 38, threshold: 20, elected: ['m'], runoff: [], openSeats: 0 },
      officialResult: { elected: [{ optionId: 'm', label: 'María López' }], note: null, declaredAt: '2026-11-03T10:00:00.000Z' },
    })
    await page.goto('/projector?code=DEMO-ROOM')
    const slide = page.locator('.slide-office')
    await expect(slide.getByRole('heading', { level: 1 })).toHaveText('Presidente')
    await expect(slide.locator('.office-name')).toHaveText('María López')
    await expect(slide.locator('.office-votes')).toHaveText('25 de 38 votos · 66 %')
    await expect(slide.locator('.office-label')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
    await expect(slide.getByRole('img', { name: 'Con poder y gloria' })).toBeVisible()
    await expect(slide.getByRole('img', { name: 'Unión Hondureña' })).toBeVisible()
    // Big enough to read from the back of the room, and inside the 16:9 frame.
    expect(await slide.locator('.office-name').evaluate((element) => parseFloat(getComputedStyle(element).fontSize))).toBeGreaterThanOrEqual(140)
    expect(await slide.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual([1920, 1080])
    await expect(page.locator('.pj-results')).toHaveCount(0)

    // The detailed count is still there, one click away, and back.
    await page.getByRole('button', { name: 'Ver conteo' }).click()
    await expect(page.locator('.pj-results li')).toHaveCount(2)
    await page.getByRole('button', { name: 'Ver resultado' }).click()
    await expect(slide).toBeVisible()
  })

  test('P2 cabe en una pantalla más pequeña con la misma proporción', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 720 })
    await projectorWith(page, {
      assembly, participantCount: 38, recordedCount: 38, eligibleCount: 38,
      round: { id: 'tesorero', title: 'Tesorero', status: 'published', category: 'office', voteNumber: 1, runoff: false },
      results: [{ optionId: 'p', label: 'Pedro Antonio Vargas Hernández', count: 30 }, { optionId: 'x', label: 'Otro', count: 8 }],
      outcome: { seats: 1, base: 38, threshold: 20, elected: ['p'], runoff: [], openSeats: 0 },
      officialResult: { elected: [{ optionId: 'p', label: 'Pedro Antonio Vargas Hernández' }], note: null, declaredAt: '2026-11-03T10:00:00.000Z' },
    })
    await page.goto('/projector?code=DEMO-ROOM')
    const slide = page.locator('.slide-office')
    await expect(slide.locator('.office-name')).toHaveText('Pedro Antonio Vargas Hernández')
    await expect(slide.locator('.office-label')).toHaveCount(0)
    expect(await slide.evaluate((element) => [element.clientWidth, element.clientHeight])).toEqual([1280, 720])
    const name = await slide.locator('.office-name').boundingBox()
    expect(name!.x).toBeGreaterThanOrEqual(0)
    expect(name!.x + name!.width).toBeLessThanOrEqual(1280)
  })

  for (const approved of [true, false]) {
    test(`P3: la decisión «${approved ? 'Aprobada' : 'No aprobada'}» con A favor, En contra y la regla`, async ({ page }) => {
      const counts = approved ? [30, 6] : [27, 9]
      await projectorWith(page, {
        assembly, participantCount: 38, recordedCount: 36, eligibleCount: 38,
        round: { id: 'presupuesto', title: 'Presupuesto 2027', status: 'published', category: 'decision', decisionFormat: 'boolean', approvalRule: 'three_quarters', voteNumber: 1, runoff: false },
        results: [{ optionId: 'favor', label: 'A favor', count: counts[0] }, { optionId: 'contra', label: 'En contra', count: counts[1] }],
        outcome: { seats: 1, base: 38, threshold: 29, elected: [], runoff: [], openSeats: 0, rule: 'three_quarters', approved },
      })
      await page.goto('/projector?code=DEMO-ROOM')
      const slide = page.locator('.slide-decision')
      await expect(slide.locator('.decision-kicker')).toHaveText('DECISIÓN')
      await expect(slide.getByRole('heading', { level: 1 })).toHaveText('Presupuesto 2027')
      const pill = slide.locator('.decision-pill')
      await expect(pill).toHaveText(approved ? '✓ Aprobada' : 'No aprobada')
      await expect(pill).toHaveClass(approved ? /decision-approved/ : /decision-rejected/)
      await expect(pill).toHaveCSS('background-color', approved ? 'rgb(31, 122, 77)' : 'rgb(163, 58, 47)')
      expect(await pill.evaluate((element) => (element as HTMLElement).innerText)).toBe(approved ? '✓ APROBADA' : 'NO APROBADA')
      await expect(slide.locator('.decision-details')).toHaveText(`A favor ${counts[0]} · En contra ${counts[1]} · Se aprueba con 3/4 · 29 votos`)
    })
  }

  test('P6: la comisión completa, en orden, con sus votos y los integrantes', async ({ page }) => {
    await projectorWith(page, {
      assembly, participantCount: 38, recordedCount: 36, eligibleCount: 38,
      round: { id: 'finanzas', title: 'Comisión de Finanzas', status: 'published', category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, runoff: false },
      results: [{ optionId: 'a', label: 'Ana Ruiz', count: 30 }, { optionId: 'j', label: 'Jorge Banegas', count: 26 }, { optionId: 'e', label: 'Elena Castro', count: 24 }, { optionId: 'l', label: 'Luis Pérez', count: 9 }],
      outcome: { seats: 3, base: 38, threshold: 20, elected: ['a', 'j', 'e'], runoff: [], openSeats: 0 },
      officialResult: { elected: [{ optionId: 'a', label: 'Ana Ruiz' }, { optionId: 'j', label: 'Jorge Banegas' }, { optionId: 'e', label: 'Elena Castro' }], note: null, declaredAt: '2026-11-03T10:00:00.000Z' },
    })
    await page.goto('/projector?code=DEMO-ROOM')
    const slide = page.locator('.slide-committee')
    await expect(slide.getByRole('heading', { level: 1 })).toHaveText('Comisión de Finanzas')
    await expect(slide.locator('.committee-rows li')).toHaveText([/^1\s*Ana Ruiz\s*30 votos$/, /^2\s*Jorge Banegas\s*26 votos$/, /^3\s*Elena Castro\s*24 votos$/])
    await expect(slide.locator('.committee-members')).toHaveText('3 integrantes')
    await expect(slide.getByText('Luis Pérez')).toHaveCount(0)
  })

  test('P6: los delegados elegidos en desempates suman los anteriores; muchos van en dos columnas', async ({ page }) => {
    const names = ['Ana Ruiz', 'Jorge Banegas', 'Elena Castro', 'Luis Pérez', 'Sofía Méndez', 'Juan Mora', 'Rosa Díaz', 'Mario Aguilar']
    await projectorWith(page, {
      assembly, participantCount: 38, recordedCount: 36, eligibleCount: 38,
      round: { id: 'delegados-2', title: 'Delegados para CG', status: 'published', category: 'committee', memberCount: 8, electionSeats: 2, voteNumber: 2, runoff: true },
      // Only this vote's counts reach the projector: the six elected earlier show without votes.
      results: [{ optionId: 'r', label: 'Rosa Díaz', count: 22 }, { optionId: 'm', label: 'Mario Aguilar', count: 21 }, { optionId: 'x', label: 'Otro', count: 3 }],
      outcome: { seats: 2, base: 38, threshold: 20, elected: ['r', 'm'], runoff: [], openSeats: 0 },
      officialResult: { elected: names.map((label, index) => ({ optionId: index === 6 ? 'r' : index === 7 ? 'm' : `e${index}`, label })), note: null, declaredAt: '2026-11-03T10:00:00.000Z' },
    })
    await page.goto('/projector?code=DEMO-ROOM')
    const rows = page.locator('.slide-committee .committee-rows li')
    await expect(rows).toHaveCount(8)
    await expect(rows.nth(6)).toHaveText(/^7\s*Rosa Díaz\s*22 votos$/)
    await expect(rows.nth(0)).toHaveText(/^1\s*Ana Ruiz$/)
    await expect(page.locator('.committee-members')).toHaveText('8 integrantes')
    const [first, fifth] = await Promise.all([rows.nth(0).boundingBox(), rows.nth(4).boundingBox()])
    expect(fifth!.x).toBeGreaterThan(first!.x + first!.width)
    const list = await page.locator('.committee-rows').boundingBox()
    expect(list!.y + list!.height).toBeLessThanOrEqual(1080)
  })

  test('sin resultado definido se queda el conteo detallado; cerrada o anulada no cambian', async ({ page }) => {
    await page.clock.install()
    let status = 'closed'
    await projectorWith(page, () => ({
      assembly, participantCount: 37, recordedCount: 36, eligibleCount: 38,
      round: { id: 'finanzas', title: 'Comisión de Finanzas', status, category: 'committee', memberCount: 3, electionSeats: 3, voteNumber: 1, runoff: false },
      ...(status === 'published' ? {
        results: [{ optionId: 'a', label: 'Ana Ruiz', count: 30 }, { optionId: 'j', label: 'Juan Mora', count: 19 }, { optionId: 'e', label: 'Elena Castro', count: 17 }, { optionId: 'p', label: 'Pedro Vargas', count: 17 }],
        outcome: { seats: 3, base: 38, threshold: 20, elected: ['a'], runoff: ['j', 'e', 'p'], openSeats: 2 },
        officialResult: { elected: [{ optionId: 'a', label: 'Ana Ruiz' }], note: null, declaredAt: '2026-11-03T10:00:00.000Z' },
      } : {}),
    }))
    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.locator('.pj-status')).toHaveText(/Votación cerrada/)
    await expect(page.locator('.slide')).toHaveCount(0)
    status = 'published'
    await refreshByPolling(page)
    await expect(page.locator('.pj-results li')).toHaveCount(4)
    await expect(page.locator('.slide')).toHaveCount(0)
    await expect(page.getByRole('button', { name: 'Ver conteo' })).toHaveCount(0)
    status = 'annulled'
    await refreshByPolling(page)
    await expect(page.locator('.pj-status')).toHaveText('Votación anulada')
  })

  test('«Presentar oficiales»: portada, Junta directiva y Departamentos con puestos en blanco', async ({ page }) => {
    await page.clock.install()
    let presentation = { active: true, slide: 0 }
    const positions = [
      ...['Presidente', 'Vicepresidente', 'Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3'].map((label, index) => ({ id: `b${index}`, group: 'board', label, sortOrder: index, custom: false, elected: index === 0 ? { label: 'María López', roundId: 'r1' } : index === 1 ? { label: 'Juan Mora', roundId: 'r2' } : null })),
      ...['Auditor', 'Escuela Sabática', 'Obra Misionera', 'Niños', 'Jóvenes', 'Asistencia Social', 'Salud', 'Familia', 'Colportaje', 'Música', 'Industria y Comercio', 'Multimedia', 'Agricultura', 'Construcción', 'Comunicación'].map((label, index) => ({ id: `d${index}`, group: 'department', label, sortOrder: index, custom: index === 14, elected: index === 0 ? { label: 'Carlos Gómez', roundId: 'r3' } : null })),
    ]
    await projectorWith(page, () => ({
      assembly, assemblyName: 'IV Asamblea Reorganizativa 2026', period: '2027–2029', participantCount: 38, positions, presentation,
      round: { id: 'presidente', title: 'Presidente', status: 'open', category: 'office' },
    }))
    await page.goto('/projector?code=DEMO-ROOM')

    // P1: it covers whatever else the projector was showing, here an open vote.
    const cover = page.locator('.slide-cover')
    await expect(cover.getByRole('heading', { level: 1 })).toHaveText('OFICIALES DE UNIÓN HONDUREÑA')
    await expect(cover.locator('.cover-period')).toHaveText('2027–2029')
    await expect(cover.locator('.cover-assembly')).toHaveText('IV Asamblea Reorganizativa 2026')
    await expect(cover.getByRole('img', { name: 'Con poder y gloria' })).toHaveAttribute('src', '/brand/conpoder-blanco.png')
    await expect(page.locator('.pj-progress')).toHaveCount(0)

    // P4: Presidente and Vicepresidente above, the other five joined below; unvoted puestos are blank.
    presentation = { active: true, slide: 1 }
    await refreshByPolling(page)
    const board = page.locator('.slide-board')
    await expect(board.getByRole('heading', { level: 1 })).toHaveText('JUNTA DIRECTIVA')
    await expect(board.locator('.puesto h2')).toHaveText(['Presidente', 'Vicepresidente', 'Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3'])
    await expect(board.locator('.puesto p')).toHaveText(['María López', 'Juan Mora', '', '', '', '', ''])
    await expect(board.locator('.puesto-blank')).toHaveCount(5)
    await expect(board.locator('.line')).toHaveCount(3 + 2 + 5)
    const [president, secretary] = await Promise.all([board.locator('.puesto').nth(0).boundingBox(), board.locator('.puesto').nth(2).boundingBox()])
    expect(secretary!.y).toBeGreaterThan(president!.y + president!.height)

    // P5: two columns on a center line; a department the mesa added fits too.
    presentation = { active: true, slide: 2 }
    await refreshByPolling(page)
    const departments = page.locator('.slide-departments')
    await expect(departments.getByRole('heading', { level: 1 })).toHaveText('DEPARTAMENTOS')
    await expect(departments.locator('.puesto')).toHaveCount(15)
    await expect(departments.locator('.puesto').nth(0)).toHaveText(/Auditor\s*Carlos Gómez/)
    await expect(departments.locator('.puesto').nth(14)).toHaveText('Comunicación')
    const [auditor, sabbath, last] = await Promise.all([0, 1, 14].map((index) => departments.locator('.puesto').nth(index).boundingBox()))
    expect(sabbath!.x).toBeGreaterThan(auditor!.x + auditor!.width)
    expect(Math.abs(sabbath!.y - auditor!.y)).toBeLessThan(1)
    expect(last!.y + last!.height).toBeLessThanOrEqual(1080)

    // Off again: the projector goes back to the vote in course.
    presentation = { active: false, slide: 2 }
    await refreshByPolling(page)
    await expect(page.locator('.slide')).toHaveCount(0)
    await expect(page.getByRole('heading', { name: 'Presidente' })).toBeVisible()
  })

  test('sin puestos del servidor la Junta directiva sale completa y en blanco; sin periodo la portada lo omite', async ({ page }) => {
    await page.clock.install()
    let presentation = { active: true, slide: 0 }
    await projectorWith(page, () => ({ assembly: { ...assembly, name: 'Asamblea de prueba' }, participantCount: 3, presentation }))
    await page.goto('/projector?code=DEMO-ROOM')
    await expect(page.locator('.cover-assembly')).toHaveText('Asamblea de prueba')
    await expect(page.locator('.cover-period')).toHaveCount(0)
    presentation = { active: true, slide: 1 }
    await refreshByPolling(page)
    await expect(page.locator('.slide-board .puesto')).toHaveCount(7)
    await expect(page.locator('.slide-board .puesto-blank')).toHaveCount(7)
  })
})

test('la mesa presenta los oficiales: activa, pasa con flechas y termina', async ({ page }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  let presentation = { active: false, slide: 0 }
  const calls: unknown[] = []
  await page.route(api, async (route) => {
    const request = route.request()
    const url = new URL(request.url())
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      await route.fulfill({ json: {
        id: 'synthetic-assembly', name: 'IV Asamblea Reorganizativa 2026', status: 'in_progress', completedAt: null,
        participants: [], participantCount: 0, attendanceRound: null, rounds: [], presentation,
      } })
      return
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/presentation')) {
      const body = request.postDataJSON()
      calls.push(body)
      presentation = { active: body.active, slide: body.slide }
      await route.fulfill({ json: { assemblyId: 'synthetic-assembly', presentation } })
      return
    }
    await route.fulfill({ status: 404, json: { message: 'No mock route for presentation test' } })
  })

  await page.goto('/moderator')
  const bar = page.getByRole('region', { name: 'Presentar oficiales' })
  await bar.getByRole('button', { name: 'Presentar oficiales' }).click()
  await expect(bar.locator('.presentation-slide')).toHaveText('Portada · 1/3')
  await expect(bar.getByRole('button', { name: 'Diapositiva anterior' })).toBeDisabled()
  await bar.getByRole('button', { name: 'Diapositiva siguiente' }).click()
  await expect(bar.locator('.presentation-slide')).toHaveText('Junta directiva · 2/3')
  await bar.getByRole('button', { name: 'Diapositiva siguiente' }).click()
  await expect(bar.locator('.presentation-slide')).toHaveText('Departamentos · 3/3')
  await expect(bar.getByRole('button', { name: 'Diapositiva siguiente' })).toBeDisabled()
  await bar.getByRole('button', { name: 'Diapositiva anterior' }).click()
  await expect(bar.locator('.presentation-slide')).toHaveText('Junta directiva · 2/3')
  await bar.getByRole('button', { name: 'Terminar presentación' }).click()
  await expect(bar.getByRole('button', { name: 'Presentar oficiales' })).toBeVisible()
  await expect(bar.locator('.presentation-slide')).toHaveCount(0)
  expect(calls).toEqual([
    { assemblyId: 'synthetic-assembly', active: true, slide: 0 },
    { assemblyId: 'synthetic-assembly', active: true, slide: 1 },
    { assemblyId: 'synthetic-assembly', active: true, slide: 2 },
    { assemblyId: 'synthetic-assembly', active: true, slide: 1 },
    { assemblyId: 'synthetic-assembly', active: false, slide: 1 },
  ])

  // Reopening the mesa picks the presentation back up from the server.
  presentation = { active: true, slide: 2 }
  await page.reload()
  await expect(bar.locator('.presentation-slide')).toHaveText('Departamentos · 3/3')
})
