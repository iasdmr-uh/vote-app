import { expect, test } from '@playwright/test'
import {
  castVoteByApi, closeAndShow, confirm, expectBadge, expectClosedByItself, mesaRow, moderatorState, openRoom, participantState, phoneRow, prepareBallot, projectorRow, voteAll,
} from './helpers'

/**
 * B. A committee of 3 (#37, #38, #39), the user's example: the 1st has majority, the 2nd lacks it, the
 * 3rd and 4th tie. Six habilitados, so the majority is 4. The 1st is elected and the runoff is 2nd, 3rd
 * and 4th for 2 seats; runoffs chain until every seat is filled. Every ballot takes exactly the open seats,
 * on the phone and on the server.
 */
test.describe.configure({ timeout: 240_000 })

const candidates = ['Ana Ruiz', 'Bruno Díaz', 'Carla Mora', 'Diego Paz', 'Elsa Vega']

test('B · comisión de 3: 1.º electo, desempate de 2.º, 3.º y 4.º por 2 puestos, selección exacta y desempates encadenados', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea B · comisión de 3', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas'])
  const { mesa, projector, phones, assemblyId } = room

  await prepareBallot(mesa, { kind: 'committee', title: 'Comisión de Finanzas', seats: 3, candidates })
  await confirm(mesa, 'Abrir votación')

  // T01: the button stays disabled until exactly 3 are marked, and a 4th box does not tick.
  const first = phones[0].page
  const review = first.getByRole('button', { name: 'Revisar mi voto' })
  const chip = first.locator('.phone-ballot-heading .count-pill')
  await expect(chip).toHaveText('0 de 3')
  await expect(review).toBeDisabled()
  await first.getByLabel('Ana Ruiz', { exact: true }).check()
  await expect(chip).toHaveText('1 de 3')
  await expect(review).toBeDisabled()
  await first.getByLabel('Bruno Díaz', { exact: true }).check()
  await expect(chip).toHaveText('2 de 3')
  await expect(review).toBeDisabled()
  await first.getByLabel('Carla Mora', { exact: true }).check()
  await expect(chip).toHaveText('3 de 3')
  await expect(review).toBeEnabled()
  await first.getByLabel('Diego Paz', { exact: true }).click()
  await expect(first.getByLabel('Diego Paz', { exact: true })).not.toBeChecked()
  await expect(chip).toHaveText('3 de 3')
  // Unmarking one disables the button again.
  await first.getByLabel('Carla Mora', { exact: true }).uncheck()
  await expect(chip).toHaveText('2 de 3')
  await expect(review).toBeDisabled()
  await first.getByLabel('Carla Mora', { exact: true }).check()
  await review.click()
  await first.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(first.getByText('Tu voto quedó registrado')).toBeVisible()

  // The server checks the count too: a valid participant token with 2 or 4 names is rejected.
  const me = await participantState(request, phones[5].token)
  const roundId = me.openRound.roundId as string
  const idOf = (label: string) => me.openRound.options.find((option: { label: string }) => option.label === label).optionId as string
  for (const marked of [['Ana Ruiz', 'Bruno Díaz'], ['Ana Ruiz', 'Bruno Díaz', 'Carla Mora', 'Diego Paz']]) {
    const rejected = await castVoteByApi(request, phones[5].token, roundId, marked.map(idOf))
    expect(rejected.status()).toBe(422)
    expect((await rejected.json()).message).toBe('Marca exactamente 3 nombres')
  }
  expect((await moderatorState(request, assemblyId)).rounds[0].participationCount).toBe(1)
  // Nothing was recorded, so that phone still has its ballot.
  await expect(phones[5].page.getByRole('button', { name: 'Revisar mi voto' })).toBeVisible()

  // 4 of 6 vote: Ana 4 (majority), Bruno 3, Carla 2, Diego 2, Elsa 1.
  await voteAll(phones, [null, ['Ana Ruiz', 'Bruno Díaz', 'Diego Paz'], ['Ana Ruiz', 'Bruno Díaz', 'Elsa Vega'], ['Ana Ruiz', 'Carla Mora', 'Diego Paz'], null, null])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('4')
  await closeAndShow(room)

  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('3 integrantes · Mayoría: 4')
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('votaron · 2 no votaron')
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Electo/a')
  for (const name of ['Bruno Díaz', 'Carla Mora', 'Diego Paz']) await expectBadge(mesaRow(mesa, name), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Elsa Vega'), null)
  await expectBadge(projectorRow(projector, 'Ana Ruiz'), '✓ Electo/a')
  for (const name of ['Bruno Díaz', 'Carla Mora', 'Diego Paz']) await expectBadge(projectorRow(projector, name), 'Desempate')
  await expect(projector.locator('.pj-subtitle')).toHaveText('3 integrantes · Mayoría: 4')
  await expect(projector.locator('.pj-turnout')).toContainText('votaron · 2 no votaron')
  await expect(phones[0].page.locator('.result-so-far strong')).toHaveText('Ana Ruiz')
  await expect(phones[0].page.locator('.official-card')).toHaveCount(0)
  await expectBadge(phoneRow(phones[0], 'Ana Ruiz'), 'Electo/a')
  for (const name of ['Bruno Díaz', 'Carla Mora', 'Diego Paz']) await expectBadge(phoneRow(phones[0], name), 'Desempate')

  // 2nd vote: the runoff for 2 seats among Bruno, Carla and Diego (T02).
  await confirm(mesa, 'Abrir desempate · 2 puestos', 'Abrir votación')
  await expect(mesa.locator('.ballot-card .eyebrow-row .badge-info')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  const second = phones[0].page
  await expect(second.locator('.phone-status-open')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await expect(second.locator('.options input')).toHaveCount(3)
  await expect(second.getByLabel('Ana Ruiz', { exact: true })).toHaveCount(0)
  await expect(second.locator('.phone-ballot-heading .count-pill')).toHaveText('0 de 2')
  await second.getByLabel('Bruno Díaz', { exact: true }).check()
  await expect(second.getByRole('button', { name: 'Revisar mi voto' })).toBeDisabled()
  await second.getByLabel('Carla Mora', { exact: true }).check()
  await second.getByLabel('Diego Paz', { exact: true }).click()
  await expect(second.getByLabel('Diego Paz', { exact: true })).not.toBeChecked()
  await expect(second.locator('.phone-ballot-heading .count-pill')).toHaveText('2 de 2')
  await second.getByRole('button', { name: 'Revisar mi voto' }).click()
  await second.getByRole('button', { name: 'Confirmar voto' }).click()
  await expect(second.getByText('Tu voto quedó registrado')).toBeVisible()

  const runoff = await participantState(request, phones[5].token)
  const runoffId = (label: string) => runoff.openRound.options.find((option: { label: string }) => option.label === label).optionId as string
  const three = await castVoteByApi(request, phones[5].token, runoff.openRound.roundId, ['Bruno Díaz', 'Carla Mora', 'Diego Paz'].map(runoffId))
  expect(three.status()).toBe(422)
  expect((await three.json()).message).toBe('Marca exactamente 2 nombres')

  // Bruno 5 is elected; Carla 3 lacks the majority of 4, so Carla and Diego go to a 3rd vote for 1 seat.
  await voteAll(phones, [null, ['Bruno Díaz', 'Carla Mora'], ['Bruno Díaz', 'Carla Mora'], ['Bruno Díaz', 'Diego Paz'], ['Bruno Díaz', 'Diego Paz'], null])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('5')
  await closeAndShow(room)
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('2 puestos · Mayoría: 4')
  await expectBadge(mesaRow(mesa, 'Bruno Díaz'), 'Electo/a')
  await expectBadge(mesaRow(mesa, 'Carla Mora'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Diego Paz'), 'Desempate')
  await expect(projector.locator('.result-so-far')).toContainText('Electos hasta ahora · 2 de 3')
  await expect(projector.locator('.pj-elected')).toHaveCount(0)
  await expect(phones[3].page.locator('.result-so-far strong')).toHaveText('Ana Ruiz · Bruno Díaz')
  await expect(phones[3].page.locator('.official-card')).toHaveCount(0)
  await expectBadge(phoneRow(phones[3], 'Bruno Díaz'), 'Electo/a')

  // 3rd vote, 1 seat: it may take a new candidate (#40), but this one opens as it is.
  await mesa.getByRole('button', { name: 'Abrir desempate · 1 puesto', exact: true }).click()
  await expect(mesa.locator('.ballot-card .eyebrow')).toHaveText('DESEMPATE · 3.ª VOTACIÓN')
  await confirm(mesa, 'Abrir votación')
  for (const phone of phones) {
    await expect(phone.page.locator('.phone-status-open')).toHaveText('DESEMPATE · 3.ª VOTACIÓN')
    await expect(phone.page.locator('.phone-ballot-heading .count-pill')).toHaveText('0 de 1')
  }
  await voteAll(phones, [['Carla Mora'], ['Carla Mora'], ['Carla Mora'], ['Carla Mora'], ['Diego Paz'], ['Diego Paz']])
  await expectClosedByItself(mesa)
  await closeAndShow(room)

  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('1 puesto · Mayoría: 4')
  await expectBadge(mesaRow(mesa, 'Carla Mora'), 'Electo/a')
  await expectBadge(mesaRow(mesa, 'Diego Paz'), null)
  await expect(mesa.getByRole('button', { name: /Abrir desempate/ })).toHaveCount(0)
  await expectBadge(projectorRow(projector, 'Carla Mora'), '✓ Electo/a')
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ Ana Ruiz · Bruno Díaz · Carla Mora')
  await expect(phones[5].page.locator('.official-card strong')).toHaveText('Ana Ruiz · Bruno Díaz · Carla Mora')

  // Every seat is filled: no draft is left and the official result holds the three.
  const final = await moderatorState(request, assemblyId)
  expect(final.rounds.map((round: { status: string }) => round.status)).toEqual(['published', 'published', 'published'])
  expect(final.rounds[0].officialResult.elected.map((person: { label: string }) => person.label).sort()).toEqual(['Ana Ruiz', 'Bruno Díaz', 'Carla Mora'])
})

