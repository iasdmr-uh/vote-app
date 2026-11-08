import { expect, test } from '@playwright/test'
import { closeAndShow, confirm, expectBadge, expectClosedByItself, expectPhoneShowsNoResult, mesaRow, openRoom, prepareBallot, projectorRow, runVote, voteAll } from './helpers'

/**
 * A. An office without majority (#37, #38, #41). Five habilitados, so the majority is 3. Nobody reaches
 * it, closing prepares the runoff between the top 2 plus whoever ties with the 2nd, and the runoff
 * elects. Mesa, projector and phones all show it.
 */
test.describe.configure({ timeout: 180_000 })

test('A · cargo sin mayoría: desempate automático entre los 2 primeros y empates, y la 2.ª votación elige', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea A · cargo sin mayoría', ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Elena Castro'])
  const { mesa, projector, phones } = room

  await prepareBallot(mesa, { kind: 'office', title: 'Presidente', candidates: ['Ana Ruiz', 'Carlos Gómez', 'Rosa Díaz', 'Luis Pérez'] })
  // 4 of 5 vote: Ana 2, Carlos 1, Rosa 1, Luis 0. The majority of 5 is 3, so nobody is elected.
  await runVote(room, [['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Rosa Díaz'], null])

  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('Mayoría: 3')
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('4 de 5')
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('votaron · 1 no votó')
  // Top 2 plus the tie with the 2nd go to the runoff; Luis, with no votes, does not.
  for (const name of ['Ana Ruiz', 'Carlos Gómez', 'Rosa Díaz']) await expectBadge(mesaRow(mesa, name), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Luis Pérez'), null)
  await expect(mesa.getByRole('button', { name: 'Abrir desempate', exact: true })).toBeVisible()

  await expect(projector.locator('.pj-subtitle')).toHaveText('Mayoría: 3')
  await expect(projector.locator('.pj-turnout')).toContainText('4 de 5')
  await expect(projector.locator('.pj-turnout')).toContainText('votaron · 1 no votó')
  for (const name of ['Ana Ruiz', 'Carlos Gómez', 'Rosa Díaz']) await expectBadge(projectorRow(projector, name), 'Desempate')
  await expectBadge(projectorRow(projector, 'Luis Pérez'), null)
  await expect(projector.locator('.pj-elected')).toHaveCount(0)
  // The phones mark the same runoff, not a bare "Empate" between the 2nd and the 3rd.
  await expectPhoneShowsNoResult(phones[4])

  // The mesa never picks: it opens the runoff the server prepared.
  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  await expect(mesa.getByText('VOTACIÓN ABIERTA', { exact: true })).toBeVisible()
  await expect(mesa.locator('.ballot-card .eyebrow-row .badge-info')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
  await expect(projector.locator('.pj-status')).toHaveText(/Votación abierta · DESEMPATE · 2\.ª VOTACIÓN/)
  for (const phone of phones) {
    await expect(phone.page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
    await expect(phone.page.locator('.options input')).toHaveCount(3)
    await expect(phone.page.getByLabel('Luis Pérez', { exact: true })).toHaveCount(0)
  }

  // Everyone votes in the runoff: Ana 3 reaches the majority of 5.
  await voteAll(phones, [['Ana Ruiz'], ['Ana Ruiz'], ['Ana Ruiz'], ['Carlos Gómez'], ['Rosa Díaz']])
  await expectClosedByItself(mesa)
  await closeAndShow(room)

  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('Mayoría: 3')
  await expect(mesa.locator('.ballot-card .voters-total')).toContainText('votaron · 0 no votaron')
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Electo/a')
  await expectBadge(mesaRow(mesa, 'Carlos Gómez'), null)
  await expect(mesa.getByRole('button', { name: /Abrir desempate/ })).toHaveCount(0)
  await expect(mesa.locator('.workflow-steps li.complete')).toHaveCount(5)

  await expect(projector.locator('.pj-status')).toHaveText(/Conteo publicado · DESEMPATE · 2\.ª VOTACIÓN/)
  await expectBadge(projectorRow(projector, 'Ana Ruiz'), '✓ Electo/a')
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ Ana Ruiz')

  for (const phone of phones) await expectPhoneShowsNoResult(phone)
})
