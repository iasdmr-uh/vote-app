import { expect, test, type Browser, type Page } from '@playwright/test'
import { closeAndShow, confirm, expectBadge, expectClosedByItself, expectPhoneShowsNoResult, mesaRow, moderatorState, openRoom, prepareBallot, projectorRow, runVote, vote, voteAll, type Phone, type Room } from './helpers'

test.describe.configure({ timeout: 240_000 })

const delegates = ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora']

const tied = (first: string, second: string) => [[first], [first], [second], [second]]

async function voteAndPublish(room: Room, ballots: string[][]) {
  await expect(room.mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await voteAll(room.phones, ballots)
  await expectClosedByItself(room.mesa)
  await closeAndShow(room)
}

async function addRegionalSecretary(browser: Browser, mesa: Page): Promise<Phone> {
  const ballot = mesa.locator('.ballot-card')
  await ballot.getByRole('textbox', { name: 'Nombre de la secretaría regional' }).fill('Marta')
  await ballot.getByRole('textbox', { name: 'Apellido de la secretaría regional' }).fill('Regional')
  const added = mesa.waitForResponse((response) => response.url().endsWith('/regional-secretary') && response.request().method() === 'POST')
  await ballot.getByRole('button', { name: 'Agregar a la secretaría regional' }).click()
  const { resumeUrl } = await (await added).json()
  await expect(mesa.locator('.qr-panel').first()).toContainText('Ingreso de Marta Regional')
  await expect(ballot.locator('.regional-secretary')).toContainText('Votan 5 en total')

  const page = await (await browser.newContext({ viewport: { width: 390, height: 844 }, isMobile: true, hasTouch: true })).newPage()
  await page.goto(resumeUrl)
  await expect.poll(() => page.evaluate(() => localStorage.getItem('participantSessionToken'))).toBeTruthy()
  return { name: 'Marta Regional', page, token: (await page.evaluate(() => localStorage.getItem('participantSessionToken')))! }
}

test('three tied votes bring in the regional secretary, whose secret vote settles the election', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea · secretaría regional', delegates)
  const { mesa, projector, phones, assemblyId } = room

  await prepareBallot(mesa, { kind: 'office', title: 'Presidente', candidates: ['Ana Ruiz', 'Luis Mora'] })
  await runVote(room, tied('Ana Ruiz', 'Luis Mora'))
  await expect(mesa.locator('.regional-secretary')).toHaveCount(0)

  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  await voteAndPublish(room, tied('Ana Ruiz', 'Luis Mora'))

  await mesa.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(mesa.getByLabel('Nombre del candidato')).toBeVisible()
  await expect(mesa.locator('.regional-secretary')).toHaveCount(0)
  await confirm(mesa, 'Abrir votación')
  await voteAndPublish(room, tied('Ana Ruiz', 'Luis Mora'))

  await mesa.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  const secretary = await addRegionalSecretary(browser, mesa)
  await expect(secretary.page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)

  await confirm(mesa, 'Abrir votación')
  await expect(projector.locator('.pj-status')).toContainText('Con la secretaría regional')
  await expect(projector.locator('.pj-progress')).toContainText('de 5 ya votaron')
  await voteAll(phones, tied('Ana Ruiz', 'Luis Mora'))
  await vote(secretary, ['Ana Ruiz'])
  await expectClosedByItself(mesa)
  await closeAndShow(room)

  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Electo/a')
  await expectBadge(projectorRow(projector, 'Ana Ruiz'), '✓ Electo/a')
  await expectPhoneShowsNoResult(phones[3])
  await expectPhoneShowsNoResult(secretary)
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText('4')

  const record = mesa.locator('.official-round')
  await expect(record).toHaveCount(4)
  for (const index of [0, 1, 2]) await expect(record.nth(index).locator('.declared-result')).toHaveCount(0)
  await expect(record.nth(3).locator('.declared-result')).toContainText('Ana Ruiz')
  await expect(record.nth(3)).toContainText('Con la secretaría regional')

  const final = await moderatorState(request, assemblyId)
  expect(final.participantCount).toBe(4)
  expect(final.rounds.map((round: { eligibleCount: number }) => round.eligibleCount)).toEqual([4, 4, 4, 5])
})

test('a decision with options that stays tied takes the regional secretary on its 4th vote', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea · decisión empatada', delegates)
  const { mesa, assemblyId } = room

  await prepareBallot(mesa, { kind: 'decision', title: 'Sede 2027', format: 'options', rule: 'simple', options: ['Tegucigalpa', 'La Ceiba'] })
  await runVote(room, tied('Tegucigalpa', 'La Ceiba'))
  for (let repeat = 0; repeat < 2; repeat += 1) {
    await confirm(mesa, 'Abrir desempate', 'Abrir votación')
    await voteAndPublish(room, tied('Tegucigalpa', 'La Ceiba'))
  }

  await mesa.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(mesa.getByLabel('Nombre del candidato')).toHaveCount(0)
  const secretary = await addRegionalSecretary(browser, mesa)
  await confirm(mesa, 'Abrir votación')
  await voteAll(room.phones, tied('Tegucigalpa', 'La Ceiba'))
  await vote(secretary, ['La Ceiba'])
  await expectClosedByItself(mesa)
  await closeAndShow(room)

  await expect(mesa.locator('.ballot-card .decision-verdict')).toHaveText('La Ceiba')
  const final = await moderatorState(request, assemblyId)
  expect(final.rounds.at(-1).eligibleCount).toBe(5)
})
