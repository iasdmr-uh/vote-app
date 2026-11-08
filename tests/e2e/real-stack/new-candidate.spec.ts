import { expect, test } from '@playwright/test'
import { api, closeAndShow, confirm, expectBadge, expectPhoneShowsNoResult, expectProjectorFinal, mesaRow, moderatorState, moderatorToken, openRoom, prepareBallot, projectorRow, runVote, voteAll } from './helpers'

/**
 * C. A new candidate (#40). The mesa may add one from the 3rd vote on, never in the first runoff. Five
 * habilitados, majority 3: two votes without majority reach a 3rd vote, where the mesa adds a candidate
 * who then gets elected.
 */
test.describe.configure({ timeout: 180_000 })

test('C · candidato nuevo: no se ofrece en la 2.ª votación, sí en la 3.ª, y el nuevo candidato resulta electo', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea C · candidato nuevo', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Pedro Vargas'])
  const { mesa, projector, phones, assemblyId } = room
  const candidateInput = mesa.getByLabel('Nombre del candidato')

  await prepareBallot(mesa, { kind: 'office', title: 'Secretario', candidates: ['Ana Ruiz', 'Carlos Gómez', 'Rosa Díaz'] })
  await expect(candidateInput).toHaveCount(0)
  // 1st vote: Ana 2, Carlos 2, Rosa 1; majority of 5 is 3.
  await runVote(room, [['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez'], ['Rosa Díaz']])
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Carlos Gómez'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Rosa Díaz'), null)

  // The 2nd vote is the first runoff: "Abrir desempate" opens it at once, with no add-candidate input.
  await expect(candidateInput).toHaveCount(0)
  await mesa.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  await expect(mesa.getByRole('dialog')).toContainText('¿Abrir la votación?')
  await expect(candidateInput).toHaveCount(0)
  await mesa.getByRole('dialog').getByRole('button', { name: 'Abrir votación', exact: true }).click()
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await expect(candidateInput).toHaveCount(0)
  // The server agrees: the first runoff takes no new candidate.
  const second = (await moderatorState(request, assemblyId)).rounds[1]
  expect(second.voteNumber).toBe(2)
  const refused = await request.post(`${api}/moderator/rounds/${second.id}/candidates`, { headers: { Authorization: `Bearer ${moderatorToken}` }, data: { label: 'Elena Castro' } })
  expect(refused.status()).toBe(409)

  // 2nd vote: Ana 2, Carlos 2, one does not vote; still no majority.
  await voteAll(phones, [['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez'], null])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('4')
  await closeAndShow(room)
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('votaron · 1 no votó')
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Carlos Gómez'), 'Desempate')

  // 3rd vote (M22): the mesa first sees the ballot, and may add a candidate there.
  await expect(candidateInput).toHaveCount(0)
  await mesa.getByRole('button', { name: 'Abrir desempate', exact: true }).click()
  const draft = mesa.locator('.ballot-card')
  await expect(draft.locator('.eyebrow')).toHaveText('DESEMPATE · 3.ª VOTACIÓN')
  await expect(candidateInput).toBeVisible()
  await candidateInput.fill('Elena Castro')
  await mesa.getByRole('button', { name: '+ Agregar' }).click()
  const added = draft.locator('.runoff-candidates li').filter({ hasText: 'Elena Castro' })
  await expect(added.locator('.badge')).toHaveText('Nuevo')
  await expect(added.getByRole('button', { name: 'Quitar Elena Castro' })).toBeVisible()
  await expect(draft.locator('.runoff-candidates li')).toHaveCount(3)
  // The candidates the previous vote passed on cannot be removed.
  await expect(draft.locator('.runoff-candidates li').filter({ hasText: 'Ana Ruiz' }).getByRole('button')).toHaveCount(0)
  await expect(candidateInput).toHaveValue('')

  await confirm(mesa, 'Abrir votación')
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  for (const phone of phones) {
    await expect(phone.page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
    await expect(phone.page.locator('.options input')).toHaveCount(3)
    await expect(phone.page.getByLabel('Elena Castro', { exact: true })).toBeVisible()
  }
  await voteAll(phones, [['Elena Castro'], ['Elena Castro'], ['Elena Castro'], ['Ana Ruiz'], ['Carlos Gómez']])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('5')
  await closeAndShow(room)

  await expectBadge(mesaRow(mesa, 'Elena Castro'), 'Electo/a')
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), null)
  await expect(mesa.getByRole('button', { name: /Abrir desempate/ })).toHaveCount(0)
  await expectBadge(projectorRow(projector, 'Elena Castro'), '✓ Electo/a')
  await expectProjectorFinal(projector, 'Elena Castro')
  await expect(projector.locator('.pj-status')).toHaveText(/DESEMPATE · 3\.ª VOTACIÓN/)
  for (const phone of phones) await expectPhoneShowsNoResult(phone)
})
