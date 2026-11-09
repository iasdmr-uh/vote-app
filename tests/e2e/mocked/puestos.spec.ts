import { expect, test } from './api-fixture'

// Puestos del organigrama (#46): the mesa chooses the puesto of a cargo (M25) and can add a departamento.


const board = ['Presidente', 'Vicepresidente', 'Secretario', 'Tesorero', 'Vocal 1', 'Vocal 2', 'Vocal 3']
const departments = ['Auditor', 'Escuela Sabática', 'Obra Misionera', 'Niños', 'Jóvenes', 'Asistencia Social', 'Salud', 'Familia', 'Colportaje', 'Música', 'Industria y Comercio', 'Multimedia', 'Agricultura', 'Construcción']
const electedBy: Record<string, string> = { Presidente: 'María López', Vicepresidente: 'Juan Mora', Secretario: 'Elena Castro' }

test('al crear la Asamblea la mesa escribe el nombre y el periodo', async ({ page, api }) => {
  let createBody: Record<string, unknown> | undefined
  await page.addInitScript(() => sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token'))
  api.on(({ request, url }) => {
    if (url.pathname.endsWith('/moderator/session')) { return { json: { authenticated: true } } }
    if (url.pathname.endsWith('/moderator/assemblies/active')) { return { json: { assembly: null, completed: [] } } }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies')) {
      createBody = request.postDataJSON()
      return { status: 201, json: { assemblyId: 'new-assembly', name: 'IV Asamblea Reorganizativa 2026', period: '2027–2029', status: 'lobby_open', joinCode: 'JOIN', joinUrl: 'http://localhost/?join=JOIN' } }
    }
    if (url.pathname.endsWith('/moderator/assemblies/new-assembly')) {
      return { json: { id: 'new-assembly', name: 'IV Asamblea Reorganizativa 2026', period: '2027–2029', status: 'lobby_open', completedAt: null, participants: [], participantCount: 0, rounds: [], positions: [] } }
    }
  })

  await page.goto('/moderator')
  await page.getByLabel('Nombre', { exact: true }).fill('IV Asamblea Reorganizativa 2026')
  await page.getByLabel('Periodo').fill('2027–2029')
  await page.getByRole('button', { name: 'Crear Asamblea' }).click()
  await expect.poll(() => createBody).toEqual({ name: 'IV Asamblea Reorganizativa 2026', period: '2027–2029' })
})

test('la mesa elige el puesto de un cargo, ve los electos en gris y agrega un departamento (M25)', async ({ page, api }) => {
  const positions = [
    ...board.map((label, sortOrder) => ({ id: `b${sortOrder}`, group: 'board', label, sortOrder, custom: false, elected: electedBy[label] ? { label: electedBy[label], roundId: `r-${label}` } : null })),
    ...departments.map((label, sortOrder) => ({ id: `d${sortOrder}`, group: 'department', label, sortOrder, custom: false, elected: null })),
  ]
  const positionBodies: unknown[] = []
  const roundBodies: Array<Record<string, unknown>> = []
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ request, url }) => {
    if (request.method() === 'GET' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: {
        id: 'synthetic-assembly', name: 'Asamblea Ordinaria 2026', period: '2027–2029', status: 'lobby_closed', completedAt: null,
        participants: [{ id: 'p1', firstName: 'Delegado', lastName: 'Sintético' }], participantCount: 1, rounds: [], attendanceRound: null, positions,
      } }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/positions')) {
      const body = request.postDataJSON() as { label: string }
      positionBodies.push(body)
      const added = { id: 'custom', group: 'department', label: body.label, sortOrder: departments.length, custom: true, elected: null }
      positions.push(added)
      return { status: 201, json: added }
    }
    if (request.method() === 'POST' && url.pathname.endsWith('/moderator/assemblies/synthetic-assembly/rounds')) {
      roundBodies.push(request.postDataJSON())
      return { status: 201, json: { id: `r${roundBodies.length}` } }
    }
  })

  await page.goto('/moderator')
  await expect(page.getByText('Delegado Sintético')).toBeVisible()
  await expect(page.getByLabel('Nombre del cargo')).toHaveCount(0)
  const trigger = page.getByRole('button', { name: 'Puesto' })
  await trigger.click()
  const menu = page.locator('.position-menu')
  await expect(menu.locator('.position-group')).toHaveText(['JUNTA DIRECTIVA', 'DEPARTAMENTOS'])
  await expect(menu.getByRole('option')).toHaveCount(21)
  const president = menu.getByRole('option', { name: /^Presidente/ })
  await expect(president).toHaveText(/Presidente\s*María López/)
  await expect(president).toHaveAttribute('aria-disabled', 'true')
  await expect(president).toHaveClass(/elected/)
  await president.click({ force: true })
  await expect(president).toHaveAttribute('aria-selected', 'false')

  const treasurer = menu.getByRole('option', { name: 'Tesorero', exact: true })
  await treasurer.click()
  await expect(menu).toHaveCount(0)
  await expect(trigger).toHaveText(/Tesorero/)
  await trigger.click()
  await expect(treasurer).toHaveAttribute('aria-selected', 'true')
  await expect(treasurer.locator('.position-check')).toHaveText('✓')

  // A departamento the org chart lacks is added last and chosen.
  await expect(menu.getByRole('button', { name: '+ Agregar' })).toBeDisabled()
  await menu.getByLabel('Nombre del departamento').fill('Comunicación')
  await menu.getByRole('button', { name: '+ Agregar' }).click()
  await expect.poll(() => positionBodies).toEqual([{ assemblyId: 'synthetic-assembly', label: 'Comunicación' }])
  await expect(menu.getByRole('option').last()).toHaveText(/Comunicación/)
  await expect(menu.getByRole('option', { name: 'Comunicación', exact: true })).toHaveAttribute('aria-selected', 'true')
  await expect(menu.getByLabel('Nombre del departamento')).toHaveValue('')
  await trigger.click()
  await expect(trigger).toHaveText(/Comunicación/)

  for (const name of ['Ana Ruiz', 'Juan Pérez']) {
    await page.getByLabel('Agregar candidato').fill(name)
    await page.getByLabel('Agregar candidato').press('Enter')
  }
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await page.getByRole('dialog').getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect.poll(() => roundBodies.length).toBe(1)
  expect(roundBodies[0]).toEqual({ positionId: 'custom', format: 'single_choice', category: 'office', options: [{ label: 'Ana Ruiz' }, { label: 'Juan Pérez' }] })

  // Committees and decisions keep their own title.
  await page.getByRole('radio', { name: 'Comisión', exact: true }).click()
  await expect(page.getByRole('button', { name: 'Puesto' })).toHaveCount(0)
  await expect(page.getByLabel('Nombre de la comisión')).toBeVisible()
  await page.getByRole('radio', { name: 'Decisión', exact: true }).click()
  await expect(page.getByLabel('Decisión', { exact: true })).toBeVisible()
})

test('sin puesto elegido, el cargo no se prepara', async ({ page, api }) => {
  await page.addInitScript(() => {
    sessionStorage.setItem('moderatorToken', 'synthetic-moderator-token')
    sessionStorage.setItem('assemblyId', 'synthetic-assembly')
  })
  api.on(({ url }) => {
    if (url.pathname.endsWith('/moderator/assemblies/synthetic-assembly')) {
      return { json: { id: 'synthetic-assembly', name: 'Asamblea', status: 'lobby_closed', completedAt: null, participants: [], participantCount: 0, rounds: [], positions: [] } }
    }
  })
  await page.goto('/moderator')
  await page.getByLabel('Agregar candidato').fill('Ana Ruiz')
  await page.getByLabel('Agregar candidato').press('Enter')
  await page.getByLabel('Agregar candidato').fill('Juan Pérez')
  await page.getByLabel('Agregar candidato').press('Enter')
  await page.getByRole('button', { name: 'Preparar papeleta' }).click()
  await expect(page.getByRole('alert')).toContainText('Elige el puesto que se vota.')
  await expect(page.getByRole('dialog')).toHaveCount(0)
})
