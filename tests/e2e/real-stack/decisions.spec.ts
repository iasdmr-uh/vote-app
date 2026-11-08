import { expect, test, type Page } from '@playwright/test'
import { addToOfficials, closeAndShow, confirm, expectBadge, mesaRow, openRoom, phoneRow, prepareBallot, projectorRow, runVote, voteAll, type Room } from './helpers'

/**
 * E. Decisions (#42). Six habilitados: mayoría simple is 4 and 3/4 is 5 (ceil of 4.5). A favor / En
 * contra settles on its single vote; a decision with options repeats between the top 2 plus ties until
 * one reaches the rule.
 */
test.describe.configure({ timeout: 240_000 })

const delegates = ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Elena Castro', 'Pedro Vargas']
const favor = ['A favor']
const contra = ['En contra']

async function expectVerdict(room: Room, verdict: 'Aprobada' | 'No aprobada', rule: string) {
  const { mesa, projector, phones } = room
  await expect(mesa.locator('.ballot-card .decision-verdict')).toHaveText(verdict)
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText(rule)
  // P21: the banner and the rule on the projector; the phones get the verdict too.
  await expect(projector.locator('.pj-elected h2')).toHaveText(verdict === 'Aprobada' ? '✓ Aprobada' : 'No aprobada')
  if (verdict === 'Aprobada') await expect(projector.locator('.pj-elected')).not.toHaveClass(/pj-rejected/)
  else await expect(projector.locator('.pj-elected')).toHaveClass(/pj-rejected/)
  await expect(projector.locator('.pj-subtitle')).toHaveText(rule)
  for (const phone of phones) await expect(phone.page.locator('.official-card strong')).toHaveText(verdict)
  // A favor / En contra never repeats.
  await expect(mesa.getByRole('button', { name: /Abrir desempate/ })).toHaveCount(0)
}

async function projectorShares(projector: Page, rows: Array<[string, string, string]>) {
  for (const [label, votes, percent] of rows) {
    await expect(projectorRow(projector, label).locator('.pj-votes')).toHaveText(votes)
    await expect(projectorRow(projector, label).locator('.pj-percent')).toHaveText(percent)
  }
}

test('E · decisiones: 3/4 aprobada y no aprobada, empate 50/50 con mayoría simple, y opciones que se repiten entre las 2 primeras', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea E · decisiones', delegates)
  const { mesa, projector, phones } = room

  // 3/4 reached: 5 of 6 A favor.
  await prepareBallot(mesa, { kind: 'decision', title: 'Reforma del reglamento', format: 'boolean', rule: 'three_quarters' })
  await expect(mesa.locator('.ballot-card .ballot-options li')).toHaveText(['A favor', 'En contra'])
  await confirm(mesa, 'Abrir votación')
  await expect(phones[0].page.locator('.options label')).toHaveText(['A favor', 'En contra'])
  await expect(phones[0].page.locator('.options input[type=radio]')).toHaveCount(2)
  await voteAll(phones, [favor, favor, favor, favor, favor, contra])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('6')
  await closeAndShow(room)
  await expectVerdict(room, 'Aprobada', 'Se aprueba con 3/4 · 5 votos')
  await projectorShares(projector, [['A favor', '5 votos', '83 %'], ['En contra', '1 voto', '17 %']])
  // A favor stays first on the projector, unranked.
  await expect(projector.locator('.pj-results li .pj-label')).toHaveText(['A favor', 'En contra'])
  await expect(projector.locator('.pj-rank')).toHaveCount(0)

  await addToOfficials(mesa)
  // 3/4 missed: 4 of 6 would pass with mayoría simple, but not with 3/4.
  await prepareBallot(mesa, { kind: 'decision', title: 'Cambio de sede', format: 'boolean', rule: 'three_quarters' })
  await runVote(room, [favor, favor, favor, favor, contra, contra])
  await expectVerdict(room, 'No aprobada', 'Se aprueba con 3/4 · 5 votos')
  await projectorShares(projector, [['A favor', '4 votos', '67 %'], ['En contra', '2 votos', '33 %']])

  await addToOfficials(mesa)
  // 50/50 with mayoría simple: exactly half is not a majority.
  await prepareBallot(mesa, { kind: 'decision', title: 'Presupuesto 2027', format: 'boolean', rule: 'simple' })
  await runVote(room, [favor, favor, favor, contra, contra, contra])
  await expectVerdict(room, 'No aprobada', 'Se aprueba con mayoría simple · 4 votos')
  await projectorShares(projector, [['A favor', '3 votos', '50 %'], ['En contra', '3 votos', '50 %']])
  await expect(projector.locator('.pj-tie')).toHaveCount(0)
  await expectBadge(phoneRow(phones[0], 'A favor'), null)

  await addToOfficials(mesa)
  // Options without majority repeat between the top 2 plus ties, then one option reaches the rule.
  await prepareBallot(mesa, { kind: 'decision', title: 'Sede 2027', format: 'options', rule: 'simple', options: ['Tegucigalpa', 'San Pedro Sula', 'La Ceiba'] })
  await runVote(room, [['Tegucigalpa'], ['Tegucigalpa'], ['Tegucigalpa'], ['San Pedro Sula'], ['San Pedro Sula'], ['La Ceiba']])
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('Se aprueba con mayoría simple · 4 votos')
  await expect(mesa.locator('.ballot-card .decision-verdict')).toHaveCount(0)
  await expectBadge(mesaRow(mesa, 'Tegucigalpa'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'San Pedro Sula'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'La Ceiba'), null)
  await expectBadge(projectorRow(projector, 'Tegucigalpa'), 'Desempate')
  await expect(projector.locator('.pj-elected')).toHaveCount(0)

  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  // A decision never takes a new candidate, so the repeat opens at once.
  await expect(mesa.getByLabel('Nombre del candidato')).toHaveCount(0)
  for (const phone of phones) {
    await expect(phone.page.locator('.phone-status-open')).toHaveText('DESEMPATE · 2.ª VOTACIÓN')
    await expect(phone.page.locator('.options label')).toHaveText(['Tegucigalpa', 'San Pedro Sula'])
  }
  await voteAll(phones, [['Tegucigalpa'], ['Tegucigalpa'], ['Tegucigalpa'], ['Tegucigalpa'], ['San Pedro Sula'], ['San Pedro Sula']])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('6')
  await closeAndShow(room)
  await expect(mesa.locator('.ballot-card .decision-verdict')).toHaveText('Tegucigalpa')
  await expectBadge(mesaRow(mesa, 'Tegucigalpa'), 'Aprobada')
  await expectBadge(mesaRow(mesa, 'San Pedro Sula'), null)
  await expect(mesa.getByRole('button', { name: /Abrir desempate/ })).toHaveCount(0)
  await expectBadge(projectorRow(projector, 'Tegucigalpa'), '✓ Aprobada')
  await expect(projector.locator('.pj-subtitle')).toHaveText('Se aprueba con mayoría simple · 4 votos')
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ Tegucigalpa')
  for (const phone of phones) await expect(phone.page.locator('.official-card strong')).toHaveText('Tegucigalpa')
  await expectBadge(phoneRow(phones[0], 'Tegucigalpa'), 'Aprobada')
})
