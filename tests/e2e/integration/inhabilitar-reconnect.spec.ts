import { expect, test, type Page } from '@playwright/test'
import { castVoteByApi, confirm, moderatorState, openRoom, participantState, prepareBallot, vote } from './helpers'

/**
 * H. An inhabilitado who left comes back (#43). Inhabilitar someone who tapped «Salir» brings them back to
 * the list, but their old token stays revoked: the mesa reconnects the phone with «Reconectar dispositivo»
 * and the phone still shows «Voto inhabilitado» until the mesa habilita them.
 */
test.describe.configure({ timeout: 180_000 })

function person(mesa: Page, name: string) {
  return mesa.locator('.mesa-person-list li').filter({ hasText: name })
}

test('H · un inhabilitado que salió se reconecta con el QR de la mesa y sigue viendo «Voto inhabilitado»', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea H · reconectar inhabilitado', ['María López', 'Carlos Gómez', 'Rosa Díaz'])
  const { mesa, phones, assemblyId } = room
  const [maria, , rosa] = phones
  const oldToken = rosa.token

  await prepareBallot(mesa, { kind: 'office', title: 'Tesorería', candidates: ['Ana Ruiz', 'Juan Mora'] })
  await confirm(mesa, 'Abrir votación')
  await vote(maria, ['Ana Ruiz'])

  // Rosa taps «Salir» and the mesa inhabilita her from the notice: she is back in the list.
  await rosa.page.getByRole('button', { name: 'Salir' }).click()
  await expect(rosa.page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  await mesa.locator('.left-notice').getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(person(mesa, 'Rosa Díaz').locator('.badge-disabled')).toHaveText('Inhabilitado')
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText('3')

  // «Reconectar dispositivo» issues a one-time code for her new session.
  await person(mesa, 'Rosa Díaz').getByLabel('Acciones para Rosa Díaz').click()
  const issued = mesa.waitForResponse((response) => response.url().includes('/resume-code') && response.request().method() === 'POST')
  await person(mesa, 'Rosa Díaz').getByRole('button', { name: 'Reconectar dispositivo' }).click()
  await mesa.getByRole('dialog').getByRole('button', { name: 'Generar QR de reconexión', exact: true }).click()
  const { resumeUrl } = await (await issued).json()
  await expect(mesa.getByRole('dialog', { name: 'QR de reconexión' })).toContainText('Reconexión de Rosa Díaz')

  // Her phone scans it: back in the room, still inhabilitada, with no ballot and no button.
  await rosa.page.goto(resumeUrl)
  await expect(rosa.page.getByRole('heading', { name: 'Voto inhabilitado' })).toBeVisible()
  await expect(rosa.page.locator('.options')).toHaveCount(0)
  await expect(rosa.page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  const newToken = (await rosa.page.evaluate(() => localStorage.getItem('participantSessionToken')))!
  expect(newToken).toBeTruthy()
  expect(newToken).not.toBe(oldToken)
  const state = await participantState(request, newToken)
  expect(state.votingDisabled).toBe(true)
  expect(state.openRound.options).toEqual([])
  const round = (await moderatorState(request, assemblyId)).rounds[0]
  const ana = round.options.find((option: { label: string }) => option.label === 'Ana Ruiz').id
  expect((await castVoteByApi(request, newToken, round.id, [ana])).status()).toBe(403)
  expect((await castVoteByApi(request, oldToken, round.id, [ana])).status()).toBe(401)
  expect((await moderatorState(request, assemblyId)).rounds[0].participationCount).toBe(1)

  // Habilitar gives the reconnected phone its ballot.
  await person(mesa, 'Rosa Díaz').getByRole('button', { name: 'Habilitar' }).click()
  await expect(rosa.page.getByRole('heading', { name: 'Voto inhabilitado' })).toHaveCount(0)
  await vote({ ...rosa, token: newToken }, ['Juan Mora'])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('2')
})
