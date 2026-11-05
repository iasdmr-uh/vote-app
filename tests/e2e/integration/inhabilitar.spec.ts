import { expect, test, type Page } from '@playwright/test'
import { castVoteByApi, closeAndPublish, confirm, expectBadge, mesaRow, moderatorState, openRoom, participantState, prepareBallot, projectorRow, vote, voteAll } from './helpers'

/**
 * D. Inhabilitar (#43) during an open vote. Six habilitados: the inhabilitado keeps counting in the base,
 * so the majority stays 4 (with a base of 5 it would be 3), and "no votaron" counts them too.
 */
test.describe.configure({ timeout: 180_000 })

function person(mesa: Page, name: string) {
  return mesa.locator('.mesa-person-list li').filter({ hasText: name })
}

test('D · inhabilitar durante una votación: el teléfono no recibe la papeleta, el servidor rechaza el voto y sigue en la base', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea D · inhabilitar', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas'])
  const { mesa, projector, phones, assemblyId } = room
  const [maria, carlos, rosa, juan, elena] = phones
  const summary = mesa.locator('.attendance-summary')

  await prepareBallot(mesa, { kind: 'office', title: 'Tesorero', candidates: ['Ana Ruiz', 'Juan Mora'] })
  await confirm(mesa, 'Abrir votación')
  await vote(maria, ['Ana Ruiz'])
  await expect(summary.locator(':scope > span')).toHaveText(['1 votó', '5 faltan'])

  // From the participant menu (M24): Carlos is inhabilitado at once, without a confirmation step.
  await person(mesa, 'Carlos Gómez').getByLabel('Acciones para Carlos Gómez').click()
  await person(mesa, 'Carlos Gómez').getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(person(mesa, 'Carlos Gómez').locator('.badge-disabled')).toHaveText('Inhabilitado')
  await expect(person(mesa, 'Carlos Gómez').getByText('Inhabilitado', { exact: true })).toBeVisible()
  await expect(summary.locator(':scope > span')).toHaveText(['1 votó', '4 faltan', '1 inhabilitado'])
  // T05: the phone shows the state, with no options and no button.
  await expect(carlos.page.getByRole('heading', { name: 'Voto inhabilitado' })).toBeVisible()
  await expect(carlos.page.locator('.options')).toHaveCount(0)
  await expect(carlos.page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  // The server withholds the ballot and rejects the vote, even with a valid token and a valid option.
  const withheld = await participantState(request, carlos.token)
  expect(withheld.votingDisabled).toBe(true)
  expect(withheld.openRound.options).toEqual([])
  const rounds = (await moderatorState(request, assemblyId)).rounds
  const ana = rounds[0].options.find((option: { label: string }) => option.label === 'Ana Ruiz').id
  const rejected = await castVoteByApi(request, carlos.token, rounds[0].id, [ana])
  expect(rejected.status()).toBe(403)
  expect((await rejected.json()).message).toBe('Tu voto está inhabilitado')
  expect((await moderatorState(request, assemblyId)).rounds[0].participationCount).toBe(1)

  // Habilitar gives the ballot back, and Carlos votes.
  await person(mesa, 'Carlos Gómez').getByRole('button', { name: 'Habilitar' }).click()
  await expect(person(mesa, 'Carlos Gómez').locator('.badge-disabled')).toHaveCount(0)
  await expect(summary.locator(':scope > span')).toHaveText(['1 votó', '5 faltan'])
  await expect(carlos.page.getByRole('heading', { name: 'Voto inhabilitado' })).toHaveCount(0)
  await vote(carlos, ['Juan Mora'])
  await expect(summary.locator(':scope > span')).toHaveText(['2 votaron', '4 faltan'])

  // Rosa taps "Salir"; the mesa's notice offers Inhabilitar, which keeps her in the list and the base.
  await rosa.page.getByRole('button', { name: 'Salir' }).click()
  await expect(rosa.page.getByRole('heading', { name: 'Bienvenido' })).toBeVisible()
  const left = mesa.locator('.left-notice')
  await expect(left).toContainText('Rosa Díaz salió de la sala')
  await left.getByRole('button', { name: 'Inhabilitar' }).click()
  await expect(left).toHaveCount(0)
  // Inhabilitar someone who left brings them back to the list (confirmed by the user).
  await expect(person(mesa, 'Rosa Díaz').locator('.badge-disabled')).toHaveText('Inhabilitado')
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText('6')
  await expect(summary.locator(':scope > span')).toHaveText(['2 votaron', '3 faltan', '1 inhabilitado'])

  // Juan and Elena vote; Pedro does not. Ana 3, Juan 1 over a base of 6.
  await voteAll([juan, elena], [['Ana Ruiz'], ['Ana Ruiz']])
  await expect(summary.locator(':scope > span')).toHaveText(['4 votaron', '1 falta', '1 inhabilitado'])
  await expect(projector.locator('.pj-progress')).toContainText('de 6 ya votaron')
  await closeAndPublish(room)

  // Rosa still counts: the majority of 6 is 4, so Ana's 3 do not elect her, and 2 did not vote.
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('Mayoría: 4')
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('4 de 6')
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('votaron · 2 no votaron')
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Juan Mora'), 'Desempate')
  await expect(projector.locator('.pj-subtitle')).toHaveText('Mayoría: 4')
  await expect(projector.locator('.pj-turnout')).toContainText('votaron · 2 no votaron')
  await expectBadge(projectorRow(projector, 'Ana Ruiz'), 'Desempate')
  const closed = (await moderatorState(request, assemblyId)).rounds[0]
  expect(closed.eligibleCount).toBe(6)
  expect(closed.outcome.threshold).toBe(4)
  expect(closed.outcome.elected).toEqual([])
})
