import { expect, test } from '@playwright/test'
import { addToOfficials, closeAndShow, confirm, expectPhoneShowsNoResult, expectProjectorFinal, openRoom, prepareBallot, runVote, voteAll, type Room } from './helpers'

test.describe.configure({ timeout: 240_000 })

const delegates = Array.from({ length: 7 }, (_, index) => `Delegado ${index + 1}`)
const favor = ['A favor']
const contra = ['En contra']
const rule = 'Se aprueba con 2/3 · 5 votos'

async function expectVerdict(room: Room, verdict: 'Aprobada' | 'No aprobada') {
  const { mesa, projector, phones } = room
  await expect(mesa.locator('.ballot-card .decision-verdict')).toHaveText(verdict)
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText(rule)
  await expectProjectorFinal(projector, verdict)
  await expect(projector.locator('.pj-subtitle')).toHaveText(rule)
  for (const phone of phones) await expectPhoneShowsNoResult(phone)
}

test('2/3 con 7 en la sala: 5 votos aprueban, 4 no aprueban aunque sean mayoría', async ({ browser, request }) => {
  const room = await openRoom(browser, request, 'Asamblea 2/3', delegates)
  const { mesa, phones } = room

  await prepareBallot(mesa, { kind: 'decision', title: 'Reforma de Estatutos', format: 'boolean', rule: 'two_thirds' })
  await confirm(mesa, 'Abrir votación')
  for (const phone of phones) {
    await expect(phone.page.locator('.options label')).toHaveText(['A favor', 'En contra'])
    await expect(phone.page.getByText(/Se aprueba con/)).toHaveCount(0)
  }
  await voteAll(phones, [favor, favor, favor, favor, favor, contra, contra])
  await expect(mesa.locator('.vote-progress strong')).toHaveText('7')
  await closeAndShow(room)
  await expectVerdict(room, 'Aprobada')

  await addToOfficials(mesa)
  await prepareBallot(mesa, { kind: 'decision', title: 'Cambio de sede', format: 'boolean', rule: 'two_thirds' })
  await runVote(room, [favor, favor, favor, favor, contra, contra, null])
  await expectVerdict(room, 'No aprobada')
})
