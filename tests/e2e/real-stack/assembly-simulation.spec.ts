import { mkdirSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'
import { expect, test, type Page } from '@playwright/test'
import { addToOfficials, closeAndShow, confirm, expectBadge, expectClosedByItself, expectPhoneShowsNoResult, mesaRow, moderatorState, openRoom, prepareBallot, projectorRow, runVote, vote, voteAll } from './helpers'

/**
 * Simulates a whole Asamblea against the real API and PostgreSQL: nine delegate phones, the projector
 * and the mesa. Union Committee offices (one without majority that goes to a runoff, one annulled and
 * prepared again) and two committees where each delegate marks exactly the committee size. Results are
 * automatic: the mesa only opens, closes, publishes and annuls. Screenshots and timing notes go to
 * SIMULATION_OUTPUT_DIR for the moderator review.
 */
const outDir = process.env.SIMULATION_OUTPUT_DIR ?? 'test-results/assembly-simulation'
const delegateNames = ['María López', 'Carlos Gómez', 'Rosa Díaz', 'Juan Mora', 'Ana Ruiz', 'Luis Pérez', 'Elena Castro', 'Pedro Vargas', 'Sofía Méndez']
const notes: string[] = []
let shot = 0

function note(message: string) {
  notes.push(`[${new Date().toISOString().slice(11, 19)}] ${message}`)
}

async function snap(page: Page, name: string) {
  shot += 1
  await page.screenshot({ path: join(outDir, `${String(shot).padStart(2, '0')}-${name}.png`), fullPage: true })
}

test.describe.configure({ timeout: 600_000 })

test('simulación completa: Comité de la Unión y comisiones', async ({ browser, request }) => {
  mkdirSync(outDir, { recursive: true })
  const consoleErrors: string[] = []
  let started = Date.now()

  // 1. The mesa creates the Asamblea, the projector shows the QR and nine delegates join from their phones.
  const room = await openRoom(browser, request, 'Asamblea Ordinaria Unión Hondureña 2026', delegateNames)
  const { mesa, projector, phones, assemblyId, joinCode } = room
  for (const [name, page] of [['mesa', mesa], ['proyector', projector], ...phones.map((phone) => [phone.name, phone.page] as const)] as const) {
    page.on('console', (message) => { if (message.type() === 'error') consoleErrors.push(`${name}: ${message.text()}`) })
  }
  note(`Ingreso de 9 delegados: ${Math.round((Date.now() - started) / 1000)} s`)
  await snap(mesa, 'mesa-ingreso-cerrado')

  // 2. Presidente: 4 – 4 – 1 over 9 habilitados (majority 5) goes to a runoff of the top 2; it elects.
  started = Date.now()
  await prepareBallot(mesa, { kind: 'office', title: 'Presidente', candidates: ['María López', 'Carlos Gómez', 'Rosa Díaz'] })
  await snap(mesa, 'mesa-presidencia-preparada')
  await runVote(room, phones.map((_, index) => [index < 4 ? 'María López' : index < 8 ? 'Carlos Gómez' : 'Rosa Díaz']))
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('Mayoría: 5')
  await expectBadge(mesaRow(mesa, 'María López'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Carlos Gómez'), 'Desempate')
  await expectBadge(mesaRow(mesa, 'Rosa Díaz'), null)
  await snap(mesa, 'mesa-presidencia-sin-mayoria-M20')
  await snap(projector, 'proyector-presidencia-sin-mayoria')
  await confirm(mesa, 'Abrir desempate', 'Abrir votación')
  await expect(phones[0].page.locator('.phone-status-open')).toHaveText('VOTACIÓN ABIERTA')
  await snap(phones[0].page, 'telefono-desempate-T02')
  await voteAll(phones, phones.map((_, index) => [index < 6 ? 'María López' : 'Carlos Gómez']))
  await expectClosedByItself(mesa)
  await closeAndShow(room)
  await expectBadge(mesaRow(mesa, 'María López'), 'Electo/a')
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ María López')
  await expectPhoneShowsNoResult(phones[3])
  await snap(projector, 'proyector-presidencia-electa')
  await snap(phones[3].page, 'telefono-presidencia-electa')
  note(`Presidente (1.ª votación + desempate): ${Math.round((Date.now() - started) / 1000)} s`)

  await addToOfficials(mesa)
  // 3. Secretario: annulled with a reason while open, then prepared again with a third candidate.
  started = Date.now()
  await prepareBallot(mesa, { kind: 'office', title: 'Secretario', candidates: ['Ana Ruiz', 'Juan Mora'] })
  await confirm(mesa, 'Abrir votación')
  await vote(phones[0], ['Ana Ruiz'])
  await vote(phones[1], ['Juan Mora'])
  await mesa.getByRole('button', { name: 'Anular votación' }).click()
  await mesa.getByRole('dialog').getByLabel('Motivo (obligatorio, queda en el registro)').fill('Faltó incluir a un candidato propuesto por la Asamblea')
  await mesa.getByRole('dialog').getByRole('button', { name: 'Anular papeleta' }).click()
  await expect(mesa.getByText('PAPELETA ANULADA', { exact: true })).toBeVisible()
  await expect(phones[5].page.getByRole('heading', { name: 'Votación anulada' })).toBeVisible()
  await expect(projector.locator('.pj-status')).toHaveText('Votación anulada')
  await snap(mesa, 'mesa-secretaria-anulada')
  await snap(projector, 'proyector-secretaria-anulada')
  await prepareBallot(mesa, { kind: 'office', title: 'Secretario', candidates: ['Ana Ruiz', 'Juan Mora', 'Elena Castro'] })
  await runVote(room, phones.map((_, index) => [index < 5 ? 'Ana Ruiz' : index < 7 ? 'Elena Castro' : 'Juan Mora']))
  await expectBadge(mesaRow(mesa, 'Ana Ruiz'), 'Electo/a')
  await expect(projector.locator('.pj-elected h2')).toHaveText('✓ Ana Ruiz')
  note(`Secretario (anulada + nueva papeleta): ${Math.round((Date.now() - started) / 1000)} s`)

  await addToOfficials(mesa)
  // 4. Comisión de Nombramiento: 5 integrantes among 7 typed names; each delegate marks exactly 5.
  started = Date.now()
  const nominees = ['Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez', 'Juan Mora', 'Rosa Díaz', 'Carlos Gómez']
  await prepareBallot(mesa, { kind: 'committee', title: 'Comisión de Nombramiento', seats: 5, candidates: nominees })
  await expect(mesa.getByText('Cada persona marca exactamente 5')).toBeVisible()
  await confirm(mesa, 'Abrir votación')
  await expect(phones[0].page.locator('.phone-ballot-heading .count-pill')).toHaveText('0 de 5')
  await snap(phones[0].page, 'telefono-nombramiento-T01')
  const summary = mesa.locator('.attendance-summary > span')
  await expect(summary).toHaveText(['0 votaron', '9 faltan'])
  for (const [index, phone] of phones.entries()) {
    await vote(phone, index < 7 ? ['Elena Castro', 'Pedro Vargas', 'Sofía Méndez', 'Luis Pérez', 'Juan Mora'] : ['Rosa Díaz', 'Carlos Gómez', 'Elena Castro', 'Pedro Vargas', 'Sofía Méndez'])
    if (index === 4) {
      await expect(summary).toHaveText(['5 votaron', '4 faltan'])
      await expect(mesa.locator('.mesa-person-list').getByRole('img')).toHaveCount(0)
      await snap(mesa, 'mesa-quien-voto')
    }
  }
  await expectClosedByItself(mesa)
  await closeAndShow(room)
  await expect(mesa.locator('.ballot-card .majority-chip')).toHaveText('5 integrantes · Mayoría: 5')
  for (const name of ['Elena Castro', 'Sofía Méndez']) await expectBadge(mesaRow(mesa, name), 'Electo/a')
  for (const name of ['Pedro Vargas', 'Luis Pérez', 'Juan Mora']) await expectBadge(mesaRow(mesa, name), 'Electo/a')
  for (const name of ['Rosa Díaz', 'Carlos Gómez']) await expectBadge(mesaRow(mesa, name), null)
  await expect(mesa.getByRole('button', { name: /Abrir desempate/ })).toHaveCount(0)
  const projected = projector.locator('.pj-results li')
  await expect(projected).toHaveCount(7)
  // Shares are over the 9 habilitados.
  await expect(projectorRow(projector, 'Elena Castro').locator('.pj-percent')).toHaveText('100 %')
  await expect(projectorRow(projector, 'Luis Pérez').locator('.pj-percent')).toHaveText('78 %')
  await expectBadge(projectorRow(projector, 'Luis Pérez'), '✓ Electo/a')
  await expect(projector.locator('.pj-turnout')).toContainText('9 de 9')
  await snap(projector, 'proyector-nombramiento-P20')
  note(`Comisión de Nombramiento: ${Math.round((Date.now() - started) / 1000)} s`)

  await addToOfficials(mesa)
  // 5. Comisión de Finanzas: 3 integrantes among 4 typed names.
  started = Date.now()
  await prepareBallot(mesa, { kind: 'committee', title: 'Comisión de Finanzas', seats: 3, candidates: ['Ana Ruiz', 'María López', 'Pedro Vargas', 'Rosa Díaz'] })
  await runVote(room, phones.map((_, index) => index < 5 ? ['Ana Ruiz', 'María López', 'Pedro Vargas'] : ['Ana Ruiz', 'Rosa Díaz', 'María López']))
  await expectBadge(mesaRow(mesa, 'Pedro Vargas'), 'Electo/a')
  await expectBadge(mesaRow(mesa, 'Rosa Díaz'), null)
  note(`Comisión de Finanzas: ${Math.round((Date.now() - started) / 1000)} s`)

  // 6. The Asamblea closes; the projector keeps the last count under "Asamblea finalizada".
  await confirm(mesa, 'Finalizar Asamblea…', 'Finalizar Asamblea')
  await expect(mesa.getByText('Asamblea finalizada', { exact: true })).toBeVisible()
  await snap(mesa, 'mesa-asamblea-finalizada')
  await expect(projector.locator('.pj-status')).toHaveText(/^Asamblea finalizada/)
  await expect(phones[0].page.getByRole('heading', { name: 'Asamblea finalizada' })).toBeVisible()
  await snap(projector, 'proyector-finalizada')

  const final = await moderatorState(request, assemblyId)
  const electedOf = (title: string) => final.rounds.find((round: { title: string; committeeRootRoundId: string | null; officialResult: unknown }) => round.title === title && !round.committeeRootRoundId && round.officialResult)
    ?.officialResult.elected.map((person: { label: string }) => person.label).sort()
  expect(electedOf('Presidente')).toEqual(['María López'])
  expect(electedOf('Secretario')).toEqual(['Ana Ruiz'])
  expect(electedOf('Comisión de Nombramiento')).toEqual(['Elena Castro', 'Juan Mora', 'Luis Pérez', 'Pedro Vargas', 'Sofía Méndez'])
  expect(electedOf('Comisión de Finanzas')).toEqual(['Ana Ruiz', 'María López', 'Pedro Vargas'])
  const summaryRows = final.rounds.map((round: { title: string; status: string; voteNumber: number; officialResult?: { elected: Array<{ label: string }> } | null }) =>
    `${round.title} · ${round.voteNumber}.ª · ${round.status}${round.officialResult ? ` · electos: ${round.officialResult.elected.map((person) => person.label).join(', ')}` : ''}`)
  writeFileSync(join(outDir, 'report.json'), `${JSON.stringify({ joinCode, rounds: summaryRows, notes, consoleErrors }, null, 2)}\n`)
})
