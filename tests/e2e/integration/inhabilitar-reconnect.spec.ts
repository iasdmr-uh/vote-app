import { expect, test, type Page } from '@playwright/test'
import { castVoteByApi, confirm, moderatorState, openRoom, participantState, prepareBallot, vote } from './helpers'

test.describe.configure({ timeout: 180_000 })

function person(mesa: Page, name: string) {
  return mesa.locator('.mesa-person-list li').filter({ hasText: name })
}

test('H · la mesa retira a alguien de la sala, lo regresa y lo reconecta con el QR', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea H · retirar y regresar', ['María López', 'Carlos Gómez', 'Rosa Díaz'])
  const { mesa, phones, assemblyId } = room
  const [maria, , rosa] = phones
  const oldToken = rosa.token

  await prepareBallot(mesa, { kind: 'office', title: 'Tesorero', candidates: ['Ana Ruiz', 'Juan Mora'] })
  await confirm(mesa, 'Abrir votación')
  await vote(maria, ['Ana Ruiz'])
  await expect(rosa.page.getByRole('button', { name: 'Salir' })).toHaveCount(0)

  await person(mesa, 'Rosa Díaz').getByLabel('Acciones para Rosa Díaz').click()
  await person(mesa, 'Rosa Díaz').getByRole('button', { name: 'Retirar de la sala' }).click()
  await mesa.getByRole('dialog').getByRole('button', { name: 'Retirar de la sala', exact: true }).click()
  await expect(mesa.locator('.out-of-room')).toContainText('Rosa Díaz')
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText('2')
  expect((await moderatorState(request, assemblyId)).rounds[0].eligibleCount).toBe(3)

  await mesa.locator('.out-of-room').getByRole('button', { name: 'Regresar a la sala' }).click()
  await expect(mesa.locator('.out-of-room')).toHaveCount(0)
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText('3')

  await person(mesa, 'Rosa Díaz').getByLabel('Acciones para Rosa Díaz').click()
  const issued = mesa.waitForResponse((response) => response.url().includes('/resume-code') && response.request().method() === 'POST')
  await person(mesa, 'Rosa Díaz').getByRole('button', { name: 'Reconectar dispositivo' }).click()
  await mesa.getByRole('dialog').getByRole('button', { name: 'Generar QR de reconexión', exact: true }).click()
  const { resumeUrl } = await (await issued).json()

  await rosa.page.goto(resumeUrl)
  await expect(rosa.page.locator('.options')).toBeVisible()
  const newToken = (await rosa.page.evaluate(() => localStorage.getItem('participantSessionToken')))!
  expect(newToken).not.toBe(oldToken)
  const state = await participantState(request, newToken)
  expect(state.votingDisabled).toBe(false)
  const round = (await moderatorState(request, assemblyId)).rounds[0]
  const ana = round.options.find((option: { label: string }) => option.label === 'Ana Ruiz').id
  expect((await castVoteByApi(request, oldToken, round.id, [ana])).status()).toBe(401)
  await vote({ ...rosa, token: newToken }, ['Juan Mora'])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('2')
})
