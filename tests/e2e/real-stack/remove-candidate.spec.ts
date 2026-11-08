import { expect, test } from '@playwright/test'
import { closeAndShow, confirm, expectPhoneShowsNoResult, moderatorState, openRoom, participantState, prepareBallot, runVote, voteAll } from './helpers'

/**
 * G. «Quitar» on a candidate the mesa added (#40). Five habilitados, majority 3: two votes without majority
 * reach the 3rd vote, where the mesa adds a candidate and takes it back before opening. The draft keeps
 * only the two from the previous vote, and no phone ever receives the removed name.
 */
test.describe.configure({ timeout: 180_000 })

test('G · quitar un candidato nuevo: sale del borrador y ningún teléfono lo recibe', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea G · quitar candidato', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Pedro Vargas'])
  const { mesa, phones, assemblyId } = room
  const candidateInput = mesa.getByLabel('Nombre del candidato')

  await prepareBallot(mesa, { kind: 'office', title: 'Vicepresidente', candidates: ['Ana Ruiz', 'Carlos Gómez', 'Rosa Díaz'] })
  await runVote(room, [['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez'], ['Rosa Díaz']])
  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await voteAll(phones, [['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez'], null])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('4')
  await closeAndShow(room)

  // 3rd vote draft: add, then Quitar.
  await mesa.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  const draft = mesa.locator('.ballot-card')
  await expect(draft.locator('.eyebrow')).toHaveText('DESEMPATE · 3.ª VOTACIÓN')
  await candidateInput.fill('Elena Castro')
  await mesa.getByRole('button', { name: '+ Agregar' }).click()
  await expect(draft.locator('.runoff-candidates li')).toHaveCount(3)
  await draft.getByRole('button', { name: 'Quitar Elena Castro' }).click()
  await expect(draft.locator('.runoff-candidates li')).toHaveCount(2)
  await expect(draft.locator('.runoff-candidates li')).toHaveText([/Ana Ruiz/, /Carlos Gómez/])
  await expect(draft.locator('.runoff-candidates .badge')).toHaveCount(0)

  // The server stored the removal: the draft holds only the two the 2nd vote passed on.
  const third = (await moderatorState(request, assemblyId)).rounds.at(-1)
  expect(third.status).toBe('draft')
  expect(third.voteNumber).toBe(3)
  expect(third.options.map((option: { label: string }) => option.label)).toEqual(['Ana Ruiz', 'Carlos Gómez'])

  await confirm(mesa, 'Abrir votación')
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  for (const phone of phones) {
    await expect(phone.page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
    await expect(phone.page.locator('.options input')).toHaveCount(2)
    await expect(phone.page.getByText('Elena Castro')).toHaveCount(0)
    const state = await participantState(request, phone.token)
    expect(state.openRound.options.map((option: { label: string }) => option.label)).toEqual(['Ana Ruiz', 'Carlos Gómez'])
  }
  await voteAll(phones, [['Ana Ruiz'], ['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez']])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('5')
  await closeAndShow(room)
  for (const phone of phones) await expectPhoneShowsNoResult(phone)
})
