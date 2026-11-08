import { expect, type APIRequestContext, type Browser, type Locator, type Page } from '@playwright/test'

/**
 * Shared steps for the real-stack suite: the mesa, the projector and the delegate phones act through the
 * real UI against the real API and PostgreSQL. API calls are only used to set up, to read back what the
 * server stored, and to prove what the server rejects.
 */
export const moderatorToken = process.env.MODERATOR_ACCESS_TOKEN!
export const api = `http://127.0.0.1:${process.env.E2E_API_PORT ?? '3300'}/api/v1`

const asModerator = { Authorization: `Bearer ${moderatorToken}` }

export type Phone = { name: string; page: Page; token: string }
export type Room = { mesa: Page; projector: Page; phones: Phone[]; joinCode: string; assemblyId: string }

/**
 * The API allows a single live Asamblea, so a scenario first finalizes whatever an earlier one left
 * running (closing its open vote), and every scenario starts from its own Asamblea.
 */
export async function finishLiveAssembly(request: APIRequestContext) {
  const active = await request.get(`${api}/moderator/assemblies/active`, { headers: asModerator })
  expect(active.ok()).toBeTruthy()
  const { assembly } = await active.json()
  if (!assembly) return
  const state = await moderatorState(request, assembly.id)
  for (const round of state.rounds.filter((item: { status: string }) => item.status === 'open')) {
    expect((await request.post(`${api}/moderator/rounds/${round.id}/close`, { headers: asModerator })).ok()).toBeTruthy()
  }
  if (state.status === 'lobby_open') {
    expect((await request.patch(`${api}/moderator/assemblies/${assembly.id}/lobby`, { headers: asModerator, data: { status: 'lobby_closed' } })).ok()).toBeTruthy()
  }
  const completed = await request.post(`${api}/moderator/assemblies/${assembly.id}/complete`, { headers: asModerator, data: { confirmation: true } })
  expect(completed.ok(), await completed.text()).toBeTruthy()
}

export async function moderatorState(request: APIRequestContext, assemblyId: string) {
  const response = await request.get(`${api}/moderator/assemblies/${assemblyId}`, { headers: asModerator })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

/** What a delegate's own session sees, read with its token. */
export async function participantState(request: APIRequestContext, token: string) {
  const response = await request.get(`${api}/participant/me`, { headers: { Authorization: `Bearer ${token}` } })
  expect(response.ok()).toBeTruthy()
  return response.json()
}

/** A vote sent straight to the API with a valid participant token, bypassing the phone's own checks. */
export async function castVoteByApi(request: APIRequestContext, token: string, roundId: string, optionIds: string[]) {
  return request.post(`${api}/participant/rounds/${roundId}/vote`, {
    headers: { Authorization: `Bearer ${token}` },
    data: optionIds.length === 1 ? { optionId: optionIds[0], confirmation: true } : { optionIds, confirmation: true },
  })
}

export async function openMesa(browser: Browser, assemblyName: string, period?: string) {
  const mesa = await (await browser.newContext({ viewport: { width: 1280, height: 900 } })).newPage()
  await mesa.goto('/moderator')
  await mesa.getByLabel('Credencial de moderación').fill(moderatorToken)
  await mesa.getByRole('button', { name: 'Continuar' }).click()
  await mesa.getByLabel('Nombre', { exact: true }).fill(assemblyName)
  if (period) await mesa.getByLabel('Periodo').fill(period)
  await mesa.getByRole('button', { name: 'Crear Asamblea', exact: true }).click()
  const created = mesa.locator('.notice.success')
  await expect(created).toContainText('Código de ingreso:')
  const joinCode = (await created.innerText()).match(/Código de ingreso:\s*(\S+)/)![1]
  const assemblyId = (await mesa.evaluate(() => sessionStorage.getItem('assemblyId')))!
  expect(assemblyId).toBeTruthy()
  return { mesa, joinCode, assemblyId }
}

export async function openProjector(browser: Browser, joinCode: string) {
  const projector = await (await browser.newContext({ viewport: { width: 1920, height: 1080 } })).newPage()
  await projector.goto(`/projector?code=${encodeURIComponent(joinCode)}`)
  return projector
}

/** A delegate joins from their own phone (its own browser context, so its own session). */
export async function joinPhone(browser: Browser, joinCode: string, name: string): Promise<Phone> {
  const context = await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })
  const page = await context.newPage()
  await page.goto(`/?join=${encodeURIComponent(joinCode)}`)
  const [firstName, ...rest] = name.split(' ')
  await page.getByLabel('Nombre', { exact: true }).fill(firstName)
  await page.getByLabel('Apellido').fill(rest.join(' '))
  await page.getByRole('button', { name: 'Entrar a la sala' }).click()
  await expect(page.getByRole('heading', { name: 'Sala de espera' })).toBeVisible()
  const token = (await page.evaluate(() => localStorage.getItem('participantSessionToken')))!
  expect(token).toBeTruthy()
  return { name, page, token }
}

/**
 * A fresh Asamblea with its projector and delegates in the room; the mesa sees all of them before it
 * closes the ingreso.
 */
export async function openRoom(browser: Browser, request: APIRequestContext, assemblyName: string, delegates: string[], period?: string): Promise<Room> {
  await finishLiveAssembly(request)
  const { mesa, joinCode, assemblyId } = await openMesa(browser, assemblyName, period)
  const projector = await openProjector(browser, joinCode)
  const phones: Phone[] = []
  for (const name of delegates) phones.push(await joinPhone(browser, joinCode, name))
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText(String(delegates.length))
  await expect(projector.getByRole('list', { name: 'Personas en la sala' }).getByRole('listitem')).toHaveCount(delegates.length)
  await confirm(mesa, 'Cerrar ingreso')
  await expect(mesa.getByRole('button', { name: 'Reabrir ingreso' })).toBeVisible()
  return { mesa, projector, phones, joinCode, assemblyId }
}

/** Clicks a mesa action and confirms it in the dialog. */
export async function confirm(mesa: Page, button: string, dialogButton = button) {
  await mesa.getByRole('button', { name: button, exact: true }).first().click()
  const dialog = mesa.getByRole('dialog')
  await dialog.getByRole('button', { name: dialogButton, exact: true }).click()
  await expect(mesa.locator('.confirmation-dialog')).toHaveCount(0)
}

type Ballot =
  | { kind: 'office'; title: string; candidates: string[] }
  | { kind: 'committee'; title: string; seats: number; candidates: string[] }
  | { kind: 'decision'; title: string; format: 'boolean'; rule: 'simple' | 'two_thirds' | 'three_quarters' }
  | { kind: 'decision'; title: string; format: 'options'; rule: 'simple' | 'two_thirds' | 'three_quarters'; options: string[] }

export async function prepareBallot(mesa: Page, ballot: Ballot) {
  const another = mesa.getByRole('button', { name: 'Preparar otra papeleta' })
  if (await another.isVisible()) await another.click()
  await expect(mesa.getByText('NUEVA PAPELETA', { exact: true })).toBeVisible()
  const kind = { office: 'Cargo', committee: 'Comisión', decision: 'Decisión' }[ballot.kind]
  await mesa.getByRole('radio', { name: kind, exact: true }).click()
  let names: string[] = []
  if (ballot.kind === 'office') {
    // A cargo fills a puesto; a title outside the default org chart is added as a departamento.
    await mesa.getByRole('button', { name: 'Puesto' }).click()
    const option = mesa.getByRole('option', { name: ballot.title, exact: true })
    if (await option.count()) await option.click()
    else {
      await mesa.getByLabel('Nombre del departamento').fill(ballot.title)
      await mesa.getByRole('button', { name: '+ Agregar' }).click()
      await expect(mesa.getByRole('option', { name: ballot.title, exact: true })).toHaveAttribute('aria-selected', 'true')
      await mesa.getByRole('button', { name: 'Puesto' }).click()
    }
    await expect(mesa.getByRole('button', { name: 'Puesto' })).toContainText(ballot.title)
    names = ballot.candidates
  } else if (ballot.kind === 'committee') {
    await mesa.getByLabel('Nombre de la comisión').fill(ballot.title)
    await mesa.getByLabel('¿Cuántos integrantes quedarán en la comisión?').fill(String(ballot.seats))
    names = ballot.candidates
  } else {
    await mesa.getByLabel('Decisión', { exact: true }).fill(ballot.title)
    await mesa.getByRole('radio', { name: ballot.format === 'boolean' ? 'A favor / En contra' : 'Opciones', exact: true }).click()
    await mesa.getByRole('radio', { name: { simple: 'Mayoría simple', two_thirds: '2/3', three_quarters: '3/4' }[ballot.rule], exact: true }).click()
    if (ballot.format === 'options') names = ballot.options
  }
  const input = mesa.getByLabel(ballot.kind === 'decision' ? 'Agregar opción' : 'Agregar candidato')
  for (const name of names) {
    await input.fill(name)
    await input.press('Enter')
  }
  await confirm(mesa, 'Preparar papeleta')
  await expect(mesa.getByText('PAPELETA PREPARADA', { exact: true })).toBeVisible()
}

/** The ballot reaches the phone through realtime; the delegate marks, reviews and confirms. */
export async function vote(phone: Phone, choices: string[]) {
  const { page } = phone
  const review = page.getByRole('button', { name: 'Revisar mi voto' })
  await expect(review).toBeVisible()
  for (const choice of choices) await page.getByLabel(choice, { exact: true }).check()
  await review.click()
  await page.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(page.getByText('Tu voto quedó registrado')).toBeVisible()
}

/** Each delegate casts the ballot at the same index; `null` leaves that delegate without voting. */
export async function voteAll(phones: Phone[], ballots: Array<string[] | null>) {
  for (const [index, choices] of ballots.entries()) if (choices) await vote(phones[index], choices)
}

export async function runVote(room: Room, ballots: Array<string[] | null>) {
  const { mesa } = room
  await confirm(mesa, 'Abrir votación')
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await voteAll(room.phones, ballots)
  const cast = ballots.filter(Boolean).length
  if (cast === room.phones.length) await expectClosedByItself(mesa)
  else await expect(mesa.locator('.vote-progress strong')).toHaveText(String(cast))
  await closeAndShow(room)
}

export async function expectClosedByItself(mesa: Page) {
  await expect(mesa.getByText('CONTEO PUBLICADO', { exact: true })).toBeVisible()
}

export async function closeAndShow(room: Room) {
  const { mesa, projector, assemblyId } = room
  const { rounds } = await moderatorState(mesa.request, assemblyId)
  if (rounds.some((round: { status: string }) => round.status === 'open')) await confirm(mesa, 'Cerrar votación')
  await expect(mesa.getByText('CONTEO PUBLICADO', { exact: true })).toBeVisible()
  await expect(projector.locator('.pj-results, .slide').first()).toBeVisible()
  if (await projector.locator('.slide').isVisible()) await projector.getByRole('button', { name: 'Ver conteo' }).click()
  await expect(projector.locator('.pj-results')).toBeVisible()
}

export async function addToOfficials(mesa: Page) {
  await confirm(mesa, 'Agregar a oficiales')
  await expect(mesa.locator('.ballot-card')).toContainText('Registrado como oficial')
}

/** A result row of the vote the mesa is looking at (not the acta below it). */
export function mesaRow(mesa: Page, label: string): Locator {
  return mesa.locator('.ballot-card .ranked-rows li').filter({ hasText: label })
}

export function phoneRow(phone: Phone, label: string): Locator {
  return phone.page.locator('.phone-results .ranked-rows li').filter({ hasText: label })
}

export function projectorRow(projector: Page, label: string): Locator {
  return projector.locator('.pj-results li').filter({ hasText: label })
}

/** The badges a row carries, so a test can check one has "Desempate" and another has none. */
export async function expectBadge(row: Locator, badge: string | null) {
  const badges = row.locator('.badge, em')
  if (badge === null) await expect(badges).toHaveCount(0)
  else await expect(badges).toHaveText([badge])
}
