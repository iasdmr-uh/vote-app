import { expect, test } from '@playwright/test'
import { api, closeAndPublish, confirm, expectBadge, mesaRow, moderatorState, moderatorToken, openRoom, prepareBallot, projectorRow, runVote, vote, voteAll } from './helpers'

/**
 * F. Annulling a first runoff (regression). The repeated runoff is still the 2.ª votación: same label on
 * the mesa, the phones and the projector, and it takes no new candidate.
 */
test.describe.configure({ timeout: 180_000 })

test('F · anular el primer desempate y repetirlo: sigue siendo la 2.ª votación y no admite candidato nuevo', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea F · anular desempate', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Pedro Vargas'])
  const { mesa, projector, phones, assemblyId } = room

  await prepareBallot(mesa, { kind: 'office', title: 'Vicepresidente', candidates: ['Ana Ruiz', 'Carlos Gómez', 'Rosa Díaz'] })
  await runVote(room, [['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez'], ['Rosa Díaz']])
  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  await expect(phones[0].page.locator('.phone-status-open')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await vote(phones[0], ['Ana Ruiz'])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('1')

  // The mesa annuls the open runoff with a reason; phones and projector show it.
  await mesa.getByRole('button', { name: 'Anular votación' }).click()
  const dialog = mesa.getByRole('dialog')
  await dialog.getByLabel('Motivo (obligatorio, queda en el registro)').fill('Se votó antes de leer las candidaturas')
  await dialog.getByRole('button', { name: 'Anular papeleta' }).click()
  await expect(mesa.getByText('PAPELETA ANULADA', { exact: true })).toBeVisible()
  for (const phone of phones) await expect(phone.page.getByRole('heading', { name: 'Votación anulada' })).toBeVisible()
  await expect(projector.locator('.pj-status')).toHaveText('Votación anulada')

  await confirm(mesa, 'Repetir con las mismas opciones', 'Repetir votación')
  await expect(mesa.getByText('PAPELETA PREPARADA', { exact: true })).toBeVisible()
  // Still the 2nd vote: the annulled one does not count, and the M22 add-candidate panel is not offered.
  await expect(mesa.locator('.ballot-card .eyebrow-row .badge-info')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await expect(mesa.getByLabel('Nombre del candidato')).toHaveCount(0)
  await expect(mesa.locator('.ballot-card .ballot-options li')).toHaveText(['Ana Ruiz', 'Carlos Gómez'])
  const rounds = (await moderatorState(request, assemblyId)).rounds
  const repeated = rounds.at(-1)
  expect(rounds.map((round: { status: string }) => round.status)).toEqual(['published', 'annulled', 'draft'])
  expect(repeated.voteNumber).toBe(2)
  expect(repeated.runoff).toBe(true)
  const refused = await request.post(`${api}/moderator/rounds/${repeated.id}/candidates`, { headers: { Authorization: `Bearer ${moderatorToken}` }, data: { label: 'Elena Castro' } })
  expect(refused.status()).toBe(409)
  expect((await refused.json()).message).toBe('Solo se puede agregar un candidato a partir de la 3.ª votación')

  await confirm(mesa, 'Abrir votación')
  await expect(mesa.locator('.ballot-card .eyebrow-row .badge-info')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await expect(projector.locator('.pj-status')).toHaveText(/Votación abierta · DESEMPATE · 2\.ª VOTACIÓN/)
  for (const phone of phones) await expect(phone.page.locator('.phone-status-open')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  // The earlier vote of phone 0 was annulled with its ballot, so that phone votes again.
  await voteAll(phones, [['Ana Ruiz'], ['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Carlos Gómez']])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('5')
  await closeAndPublish(room)

  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Electo/a')
  await expect(mesa.locator('.ballot-card .eyebrow-row .badge-info')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await expectBadge(projectorRow(projector, 'Ana Ruiz'), '✓ Electo/a')
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ Ana Ruiz')
  await expect(phones[4].page.locator('.official-card strong')).toHaveText('Ana Ruiz')
})
