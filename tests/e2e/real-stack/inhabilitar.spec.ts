import { expect, test, type Page } from '@playwright/test'
import { castVoteByApi, closeAndShow, confirm, expectBadge, mesaRow, moderatorState, openRoom, participantState, prepareBallot, projectorRow, vote, voteAll } from './helpers'

test.describe.configure({ timeout: 180_000 })

function person(mesa: Page, name: string) {
  return mesa.locator('.mesa-person-list li').filter({ hasText: name })
}

test('D · inhabilitar antes de una votación: el teléfono no recibe la papeleta, el servidor rechaza el voto, sigue en la base y la mesa no cambia nada mientras se vota', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea D · inhabilitar', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas'])
  const { mesa, projector, phones, assemblyId } = room
  const [maria, carlos, , juan, elena, pedro] = phones
  const summary = mesa.locator('.attendance-summary')

  await prepareBallot(mesa, { kind: 'office', title: 'Tesorero', candidates: ['Ana Ruiz', 'Juan Mora'] })
  for (const name of ['Carlos Gómez', 'Rosa Díaz']) {
    await person(mesa, name).getByLabel(`Acciones para ${name}`).click()
    await person(mesa, name).getByRole('button', { name: 'Inhabilitar' }).click()
    await expect(person(mesa, name).locator('.badge-disabled')).toHaveText('Inhabilitado')
  }
  await confirm(mesa, 'Abrir votación')
  await vote(maria, ['Ana Ruiz'])
  await expect(summary.locator(':scope > span')).toHaveText(['1 votó', '3 faltan', '2 inhabilitados'])

  await expect(carlos.page.getByRole('heading', { name: 'Voto inhabilitado' })).toBeVisible()
  await expect(carlos.page.locator('.options')).toHaveCount(0)
  await expect(carlos.page.getByRole('button', { name: 'Revisar mi voto' })).toHaveCount(0)
  const withheld = await participantState(request, carlos.token)
  expect(withheld.votingDisabled).toBe(true)
  expect(withheld.openRound.options).toEqual([])
  const rounds = (await moderatorState(request, assemblyId)).rounds
  const ana = rounds[0].options.find((option: { label: string }) => option.label === 'Ana Ruiz').id
  const rejected = await castVoteByApi(request, carlos.token, rounds[0].id, [ana])
  expect(rejected.status()).toBe(403)
  expect((await rejected.json()).message).toBe('Tu voto está inhabilitado')
  expect((await moderatorState(request, assemblyId)).rounds[0].participationCount).toBe(1)

  await expect(person(mesa, 'Carlos Gómez').getByRole('button', { name: 'Habilitar' })).toHaveCount(0)
  await expect(person(mesa, 'Juan Mora').getByLabel('Acciones para Juan Mora')).toHaveCount(0)
  await expect(mesa.locator('.mesa-participants .count-pill')).toHaveText('6')

  await voteAll([juan, elena, pedro], [['Ana Ruiz'], ['Ana Ruiz'], ['Juan Mora']])
  await expect(summary.locator(':scope > span')).toHaveText(['4 votaron', '0 faltan', '2 inhabilitados'])
  await expect(projector.locator('.pj-progress')).toContainText('de 6 ya votaron')
  await closeAndShow(room)

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

  await person(mesa, 'Carlos Gómez').getByRole('button', { name: 'Habilitar' }).click()
  await expect(person(mesa, 'Carlos Gómez').locator('.badge-disabled')).toHaveCount(0)
  await expect(carlos.page.getByRole('heading', { name: 'Voto inhabilitado' })).toHaveCount(0)
})
