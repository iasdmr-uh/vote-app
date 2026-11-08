import { expect, test } from '@playwright/test'
import { closeAndShow, confirm, expectBadge, expectClosedByItself, mesaRow, openRoom, phoneRow, prepareBallot, projectorRow, voteAll } from './helpers'

test.describe.configure({ timeout: 240_000 })

const delegates = ['Delegado 1', 'Delegado 2', 'Delegado 3', 'Delegado 4', 'Delegado 5', 'Delegado 6']
const candidates = ['Isaías', 'Jeremías', 'Ezequiel', 'Daniel', 'Oseas', 'Joel', 'Amós']
const firstThree = ['Isaías', 'Jeremías', 'Ezequiel']

test('comisión de 5: a 3 de 5 el resultado es preliminar y a 5 de 5 es oficial', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea · resultado preliminar', delegates)
  const { mesa, projector, phones } = room

  await prepareBallot(mesa, { kind: 'committee', title: 'Comisión de Disciplina', seats: 5, candidates })
  await confirm(mesa, 'Abrir votación')
  await voteAll(phones, [
    [...firstThree, 'Daniel', 'Oseas'],
    [...firstThree, 'Daniel', 'Oseas'],
    [...firstThree, 'Daniel', 'Joel'],
    [...firstThree, 'Oseas', 'Amós'],
    [...firstThree, 'Joel', 'Amós'],
    [...firstThree, 'Joel', 'Amós'],
  ])
  await expectClosedByItself(mesa)
  await closeAndShow(room)

  const soFar = 'Electos hasta ahora · 3 de 5'
  await expect(mesa.locator('.result-so-far')).toContainText(soFar)
  await expect(projector.locator('.result-so-far')).toContainText(soFar)
  for (const phone of phones) await expect(phone.page.locator('.result-so-far')).toContainText(soFar)
  await expect(phones[0].page.locator('.result-so-far strong')).toHaveText('Isaías · Jeremías · Ezequiel')
  for (const name of firstThree) {
    await expectBadge(mesaRow(mesa, name), 'Electo/a')
    await expectBadge(projectorRow(projector, name), '✓ Electo/a')
    await expectBadge(phoneRow(phones[0], name), 'Electo/a')
  }
  await expect(projector.locator('.pj-elected')).toHaveCount(0)
  for (const area of [mesa.locator('.ballot-card'), projector.locator('body'), phones[0].page.locator('body')]) await expect(area).not.toContainText(/oficial\b|resultado final/i)
  await expect(phones[0].page.locator('.official-card')).toHaveCount(0)

  await confirm(mesa, 'Abrir desempate · 2 puestos', 'Abrir votación')
  for (const name of firstThree) await expect(phones[0].page.getByLabel(name, { exact: true })).toHaveCount(0)
  await voteAll(phones, [['Daniel', 'Oseas'], ['Daniel', 'Oseas'], ['Daniel', 'Oseas'], ['Daniel', 'Oseas'], ['Joel', 'Amós'], ['Joel', 'Amós']])
  await expectClosedByItself(mesa)
  await closeAndShow(room)

  const everyone = 'Isaías · Jeremías · Ezequiel · Daniel · Oseas'
  for (const page of [mesa, projector, ...phones.map((phone) => phone.page)]) {
    await expect(page.locator('.result-so-far')).toHaveCount(0)
    await expect(page.locator('.result-summary')).toContainText('Resultado final')
  }
  await expect(projector.locator('.pj-elected h2')).toHaveText(`✓ ${everyone}`)
  await expect(phones[0].page.locator('.official-card')).toContainText('RESULTADO OFICIAL')
  await expect(phones[0].page.locator('.official-card strong')).toHaveText(everyone)
})
